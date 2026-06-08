/**
 * 檀枫 AI 工具箱 — 埋点事件接收
 * POST /api/event
 * Body: { type: "detail|try|search", agent: "Agent名称" }
 */
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
    const type = body.type || '';
    const agent = body.agent || '';
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';

    if (!type) {
      return Response.json({ error: '缺少 type' }, {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 写入 KV：key = event:{date}:{timestamp}:{ip}
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);         // 2026-06-09
    const ts = now.toISOString().replace(/:/g, '-');        // 2026-06-09T14-30-00.000Z
    const rand = Math.random().toString(36).slice(2, 6);

    const eventKey = `event:${dateStr}:${ts}:${rand}`;
    const eventData = JSON.stringify({
      type,
      agent,
      ip,
      time: now.toISOString(),
    });

    // KV 写入（最多保留30天自动过期）
    await env.AGENT_STATS.put(eventKey, eventData, {
      expirationTtl: 60 * 60 * 24 * 30,  // 30天
    });

    return Response.json({ ok: true }, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return Response.json({ error: '服务器错误: ' + e.message }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
