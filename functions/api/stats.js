/**
 * 檀枫 AI 工具箱 — 统计数据查询
 * GET /api/stats → 返回全量聚合数据（OpenClaw 用这个）
 */
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10); // 2026-06-09

    // 列出所有 KV 事件（最近30天的）
    const listResult = await env.AGENT_STATS.list({ prefix: 'event:' });
    const keys = listResult.keys || [];

    // 收集今日事件
    const todayEvents = [];
    const todayPrefix = `event:${todayStr}:`;

    // 分批读取今日事件（KV list 一次最多1000条，对你还够用）
    const todayKeys = keys.filter(k => k.name.startsWith(todayPrefix));

    // 并行读取今日事件
    const todayReads = await Promise.all(
      todayKeys.map(k => env.AGENT_STATS.get(k.name, 'json'))
    );
    todayReads.forEach(e => { if (e) todayEvents.push(e); });

    // 聚合：每个 agent 的事件数
    const agentCount = {};
    todayEvents.forEach(e => {
      const name = e.agent || '未知';
      if (!agentCount[name]) agentCount[name] = { detail: 0, try: 0, total: 0 };
      agentCount[name][e.type] = (agentCount[name][e.type] || 0) + 1;
      agentCount[name].total += 1;
    });

    // 按 total 排序
    const agents = Object.entries(agentCount)
      .map(([name, c]) => ({ name, ...c }))
      .sort((a, b) => b.total - a.total);

    // 最近20条
    const recent = todayEvents.slice(-20).reverse().map(e => ({
      agent: e.agent || '未知',
      ip: e.ip,
      type: e.type,
      time: e.time,
    }));

    // 独立 IP 数
    const ips = new Set(todayEvents.map(e => e.ip)).size;

    return Response.json({
      total: keys.length,
      today: todayEvents.length,
      unique_ips: ips,
      agents,
      recent,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (e) {
    return Response.json({ error: '服务器错误: ' + e.message }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
