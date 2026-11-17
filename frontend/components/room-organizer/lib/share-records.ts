/**
 * 分享记录：一条 = 一次「生成链接」（网页发布或只读 3D）。
 *
 * 服务端（GET /projects/:id/shares）只回 shareId / revision / createdAt / revokedAt，
 * 链接 token 只在生成那一次返回，所以 URL 只能记在本机：
 *  - 本机日志键 scendance.shareLog.v1.<projectId>，网页与 3D 漫游都追加；
 *  - 旧单条键 scendance.publishedLink.v1.<projectId> 在读取时迁移成一条记录，不删旧键（旧版本还能读）；
 *  - mergeShareRows 把服务端清单（版本/时间/撤回，权威）与本机 URL 合并成渲染行，
 *    服务端没接或拉取失败时退化为纯本机行。
 */

export interface ServerShare {
  shareId: string;
  publicationId: string;
  revision: number;
  /** ISO 时间串；解析失败按 0 处理，只影响排序显示。 */
  createdAt: string;
  revokedAt: string | null;
}

export interface ShareRecord {
  id: string;
  kind: 'web' | 'viewer';
  /** 生成时拿到的一次性链接；服务端不会再次返回。 */
  url: string;
  revision: number | null;
  /** 生成时间（epoch ms）；旧迁移记录未知时为 0。 */
  at: number;
}

export interface ShareRow {
  key: string;
  kind: 'web' | 'viewer';
  revision: number | null;
  at: number;
  url: string | null;
  shareId: string | null;
  revoked: boolean;
}

const LOG_KEY = 'scendance.shareLog.v1.';
const LEGACY_KEY = 'scendance.publishedLink.v1.';
const MAX_RECORDS = 50;

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* 退化到随机串 */ }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is ShareRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ShareRecord>;
  return (record.kind === 'web' || record.kind === 'viewer')
    && typeof record.url === 'string' && !!record.url
    && (record.revision === null || typeof record.revision === 'number')
    && typeof record.at === 'number';
}

function readLogRecords(projectId: string): ShareRecord[] {
  const raw = localStorage.getItem(LOG_KEY + projectId);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}

function readLegacyRecord(projectId: string): ShareRecord | null {
  const legacy = localStorage.getItem(LEGACY_KEY + projectId);
  if (!legacy) return null;
  const parsed = JSON.parse(legacy) as Partial<{ url: unknown; revision: unknown }>;
  if (typeof parsed.url !== 'string' || !parsed.url || typeof parsed.revision !== 'number') return null;
  return { id: `legacy-${projectId}`, kind: 'web', url: parsed.url, revision: parsed.revision, at: 0 };
}

/** 本机分享日志；旧单条发布键作为补充读出（日志里已有同一 revision 时不再重复）。 */
export function readShareRecords(projectId?: string): ShareRecord[] {
  if (!projectId) return [];
  try {
    const logged = readLogRecords(projectId);
    const legacy = readLegacyRecord(projectId);
    if (!legacy) return logged;
    const duplicate = logged.some(record => record.kind === 'web' && record.revision === legacy.revision);
    return duplicate ? logged : [...logged, legacy];
  } catch { return []; }
}

/** 追加一条记录并写回；只认新日志键，不迁移旧键（发布时两键都会写，迁移会造成同版重复）。超出上限丢最旧的。 */
export function appendShareRecord(projectId: string | undefined, record: Omit<ShareRecord, 'id'>): ShareRecord {
  const full: ShareRecord = { ...record, id: newId() };
  if (!projectId) return full;
  try {
    const next = [...readLogRecords(projectId), full].slice(-MAX_RECORDS);
    localStorage.setItem(LOG_KEY + projectId, JSON.stringify(next));
  } catch { /* 存不进就只保证这一次可用 */ }
  return full;
}

/**
 * 服务端清单（权威：版本/时间/撤回）× 本机日志（唯一有 URL 的地方）→ 渲染行。
 * 网页记录按 revision 与服务端对上（本机先到先认领），对不上的服务端行单独成行、无 URL；
 * 3D 漫游是本机哈希链接，不参与服务端匹配。按时间倒序，时间相同按版本倒序。
 */
export function mergeShareRows(local: ShareRecord[], server: ServerShare[] | null): ShareRow[] {
  const unclaimed = [...(server ?? [])];
  const takeShare = (record: ShareRecord): ServerShare | null => {
    const index = unclaimed.findIndex(share => share.revision === record.revision);
    return index >= 0 ? unclaimed.splice(index, 1)[0]! : null;
  };
  const rows: ShareRow[] = local.map(record => {
    if (record.kind !== 'web') {
      return { key: record.id, kind: record.kind, revision: record.revision, at: record.at, url: record.url, shareId: null, revoked: false };
    }
    const claimed = takeShare(record);
    return {
      key: claimed?.shareId ?? record.id,
      kind: 'web',
      revision: claimed?.revision ?? record.revision,
      at: record.at || (claimed ? Date.parse(claimed.createdAt) || 0 : 0),
      url: record.url,
      shareId: claimed?.shareId ?? null,
      revoked: claimed?.revokedAt != null,
    };
  });
  for (const share of unclaimed) {
    rows.push({ key: share.shareId, kind: 'web', revision: share.revision, at: Date.parse(share.createdAt) || 0, url: null, shareId: share.shareId, revoked: share.revokedAt != null });
  }
  return rows.sort((a, b) => (b.at - a.at) || ((b.revision ?? 0) - (a.revision ?? 0)));
}
