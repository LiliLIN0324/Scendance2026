// 会员订阅（PAYATHON 2026）：履约、幂等、提前续费接期、额度隔离与权益判定。
// 直接在 PGlite 夹具上调用迁移里的 pay_* 函数——夹具跑全量迁移，
// 同时保证 20261128010000_pay_subscriptions.sql 不破坏其他测试。
import { describe, expect, it } from 'vitest';
import { database } from './fixtures';

const OWNER = 'anon:web-sub-test';

interface SubscriptionRow {
  id: string;
  plan_code: string;
  seats: number;
  period_start: string;
  period_end: string;
  status: string;
  entitlements: Record<string, unknown>;
}

async function insertPaidOrder(
  db: Awaited<ReturnType<typeof database>>['db'],
  input: { sku: string; kind: 'times' | 'subscription'; planCode?: string | null; periodMonths?: number | null; amountCents: number; idem: string },
) {
  const result = await db.query<{ id: string }>(
    `insert into public.pay_orders
       (owner_key, sku, kind, plan_code, period_months, times_purchased, amount_cents, status, provider, idempotency_key, paid_at, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,'paid','mock',$8, now(), now() + interval '180 days')
     returning id`,
    [OWNER, input.sku, input.kind, input.planCode ?? null, input.periodMonths ?? null, input.kind === 'subscription' ? 0 : 1, input.amountCents, input.idem],
  );
  return result.rows[0].id;
}

async function rows(db: Awaited<ReturnType<typeof database>>['db']): Promise<SubscriptionRow[]> {
  const result = await db.query<SubscriptionRow>(
    'select * from public.subscriptions where owner_key = $1 order by period_end desc',
    [OWNER],
  );
  return result.rows;
}

function monthsBetween(from: string, to: string): number {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  return Math.round((end - start) / (30 * 86400000));
}

describe('pay_subscriptions', () => {
  it('seed 了四个订阅档位，金额与权益随档位下发', async () => {
    const f = await database();
    const db = f.db;
    const result = await db.query<{ code: string; kind: string; plan_code: string; period_months: number; amount_cents: number; seats: number }>(
      `select code, kind, plan_code, period_months, amount_cents, seats from public.pay_skus
        where kind = 'subscription' order by sort`,
    );
    expect(result.rows.map(row => row.code)).toEqual(['sub_pro_m', 'sub_pro_y', 'sub_team_m', 'sub_team_y']);
    expect(result.rows[1]).toMatchObject({ plan_code: 'pro', period_months: 12, amount_cents: 99900, seats: 1 });
    expect(result.rows[3]).toMatchObject({ plan_code: 'team', period_months: 12, amount_cents: 399900, seats: 3 });
    // 按次 SKU 不受影响
    const times = await db.query<{ code: string }>(`select code from public.pay_skus where kind = 'times' order by sort`);
    expect(times.rows.map(row => row.code)).toEqual(['scan_1', 'scan_3', 'scan_10']);
  });

  it('订阅订单 times_purchased = 0 通过新约束；pay_reserve 只认按次单', async () => {
    const f = await database();
    const db = f.db;
    await insertPaidOrder(db, { sku: 'sub_pro_m', kind: 'subscription', planCode: 'pro', periodMonths: 1, amountCents: 9900, idem: 'sub-only-1' });
    // 只有订阅单时，预扣必须拒绝——订阅不含次数额度。
    await expect(db.query(`select public.pay_reserve($1, 'idem-x', 'job-x', 1)`, [OWNER]))
      .rejects.toThrow(/INSUFFICIENT_CREDITS/);
    // 按次单照常预扣。
    await insertPaidOrder(db, { sku: 'scan_1', kind: 'times', amountCents: 490, idem: 'times-1' });
    const reserved = await db.query<{ result: { remaining: number } }>(
      `select public.pay_reserve($1, 'idem-y', 'job-y', 1) as result`, [OWNER],
    );
    expect(reserved.rows[0].result.remaining).toBe(0);
  });

  it('pay_fulfill_subscription 开通订阅：seats、权益与周期来自 SKU 与订单', async () => {
    const f = await database();
    const db = f.db;
    const orderId = await insertPaidOrder(db, { sku: 'sub_pro_m', kind: 'subscription', planCode: 'pro', periodMonths: 1, amountCents: 9900, idem: 'fulfil-1' });
    const fulfilled = await db.query<{ result: { subscriptionId: string; idempotent: boolean } }>(
      'select public.pay_fulfill_subscription($1) as result', [orderId],
    );
    expect(fulfilled.rows[0].result.idempotent).toBe(false);

    const list = await rows(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ plan_code: 'pro', seats: 1, status: 'active' });
    expect(list[0].entitlements).toMatchObject({ exportResolution: '1080p', watermark: false });
    expect(monthsBetween(list[0].period_start, list[0].period_end)).toBe(1);
  });

  it('重复履约幂等：同一订单只开一份订阅', async () => {
    const f = await database();
    const db = f.db;
    const orderId = await insertPaidOrder(db, { sku: 'sub_pro_y', kind: 'subscription', planCode: 'pro', periodMonths: 12, amountCents: 99900, idem: 'idem-1' });
    const first = await db.query<{ result: { subscriptionId: string; idempotent: boolean } }>(
      'select public.pay_fulfill_subscription($1) as result', [orderId],
    );
    const second = await db.query<{ result: { subscriptionId: string; idempotent: boolean } }>(
      'select public.pay_fulfill_subscription($1) as result', [orderId],
    );
    expect(second.rows[0].result.idempotent).toBe(true);
    expect(second.rows[0].result.subscriptionId).toBe(first.rows[0].result.subscriptionId);
    expect(await rows(db)).toHaveLength(1);
  });

  it('提前续费从原 period_end 顺延，不吃掉已买时长', async () => {
    const f = await database();
    const db = f.db;
    const firstOrder = await insertPaidOrder(db, { sku: 'sub_pro_m', kind: 'subscription', planCode: 'pro', periodMonths: 1, amountCents: 9900, idem: 'renew-1' });
    await db.query('select public.pay_fulfill_subscription($1)', [firstOrder]);
    const afterFirst = (await rows(db))[0];

    const secondOrder = await insertPaidOrder(db, { sku: 'sub_pro_m', kind: 'subscription', planCode: 'pro', periodMonths: 1, amountCents: 9900, idem: 'renew-2' });
    await db.query('select public.pay_fulfill_subscription($1)', [secondOrder]);

    const list = await rows(db);
    expect(list).toHaveLength(2);
    const latest = list[0];
    // 第二单的起点 = 第一单的终点，终点 = 起点再 +1 个月。
    expect(new Date(latest.period_start).getTime()).toBe(new Date(afterFirst.period_end).getTime());
    expect(monthsBetween(latest.period_start, latest.period_end)).toBe(1);
    expect(monthsBetween(afterFirst.period_start, latest.period_end)).toBe(2);
  });

  it('pay_subscription_for 是唯一判定入口：无订阅返回免费基线，过期后回落', async () => {
    const f = await database();
    const db = f.db;
    const free = await db.query<{ result: { planCode: string; entitlements: Record<string, unknown> } }>(
      'select public.pay_subscription_for($1) as result', [OWNER],
    );
    expect(free.rows[0].result.planCode).toBe('free');
    expect(free.rows[0].result.entitlements).toMatchObject({ exportResolution: '720p', watermark: true });

    const orderId = await insertPaidOrder(db, { sku: 'sub_team_m', kind: 'subscription', planCode: 'team', periodMonths: 1, amountCents: 39900, idem: 'entitle-1' });
    await db.query('select public.pay_fulfill_subscription($1)', [orderId]);
    const team = await db.query<{ result: { planCode: string; seats: number; entitlements: Record<string, unknown> } }>(
      'select public.pay_subscription_for($1) as result', [OWNER],
    );
    expect(team.rows[0].result.planCode).toBe('team');
    expect(team.rows[0].result.seats).toBe(3);
    expect(team.rows[0].result.entitlements).toMatchObject({ whiteLabel: true, sharedLibrary: true, approvalTrail: true });

    // 过期后回落到免费基线。
    await db.query(`update public.subscriptions set period_end = now() - interval '1 day' where owner_key = $1`, [OWNER]);
    const expired = await db.query<{ result: { planCode: string } }>(
      'select public.pay_subscription_for($1) as result', [OWNER],
    );
    expect(expired.rows[0].result.planCode).toBe('free');
  });

  it('pay_fulfill_subscription 拒绝非订阅单与未支付单', async () => {
    const f = await database();
    const db = f.db;
    const timesOrder = await insertPaidOrder(db, { sku: 'scan_1', kind: 'times', amountCents: 490, idem: 'guard-times' });
    await expect(db.query('select public.pay_fulfill_subscription($1)', [timesOrder]))
      .rejects.toThrow(/NOT_SUBSCRIPTION_ORDER/);

    const pending = await db.query<{ id: string }>(
      `insert into public.pay_orders
         (owner_key, sku, kind, plan_code, period_months, times_purchased, amount_cents, status, provider, idempotency_key)
       values ($1,'sub_pro_m','subscription','pro',1,0,9900,'pending','mock','guard-pending') returning id`,
      [OWNER],
    );
    await expect(db.query('select public.pay_fulfill_subscription($1)', [pending.rows[0].id]))
      .rejects.toThrow(/ORDER_NOT_PAID/);
  });
});
