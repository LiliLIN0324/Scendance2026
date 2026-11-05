// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { consume, createOrder, getOrder, release } from './client';

/**
 * 本地 mock 通道：PAY_MOCK=1（或没配 NEXT_PUBLIC_PAY_API_BASE）时，
 * 下单直接到账、扣次与返还都只写 localStorage，用来验证整条前端闭环。
 */
beforeEach(() => {
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
