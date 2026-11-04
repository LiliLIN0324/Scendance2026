/**
 * 额度账本（纯函数，便于单测）。
 * 一次重建任务 = 1 次额度，与照片张数无关。
 *
 * 口径：
 * - purchased：已支付订单带来的总次数
 * - committed：已确认消耗
 * - reserved：已预扣、尚未确认的（提交时进入，成功提交后转 committed）
 * - 可用 = purchased - committed - reserved
 */
export interface CreditAccount {
  purchased: number;
  committed: number;
  reserved: number;
}

export type ConsumptionState = 'reserved' | 'committed' | 'released';

export interface ConsumptionRecord {
  idempotencyKey: string;
  orderId: string;
  times: number;
  state: ConsumptionState;
}

export interface PayOrder {
  id: string;
  sku: string;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded' | 'expired';
  timesPurchased: number;
  timesUsed: number;
  amountCents: number;
  paidAt: string | null;
  expiresAt: string | null;
}

export const QUOTA_RULES = {
  /** 已支付订单有效期（天） */
  validDays: 180,
  /** 整单未使用时，可申请原路退款的窗口（天） */
  refundWindowDays: 7,
  /** 同设备每日重建上限 */
  dailyJobLimit: 3,
  /** 单次提交最多扣几次（防止误传） */
  maxTimesPerJob: 10,
} as const;

export function emptyAccount(): CreditAccount {
  return { purchased: 0, committed: 0, reserved: 0 };
}

export function remainingOf(account: CreditAccount): number {
  return Math.max(0, account.purchased - account.committed - account.reserved);
}

export function canConsume(account: CreditAccount, times = 1): boolean {
  return times > 0 && times <= QUOTA_RULES.maxTimesPerJob && remainingOf(account) >= times;
}

export function fromOrders(orders: PayOrder[]): CreditAccount {
  const account = emptyAccount();
  orders.forEach(order => {
    if (order.status === 'paid') account.purchased += order.timesPurchased;
  });
  return account;
}

/**
 * 按流水状态回放账户。重复回放同一条（幂等键相同）不会重复记账：
 * 传入已应用过的记录时必须跳过——调用方用 appliesOnce 判断。
 */
export function applyConsumption(account: CreditAccount, record: ConsumptionRecord): CreditAccount {
  if (record.times <= 0) return account;
  if (record.state === 'reserved') {
    return { ...account, reserved: account.reserved + record.times };
  }
  if (record.state === 'committed') {
    return {
      ...account,
      reserved: Math.max(0, account.reserved - record.times),
      committed: account.committed + record.times,
    };
  }
  return { ...account, reserved: Math.max(0, account.reserved - record.times) };
}

/** 幂等：同一个 key 只允许生效一次。 */
export function appliesOnce(appliedKeys: Set<string>, record: ConsumptionRecord): boolean {
  if (appliedKeys.has(record.idempotencyKey)) return false;
  appliedKeys.add(record.idempotencyKey);
  return true;
}

export function buildIdempotencyKey(input: { ownerKey: string; jobId: string; attempt?: number }): string {
  const attempt = Math.max(1, Math.floor(input.attempt ?? 1));
  return `scan:${input.ownerKey}:${input.jobId}:${attempt}`;
}

export function buildOrderKey(input: { ownerKey: string; sku: string; minuteBucket: number }): string {
  return `order:${input.ownerKey}:${input.sku}:${input.minuteBucket}`;
}

export function isOrderExpired(order: PayOrder, now = Date.now()): boolean {
  if (!order.expiresAt) return false;
  return new Date(order.expiresAt).getTime() <= now;
}

/**
 * 退款规则：
 * - 失败 / 超时 / 服务端判不可重建 → 只退次数，不退钱（自动，立即到账）
 * - 整单一次未用且 7 天内 → 可申请原路退款（人工审核）
 * - 已使用过任意一次 → 不退钱
 */
export function refundableInCash(order: PayOrder, now = Date.now()): boolean {
  if (order.status !== 'paid') return false;
  if (order.timesUsed > 0) return false;
  if (!order.paidAt) return false;
  const paidAt = new Date(order.paidAt).getTime();
  return now - paidAt <= QUOTA_RULES.refundWindowDays * 86400000;
}

/** 失败后应返还的次数：按已扣次数原样返还。 */
export function refundTimes(consumed: number): number {
  return Math.max(0, Math.floor(consumed));
}

/** 展示用：15 → "15 次可用"。 */
export function describeRemaining(account: CreditAccount): string {
  return `${remainingOf(account)} 次可用`;
}
