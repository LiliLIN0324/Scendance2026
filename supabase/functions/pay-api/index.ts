// pay-api：付费与扣次的后端（支付宝 AI 付 / Vibe Pay，标准 RSA2 流程）。
//
// 路由（函数内相对路径）：
//   POST /pay/create        建单（金额以后端 SKU 表为准，绝不信任前端传的金额）
//   POST /pay/notify        支付宝异步通知（验签 + 金额/订单号校验 + 幂等）
//   GET  /pay/order/:id     查单（回调丢失时主动查询支付宝补偿）
//   POST /pay/mock-paid     仅 mock 模式可用，模拟支付成功
//   POST /scan/consume      预扣一次（幂等键 = owner + jobId + attempt）
//   POST /scan/release      失败返还
//   POST /scan/expire       超时未确认的预扣统一返还（可由定时任务调用）
//
// 密钥只从环境变量读取（ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY /
// ALIPAY_NOTIFY_URL / ALIPAY_SANDBOX），代码与日志不出现明文密钥。
// 未配置凭据时自动降级为 mock，并在响应里明确返回 mode=mock，前端必须显示标识。
import { createClient } from '@supabase/supabase-js';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-idempotency-key, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });

const fail = (code: string, status: number, message?: string | null, extra?: Record<string, unknown>) =>
  json({ error: { code, message: message ?? code }, ...(extra ?? {}) }, status);

const env = (key: string) => Deno.env.get(key);

/** 支付宝异步通知只认纯文本 success；返回 JSON 会被当成失败并重试。 */
const notifyOk = () => new Response('success', { status: 200, headers: { 'content-type': 'text/plain' } });

function client() {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SERVER_NOT_CONFIGURED');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Mode = 'mock' | 'sandbox' | 'live';

function paymentMode(): Mode {
  const hasCreds = Boolean(env('ALIPAY_APP_ID') && env('ALIPAY_PRIVATE_KEY') && env('ALIPAY_PUBLIC_KEY'));
  if (env('PAY_MOCK') === '1' || !hasCreds) return 'mock';
  return env('ALIPAY_SANDBOX') === '1' ? 'sandbox' : 'live';
}

const gateway = () =>
  env('ALIPAY_GATEWAY') ?? (env('ALIPAY_SANDBOX') === '1'
    ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
    : 'https://openapi.alipay.com/gateway.do');

// —— 密钥处理（PEM / 纯 base64 均可，必须 PKCS#8 私钥）——
function normalisePem(value: string, label: string): string {
  const body = value
    .replace(/-----BEGIN[\s\S]*?-----/g, '')
    .replace(/-----END[\s\S]*?-----/g, '')
    .replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [body];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

function dekToBytes(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem.replace(/-----BEGIN[\s\S]*?-----/g, '').replace(/-----END[\s\S]*?-----/g, '').replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

let privateKeyPromise: Promise<CryptoKey> | null = null;
let publicKeyPromise: Promise<CryptoKey> | null = null;

function getPrivateKey(): Promise<CryptoKey> {
  if (!privateKeyPromise) {
    const raw = env('ALIPAY_PRIVATE_KEY');
    if (!raw) return Promise.reject(new Error('ALIPAY_PRIVATE_KEY_MISSING'));
    if (/BEGIN RSA PRIVATE KEY/.test(raw)) {
      return Promise.reject(new Error('PRIVATE_KEY_PKCS1_UNSUPPORTED_USE_PKCS8'));
    }
    privateKeyPromise = crypto.subtle.importKey(
      'pkcs8',
      dekToBytes(normalisePem(raw, 'PRIVATE KEY')),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  return privateKeyPromise;
}

function getPublicKey(): Promise<CryptoKey> {
  if (!publicKeyPromise) {
    const raw = env('ALIPAY_PUBLIC_KEY');
    if (!raw) return Promise.reject(new Error('ALIPAY_PUBLIC_KEY_MISSING'));
    publicKeyPromise = crypto.subtle.importKey(
      'spki',
      dekToBytes(normalisePem(raw, 'PUBLIC KEY')),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  }
  return publicKeyPromise;
}

/** 支付宝签名串：去掉 sign / sign_type / 空值，按 key 字典序，k=v 用 & 连接。 */
function canonicalString(params: Record<string, string>): string {
  return Object.keys(params)
    .filter(key => key !== 'sign' && key !== 'sign_type' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
}

async function signParams(params: Record<string, string>): Promise<string> {
  const key = await getPrivateKey();
  const payload = new TextEncoder().encode(canonicalString(params));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, payload);
  return base64FromBytes(new Uint8Array(signature));
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

async function verifySignature(params: Record<string, string>): Promise<boolean> {
  const sign = params.sign;
  const signType = (params.sign_type ?? 'RSA2').toUpperCase();
  if (!sign) return false;
  if (signType !== 'RSA2') return false; // 只接受 RSA2，RSA1 一律拒绝
  const key = await getPublicKey();
  const payload = new TextEncoder().encode(canonicalString(params));
  const signature = dekToBytes(sign);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, payload);
}

function alipayTimestamp(now = new Date()): string {
  const beijing = new Date(now.getTime() + 8 * 3600 * 1000);
  return beijing.toISOString().replace('T', ' ').slice(0, 19);
}

/** 元字符串 → 整数分，不做浮点运算。 */
function yuanToCents(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [yuan, fen = '0'] = text.split('.');
  return Number(yuan) * 100 + Number(fen.padEnd(2, '0'));
}

function centsToYuan(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** 从响应 JSON 文本里截取某一节点的原始片段（支付宝对原始子串验签）。 */
function extractRawSection(text: string, key: string): string | null {
  const marker = `"${key}"`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const colon = text.indexOf(':', start + marker.length);
  if (colon < 0) return null;
  const open = text.indexOf('{', colon);
  if (open < 0) return null;
  let depth = 0;
  let inString = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return null;
}

async function callAlipay(
  method: string,
  biz: Record<string, unknown>,
  extra: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    app_id: env('ALIPAY_APP_ID') ?? '',
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: alipayTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify(biz),
    ...extra,
  };
  params.sign = await signParams(params);

  const response = await fetch(`${gateway()}?charset=utf-8`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('ALIPAY_BAD_RESPONSE');
  }

  const responseKey = method.replace(/\./g, '_') + '_response';
  const node = parsed[responseKey] as Record<string, unknown> | undefined;
  if (!node) throw new Error('ALIPAY_EMPTY_RESPONSE');

  // 响应验签：支付宝对响应节点的原始 JSON 串签名。
  const sign = parsed.sign as string | undefined;
  const rawSection = extractRawSection(text, responseKey);
  if (sign && rawSection) {
    const key = await getPublicKey();
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      dekToBytes(sign),
      new TextEncoder().encode(rawSection),
    );
    if (!ok) throw new Error('ALIPAY_RESPONSE_SIGNATURE_INVALID');
  }

  if (node.code && String(node.code) !== '10000') {
    throw new Error(`ALIPAY_${String(node.sub_code ?? node.code)}:${String(node.sub_msg ?? node.msg ?? '')}`);
  }
  return node;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildIdempotencyKey(owner: string, jobId: string, attempt: number) {
  return `scan:${owner}:${jobId}:${attempt}`;
}

function toOrderView(order: Record<string, unknown>) {
  const purchased = Number(order.times_purchased ?? 0);
  const used = Number(order.times_used ?? 0);
  return {
    id: order.id,
    sku: order.sku,
    status: order.status,
    timesPurchased: purchased,
    timesUsed: used,
    remaining: Math.max(0, purchased - used),
    amountCents: order.amount_cents,
    expiresAt: order.expires_at ?? null,
    paidAt: order.paid_at ?? null,
    createdAt: order.created_at ?? null,
    provider: order.provider,
    providerOrderId: order.provider_order_id ?? null,
  };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const path = new URL(request.url).pathname.replace(/^\/functions\/v1\/pay-api/, '');
  const mode = paymentMode();

  try {
    const db = client();

    // —— 建单 ——
    if (path === '/pay/create' && request.method === 'POST') {
      const body = await readJson(request);
      const skuCode = String(body.sku ?? '').trim();
      const ownerKey = String(body.ownerKey ?? '').trim();
      const anonId = body.anonId ? String(body.anonId) : null;
      const userId = body.userId ? String(body.userId) : null;
      const idem = (request.headers.get('x-idempotency-key') ?? '').trim()
        || `order:${ownerKey}:${skuCode}:${Math.floor(Date.now() / 60000)}`;
      if (!skuCode || !ownerKey) return fail('BAD_REQUEST', 400, '需要 sku 与 ownerKey', { mode });

      const { data: existing } = await db.from('pay_orders').select('*').eq('idempotency_key', idem).maybeSingle();
      if (existing) return json({ order: toOrderView(existing), mode });

      const { data: sku, error: skuError } = await db.from('pay_skus').select('*').eq('code', skuCode).eq('active', true).maybeSingle();
      if (skuError || !sku) return fail('SKU_NOT_FOUND', 404, '商品不存在或已下架', { mode });

      const { data: order, error } = await db
        .from('pay_orders')
        .insert({
          owner_key: ownerKey,
          user_id: userId,
          anon_id: anonId,
          sku: sku.code,
          times_purchased: sku.times,
          amount_cents: sku.amount_cents,
          status: 'pending',
          provider: mode === 'mock' ? 'mock' : 'alipay',
          idempotency_key: idem,
        })
        .select('*')
        .single();
      if (error) {
        if (String(error.code) === '23505') {
          const { data: again } = await db.from('pay_orders').select('*').eq('idempotency_key', idem).maybeSingle();
          if (again) return json({ order: toOrderView(again), mode });
        }
        return fail('ORDER_CREATE_FAILED', 500, error.message, { mode });
      }

      if (mode === 'mock') {
        const { data: paid } = await db
          .from('pay_orders')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 180 * 86400000).toISOString(),
            provider_order_id: `mock_${order.id}`,
          })
          .eq('id', order.id)
          .select('*')
          .single();
        return json({ order: toOrderView(paid ?? order), mode, mock: true });
      }

      // 真实通道：当面付预下单，返回二维码内容。
      const subject = `Scendance 现场重建 · ${sku.title}`;
      try {
        const result = await callAlipay(
          'alipay.trade.precreate',
          {
            out_trade_no: order.id,
            total_amount: centsToYuan(sku.amount_cents),
            subject,
            timeout_express: '30m',
            product_code: 'FACE_TO_FACE_PAYMENT',
          },
          { notify_url: env('ALIPAY_NOTIFY_URL') ?? '' },
        );
        await db.from('pay_orders').update({ provider_order_id: order.id }).eq('id', order.id);
        return json({
          order: toOrderView({ ...order, provider_order_id: order.id }),
          mode,
          qrCode: result.qr_code ?? null,
          payUrl: result.qr_code ?? null,
          note: mode === 'sandbox' ? '沙盒环境，不产生真实扣款' : null,
        });
      } catch (error) {
        await db.from('pay_orders').update({ status: 'cancelled' }).eq('id', order.id).eq('status', 'pending');
        return fail('PROVIDER_CREATE_FAILED', 502, error instanceof Error ? error.message : '下单失败', { mode, order: toOrderView(order) });
      }
    }

    // —— 异步通知 ——
    if (path === '/pay/notify' && request.method === 'POST') {
      if (mode === 'mock') return fail('NOTIFY_DISABLED_IN_MOCK', 403, null, { mode });
      const raw = await request.text();
      const params: Record<string, string> = {};
      new URLSearchParams(raw).forEach((value, key) => {
        params[key] = value;
      });

      const verified = await verifySignature(params);
      if (!verified) return fail('NOTIFY_SIGNATURE_INVALID', 401, null, { mode });

      // 只认本应用的通知
      if (params.app_id && params.app_id !== env('ALIPAY_APP_ID')) {
        return fail('NOTIFY_APP_MISMATCH', 401, null, { mode });
      }
      if (params.trade_status !== 'TRADE_SUCCESS' && params.trade_status !== 'TRADE_FINISHED') {
        return notifyOk();
      }

      const outTradeNo = params.out_trade_no ?? '';
      const totalCents = yuanToCents(params.total_amount);
      if (!outTradeNo || totalCents === null) return fail('NOTIFY_BAD_BODY', 400, null, { mode });

      const eventId = params.notify_id || `${outTradeNo}:${params.trade_status}`;
      const { data: seen } = await db.from('pay_events').select('id').eq('event_id', eventId).maybeSingle();
      if (seen) return notifyOk();
      await db.from('pay_events').insert({ event_id: eventId, provider: 'alipay', payload: params });

      const { data: order } = await db.from('pay_orders').select('*').eq('id', outTradeNo).maybeSingle();
      if (!order) return fail('NOTIFY_ORDER_NOT_FOUND', 404, null, { mode });
      if (Number(order.amount_cents) !== totalCents) {
        return fail('NOTIFY_AMOUNT_MISMATCH', 400, `回调金额 ${params.total_amount} 与订单 ${order.amount_cents} 分不一致`, { mode });
      }
      if (order.status === 'paid') return notifyOk();

      await db
        .from('pay_orders')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 180 * 86400000).toISOString(),
          provider_order_id: outTradeNo,
        })
        .eq('id', order.id)
        .eq('status', 'pending');
      // 支付宝要求返回纯文本 success，否则会重试。
      return notifyOk();
    }

    // —— 模拟支付（仅 mock）——
    if (path === '/pay/mock-paid' && request.method === 'POST') {
      if (mode !== 'mock') return fail('MOCK_DISABLED', 403, null, { mode });
      const body = await readJson(request);
      const orderId = String(body.orderId ?? '');
      if (!orderId) return fail('BAD_REQUEST', 400, null, { mode });
      const { data: order } = await db
        .from('pay_orders')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 180 * 86400000).toISOString(),
          provider: 'mock',
          provider_order_id: `mock_${orderId}`,
        })
        .eq('id', orderId)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();
      if (!order) return fail('ORDER_NOT_FOUND', 409, null, { mode });
      return json({ order: toOrderView(order), mode, mock: true });
    }

    // —— 查单（回调丢失时主动查询补偿）——
    const orderMatch = path.match(/^\/pay\/order\/([^/]+)$/);
    if (orderMatch && request.method === 'GET') {
      const orderId = decodeURIComponent(orderMatch[1]);
      const { data: order } = await db.from('pay_orders').select('*').eq('id', orderId).maybeSingle();
      if (!order) return fail('ORDER_NOT_FOUND', 404, null, { mode });

      if (order.status === 'pending' && mode !== 'mock') {
        try {
          const result = await callAlipay('alipay.trade.query', { out_trade_no: orderId });
          const tradeStatus = String(result.trade_status ?? '');
          if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
            const paidCents = yuanToCents(result.total_amount as string);
            if (paidCents === Number(order.amount_cents)) {
              const { data: updated } = await db
                .from('pay_orders')
                .update({
                  status: 'paid',
                  paid_at: new Date().toISOString(),
                  expires_at: new Date(Date.now() + 180 * 86400000).toISOString(),
                  provider_order_id: orderId,
                })
                .eq('id', orderId)
                .eq('status', 'pending')
                .select('*')
                .single();
              return json({ order: toOrderView(updated ?? order), mode, reconciled: true });
            }
            return fail('QUERY_AMOUNT_MISMATCH', 409, '主动查询金额与订单不一致', { mode, order: toOrderView(order) });
          }
        } catch (error) {
          // 查询失败不阻断前端轮询，保持 pending。
          return json({ order: toOrderView(order), mode, queryError: error instanceof Error ? error.message : 'QUERY_FAILED' });
        }
      }
      return json({ order: toOrderView(order), mode });
    }

    // —— 扣次（预扣）——
    if (path === '/scan/consume' && request.method === 'POST') {
      const body = await readJson(request);
      const ownerKey = String(body.ownerKey ?? '').trim();
      const jobId = String(body.jobId ?? '').trim();
      const attempt = Number(body.attempt ?? 1);
      const times = Math.max(1, Math.min(10, Number(body.times ?? 1)));
      if (!ownerKey || !jobId) return fail('BAD_REQUEST', 400, '需要 ownerKey 与 jobId', { mode });

      const limit = Number(env('PAY_DAILY_JOB_LIMIT') ?? '3');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count } = await db
        .from('scan_consumptions')
        .select('id', { count: 'exact', head: true })
        .eq('owner_key', ownerKey)
        .gte('created_at', today.toISOString());
      if ((count ?? 0) >= limit) return fail('RATE_LIMITED', 429, `同一设备每天最多 ${limit} 次重建`, { mode });

      const idem = buildIdempotencyKey(ownerKey, jobId, attempt);
      const { data, error } = await db.rpc('pay_reserve', {
        p_owner_key: ownerKey,
        p_idem: idem,
        p_job_id: jobId,
        p_times: times,
      });
      if (error) {
        const message = String(error.message ?? '');
        if (message.includes('INSUFFICIENT_CREDITS')) return fail('INSUFFICIENT_CREDITS', 402, '没有可用次数，先购买', { mode });
        return fail('CONSUME_FAILED', 500, message, { mode });
      }
      return json({ consumption: { idempotencyKey: idem, ...(data as Record<string, unknown>) }, mode });
    }

    // —— 失败返还 ——
    if (path === '/scan/release' && request.method === 'POST') {
      const body = await readJson(request);
      const idem = String(body.idempotencyKey ?? '');
      if (!idem) return fail('BAD_REQUEST', 400, null, { mode });
      const { data, error } = await db.rpc('pay_release', { p_idem: idem });
      if (error) return fail('RELEASE_FAILED', 500, error.message, { mode });
      return json({ consumption: data, mode });
    }

    // —— 超时自动退 ——
    if (path === '/scan/expire' && request.method === 'POST') {
      const body = await readJson(request);
      const minutes = Math.max(5, Math.min(1440, Number(body.minutes ?? 30)));
      const { data, error } = await db.rpc('pay_release_stale', { p_minutes: minutes });
      if (error) return fail('EXPIRE_FAILED', 500, error.message, { mode });
      return json({ released: data, mode });
    }

    return fail('NOT_FOUND', 404, null, { mode });
  } catch (error) {
    if (error instanceof Error && error.message === 'SERVER_NOT_CONFIGURED') {
      return fail('SERVER_NOT_CONFIGURED', 500, '缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', { mode });
    }
    if (error instanceof Error && (error.message.includes('PRIVATE_KEY') || error.message.includes('PUBLIC_KEY'))) {
      return fail('PAY_KEY_INVALID', 500, error.message, { mode });
    }
    return fail('SERVER_ERROR', 500, error instanceof Error ? error.message : undefined, { mode });
  }
});
