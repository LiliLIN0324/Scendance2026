'use client';

// 付费客户端：有后端地址走真实通道，没有则走本地 mock（PAY_MOCK）。
// 金额只作展示；下单只传 sku code，成交金额由后端 pay_skus 表决定。
import { findSku, findSubscriptionSku, type OrderSkuCode, type PlanCode } from './skus';

export type PayMode = 'mock' | 'sandbox' | 'live';

export interface PayOrderView {
  id: string;
  sku: string;
  /** 订单种类：times = 按次重建，subscription = 会员订阅（pay_orders.kind）。 */
  kind: 'times' | 'subscription';
  planCode: PlanCode | null;
  periodMonths: number | null;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded' | 'expired';
  timesPurchased: number;
  timesUsed: number;
  remaining: number;
  amountCents: number;
  paidAt: string | null;
  createdAt: string | null;
  provider: string;
  providerOrderId: string | null;
}

/** pay_subscription_for 的返回：权益判定的唯一入口，UI 不自己拼 plan 字符串。 */
export interface SubscriptionView {
  planCode: PlanCode;
  seats: number;
  periodStart: string | null;
  periodEnd: string | null;
  entitlements: Record<string, unknown> | null;
}

export interface CreateOrderResult {
  order: PayOrderView;
  subscription?: SubscriptionView | null;
  mode: PayMode;
  qrCode?: string | null;
  payUrl?: string | null;
  note?: string | null;
}

export class PayError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

const API_BASE = (process.env.NEXT_PUBLIC_PAY_API_BASE ?? '').replace(/\/$/, '');
const FORCE_MOCK = process.env.NEXT_PUBLIC_PAY_MOCK === '1';
/**
 * 支付通道选择：aichashou（PAYATHON 2026 官方收款平台，权益托管）或 alipay
 * （当面付直连）。服务端 Key 永不进前端；爱猹收的 access/consume 一律经
 * pay-api 代理（/pay/aichashou/*）。未配置 API_BASE 时仍是本地 mock。
 */
export type PayProvider = 'aichashou' | 'alipay';
export const payProvider: PayProvider =
  process.env.NEXT_PUBLIC_PAY_PROVIDER === 'aichashou' && API_BASE ? 'aichashou' : 'alipay';

/** 爱猹收 access 接口的响应（经 pay-api 代理透传）。 */
export interface AccessResult {
  access: 'granted' | 'purchase_required' | 'unavailable';
  entitlement?: {
    type?: 'permanent' | 'duration' | 'quota';
    starts_at?: number;
    expires_at?: number;
    remaining?: number;
  };
  purchase?: { url: string; qr_code_url?: string | null };
  reason?: { code?: string; message?: string };
}

/** 没有配置后端地址时，本地 mock 兜底，界面必须显示「模拟支付」。 */
export function isMockMode(): boolean {
  return FORCE_MOCK || !API_BASE;
}

export function modeLabel(mode: PayMode): string {
  if (mode === 'mock') return '模拟支付 · 未真实扣款';
  if (mode === 'sandbox') return '沙盒支付 · 不产生真实扣款';
  return '真实支付';
}

const OWNER_KEY = 'scendance.pay.owner.v1';
const ORDER_KEY = 'scendance.pay.orders.v1';
const CONSUME_KEY = 'scendance.pay.consumptions.v1';

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

/** 匿名设备键：网页未登录时也能归属额度。后续绑定用户只需把 owner 换成 user:<id>。 */
export function deviceOwnerKey(): string {
  if (typeof window === 'undefined') return 'anon:server';
  let value = window.localStorage.getItem(OWNER_KEY);
  if (!value) {
    const random = Math.random().toString(36).slice(2, 10);
    value = `anon:web-${random}`;
    window.localStorage.setItem(OWNER_KEY, value);
  }
  return value;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new PayError('PAY_NOT_CONFIGURED', '未配置 NEXT_PUBLIC_PAY_API_BASE');
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error as { code?: string; message?: string } | undefined;
    throw new PayError(error?.code ?? 'PAY_API_ERROR', error?.message ?? `HTTP ${response.status}`);
  }
  return body as T;
}

interface MockConsumption {
  idempotencyKey: string;
  orderId: string;
  times: number;
  state: 'reserved' | 'released';
}

function mockOrders(): PayOrderView[] {
  return readJson<PayOrderView[]>(ORDER_KEY, []);
}

function saveMockOrders(orders: PayOrderView[]) {
  writeJson(ORDER_KEY, orders);
}

function mockConsumptions(): MockConsumption[] {
  return readJson<MockConsumption[]>(CONSUME_KEY, []);
}

function saveMockConsumptions(list: MockConsumption[]) {
  writeJson(CONSUME_KEY, list);
}

export async function createOrder(input: { sku: OrderSkuCode; ownerKey?: string }): Promise<CreateOrderResult> {
  const ownerKey = input.ownerKey ?? deviceOwnerKey();
  if (isMockMode()) {
    const subSku = findSubscriptionSku(input.sku);
    const now = new Date();
    const order: PayOrderView = subSku
      ? {
          id: `mock-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          sku: subSku.code,
          kind: 'subscription',
          planCode: subSku.planCode,
          periodMonths: subSku.periodMonths,
          status: 'paid',
          timesPurchased: 0,
          timesUsed: 0,
          remaining: 0,
          amountCents: subSku.amountCents,
          paidAt: now.toISOString(),
          createdAt: now.toISOString(),
          provider: 'mock',
          providerOrderId: null,
        }
      : (() => {
          const sku = findSku(input.sku);
          if (!sku) throw new PayError('SKU_NOT_FOUND');
          return {
            id: `mock-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            sku: sku.code,
            kind: 'times' as const,
            planCode: null,
            periodMonths: null,
            status: 'paid' as const,
            timesPurchased: sku.times,
            timesUsed: 0,
            remaining: sku.times,
            amountCents: sku.amountCents,
            paidAt: now.toISOString(),
            createdAt: now.toISOString(),
            provider: 'mock',
            providerOrderId: null,
          };
        })();
    saveMockOrders([...mockOrders(), order]);
    const result: CreateOrderResult = { order, mode: 'mock', note: '本地模拟，未发生真实收款' };
    if (subSku) result.subscription = mockSubscriptionFromOrders();
    return result;
  }

  const result = await api<CreateOrderResult>('/pay/create', {
    method: 'POST',
    body: JSON.stringify({ sku: input.sku, ownerKey, anonId: ownerKey }),
  });
  return result;
}

/** 由 mock 订单推导当前订阅：mock 里下单即到账，订阅终点 = 支付时刻 + 周期。 */
function mockSubscriptionFromOrders(): SubscriptionView {
  const paid = mockOrders()
    .filter(order => order.status === 'paid' && order.kind === 'subscription' && order.planCode)
    .sort((a, b) => (a.paidAt ?? '').localeCompare(b.paidAt ?? ''));
  const latest = paid[paid.length - 1];
  if (!latest?.planCode) {
    return { planCode: 'free', seats: 1, periodStart: null, periodEnd: null, entitlements: null };
  }
  const start = latest.paidAt ?? latest.createdAt ?? new Date().toISOString();
  const end = new Date(start);
  end.setMonth(end.getMonth() + Math.max(1, latest.periodMonths ?? 1));
  return {
    planCode: latest.planCode,
    seats: latest.planCode === 'team' ? 3 : 1,
    periodStart: start,
    periodEnd: end.toISOString(),
    entitlements: null,
  };
}

/** 当前订阅与权益；免费/过期由后端 pay_subscription_for 统一判定，前端不自拼。 */
export async function getSubscription(ownerKey?: string): Promise<{ subscription: SubscriptionView; mode: PayMode }> {
  if (isMockMode()) {
    return { subscription: mockSubscriptionFromOrders(), mode: 'mock' };
  }
  if (payProvider === 'aichashou') {
    // 爱猹收通道：会员权益由平台托管，access 的 duration 起止映射成订阅视图。
    // 专业版与团队版是两个权益；team granted 时优先展示团队版。
    const owner = ownerKey ?? deviceOwnerKey();
    const pro = await fetchEntitlement('membership', owner);
    const team = await fetchEntitlement('team', owner).catch(() => null);
    const pick = (result: { entitlement: AccessResult } | null) =>
      result && result.entitlement.access === 'granted' && result.entitlement.entitlement?.type === 'duration'
        ? result.entitlement.entitlement
        : null;
    const teamEnt = pick(team);
    const proEnt = pick(pro);
    const chosen = teamEnt ?? proEnt;
    if (chosen?.expires_at) {
      const plan = teamEnt ? 'team' : 'pro';
      const start = chosen.starts_at ? chosen.starts_at * 1000 : Date.now();
      return {
        subscription: {
          planCode: plan,
          seats: teamEnt ? 3 : 1,
          periodStart: new Date(start).toISOString(),
          periodEnd: new Date(chosen.expires_at * 1000).toISOString(),
          entitlements: null,
        },
        mode: 'live',
      };
    }
    return { subscription: { planCode: 'free', seats: 1, periodStart: null, periodEnd: null, entitlements: null }, mode: 'live' };
  }
  const owner = ownerKey ?? deviceOwnerKey();
  return api<{ subscription: SubscriptionView; mode: PayMode }>('/pay/subscription', {
    method: 'POST',
    body: JSON.stringify({ ownerKey: owner }),
  });
}

/**
 * 爱猹收权益检查（经 pay-api 代理；Key 只在服务端）。
 * 返回 access 状态与平台生成的购买入口（url = 支付宝收银链接，qr_code_url = 平台二维码图）。
 * kind：membership = 专业版时长，team = 团队版时长，quota = 重建次数额度。
 */
export async function fetchEntitlement(
  kind: 'membership' | 'team' | 'quota',
  ownerKey?: string,
): Promise<{ entitlement: AccessResult; mode: PayMode }> {
  const owner = ownerKey ?? deviceOwnerKey();
  const result = await api<{ provider: string; entitlement: AccessResult; mode: PayMode }>('/pay/aichashou/access', {
    method: 'POST',
    body: JSON.stringify({ ownerKey: owner, kind }),
  });
  return { entitlement: result.entitlement, mode: result.mode };
}

/** 爱猹收额度原子扣减（幂等键沿用 scan:owner:job:attempt 规则）。余额不足抛 INSUFFICIENT_CREDITS。 */
async function consumeQuotaViaAichashou(
  amount: number,
  idempotencyKey: string,
  ownerKey?: string,
): Promise<{ remaining: number }> {
  const owner = ownerKey ?? deviceOwnerKey();
  const result = await api<{ result: { consumed?: number; entitlement?: { remaining?: number } } }>('/pay/aichashou/consume', {
    method: 'POST',
    body: JSON.stringify({ ownerKey: owner, amount, idempotencyKey }),
  }).catch((cause: unknown) => {
    // pay-api 把爱猹收 409 的 error.code=insufficient_quota 透传到外层。
    if (cause instanceof PayError && cause.code === 'insufficient_quota') {
      throw new PayError('INSUFFICIENT_CREDITS', cause.message);
    }
    throw cause;
  });
  return { remaining: result.result?.entitlement?.remaining ?? 0 };
}

export async function getOrder(orderId: string): Promise<{ order: PayOrderView; mode: PayMode }> {
  if (isMockMode()) {
    const order = mockOrders().find(item => item.id === orderId);
    if (!order) throw new PayError('ORDER_NOT_FOUND');
    return { order, mode: 'mock' };
  }
  return api<{ order: PayOrderView; mode: PayMode }>(`/pay/order/${encodeURIComponent(orderId)}`);
}

/** 本地 mock 也需要幂等：同一 jobId+attempt 重复调用不重复扣。 */
export async function consume(input: {
  ownerKey?: string;
  jobId: string;
  attempt?: number;
  times?: number;
}): Promise<{ idempotencyKey: string; remaining: number; state: string; mode: PayMode }> {
  const ownerKey = input.ownerKey ?? deviceOwnerKey();
  const attempt = Math.max(1, Math.floor(input.attempt ?? 1));
  const times = Math.max(1, Math.min(10, input.times ?? 1));
  const idempotencyKey = `scan:${ownerKey}:${input.jobId}:${attempt}`;

  if (isMockMode()) {
    const consumptions = mockConsumptions();
    const existing = consumptions.find(item => item.idempotencyKey === idempotencyKey);
    if (existing) {
      const order = mockOrders().find(item => item.id === existing.orderId);
      return { idempotencyKey, remaining: order?.remaining ?? 0, state: existing.state, mode: 'mock' };
    }
    const orders = mockOrders();
    const target = orders
      .filter(item => item.status === 'paid' && item.remaining >= times)
      .sort((left, right) => right.remaining - left.remaining)[0];
    if (!target) throw new PayError('INSUFFICIENT_CREDITS', '没有可用次数，先购买');
    target.timesUsed += times;
    target.remaining -= times;
    saveMockOrders(orders);
    saveMockConsumptions([...consumptions, { idempotencyKey, orderId: target.id, times, state: 'reserved' }]);
    return { idempotencyKey, remaining: target.remaining, state: 'reserved', mode: 'mock' };
  }

  if (payProvider === 'aichashou') {
    // 爱猹收通道：额度权威在平台，原子扣减 + 幂等键透传。
    const { remaining } = await consumeQuotaViaAichashou(times, idempotencyKey, ownerKey);
    return { idempotencyKey, remaining, state: 'consumed', mode: 'live' };
  }

  return api('/scan/consume', {
    method: 'POST',
    body: JSON.stringify({ ownerKey, jobId: input.jobId, attempt, times }),
  });
}

/** 失败返还：幂等，重复调用只退一次。 */
export async function release(idempotencyKey: string): Promise<{ remaining: number; state: string; mode: PayMode }> {
  if (isMockMode()) {
    const consumptions = mockConsumptions();
    const target = consumptions.find(item => item.idempotencyKey === idempotencyKey);
    if (!target) throw new PayError('CONSUMPTION_NOT_FOUND');
    if (target.state === 'released') {
      const order = mockOrders().find(item => item.id === target.orderId);
      return { remaining: order?.remaining ?? 0, state: 'released', mode: 'mock' };
    }
    const orders = mockOrders();
    const order = orders.find(item => item.id === target.orderId);
    if (order) {
      order.timesUsed = Math.max(0, order.timesUsed - target.times);
      order.remaining += target.times;
      saveMockOrders(orders);
    }
    target.state = 'released';
    saveMockConsumptions(consumptions);
    return { remaining: order?.remaining ?? 0, state: 'released', mode: 'mock' };
  }
  const result = await api<{ consumption: { remaining?: number; state?: string }; mode: PayMode }>('/scan/release', {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey }),
  });
  return {
    remaining: Number(result.consumption?.remaining ?? 0),
    state: String(result.consumption?.state ?? 'released'),
    mode: result.mode,
  };
}

/** 最近一笔已支付订单，用于展示凭证与剩余次数。 */
export function latestPaidOrder(): PayOrderView | null {
  const orders = mockOrders().filter(item => item.status === 'paid');
  return orders.length ? orders[orders.length - 1] : null;
}
