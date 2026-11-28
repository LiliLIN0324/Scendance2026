#!/usr/bin/env node
/**
 * 本地开发代理：前端 → 本代理 → 爱猹收（pay.watcha.cn）。
 *
 * 用途：PAYATHON 2026 本地联调。爱猹收的服务端 Key 只存在本进程内存
 * （从仓库根 .env.local 读取，绝不进入前端与日志）；前端 lib/pay/client
 * 的 NEXT_PUBLIC_PAY_API_BASE 指到本代理即可走通 access/consume。
 *
 * 上线路径：同样的两个端点已实现在 pay-api Edge Function
 * （supabase/functions/pay-api/index.ts，/pay/aichashou/*），部署后把
 * NEXT_PUBLIC_PAY_API_BASE 换成云端函数地址即可，前端零改动。
 *
 * 只绑定 127.0.0.1；仅代理两个端点，其余一律 404。
 *   POST /functions/v1/pay-api/pay/aichashou/access  { ownerKey, kind, returnUrl? }
 *   POST /functions/v1/pay-api/pay/aichashou/consume { ownerKey, amount, idempotencyKey }
 *
 * 运行：node scripts/dev-aichashou-proxy.mjs  （默认端口 3198）
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(path.join(repo, '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
);

const BASE = (env.AICHASHOU_BASE_URL ?? 'https://pay.watcha.cn').replace(/\/$/, '');
const KEY = env.AICHASHOU_API_KEY ?? env.AICHASHOU_SANDBOX_API_KEY ?? '';
const ENT_MEMBERSHIP = env.AICHASHOU_ENT_MEMBERSHIP ?? '';
const ENT_QUOTA = env.AICHASHOU_ENT_QUOTA ?? '';
// 内部账号豁免白名单（与 pay-api 同语义）：创始成员测试用，不计入比赛数据。
const ADMIN_KEYS = (env.AICHASHOU_ADMIN_OWNER_KEYS ?? '')
  .split(',')
  .map(key => key.trim())
  .filter(Boolean);
const PORT = Number(process.env.AICHASHOU_PROXY_PORT ?? 3198);

if (!KEY || !ENT_MEMBERSHIP || !ENT_QUOTA) {
  console.error('[aichashou-proxy] 缺少 AICHASHOU_* 配置：请确认仓库根 .env.local 已注入 Key 与权益 ID。');
  process.exit(1);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(body));
};

function entitlementIdFor(kind) {
  if (kind === 'quota') return ENT_QUOTA;
  if (kind === 'team') return env.AICHASHOU_ENT_TEAM ?? '';
  return ENT_MEMBERSHIP;
}

async function forward(payload) {
  const response = await fetch(`${BASE}${payload.upstreamPath}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload.body),
  });
  const body = (await response.json().catch(() => ({})));
  return { status: response.status, body };
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;

  const path = (req.url ?? '').split('?')[0];
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    json(res, 400, { error: { code: 'BAD_JSON', message: '请求体不是合法 JSON' } });
    return;
  }
  const ownerKey = String(parsed.ownerKey ?? '').trim();

  if (req.method === 'POST' && path === '/functions/v1/pay-api/pay/aichashou/access') {
    if (!ownerKey) {
      json(res, 400, { error: { code: 'BAD_REQUEST', message: '需要 ownerKey' } });
      return;
    }
    if (ADMIN_KEYS.includes(ownerKey)) {
      json(res, 200, {
        provider: 'aichashou',
        entitlement: {
          access: 'granted',
          entitlement: String(parsed.kind ?? 'membership') === 'quota' ? { type: 'quota', remaining: 999999 } : { type: 'permanent' },
        },
        mode: 'sandbox',
      });
      return;
    }
    const entitlementId = entitlementIdFor(String(parsed.kind ?? 'membership'));
    const upstream = { entitlement_id: entitlementId, user_id: ownerKey };
    if (typeof parsed.returnUrl === 'string' && parsed.returnUrl.startsWith('https://')) upstream.return_url = parsed.returnUrl;
    try {
      const { status, body } = await forward({ upstreamPath: '/v1/entitlements/access', body: upstream });
      json(res, status >= 200 && status < 300 ? 200 : 502, { provider: 'aichashou', entitlement: body, mode: 'sandbox' });
    } catch (error) {
      json(res, 502, { error: { code: 'UPSTREAM_FAILED', message: String(error) } });
    }
    return;
  }

  if (req.method === 'POST' && path === '/functions/v1/pay-api/pay/aichashou/consume') {
    if (!ownerKey || !String(parsed.idempotencyKey ?? '').trim()) {
      json(res, 400, { error: { code: 'BAD_REQUEST', message: '需要 ownerKey 与 idempotencyKey' } });
      return;
    }
    if (ADMIN_KEYS.includes(ownerKey)) {
      json(res, 200, {
        provider: 'aichashou',
        result: { consumed: Math.max(1, Math.min(10, Number(parsed.amount ?? 1))), entitlement: { type: 'quota', remaining: 999999 } },
        mode: 'sandbox',
      });
      return;
    }
    try {
      const { status, body } = await forward({
        upstreamPath: '/v1/entitlements/consume',
        body: {
          entitlement_id: ENT_QUOTA,
          user_id: ownerKey,
          amount: Math.max(1, Math.min(10, Number(parsed.amount ?? 1))),
          idempotency_key: String(parsed.idempotencyKey),
        },
      });
      const upstreamError = body.error;
      json(res, status, { provider: 'aichashou', result: body, ...(upstreamError ? { error: upstreamError } : {}), mode: 'sandbox' });
    } catch (error) {
      json(res, 502, { error: { code: 'UPSTREAM_FAILED', message: String(error) } });
    }
    return;
  }

  json(res, 404, { error: { code: 'NOT_FOUND', message: `本代理只支持爱猹收 access/consume，收到 ${req.method} ${path}` } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[aichashou-proxy] listening on http://127.0.0.1:${PORT} → ${BASE}`);
  console.log('[aichashou-proxy] 前端请配 NEXT_PUBLIC_PAY_API_BASE=http://127.0.0.1:3198/functions/v1/pay-api + NEXT_PUBLIC_PAY_PROVIDER=aichashou');
});
