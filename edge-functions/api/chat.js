/**
 * 檀枫 AI 工具箱 — EdgeOne Pages Edge Function
 * 处理 /api/chat POST 请求
 */
const AGNES_URL = "https://apihub.agnes-ai.com/v1/chat/completions";
const AGNES_MODEL = "agnes-2.0-flash";

let AGENTS_CACHE = null;

async function getAgentPrompt(agentId, requestUrl) {
  if (AGENTS_CACHE) return AGENTS_CACHE[agentId] || null;

  try {
    // 从同源静态文件加载 agents.js
    const origin = new URL(requestUrl).origin;
    const resp = await fetch(
      `${origin}/agents.js`,
      { headers: { "Accept": "application/javascript" } }
    );
    if (!resp.ok) return null;

    const content = await resp.text();
    const agentsMatch = content.split("const AGENTS = [");
    if (agentsMatch.length < 2) return null;
    const agentsStr = agentsMatch[1].split("];")[0];

    const names = [...agentsStr.matchAll(/name:\s*"([^"]+)"/g)].map(m => m[1]);
    const prompts = [...agentsStr.matchAll(/prompt:\s*`([^`]+)`/g)].map(m => m[1]);

    AGENTS_CACHE = {};
    for (let i = 0; i < names.length; i++) {
      if (i < prompts.length) {
        AGENTS_CACHE[names[i]] = prompts[i].trim();
      }
    }
    return AGENTS_CACHE[agentId] || null;
  } catch (err) {
    console.error("[chat] 加载 agents.js 失败:", err.message);
    return null;
  }
}

// 处理 CORS 预检
export async function onRequestOptions(context) {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// 处理 POST 请求
export async function onRequestPost(context) {
  const { request } = context;

  try {
    const body = await request.json();
    const agentId = body.agent_id || "";
    const message = (body.message || "").trim();

    if (!agentId || !message) {
      return json(400, { error: "缺少参数" });
    }

    const systemPrompt = await getAgentPrompt(agentId, request.url);
    if (!systemPrompt) {
      return json(404, { error: `找不到 Agent: ${agentId}` });
    }

    // 从环境变量读取 API Key
    const agnesKey = process.env.AGNES_KEY || "";
    if (!agnesKey) {
      return json(500, { error: "服务未配置 AGNES_KEY 环境变量" });
    }

    const reqData = JSON.stringify({
      model: AGNES_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    });

    const resp = await fetch(AGNES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${agnesKey}`,
      },
      body: reqData,
    });

    if (!resp.ok) {
      return json(500, { error: `AI 调用失败 (${resp.status})` });
    }

    const result = await resp.json();
    return json(200, {
      reply: result.choices[0].message.content,
      tokens: result.usage.total_tokens,
    });
  } catch (err) {
    console.error("[chat] 错误:", err.message);
    return json(500, { error: "服务器错误: " + err.message });
  }
}

function json(status, data) {
  const body = JSON.stringify(data);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
