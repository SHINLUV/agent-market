/**
 * 檀枫 AI 工具箱 — Cloudflare Pages Function
 * 路径: /api/chat
 */
let agentsCache = null;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: '仅支持 POST' }, {
      status: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const body = await request.json();
    const agentId = body.agent_id || '';
    const message = (body.message || '').trim();

    if (!agentId || !message) {
      return Response.json({ error: '缺少参数' }, {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 从同站加载 agents.js（首次缓存）
    if (!agentsCache) {
      const url = new URL(request.url);
      const resp = await fetch(`${url.origin}/agents.js`);
      const text = await resp.text();
      const start = text.indexOf('const AGENTS = [');
      const end = text.indexOf('];', start);
      const arr = text.slice(start + 16, end);
      const names = [...arr.matchAll(/name:\s*"([^"]+)"/g)].map(m => m[1]);
      const prompts = [...arr.matchAll(/prompt:\s*`([^`]+)`/g)].map(m => m[1]);
      agentsCache = {};
      names.forEach((n, i) => {
        if (prompts[i]) agentsCache[n] = prompts[i].trim();
      });
    }

    const prompt = agentsCache[agentId];
    if (!prompt) {
      return Response.json({ error: `找不到 Agent: ${agentId}` }, {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const apiKey = env.AGNES_KEY || '';
    if (!apiKey) {
      return Response.json({ error: '未配置 AGNES_KEY 环境变量' }, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const aiResp = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'agnes-2.0-flash',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: message },
        ],
      }),
    });

    const data = await aiResp.json();
    return Response.json({
      reply: data.choices[0].message.content,
      tokens: data.usage.total_tokens,
    }, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return Response.json({ error: '服务器错误: ' + e.message }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
