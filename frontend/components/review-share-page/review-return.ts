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

/** Q4 云化接口形状（仅声明，不实现）：现存储为单条记录，云化按 planKey 关联。 */
export interface ReviewReturnRepository {
  mark(planKey: string): Promise<{ ok: true }>;
  read(planKey: string): Promise<ReviewReturn | null>;
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

/**
 * 红环口径 R2：只在回执属于「当前方案」时亮。
 * currentPlanKey 缺省（旧调用方/测试）时兜底为任意回执即亮，保持向后兼容。
 * sample demo 回执与其他方案的回执因此不再点亮本方案的球。
 */
export function reviewOrbShouldTurnRed(record: ReviewReturn | null, currentPlanKey?: string): boolean {
  if (!record) return false;
  if (!currentPlanKey) return true;
  return record.planKey === currentPlanKey;
}

export function reviewOrbClass(returned: boolean): string {
  return returned ? ' is-review-returned' : '';
}
