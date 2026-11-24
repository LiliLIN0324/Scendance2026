/**
 * 交接件人数读源（B3 读侧地基）——纯函数，不读存储、不碰 React。
 *
 * 背景：目前人数分散在两处——
 * - 旧本机 brief（`CreativeBrief.guests` + `guestsConfirmed`），文件/备份里存；
 * - 对话工作流 brief（`OutdoorBrief.guests`），落 `scendance:outdoor-flow:<scope>`。
 *
 * 导出/交接要只有一个答案，于是把优先级钉在这里：
 * 1. 本机 brief 明确标过「已确认」时，以用户的显式确认为准；
 * 2. 否则取对话里最近一次落库的人数（那是这单正在用的数）；
 * 3. 再否则退回本机 brief 的未确认数字；
 * 4. 全没有就是 unknown——**不猜、不拿别的活动的数顶上**。
 *
 * 为什么对话数排在未确认的本机数前面：本机 brief 的数字可能来自更早的草稿，
 * 而对话里的数是这单当场说的；但一旦用户勾了「已确认」，人的确认永远压过推断。
 */

/** 读源一侧：本机 brief 的人数与确认态。 */
export interface LegacyBriefHeadcount {
  readonly guests?: number | undefined;
  readonly confirmed?: boolean | undefined;
}

/** 读源另一侧：对话工作流 brief 的人数（未说话时是 undefined）。 */
export interface ConversationBriefHeadcount {
  readonly guests?: number | undefined;
}

export type BriefHeadcountSource = 'legacy-confirmed' | 'conversation' | 'legacy-unconfirmed' | 'unknown';

export interface ResolvedBriefHeadcount {
  readonly value: number | null;
  readonly source: BriefHeadcountSource;
}

/** 只接受正的有限数；0、负数、NaN、Infinity 一律当作「没说」。 */
function usableGuests(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/**
 * 按上面的优先级给出唯一人数。两个来源都可以缺。
 */
export function resolveBriefHeadcount(input: {
  legacy?: LegacyBriefHeadcount | null | undefined;
  conversation?: ConversationBriefHeadcount | null | undefined;
}): ResolvedBriefHeadcount {
  const legacy = usableGuests(input.legacy?.guests ?? undefined);
  if (legacy !== null && input.legacy?.confirmed === true) return { value: legacy, source: 'legacy-confirmed' };
  const conversation = usableGuests(input.conversation?.guests ?? undefined);
  if (conversation !== null) return { value: conversation, source: 'conversation' };
  if (legacy !== null) return { value: legacy, source: 'legacy-unconfirmed' };
  return { value: null, source: 'unknown' };
}

/**
 * 导出时该按哪个 scope 读对话 brief：只有真实的项目 id 才允许读。
 *
 * **这道门禁是必需的**：本机草稿一律落 `project:${DEFAULT_OUTDOOR_PROJECT_ID}`，
 * 所有草稿共用一个桶——若导出对没有项目 id 的草稿也读它，会把另一份草稿的人数
 * 当成本单的，等于虚报。无项目 id 时返回 null，调用方按 unknown 处理。
 */
export function flowBriefScopeForExport(projectId: string | null | undefined): string | null {
  const id = typeof projectId === 'string' ? projectId.trim() : '';
  return id ? `project:${id}` : null;
}

/** 只读存储接口：测试可注入内存实现，生产传 `window.localStorage`。 */
export interface BriefStorage {
  getItem(key: string): string | null;
}

/**
 * 从对话工作流落盘的桶里取人数。取不到（无项目 id / 无记录 / JSON 坏 / 数值不可用）
 * 一律返回 undefined，由 `resolveBriefHeadcount` 退回 unknown。
 *
 * 注意：这里只认 `project:<真实 id>`；本机草稿一律返回 undefined（见
 * `flowBriefScopeForExport` 的注释——所有草稿共用同一个桶）。
 */
export function readConversationGuests(
  projectId: string | null | undefined,
  storage: BriefStorage | null | undefined,
): number | undefined {
  const key = flowBriefScopeForExport(projectId);
  if (!key || !storage) return undefined;
  let record: unknown;
  try {
    const raw = storage.getItem(`scendance:outdoor-flow:${key}`);
    if (!raw) return undefined;
    record = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (record === null || typeof record !== 'object') return undefined;
  const brief = (record as { brief?: unknown }).brief;
  if (brief === null || typeof brief !== 'object') return undefined;
  return usableGuests((brief as { guests?: unknown }).guests as number | undefined) ?? undefined;
}

/** 本机备份里的 brief 快照（只需要人数与确认态两个字段）。 */
export interface SavedBriefLike {
  readonly status: string;
  readonly value?: { readonly guests?: number | undefined; readonly guestsConfirmed?: boolean | undefined } | undefined;
}

/**
 * 活动交接导出用的人数：把「本机备份里的 brief」与「对话桶」合成一个答案。
 * 接线点只需调它，优先级规则与防虚报闸门都在这一个地方。
 */
export function resolveActivityHeadcount(input: {
  brief: SavedBriefLike | null | undefined;
  projectId: string | null | undefined;
  storage?: BriefStorage | null | undefined;
}): ResolvedBriefHeadcount {
  const legacy = input.brief?.status === 'present' && input.brief.value
    ? { guests: input.brief.value.guests, confirmed: input.brief.value.guestsConfirmed === true }
    : null;
  const guests = readConversationGuests(input.projectId, input.storage);
  return resolveBriefHeadcount({
    legacy,
    conversation: guests === undefined ? null : { guests },
  });
}
