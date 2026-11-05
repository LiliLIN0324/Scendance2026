import { describe, expect, it } from 'vitest';
import {
  applyConsumption,
  appliesOnce,
  buildIdempotencyKey,
  buildOrderKey,
  canConsume,
  emptyAccount,
  fromOrders,
  isOrderExpired,
  QUOTA_RULES,
  refundableInCash,
  refundTimes,
  remainingOf,
  type ConsumptionRecord,
  type PayOrder,
} from './quota';

const paidOrder = (overrides: Partial<PayOrder> = {}): PayOrder => ({
  id: 'order-1',
  sku: 'scan_3',
  status: 'paid',
  timesPurchased: 3,
  timesUsed: 0,
  amountCents: 990,
  paidAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2027-04-30T00:00:00.000Z',
  ...overrides,
});

const record = (state: ConsumptionRecord['state'], key = 'scan:anon:a:job:1'): ConsumptionRecord => ({
  idempotencyKey: key,
  orderId: 'order-1',
  times: 1,
  state,
});

describe('额度账本', () => {
  it('空账本不可扣次', () => {
    const account = emptyAccount();
    expect(remainingOf(account)).toBe(0);
    expect(canConsume(account, 1)).toBe(false);
  });

  it('只有已支付订单计入额度', () => {
    const account = fromOrders([
      paidOrder({ id: 'a', timesPurchased: 3 }),
      paidOrder({ id: 'b', status: 'pending', timesPurchased: 10 }),
      paidOrder({ id: 'c', status: 'cancelled', timesPurchased: 1 }),
    ]);
    expect(account.purchased).toBe(3);
    expect(remainingOf(account)).toBe(3);
  });

  it('预扣后可用下降，确认后不再回涨', () => {
    const account = { purchased: 3, committed: 0, reserved: 0 };
    const reserved = applyConsumption(account, record('reserved'));
    expect(remainingOf(reserved)).toBe(2);
    const committed = applyConsumption(reserved, record('committed', 'scan:anon:a:job:1:done'));
    expect(remainingOf(committed)).toBe(2);
    expect(committed.committed).toBe(1);
    expect(committed.reserved).toBe(0);
  });

  it('失败返还后次数回到账上', () => {
    const account = { purchased: 3, committed: 0, reserved: 1 };
    const released = applyConsumption(account, record('released', 'scan:anon:a:job:1'));
    expect(remainingOf(released)).toBe(3);
  });

  it('同一幂等键只生效一次', () => {
    const applied = new Set<string>();
    const first = record('reserved', 'scan:anon:a:job:1');
    expect(appliesOnce(applied, first)).toBe(true);
    expect(appliesOnce(applied, first)).toBe(false);
    expect(applied.size).toBe(1);
  });

  it('单任务扣次有上限', () => {
    const account = { purchased: 20, committed: 0, reserved: 0 };
    expect(canConsume(account, QUOTA_RULES.maxTimesPerJob)).toBe(true);
    expect(canConsume(account, QUOTA_RULES.maxTimesPerJob + 1)).toBe(false);
  });

  it('幂等键随 attempt 变化', () => {
    const base = buildIdempotencyKey({ ownerKey: 'anon:a', jobId: 'job-1' });
    const retry = buildIdempotencyKey({ ownerKey: 'anon:a', jobId: 'job-1', attempt: 2 });
    expect(base).toBe('scan:anon:a:job-1:1');
    expect(retry).toBe('scan:anon:a:job-1:2');
    expect(base).not.toBe(retry);
  });

  it('订单幂等键同一分钟稳定', () => {
    expect(buildOrderKey({ ownerKey: 'anon:a', sku: 'scan_3', minuteBucket: 100 })).toBe('order:anon:a:scan_3:100');
  });

  it('过期订单不再可用', () => {
    const order = paidOrder({ expiresAt: '2026-10-01T00:00:00.000Z' });
    expect(isOrderExpired(order, new Date('2026-11-05').getTime())).toBe(true);
  });

  it('未使用且 7 天内可退钱；用过一次就不退钱', () => {
    const now = new Date('2026-11-03T00:00:00.000Z').getTime();
    expect(refundableInCash(paidOrder(), now)).toBe(true);
    expect(refundableInCash(paidOrder({ timesUsed: 1 }), now)).toBe(false);
    expect(refundableInCash(paidOrder({ paidAt: '2026-10-01T00:00:00.000Z' }), now)).toBe(false);
    expect(refundableInCash(paidOrder({ status: 'pending' }), now)).toBe(false);
  });

  it('失败返还按已扣次数原样退回', () => {
    expect(refundTimes(3)).toBe(3);
    expect(refundTimes(-1)).toBe(0);
    expect(refundTimes(1.6)).toBe(1);
  });
});
