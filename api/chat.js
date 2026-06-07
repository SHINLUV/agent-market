/**
 * 檀枫 AI 工具箱 — API 端点
 * 放在 api/ 目录下，兼容 Vercel / EdgeOne Pages 等平台
 */
const AGNES_URL = "https://apihub.agnes-ai.com/v1/chat/completions";
const AGNES_MODEL = "agnes-2.0-flash";

let AGENTS_CACHE = null;

async function loadAgents(requestUrl) {
  if (AGENTS_CACHE) return AGENTS_CACHE;
  const origin = new URL(requestUrl).origin;
  const resp = await fetch(`${origin}/agents.js`);
  const text = await resp.text();
  const idx = text.indexOf("const AGENTS = [");
  const end = text.indexOf("];", idx);
  const arr = text.slice(idx + 16, end);
  const names = [...arr.matchAll(/name:\s*"([^"]+)"/g)].map(m => m[1]);
  const prompts = [...arr.matchAll(/prompt:\s*`([^`]+)`/g)].map(m => m[1]);
  AGENTS_CACHE = {};
  names.forEach((n, i) => { if (prompts[i]) AGENTS_CACHE[n] = prompts[i].trim(); });
  return AGENTS_CACHE;
}

export default async function handler(req) {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "仅支持 POST" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const agentId = body.agent_id || "";
    const message = (body.message || "").trim();
    if (!agentId || !message) {
      return Response.json({ error: "缺少参数" }, { status: 400 });
    }

    const agents = await loadAgents(req.url);
    const prompt = agents[agentId];
    if (!prompt) {
      return Response.json({ error: `找不到 Agent: ${agentId}` }, { status: 404 });
    }

    const key = process.env.AGNES_KEY || "";
    if (!key) {
      return Response.json({ error: "未配置 AGNES_KEY" }, { status: 500 });
    }

    const resp = await fetch(AGNES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: AGNES_MODEL,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: message },
        ],
      }),
    });

    const data = await resp.json();
    return Response.json({
      reply: data.choices[0].message.content,
      tokens: data.usage.total_tokens,
    });
  } catch (e) {
    return Response.json({ error: "服务器错误: " + e.message }, { status: 500 });
  }
}
