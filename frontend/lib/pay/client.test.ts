// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consume, createOrder, getOrder, getSubscription, release } from './client';
import { MemoryStorage } from '../test-support-memory-storage';

/**
 * 本地 mock 通道：PAY_MOCK=1（或没配 NEXT_PUBLIC_PAY_API_BASE）时，
 * 下单直接到账、扣次与返还都只写 localStorage，用来验证整条前端闭环。
 */
let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  window.localStorage.clear();
});

describe('pay client mock', () => {
  it('下单即到账，次数可查', async () => {
    const created = await createOrder({ sku: 'scan_3' });
    expect(created.mode).toBe('mock');
    expect(created.order.status).toBe('paid');
    expect(created.order.timesPurchased).toBe(3);
    expect(created.order.remaining).toBe(3);

    const fetched = await getOrder(created.order.id);
    expect(fetched.order.remaining).toBe(3);
  });

  it('扣次后余额递减，重复提交同一幂等键不重复扣', async () => {
    await createOrder({ sku: 'scan_3' });
    const first = await consume({ jobId: 'job-a', attempt: 1 });
    expect(first.remaining).toBe(2);
    expect(first.state).toBe('reserved');

    const repeat = await consume({ jobId: 'job-a', attempt: 1 });
    expect(repeat.idempotencyKey).toBe(first.idempotencyKey);
    expect(repeat.remaining).toBe(2);
  });

  it('换一个 attempt 才会再扣一次', async () => {
    await createOrder({ sku: 'scan_3' });
    await consume({ jobId: 'job-a', attempt: 1 });
    const retry = await consume({ jobId: 'job-a', attempt: 2 });
    expect(retry.remaining).toBe(1);
  });

  it('失败返还只退一次', async () => {
    await createOrder({ sku: 'scan_3' });
    const reserved = await consume({ jobId: 'job-b', attempt: 1 });
    expect(reserved.remaining).toBe(2);

    const once = await release(reserved.idempotencyKey);
    expect(once.remaining).toBe(3);
    const twice = await release(reserved.idempotencyKey);
    expect(twice.remaining).toBe(3);
    expect(twice.state).toBe('released');
  });

  it('没买就扣次返回 INSUFFICIENT_CREDITS', async () => {
    await expect(consume({ jobId: 'job-c' })).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
  });
});

describe('pay client mock 订阅', () => {
  it('订阅下单即到账，kind / planCode / 周期写入订单', async () => {
    const created = await createOrder({ sku: 'sub_pro_y' });
    expect(created.mode).toBe('mock');
    expect(created.order.kind).toBe('subscription');
    expect(created.order.planCode).toBe('pro');
    expect(created.order.periodMonths).toBe(12);
    expect(created.order.timesPurchased).toBe(0);
    expect(created.order.amountCents).toBe(99900);
    expect(created.subscription?.planCode).toBe('pro');
    expect(created.subscription?.seats).toBe(1);
    expect(created.subscription?.periodEnd).toBeTruthy();
  });

  it('getSubscription 反映最新订阅：按月 +1 个月，团队版 3 席位', async () => {
    await createOrder({ sku: 'sub_pro_m' });
    const monthly = await getSubscription();
    expect(monthly.subscription.planCode).toBe('pro');
    const end = new Date(monthly.subscription.periodEnd ?? '');
    expect(end.getTime()).toBeGreaterThan(Date.now() + 27 * 86400000);
    expect(end.getTime()).toBeLessThan(Date.now() + 32 * 86400000);

    await createOrder({ sku: 'sub_team_m' });
    const team = await getSubscription();
    expect(team.subscription.planCode).toBe('team');
    expect(team.subscription.seats).toBe(3);
  });

  it('订阅单不进次数额度池：只有订阅时扣次报不足', async () => {
    await createOrder({ sku: 'sub_pro_y' });
    await expect(consume({ jobId: 'job-sub', attempt: 1 })).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
  });

  it('没有订阅时返回免费基线', async () => {
    const { subscription } = await getSubscription();
    expect(subscription.planCode).toBe('free');
    expect(subscription.seats).toBe(1);
    expect(subscription.periodEnd).toBeNull();
  });
});
