#!/usr/bin/env node
// 只读探针：确认 humanoid auto-rig 的 endpoint 形状与鉴权是否可用。
// 不提交有效任务、不消耗额度：请求体故意缺 modelUrl。
import { readFileSync, existsSync } from 'node:fs';

function key() {
  if (process.env.LUX3D_API_KEY) return process.env.LUX3D_API_KEY;
  const text = readFileSync('.env.local', 'utf8');
  const line = text.split(/\r?\n/).find(l => l.trim().startsWith('LUX3D_API_KEY='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}
const KEY = key();
if (!KEY) { console.error('缺少 LUX3D_API_KEY'); process.exit(2); }

const BASES = [
  process.env.LUX3D_BASE_URL,
  'https://api.aholo3d.cn',
  'https://api.aholo.ai/global',
].filter(Boolean);

async function hit(method, url, body) {
  const init = { method, headers: { Authorization: KEY, 'x-source': 'openapi' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    return { method, url, status: res.status, body: text.slice(0, 500) };
  } catch (e) {
    return { method, url, error: e.message };
  }
}

const results = [];
for (const BASE of BASES) {
  results.push({ base: BASE, note: 'POST rig create（缺 modelUrl，预期被拒）' , res: await hit('POST', `${BASE}/animations/rig/task/create`, {}) });
  results.push({ base: BASE, note: 'GET rig get（不存在的 taskId）', res: await hit('GET', `${BASE}/animations/rig/task/get?taskid=0000000`) });
  results.push({ base: BASE, note: 'GET rig 路径参数式', res: await hit('GET', `${BASE}/animations/rig/task/0000000`) });
}
console.log(JSON.stringify(results, null, 2));
