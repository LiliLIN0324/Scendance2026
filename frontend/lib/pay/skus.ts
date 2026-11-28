// 价格与 SKU：金额一律整数分。此文件只用于展示与下单时传 code，
// 实际成交金额由后端 pay_skus 表决定，前端传来的金额一律不采信。
// 订阅档位与 supabase/migrations/20261128010000_pay_subscriptions.sql 的 seed 一一对应；
// 改价格要两处同改（迁移是唯一真值，这里只是展示镜像）。
export type SkuCode = 'scan_1' | 'scan_3' | 'scan_10';
export type SubscriptionSkuCode = 'sub_pro_m' | 'sub_pro_y' | 'sub_team_m' | 'sub_team_y';
export type OrderSkuCode = SkuCode | SubscriptionSkuCode;
export type PlanCode = 'free' | 'pro' | 'team';
export type BillingCycle = 'monthly' | 'yearly';

export interface PaySku {
  code: SkuCode;
  title: string;
  note: string;
  times: number;
  amountCents: number;
  /** 折算单次价（分），仅用于展示。 */
  unitCents: number;
  badge?: string;
}

export const PAY_SKUS: PaySku[] = [
  {
    code: 'scan_1',
    title: '单次重建',
    note: '先试一次，确认效果',
    times: 1,
    amountCents: 490,
    unitCents: 490,
  },
  {
    code: 'scan_3',
    title: '3 次重建',
    note: '一次场地，三种角度',
    times: 3,
    amountCents: 990,
    unitCents: 330,
    badge: '常用',
  },
  {
    code: 'scan_10',
    title: '10 次重建',
    note: '一周跑多个现场',
    times: 10,
    amountCents: 2990,
    unitCents: 299,
  },
];

export function findSku(code: string): PaySku | undefined {
  return PAY_SKUS.find(sku => sku.code === code);
}

export function findSubscriptionSku(code: string): SubscriptionSku | undefined {
  return SUB_SKUS.find(sku => sku.code === code);
}

/** 订阅 SKU（下单 code → 周期），金额与迁移 seed 一致。 */
export interface SubscriptionSku {
  code: SubscriptionSkuCode;
  planCode: Exclude<PlanCode, 'free'>;
  cycle: BillingCycle;
  amountCents: number;
  periodMonths: number;
}

export const SUB_SKUS: SubscriptionSku[] = [
  { code: 'sub_pro_m', planCode: 'pro', cycle: 'monthly', amountCents: 9900, periodMonths: 1 },
  { code: 'sub_pro_y', planCode: 'pro', cycle: 'yearly', amountCents: 99900, periodMonths: 12 },
  { code: 'sub_team_m', planCode: 'team', cycle: 'monthly', amountCents: 39900, periodMonths: 1 },
  { code: 'sub_team_y', planCode: 'team', cycle: 'yearly', amountCents: 399900, periodMonths: 12 },
];

/** 档位 → 当前周期对应订阅 SKU；免费版没有下单 code。 */
export function subscriptionSkuFor(plan: Exclude<PlanCode, 'free'>, cycle: BillingCycle): SubscriptionSku | undefined {
  return SUB_SKUS.find(sku => sku.planCode === plan && sku.cycle === cycle);
}

/** 490 → "¥4.90"；整数分不参与浮点运算。 */
export function formatYuan(cents: number): string {
  const safe = Math.max(0, Math.round(cents));
  const yuan = Math.floor(safe / 100);
  const fen = safe % 100;
  return `¥${yuan}.${fen.toString().padStart(2, '0')}`;
}
