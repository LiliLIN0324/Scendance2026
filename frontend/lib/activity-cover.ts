import { listSourceRecords, updateSourceForm } from './source-storage';
import { captureStageCover } from './stage-cover';

/** Covers live beside the archives, never inside the backup JSON that users export. */
export const ACTIVITY_COVER_NAMESPACE = 'local-activity-cover';
const COVERS = ACTIVITY_COVER_NAMESPACE;
/** A 640×380 JPEG stays far below this; anything larger is not a cover. */
const MAX_COVER_LENGTH = 400_000;
export interface ActivityCover { dataUrl: string; capturedAt: string }

function coverKey(projectId: string): [string, string] { return [COVERS, projectId]; }

function validCover(value: unknown): ActivityCover | null {
  if (!value || typeof value !== 'object') return null;
  const { dataUrl, capturedAt } = value as Partial<ActivityCover>;
  return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') && dataUrl.length <= MAX_COVER_LENGTH &&
    typeof capturedAt === 'string' ? { dataUrl, capturedAt } : null;
}

/** Unreadable covers are skipped; the archive list still opens with its plan fallback. */
export async function readActivityCovers(): Promise<Map<string, string>> {
  const covers = new Map<string, string>();
  for (const record of await listSourceRecords<unknown>(COVERS)) {
    const cover = validCover(record.value);
    if (cover) covers.set(record.key[1], cover.dataUrl);
  }
  return covers;
}

/** A cover is decoration: a failed write must never touch the archive or the canvas. */
export async function saveActivityCover(projectId: string, dataUrl: string | null): Promise<boolean> {
  const cover = validCover({ dataUrl, capturedAt: new Date().toISOString() });
  if (!cover) return false;
  try { await updateSourceForm(coverKey(projectId), () => cover); return true; } catch { return false; }
}

/** Archives written before covers existed fill in the first time their canvas is listed. */
export async function ensureActivityCover(projectId: string): Promise<boolean> {
  try {
    if ((await readActivityCovers()).has(projectId)) return false;
    return await saveActivityCover(projectId, captureStageCover());
  } catch { return false; }
}

/** 2026-11-14 归档卡右键删除：封面一并清掉。封面是装饰，清理失败不拦归档删除主流程。 */
export async function deleteActivityCover(projectId: string): Promise<void> {
  try { await updateSourceForm(coverKey(projectId), () => undefined); } catch { /* 封面清理失败不影响归档删除。 */ }
}
