/**
 * 评审完成回执。
 *
 * 评审方在方案页点「完成评审」后，写进本机 localStorage。
 * 创作者工作台收起态的活物球（`AgentReopenCard`，产品旧称 Bingo 球）
 * 读到回执就加 `is-review-returned`，球带红环。
 *
 * 本刀是同一浏览器的演示钩子：不写 Supabase，球也不按 planKey 过滤。
 * 后刀再接真状态：用 planKey 对齐当前布置，并跨设备同步。
 */

export const REVIEW_RETURN_STORAGE_KEY = 'scendance-review-share-return-v1';

export interface ReviewReturn {
  planKey: string;
  at: string;
}

export function markReviewReturned(
  storage: Pick<Storage, 'setItem'>,
  input: { planKey: string; now?: Date },
): { ok: true; record: ReviewReturn } | { ok: false; reason: 'plan' | 'storage' } {
  if (!input.planKey || input.planKey.length > 80) return { ok: false, reason: 'plan' };
  const record: ReviewReturn = {
    planKey: input.planKey,
    at: (input.now ?? new Date()).toISOString(),
  };
  try {
    storage.setItem(REVIEW_RETURN_STORAGE_KEY, JSON.stringify({ version: 1, ...record }));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  return { ok: true, record };
}

export function readReviewReturn(storage: Pick<Storage, 'getItem'> | null): ReviewReturn | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(REVIEW_RETURN_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const row = parsed as Record<string, unknown>;
    if (row.version !== 1) return null;
    if (typeof row.planKey !== 'string' || row.planKey.length === 0 || row.planKey.length > 80) return null;
    if (typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) return null;
    return { planKey: row.planKey, at: row.at };
  } catch {
    return null;
  }
}

/** 后刀在这里按当前方案的 planKey 收窄。本刀只要有回执，创作者侧的球就变红。 */
export function reviewOrbShouldTurnRed(record: ReviewReturn | null): boolean {
  return record !== null;
}

export function reviewOrbClass(returned: boolean): string {
  return returned ? ' is-review-returned' : '';
}
