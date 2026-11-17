/**
 * 户外引导卡历史的后端同步（2026-11-17 用户要求「跟着活动一起存到后端，换设备或清缓存不丢」）。
 *
 * 口径：
 *  - **本机是快照，后端是副本**：读写都先走本机，服务不可用就安静退回本机（不报错、不阻塞编辑）；
 *  - **合并按 `at` 去重**：两台设备各记一条时取并集，同一时刻的同一决策只留一条；
 *  - **只存决策流水**：卡片标题、说明、当时的按钮、结论、时间；不存规划本体。
 *
 * 纯函数 + 注入口：这里不直接 import 会话实现，测试可以塞假会话。
 */

export type CardHistoryDecision = "confirmed" | "withdrawn" | "replaced";

export interface CardHistoryEntry {
  at: number;
  stage: string;
  kind: string;
  title: string;
  decision: CardHistoryDecision;
  notes: string[];
  actions: string[];
}

export interface CardHistorySession {
  getOutdoorCardHistory?(projectId: string): Promise<unknown[]>;
  saveOutdoorCardHistory?(projectId: string, entries: unknown[]): Promise<unknown[]>;
}

export const CARD_HISTORY_LIMIT = 30;
/** 服务端最多收 200 条（迁移里的约束），本机口径 30 条，留足余量。 */
export const CARD_HISTORY_SERVER_LIMIT = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** 把服务端/本地来的任意 JSON 收成合法记录；坏条目直接丢，不因一条脏数据整份作废。 */
export function sanitizeCardHistory(raw: unknown): CardHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter(
      (entry) =>
        typeof entry.at === "number" &&
        Number.isFinite(entry.at) &&
        typeof entry.title === "string",
    )
    .map((entry) => ({
      at: entry.at as number,
      stage: typeof entry.stage === "string" ? entry.stage : "place",
      kind: typeof entry.kind === "string" ? entry.kind : "scope",
      title: entry.title as string,
      decision:
        entry.decision === "withdrawn" || entry.decision === "replaced"
          ? entry.decision
          : ("confirmed" as CardHistoryDecision),
      notes: strings(entry.notes),
      actions: strings(entry.actions),
    }));
}

/** 并集：按 `at + title + decision` 去重，按时间升序，截到本机上限。 */
export function mergeCardHistory(
  local: readonly CardHistoryEntry[],
  remote: readonly CardHistoryEntry[],
  limit = CARD_HISTORY_LIMIT,
): CardHistoryEntry[] {
  const seen = new Set<string>();
  const merged: CardHistoryEntry[] = [];
  for (const entry of [...local, ...remote]) {
    const key = `${entry.at}|${entry.title}|${entry.decision}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  merged.sort((a, b) => a.at - b.at);
  return merged.slice(-limit);
}

/**
 * 读回后端记录。未登录、方法不存在、网络失败一律返回 `[]`——
 * 调用方沿用本机记录，不把同步失败抬到界面上。
 */
export async function loadRemoteCardHistory(
  session: CardHistorySession | null | undefined,
  projectId: string,
): Promise<CardHistoryEntry[]> {
  if (!session?.getOutdoorCardHistory || !projectId) return [];
  try {
    return sanitizeCardHistory(await session.getOutdoorCardHistory(projectId));
  } catch {
    return [];
  }
}

/** 推到后端；同样不抛错，返回是否成功（只用于诊断，界面不依赖）。 */
export async function pushRemoteCardHistory(
  session: CardHistorySession | null | undefined,
  projectId: string,
  entries: readonly CardHistoryEntry[],
): Promise<boolean> {
  if (!session?.saveOutdoorCardHistory || !projectId) return false;
  try {
    await session.saveOutdoorCardHistory(
      projectId,
      entries.slice(-CARD_HISTORY_SERVER_LIMIT),
    );
    return true;
  } catch {
    return false;
  }
}
