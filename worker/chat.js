/**
 * 檀枫 AI 工具箱 — Cloudflare Worker（一体版）
 * 功能：代理 EdgeOne 静态文件 + 处理 /api/chat
 * 部署：复制到 Cloudflare Workers 编辑器，粘贴，部署
 */

// 你的 EdgeOne Pages 地址
const STATIC_HOST = 'tanfeng-agent-market-dplv095f0iiu.edgeone.cool';
// EdgeOne 访问令牌（带在 URL 里）
const EO_TOKEN = 'eo_token=c183c42ea2c861acf0ba31e02dfc794e&eo_time=1780863652';

let agentsCache = null;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── API 路由 ──
    if (url.pathname === '/api/chat') {
      return handleChat(request, env, url);
    }

    // ── 其他请求：代理到 EdgeOne Pages ──
    let targetUrl = `https://${STATIC_HOST}${url.pathname}`;
    if (url.search) {
      targetUrl += '?' + url.search + '&' + EO_TOKEN;
    } else {
      targetUrl += '?' + EO_TOKEN;
    }

    const resp = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    // 修改响应头（允许跨域）
    const newHeaders = new Headers(resp.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    return new Response(resp.body, {
      status: resp.status,
      headers: newHeaders,
    });
  },
};

async function handleChat(request, env, url) {
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

    // 加载 agents 配置（从 EdgeOne 获取，缓存）
    if (!agentsCache) {
      const agentsResp = await fetch(`https://${STATIC_HOST}/agents.js?${EO_TOKEN}`);
      const text = await agentsResp.text();
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

    const key = env.AGNES_KEY || '';
    if (!key) {
      return Response.json({ error: '未配置 AGNES_KEY' }, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const aiResp = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
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
