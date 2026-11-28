// pay-api：付费与扣次的后端（支付宝 AI 付 / Vibe Pay，标准 RSA2 流程）。
//
// 路由（函数内相对路径）：
//   GET  /pay/skus          在售 SKU 清单（含订阅档位与权益 JSON，前端只展示这一份）
//   POST /pay/create        建单（金额以后端 SKU 表为准，绝不信任前端传的金额）
//   POST /pay/notify        支付宝异步通知（验签 + 金额/订单号校验 + 幂等）
//   GET  /pay/order/:id     查单（回调丢失时主动查询支付宝补偿）
//   POST /pay/mock-paid     仅 mock 模式可用，模拟支付成功
//   POST /pay/subscription  查询某 owner 的当前订阅与权益（pay_subscription_for）
//   POST /pay/aichashou/access   爱猹收权益检查（granted/purchase_required + 购买入口）
//   POST /pay/aichashou/consume  爱猹收额度原子扣减（幂等键透传）
//   POST /scan/consume      预扣一次（幂等键 = owner + jobId + attempt）
//   POST /scan/release      失败返还
//   POST /scan/expire       超时未确认的预扣统一返还（可由定时任务调用）
//
// 订阅与按次共用 pay_orders，kind 区分；订阅订单支付后由 pay_fulfill_subscription
// 开通 subscriptions 行，权益判定只走 pay_subscription_for。
// 爱猹收通道（PAYATHON 2026 官方收款平台 pay.watcha.cn）：商品与权益托管在平台，
// 本函数只做服务端代理——Key 永不下发前端。未配置 AICHASHOU_* 时爱猹收路由 501，
// 其余路由不受影响（三态：mock / sandbox / live 仍是支付宝当面付直连通道）。
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

/**
 * 爱猹收（pay.watcha.cn）服务端代理：商品与权益托管在平台，这里只持有
 * 服务端 Key 并转发 access/consume。Key 从环境读取，绝不回显、不下发前端。
 * user_id 用产品内的稳定 ownerKey（anon:<device> / user:<uuid>），不采信
 * 手机号或邮箱；额度扣减的幂等键沿用「scan:owner:job:attempt」规则。
 */
function aichashouConfigured(): boolean {
  return Boolean((env('AICHASHOU_API_KEY') ?? env('AICHASHOU_SANDBOX_API_KEY')) && env('AICHASHOU_ENT_MEMBERSHIP') && env('AICHASHOU_ENT_QUOTA'));
}

function aichashouEntitlementId(kind: string): string | null {
  // 团队版（team）为可选配置：未配置时路由返回缺失错误，前端团队卡不挂购买按钮。
  if (kind === 'quota') return env('AICHASHOU_ENT_QUOTA') ?? null;
  if (kind === 'team') return env('AICHASHOU_ENT_TEAM') ?? null;
  return env('AICHASHOU_ENT_MEMBERSHIP') ?? null;
}

/**
 * 内部账号豁免：创始成员的 ownerKey 白名单（逗号分隔 env）。
 * 命中后不查爱猹收账本、不产生真实收款与平台消费记录——仅供内部测试便利，
 * 不是「真实用户付费」的数据来源（agent.md：收款方购买自己的商品不算数）。
 * 登录接入后 ownerKey 应为稳定的 user:<uuid>，再把这些键填进 env。
 */
function aichashouAdminKeys(): string[] {
  return (env('AICHASHOU_ADMIN_OWNER_KEYS') ?? '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean);
}

async function aichashouPost(path: string, payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const key = env('AICHASHOU_API_KEY') ?? env('AICHASHOU_SANDBOX_API_KEY');
  const base = (env('AICHASHOU_BASE_URL') ?? 'https://pay.watcha.cn').replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
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
    kind: order.kind ?? 'times',
    planCode: order.plan_code ?? null,
    periodMonths: order.period_months ?? null,
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

/**
 * 订阅履约：订单已支付后开通/顺延订阅。
 * 幂等由 pay_fulfill_subscription 的 (provider, provider_order_id) 唯一约束保证，
 * 重复调用不会开两份订阅。履约失败不回滚订单状态 —— 订单已收款，
 * 权益开通失败会由查单补偿路径重试；查单路径对已支付的订阅订单每次都重放履约。
 */
async function fulfillSubscription(
  db: ReturnType<typeof client>,
  order: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if ((order.kind ?? 'times') !== 'subscription') return null;
  const { data, error } = await db.rpc('pay_fulfill_subscription', { p_order_id: order.id });
  if (error) {
    console.error('pay_fulfill_subscription failed', String(error.message ?? error.code ?? ''));
    return null;
  }
  return (data ?? null) as Record<string, unknown> | null;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  // 边缘转发有两种形态：公开 URL 带 /functions/v1/<fn>，内部转发只保留 /<fn> 前缀，两种都剥。
  const path = new URL(request.url).pathname
    .replace(/^\/functions\/v1\/pay-api/, '')
    .replace(/^\/pay-api/, '') || '/';
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

      // 订阅 SKU：kind/plan_code/period_months 由 SKU 表下发，次数记 0（次数额度只属于按次单）。
      const isSubscription = (sku.kind ?? 'times') === 'subscription';
      const { data: order, error } = await db
        .from('pay_orders')
        .insert({
          owner_key: ownerKey,
          user_id: userId,
          anon_id: anonId,
          sku: sku.code,
          kind: isSubscription ? 'subscription' : 'times',
          plan_code: isSubscription ? (sku.plan_code ?? null) : null,
          period_months: isSubscription ? (sku.period_months ?? null) : null,
          times_purchased: isSubscription ? 0 : sku.times,
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
        const paidOrder = paid ?? order;
        const subscription = await fulfillSubscription(db, paidOrder);
        return json({ order: toOrderView(paidOrder), subscription, mode, mock: true });
      }

      // 真实通道：当面付预下单，返回二维码内容。
      const subject = (sku.kind ?? 'times') === 'subscription'
        ? `幕景会员 · ${sku.title}`
        : `Scendance 现场重建 · ${sku.title}`;
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

      const { data: paidOrder } = await db
        .from('pay_orders')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 180 * 86400000).toISOString(),
          provider_order_id: outTradeNo,
        })
        .eq('id', order.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();
      // 订阅单在回调里直接履约。履约失败不影响回执：订单已收款，先回 success
      // 防止支付宝无限重投同一通知；查单路径会对已支付的订阅单重放履约补偿。
      await fulfillSubscription(db, paidOrder ?? order);
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
      const subscription = await fulfillSubscription(db, order);
      return json({ order: toOrderView(order), subscription, mode, mock: true });
    }

    // —— 订阅与权益查询（唯一判定入口）——
    if (path === '/pay/subscription' && request.method === 'POST') {
      const body = await readJson(request);
      const ownerKey = String(body.ownerKey ?? '').trim();
      if (!ownerKey) return fail('BAD_REQUEST', 400, '需要 ownerKey', { mode });
      const { data, error } = await db.rpc('pay_subscription_for', { p_owner_key: ownerKey });
      if (error) return fail('SUBSCRIPTION_QUERY_FAILED', 500, error.message, { mode });
      return json({ subscription: data, mode });
    }

    // —— 爱猹收权益检查（平台托管的会员/额度；购买入口由平台生成）——
    if (path === '/pay/aichashou/access' && request.method === 'POST') {
      const body = await readJson(request);
      const ownerKey = String(body.ownerKey ?? '').trim();
      const kind = String(body.kind ?? 'membership');
      const returnUrl = typeof body.returnUrl === 'string' && body.returnUrl.startsWith('https://') ? body.returnUrl : undefined;
      if (!ownerKey) return fail('BAD_REQUEST', 400, '需要 ownerKey', { mode });
      if (aichashouAdminKeys().includes(ownerKey)) {
        // 内部豁免：永久 granted（额度则视为近乎无限），不触达爱猹收账本。
        return json({
          provider: 'aichashou',
          entitlement: {
            access: 'granted',
            entitlement: kind === 'quota' ? { type: 'quota', remaining: 999999 } : { type: 'permanent' },
          },
          mode,
        });
      }
      if (!aichashouConfigured()) return fail('AICHASHOU_NOT_CONFIGURED', 501, '爱猹收未配置，走支付宝通道', { mode });
      const entitlementId = aichashouEntitlementId(kind);
      if (!entitlementId) return fail('AICHASHOU_ENTITLEMENT_MISSING', 500, `缺少 ${kind} 权益 ID 配置`, { mode });
      const payload: Record<string, unknown> = { entitlement_id: entitlementId, user_id: ownerKey };
      if (returnUrl) payload.return_url = returnUrl;
      const result = await aichashouPost('/v1/entitlements/access', payload);
      if (!result) return fail('AICHASHOU_UPSTREAM_FAILED', 502, '爱猹收无响应', { mode });
      // 透传上游状态与响应体（200 granted / 200 purchase_required / 4xx 失败关闭）。
      return json({ provider: 'aichashou', entitlement: result.body, mode }, result.status >= 200 && result.status < 300 ? 200 : 502);
    }

    // —— 爱猹收额度原子扣减（幂等键透传；余额不足透传 409）——
    if (path === '/pay/aichashou/consume' && request.method === 'POST') {
      const body = await readJson(request);
      const ownerKey = String(body.ownerKey ?? '').trim();
      const idem = String(body.idempotencyKey ?? '').trim();
      const amount = Math.max(1, Math.min(10, Number(body.amount ?? 1)));
      if (!ownerKey || !idem) return fail('BAD_REQUEST', 400, '需要 ownerKey 与 idempotencyKey', { mode });
      if (aichashouAdminKeys().includes(ownerKey)) {
        // 内部豁免：不扣平台账本，返回近乎无限的余额快照。
        return json({ provider: 'aichashou', result: { consumed: amount, entitlement: { type: 'quota', remaining: 999999 } }, mode });
      }
      if (!aichashouConfigured()) return fail('AICHASHOU_NOT_CONFIGURED', 501, '爱猹收未配置，走支付宝通道', { mode });
      const entitlementId = aichashouEntitlementId('quota');
      if (!entitlementId) return fail('AICHASHOU_ENTITLEMENT_MISSING', 500, '缺少额度权益 ID 配置', { mode });
      const result = await aichashouPost('/v1/entitlements/consume', {
        entitlement_id: entitlementId,
        user_id: ownerKey,
        amount,
        idempotency_key: idem,
      });
      if (!result) return fail('AICHASHOU_UPSTREAM_FAILED', 502, '爱猹收无响应', { mode });
      // 409 余额不足：把上游 error 透传到外层，前端据此映射 INSUFFICIENT_CREDITS。
      const upstreamError = (result.body as { error?: Record<string, unknown> }).error;
      return json(
        { provider: 'aichashou', result: result.body, ...(upstreamError ? { error: upstreamError } : {}), mode },
        result.status,
      );
    }

    // —— 在售 SKU 清单 ——
    if (path === '/pay/skus' && request.method === 'GET') {
      const { data, error } = await db.from('pay_skus').select('*').eq('active', true).order('sort');
      if (error) return fail('SKU_LIST_FAILED', 500, error.message, { mode });
      const skus = (data ?? []).map(sku => ({
        code: sku.code,
        title: sku.title,
        kind: sku.kind ?? 'times',
        planCode: sku.plan_code ?? null,
        periodMonths: sku.period_months ?? null,
        seats: sku.seats ?? null,
        entitlements: sku.entitlements ?? null,
        times: sku.times,
        amountCents: sku.amount_cents,
      }));
      return json({ skus, mode });
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
              const subscription = await fulfillSubscription(db, updated ?? order);
              return json({ order: toOrderView(updated ?? order), subscription, mode, reconciled: true });
            }
            return fail('QUERY_AMOUNT_MISMATCH', 409, '主动查询金额与订单不一致', { mode, order: toOrderView(order) });
          }
        } catch (error) {
          // 查询失败不阻断前端轮询，保持 pending。
          return json({ order: toOrderView(order), mode, queryError: error instanceof Error ? error.message : 'QUERY_FAILED' });
        }
      }
      // 已支付的订阅订单：重放履约（幂等）作为回调丢失的补偿，
      // 前端在观察到 paid 的那次轮询就能直接拿到订阅结果。
      if (order.status === 'paid') {
        const subscription = await fulfillSubscription(db, order);
        if (subscription) return json({ order: toOrderView(order), subscription, mode });
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
