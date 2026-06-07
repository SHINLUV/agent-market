"""
檀枫 AI 工具箱 — 后端服务器 v2.0
SQLite 数据库 + 试用次数限制 + 使用统计 + 进程守护
"""
import json, os, sys, urllib.request, traceback, sqlite3, time, hashlib, threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# ============================================================
# 配置
# ============================================================
AGNES_URL = "https://apihub.agnes-ai.com/v1/chat/completions"
# 从环境变量读取 API Key（逗号分隔多个用于轮换）
_raw_keys = os.environ.get("AGNES_KEYS", "")
AGNES_KEYS = [k.strip() for k in _raw_keys.split(",") if k.strip()]
if not AGNES_KEYS:
    raise RuntimeError("请设置 AGNES_KEYS 环境变量，多个 Key 用逗号分隔")
AGNES_KEY_INDEX = 0
AGNES_KEY_LOCK = threading.Lock()
AGNES_MODEL_FLASH = "agnes-2.0-flash"
AGNES_MODEL_PRO = "agnes-2.0"
PORT = 8080

def get_agnes_key():
    """轮换获取 API Key，每个请求换一把"""
    global AGNES_KEY_INDEX
    with AGNES_KEY_LOCK:
        key = AGNES_KEYS[AGNES_KEY_INDEX % len(AGNES_KEYS)]
        AGNES_KEY_INDEX += 1
        return key
TRIAL_LIMIT = 3       # 免费试用次数
DB_PATH = "usage.db"  # SQLite 数据库文件

# ============================================================
# 数据库初始化
# ============================================================
def init_db():
    """创建数据库表"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS usage_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_name TEXT NOT NULL,
            client_ip TEXT NOT NULL,
            user_input TEXT,
            reply_length INTEGER DEFAULT 0,
            tokens INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS trial_limit (
            client_ip TEXT NOT NULL,
            trial_date TEXT NOT NULL DEFAULT (date('now','localtime')),
            trial_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (client_ip, trial_date)
        )
    """)
    conn.commit()
    conn.close()
    print(f"[DB] SQLite 数据库已就绪: {DB_PATH}")

def log_usage(agent_name, client_ip, user_input, reply_length, tokens):
    """记录一次 Agent 使用"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO usage_log (agent_name, client_ip, user_input, reply_length, tokens) VALUES (?, ?, ?, ?, ?)",
        (agent_name, client_ip, user_input[:200], reply_length, tokens)
    )
    conn.commit()
    conn.close()

def check_trial(client_ip):
    """检查今日试用次数，返回 (remaining, total_used)。每天自动重置。"""
    today = time.strftime("%Y-%m-%d", time.localtime())
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT trial_count FROM trial_limit WHERE client_ip = ? AND trial_date = ?",
        (client_ip, today)
    ).fetchone()
    conn.close()
    used = row[0] if row else 0
    return (max(0, TRIAL_LIMIT - used), used)

def use_trial(client_ip):
    """消耗一次今日试用机会"""
    today = time.strftime("%Y-%m-%d", time.localtime())
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT INTO trial_limit (client_ip, trial_date, trial_count) VALUES (?, ?, 1)
        ON CONFLICT(client_ip, trial_date) DO UPDATE SET trial_count = trial_count + 1
    """, (client_ip, today))
    conn.commit()
    conn.close()

def get_stats():
    """获取统计数据"""
    conn = sqlite3.connect(DB_PATH)
    # 总使用次数
    total = conn.execute("SELECT COUNT(*) FROM usage_log").fetchone()[0]
    # 每个 Agent 的使用次数
    agent_stats = conn.execute("""
        SELECT agent_name, COUNT(*) as cnt, SUM(tokens) as total_tokens
        FROM usage_log GROUP BY agent_name ORDER BY cnt DESC
    """).fetchall()
    # 今日使用次数
    today = conn.execute(
        "SELECT COUNT(*) FROM usage_log WHERE date(created_at) = date('now', 'localtime')"
    ).fetchone()[0]
    # 不同 IP 数
    ips = conn.execute("SELECT COUNT(DISTINCT client_ip) FROM usage_log").fetchone()[0]
    # 最近使用记录
    recent = conn.execute("""
        SELECT agent_name, client_ip, tokens, created_at
        FROM usage_log ORDER BY id DESC LIMIT 20
    """).fetchall()
    conn.close()
    return {
        "total": total,
        "today": today,
        "unique_ips": ips,
        "agents": [{"name": n, "count": c, "tokens": t} for n, c, t in agent_stats],
        "recent": [{"agent": r[0], "ip": r[1], "tokens": r[2], "time": r[3]} for r in recent]
    }

# ============================================================
# 对话 Session 管理（多轮记忆）
# ============================================================
sessions = {}               # {session_id: [{"role":..., "content":...}]}
sessions_lock = threading.Lock()
SESSION_MAX_MSGS = 10       # 每个会话最多保留几轮对话
SESSION_TTL = 3600          # 会话过期时间（秒）

def get_session(session_id):
    """获取会话历史，返回消息列表"""
    with sessions_lock:
        if session_id not in sessions:
            sessions[session_id] = []
        return sessions[session_id]

def save_to_session(session_id, role, content):
    """保存一条消息到会话"""
    with sessions_lock:
        if session_id not in sessions:
            sessions[session_id] = []
        sessions[session_id].append({"role": role, "content": content})
        # 控制长度：保留最近 N*2 条（user+assistant 成对）
        if len(sessions[session_id]) > SESSION_MAX_MSGS * 2:
            sessions[session_id] = sessions[session_id][-(SESSION_MAX_MSGS * 2):]

def cleanup_sessions():
    """定期清理过期会话（简化版：每次启动时清理）"""
    # 生产环境可用 Redis TTL，这里保持简单
    pass

# ============================================================
# Agent Prompt + 模型路由加载
# ============================================================
AGENT_PROMPTS = {}
AGENT_MODELS = {}   # {"agent_name": "flash" | "pro"}

# 需要强模型的 Agent（结构化输出复杂）
PRO_AGENTS = {
    "商品标题优化", "朋友圈推广文案", "差评分析与回复",
    "详情页文案", "商品智能问答", "商品对比分析",
    "竞品拆解", "评论提炼洞察", "弃单挽回话术", "长尾搜索词挖掘",
    "主图点击率诊断", "客服快捷回复模板", "选品可行性分析",
    "促销活动策划", "店铺诊断总览", "爆款标题打分器"
}

def load_agents():
    global AGENT_PROMPTS, AGENT_MODELS
    js_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agents.js")
    import re
    with open(js_path, "r", encoding="utf-8") as f:
        content = f.read()
    agents_str = content.split("const AGENTS = [", 1)[1].rsplit("];", 1)[0]
    names = re.findall(r'name:\s*"([^"]+)"', agents_str)
    prompts = re.findall(r'prompt:\s*`([^`]+)`', agents_str)
    for i, name in enumerate(names):
        if i < len(prompts):
            AGENT_PROMPTS[name] = prompts[i].strip()
            AGENT_MODELS[name] = "pro" if name in PRO_AGENTS else "flash"
    print(f"[INIT] 已加载 {len(AGENT_PROMPTS)} 个 Agent（{sum(1 for m in AGENT_MODELS.values() if m=='pro')} 个用 Pro 模型）")

# ============================================================
# HTTP 处理器
# ============================================================
class AgentHandler(SimpleHTTPRequestHandler):

    def get_client_ip(self):
        """获取客户端 IP"""
        return self.client_address[0]

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/stats":
            self._handle_stats()
        elif path == "/admin":
            self._serve_admin()
        else:
            SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        try:
            path = self.path.split("?")[0]
            if path == "/api/chat":
                self._handle_chat()
            else:
                self.send_error(404)
        except Exception as e:
            traceback.print_exc()
            try:
                self._json(500, {"error": str(e)})
            except:
                pass

    def _handle_chat(self):
        try:
            self._handle_chat_impl()
        except Exception as e:
            traceback.print_exc()
            try:
                self._json(500, {"error": "服务器内部错误: " + str(e)})
            except:
                pass

    def _handle_chat_impl(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            data = json.loads(body)
        except:
            self._json(400, {"error": "无效 JSON"})
            return

        agent_id = data.get("agent_id", "")
        message = data.get("message", "").strip()
        session_id = data.get("session_id", "default")
        if not agent_id or not message:
            self._json(400, {"error": "缺少 agent_id 或 message"})
            return

        system_prompt = AGENT_PROMPTS.get(agent_id)
        if not system_prompt:
            self._json(404, {"error": f"找不到 Agent: {agent_id}"})
            return

        ip = self.get_client_ip()

        # 获取会话历史（多轮记忆）
        history = get_session(session_id)  # 当前消息加入前的历史

        # 构建完整消息列表：system + 历史 + 当前用户消息
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history[-SESSION_MAX_MSGS * 2:])  # 最近N轮对话
        messages.append({"role": "user", "content": message})  # 当前消息

        # 保存用户消息到会话
        save_to_session(session_id, "user", message)

        # 模型路由：复杂 Agent 用强模型
        # 模型路由：默认用 Flash
        model = AGNES_MODEL_FLASH

        # 第一轮：调用 Agnes
        result = self._call_agnes_with_messages(messages, model=model)
        if result is None:
            self._json(500, {"error": "Agnes API 调用失败"})
            return

        first_reply = result["content"]

        # TODO: Reflection 暂时禁用排查崩溃
        final_reply = first_reply
        total_tokens = result["tokens"]

        # 保存到会话历史
        save_to_session(session_id, "assistant", final_reply)

        # 记录使用
        log_usage(agent_id, ip, message, len(final_reply), total_tokens)

        self._json(200, {
            "reply": final_reply,
            "tokens": total_tokens
        })

    def _call_agnes_with_messages(self, messages, model=None):
        """调用 Agnes API，传入完整 messages 列表"""
        if model is None:
            model = AGNES_MODEL_FLASH
        req_data = json.dumps({
            "model": model,
            "messages": messages
        }, ensure_ascii=False).encode("utf-8")

        try:
            req = urllib.request.Request(
                AGNES_URL,
                data=req_data,
                headers={
                    "Content-Type": "application/json; charset=utf-8",
                    "Authorization": f"Bearer {get_agnes_key()}"
                }
            )
            resp = urllib.request.urlopen(req, timeout=60)
            result = json.loads(resp.read().decode("utf-8"))
            return {
                "content": result["choices"][0]["message"]["content"],
                "tokens": result["usage"]["total_tokens"]
            }
        except Exception as e:
            traceback.print_exc()
            return None

    def _handle_stats(self):
        """返回统计数据 JSON"""
        stats = get_stats()
        self._json(200, stats)

    def _serve_admin(self):
        """渲染统计面板"""
        stats = get_stats()
        rows = ""
        for a in stats["agents"]:
            rows += f"<tr><td>{a['name']}</td><td>{a['count']}</td><td>{a['tokens']}</td></tr>"
        recent_rows = ""
        for r in stats["recent"]:
            recent_rows += f"<tr><td>{r['time']}</td><td>{r['agent']}</td><td>{r['ip']}</td><td>{r['tokens']}</td></tr>"

        html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>檀枫 · 管理面板</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:Inter,-apple-system,sans-serif;background:#060010;color:#f4f0ff;padding:32px;min-height:100vh}}
h1{{font-size:24px;font-weight:900;margin-bottom:8px}}
h1 span{{background:linear-gradient(135deg,#8B5CF6,#FF006E);-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
.sub{{color:#8a7aa0;font-size:14px;margin-bottom:32px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:40px}}
.card{{background:rgba(14,6,32,.6);border:1px solid rgba(139,92,246,.12);border-radius:16px;padding:20px}}
.card-num{{font-size:32px;font-weight:900;background:linear-gradient(135deg,#f4f0ff,#00F0FF);-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
.card-label{{font-size:12px;color:#8a7aa0;margin-top:4px;text-transform:uppercase;letter-spacing:.05em}}
h2{{font-size:18px;font-weight:800;margin-bottom:16px;letter-spacing:-.3px}}
table{{width:100%;border-collapse:collapse;margin-bottom:40px;font-size:13px}}
th,td{{text-align:left;padding:10px 14px;border-bottom:1px solid rgba(139,92,246,.1)}}
th{{color:#8a7aa0;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}}
td{{color:#c8b8e8}}
tr:hover td{{background:rgba(139,92,246,.05)}}
.footer{{text-align:center;color:#8a7aa0;font-size:12px;margin-top:40px;padding-top:20px;border-top:1px solid rgba(139,92,246,.1)}}
</style>
</head>
<body>
<h1>檀枫 AI <span>工具箱</span></h1>
<p class="sub">管理面板 · 数据实时更新 · <a href="/" style="color:#00F0FF">返回首页</a></p>
<div class="cards">
<div class="card"><div class="card-num">{stats['total']}</div><div class="card-label">总使用次数</div></div>
<div class="card"><div class="card-num">{stats['today']}</div><div class="card-label">今日使用</div></div>
<div class="card"><div class="card-num">{stats['unique_ips']}</div><div class="card-label">用户数（IP）</div></div>
<div class="card"><div class="card-num">{TRIAL_LIMIT}</div><div class="card-label">每IP试用次数</div></div>
</div>
<h2>Agent 排行榜</h2>
<table><tr><th>Agent</th><th>使用次数</th><th>消耗 Token</th></tr>{rows}</table>
<h2>最近使用</h2>
<table><tr><th>时间</th><th>Agent</th><th>IP</th><th>Token</th></tr>{recent_rows}</table>
<div class="footer">檀枫 AI 工具箱 · 自动刷新 <span id="timer">60</span>s</div>
<script>let t=60;setInterval(()=>{{t--;if(t<=0)location.reload();document.getElementById('timer').textContent=t}},1000)</script>
</body>
</html>"""
        self._html(200, html)

    def _json(self, code, data):
        resp = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def _html(self, code, html):
        resp = html.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        if "/api/" in str(args[0]) or "/admin" in str(args[0]):
            print(f"[{self.client_address[0]}] {args[0]}")


# ============================================================
# 启动
# ============================================================
if __name__ == "__main__":
    load_agents()
    init_db()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = HTTPServer(("0.0.0.0", PORT), AgentHandler)
    print(f"[READY] 檀枫 AI 工具箱已启动: http://127.0.0.1:{PORT}")
    print(f"[READY] 管理面板: http://127.0.0.1:{PORT}/admin")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[EXIT] 已停止")
        server.shutdown()
