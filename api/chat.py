"""
檀枫 AI 工具箱 — Vercel Serverless API
"""
import json, urllib.request, os, re
from http.server import BaseHTTPRequestHandler

AGNES_URL = "https://apihub.agnes-ai.com/v1/chat/completions"
AGNES_KEY = os.environ.get("AGNES_KEY", "")
AGNES_MODEL = "agnes-2.0-flash"

AGENT_PROMPTS = {}

def load_prompts():
    global AGENT_PROMPTS
    try:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(base, "agents.js"), "r", encoding="utf-8") as f:
            content = f.read()
        agents_str = content.split("const AGENTS = [", 1)[1].rsplit("];", 1)[0]
        names = re.findall(r'name:\s*"([^"]+)"', agents_str)
        prompts = re.findall(r'prompt:\s*`([^`]+)`', agents_str)
        for i, name in enumerate(names):
            if i < len(prompts):
                AGENT_PROMPTS[name] = prompts[i].strip()
    except:
        pass

load_prompts()

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except:
            self._json(400, {"error": "无效 JSON"})
            return

        agent_id = body.get("agent_id", "")
        message = body.get("message", "").strip()
        if not agent_id or not message:
            self._json(400, {"error": "缺少参数"})
            return

        system_prompt = AGENT_PROMPTS.get(agent_id)
        if not system_prompt:
            self._json(404, {"error": "找不到 Agent"})
            return

        req_data = json.dumps({
            "model": AGNES_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ]
        }, ensure_ascii=False).encode("utf-8")

        try:
            req = urllib.request.Request(
                AGNES_URL, data=req_data,
                headers={
                    "Content-Type": "application/json; charset=utf-8",
                    "Authorization": f"Bearer {AGNES_KEY}"
                }
            )
            resp = urllib.request.urlopen(req, timeout=25)
            result = json.loads(resp.read().decode("utf-8"))
            self._json(200, {
                "reply": result["choices"][0]["message"]["content"],
                "tokens": result["usage"]["total_tokens"]
            })
        except Exception as e:
            self._json(500, {"error": "AI 调用失败"})

    def _json(self, code, data):
        resp = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, format, *args):
        pass
