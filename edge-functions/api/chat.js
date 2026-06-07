/**
 * 檀枫 AI 工具箱 — EdgeOne Pages Edge Function
 * 对应 Vercel 的 api/chat.py
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const AGNES_URL = "https://apihub.agnes-ai.com/v1/chat/completions";
const AGNES_MODEL = "agnes-2.0-flash";

// 启动时加载 Agent 配置
let AGENT_PROMPTS = {};

function loadPrompts() {
  try {
    const filePath = join(process.cwd(), 'agents.js');
    const content = readFileSync(filePath, 'utf-8');
    const agentsMatch = content.split("const AGENTS = [");
    if (agentsMatch.length < 2) return;
    const agentsStr = agentsMatch[1].split("];")[0];
    const names = [...agentsStr.matchAll(/name:\s*"([^"]+)"/g)].map(m => m[1]);
    const prompts = [...agentsStr.matchAll(/prompt:\s*`([^`]+)`/g)].map(m => m[1]);
    for (let i = 0; i < names.length; i++) {
      if (i < prompts.length) {
        AGENT_PROMPTS[names[i]] = prompts[i].trim();
      }
    }
    console.log(`[EdgeFunction] 已加载 ${Object.keys(AGENT_PROMPTS).length} 个 Agent`);
  } catch (err) {
    console.error("[EdgeFunction] 加载 Agent 配置失败:", err.message);
  }
}

loadPrompts();

export default async function handler(request, context) {
  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: '仅支持 POST' });
  }

  try {
    const body = await request.json();
    const agentId = body.agent_id || '';
    const message = (body.message || '').trim();

    if (!agentId || !message) {
      return jsonResponse(400, { error: '缺少参数' });
    }

    const systemPrompt = AGENT_PROMPTS[agentId];
    if (!systemPrompt) {
      return jsonResponse(404, { error: `找不到 Agent: ${agentId}` });
    }

    const agnesKey = context.env?.AGNES_KEY || '';
    if (!agnesKey) {
      return jsonResponse(500, { error: '服务未配置 API Key' });
    }

    const reqData = JSON.stringify({
      model: AGNES_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });

    const resp = await fetch(AGNES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${agnesKey}`,
      },
      body: reqData,
    });

    if (!resp.ok) {
      return jsonResponse(500, { error: `AI 调用失败 (${resp.status})` });
    }

    const result = await resp.json();
    return jsonResponse(200, {
      reply: result.choices[0].message.content,
      tokens: result.usage.total_tokens,
    });
  } catch (err) {
    console.error("[EdgeFunction] 错误:", err.message);
    return jsonResponse(500, { error: '服务器错误' });
  }
}

function jsonResponse(status, data) {
  const body = JSON.stringify(data);
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
