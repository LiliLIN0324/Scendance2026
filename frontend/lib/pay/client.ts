'use client';

// 付费客户端：有后端地址走真实通道，没有则走本地 mock（PAY_MOCK）。
// 金额只作展示；下单只传 sku code，成交金额由后端 pay_skus 表决定。
import { findSku, type SkuCode } from './skus';

export type PayMode = 'mock' | 'sandbox' | 'live';

export interface PayOrderView {
  id: string;
  sku: string;
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

export interface CreateOrderResult {
  order: PayOrderView;
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

export async function createOrder(input: { sku: SkuCode; ownerKey?: string }): Promise<CreateOrderResult> {
  const ownerKey = input.ownerKey ?? deviceOwnerKey();
  if (isMockMode()) {
    const sku = findSku(input.sku);
    if (!sku) throw new PayError('SKU_NOT_FOUND');
    const now = new Date();
    const order: PayOrderView = {
      id: `mock-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sku: sku.code,
      status: 'paid',
      timesPurchased: sku.times,
      timesUsed: 0,
      remaining: sku.times,
      amountCents: sku.amountCents,
      paidAt: now.toISOString(),
      createdAt: now.toISOString(),
      provider: 'mock',
      providerOrderId: null,
    };
    saveMockOrders([...mockOrders(), order]);
    return { order, mode: 'mock', note: '本地模拟，未发生真实收款' };
  }

  const result = await api<CreateOrderResult>('/pay/create', {
    method: 'POST',
    body: JSON.stringify({ sku: input.sku, ownerKey, anonId: ownerKey }),
  });
  return result;
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
