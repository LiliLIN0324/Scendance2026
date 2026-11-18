import { canonical } from '../../supabase/functions/_shared/domain';
import { mergeMaterialCheckinLedgers } from '../../supabase/functions/_shared/material-checkin-contract';
import { INITIAL_GROUND_FLOOR, INITIAL_LAYOUT } from '../components/room-organizer/lib/initial-layout';
import { MAX_NAME_LENGTH } from '../components/room-organizer/lib/schema';
import { deleteActivityCover, readActivityCovers } from './activity-cover';
import {
  createLocalProjectBackupV3, createLocalProjectBackupV5WithDocuments, createLocalProjectBackupV6,
  parseLocalProjectBackupJson,
  type LocalProjectBackupV3, type LocalProjectBackupV5, type LocalProjectBackupV6,
  type ValidatedLocalProjectRestoreCandidate,
} from './local-project-backup';
import { listSourceRecords, readSourceRecord, updateSourceForm } from './source-storage';
import type { RoomLayout } from '../components/room-organizer/lib/types';

export const LOCAL_ACTIVITIES_NAMESPACE = 'local-activity';
export type NewLocalActivityMode = 'empty' | 'reuse-layout';
export interface LocalActivitySummary {
  projectId: string;
  name: string;
  archivedAt: string;
  itemCount: number;
  /** Geometry-only copy for the list thumbnail; attachments and embedded copies are dropped. */
  preview?: RoomLayout;
  /** 3D still captured when the activity was archived; older archives fall back to `preview`. */
  cover?: string;
}
export interface LocalActivityList {
  activities: LocalActivitySummary[];
  unreadableProjectIds: string[];
}

function activityKey(projectId: string): [string, string] {
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 128) {
    throw new Error('当前活动缺少有效编号，请先完成本地保存。');
  }
  return [LOCAL_ACTIVITIES_NAMESPACE, projectId];
}

/** Archives are the existing complete V3 envelope, not another storage format. */
/** Archives are V3, V5 when the activity has image documents, or V6 when it carries a local event profile. */
type LocalActivityArchive = LocalProjectBackupV3 | LocalProjectBackupV5 | LocalProjectBackupV6;

/** V5 full backups are accepted only when their image documents are actually present. */
function backupFromText(text: string, projectId: string): LocalActivityArchive {
  activityKey(projectId);
  const candidate = parseLocalProjectBackupJson(text);
  if (candidate.source !== 'backup' ||
      (candidate.backupVersion !== 3 && candidate.backupVersion !== 5 && candidate.backupVersion !== 6) ||
      candidate.brief.status === 'not-in-file' || candidate.materialCheckins.status === 'not-in-file') {
    throw new Error('本机活动归档需要 V3/V5/V6 备份（含数量点验状态）。');
  }
  if (candidate.layout.id !== projectId) throw new Error('归档与活动编号不一致，未切换活动。');
  const briefSnapshot = { state: 'ready' as const, scope: projectId, brief: candidate.brief };
  const checkinSnapshot = { state: 'ready' as const, scope: projectId, materialCheckins: candidate.materialCheckins };
  if (candidate.backupVersion === 5 && candidate.sourceDocuments.status === 'present') {
    return createLocalProjectBackupV5WithDocuments(candidate.layout, briefSnapshot, checkinSnapshot,
      candidate.sourceDocuments, candidate.createdAt!);
  }
  if (candidate.backupVersion === 6 || candidate.layout.eventProfile !== undefined) {
    return createLocalProjectBackupV6(candidate.layout, briefSnapshot, checkinSnapshot, candidate.createdAt!);
  }
  return createLocalProjectBackupV3(candidate.layout, briefSnapshot, checkinSnapshot, candidate.createdAt!);
}

function checkedArchive(value: unknown, projectId: string): LocalActivityArchive {
  if (value === undefined) throw new Error('这份本机活动归档已不存在，当前活动未改变。');
  let text: string;
  try {
    text = JSON.stringify(value, (_key, child: unknown) => {
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol' ||
          typeof child === 'bigint' || (typeof child === 'number' && !Number.isFinite(child))) {
        throw new Error('归档含无法完整保存的字段。');
      }
      return child;
    });
    if (canonical(value) !== canonical(JSON.parse(text))) throw new Error('归档字段不能完整回读。');
  } catch {
    throw new Error('本机活动归档无法完整读取，原记录已保留。');
  }
  return backupFromText(text, projectId);
}

/** Switching is allowed only after native commit and independent readback both succeed. */
export async function archiveLocalActivity(text: string, expectedProjectId: string,
  beforeWrite: () => void = () => {}): Promise<LocalActivityArchive> {
  const proposal = backupFromText(text, expectedProjectId), key = activityKey(expectedProjectId);
  const written = await updateSourceForm(key, value => {
    beforeWrite();
    const current = value === undefined ? undefined : checkedArchive(value, expectedProjectId);
    let materialCheckins = proposal.materialCheckins;
    // An older/absent snapshot can never erase archived facts. Provider also merges the live ledger on reopen.
    if (current?.materialCheckins.status === 'present') {
      materialCheckins = { status: 'present', value: materialCheckins.status === 'present'
        ? mergeMaterialCheckinLedgers(current.materialCheckins.value, materialCheckins.value)
        : current.materialCheckins.value };
    }
    // 旧快照同样不能抹掉已归档的活动档案与图片；新值（若有）以本次为准。
    const profile = proposal.layout.eventProfile ?? current?.layout.eventProfile;
    const layout: RoomLayout = profile === undefined ? proposal.layout : { ...proposal.layout, eventProfile: profile };
    const proposedDocuments = 'sourceDocuments' in proposal ? proposal.sourceDocuments : undefined;
    const currentDocuments = current && 'sourceDocuments' in current ? current.sourceDocuments : undefined;
    const sourceDocuments = proposedDocuments ?? currentDocuments;
    const briefSnapshot = { state: 'ready' as const, scope: expectedProjectId, brief: proposal.brief };
    const checkinSnapshot = { state: 'ready' as const, scope: expectedProjectId, materialCheckins };
    if (sourceDocuments) {
      return createLocalProjectBackupV5WithDocuments(layout, briefSnapshot, checkinSnapshot, sourceDocuments, proposal.createdAt);
    }
    return profile === undefined
      ? createLocalProjectBackupV3(layout, briefSnapshot, checkinSnapshot, proposal.createdAt)
      : createLocalProjectBackupV6(layout, briefSnapshot, checkinSnapshot, proposal.createdAt);
  });
  const readback = checkedArchive(await readSourceRecord<unknown>(key), expectedProjectId);
  if (canonical(written) !== canonical(readback)) {
    throw new Error('活动归档回读与本次保存不一致，请重新核对后再切换。');
  }
  return readback;
}

export async function readLocalActivity(projectId: string): Promise<ValidatedLocalProjectRestoreCandidate> {
  const backup = checkedArchive(await readSourceRecord<unknown>(activityKey(projectId)), projectId);
  return parseLocalProjectBackupJson(JSON.stringify(backup));
}

/** 2026-11-14 归档卡右键删除：归档记录与封面一并清除；确认弹窗由 UI 层负责。 */
export async function deleteLocalActivity(projectId: string): Promise<void> {
  await updateSourceForm(activityKey(projectId), () => undefined);
  await deleteActivityCover(projectId);
}

/** Thumbnails draw floors only; keeping attachments or embedded scene copies would pin them in list state. */
function previewLayout(layout: RoomLayout): RoomLayout {
  const preview: RoomLayout = { ...layout };
  delete preview.floorPlanImage;
  delete preview.designBook;
  delete preview.backendSceneV2;
  delete preview.backendVenue;
  delete preview.backendCamera;
  delete preview.backendLighting;
  delete preview.itemLayers;
  delete preview.productionPlan;
  delete preview.eventOperations;
  // 列表缩略图只画楼层：日期/预算/分工等档案不进列表状态。
  delete preview.eventProfile;
  return preview;
}

export async function listLocalActivities(): Promise<LocalActivityList> {
  const records = await listSourceRecords<unknown>(LOCAL_ACTIVITIES_NAMESPACE);
  const covers = await readActivityCovers().catch(() => new Map<string, string>());
  const activities: LocalActivitySummary[] = [], unreadableProjectIds: string[] = [];
  for (const record of records) {
    try {
      const backup = checkedArchive(record.value, record.key[1]);
      const cover = covers.get(record.key[1]);
      activities.push({ projectId: record.key[1], name: backup.layout.name, archivedAt: backup.createdAt,
        itemCount: backup.layout.floors.reduce((count, floor) => count + floor.items.length, 0),
        preview: previewLayout(backup.layout), ...(cover ? { cover } : {}) });
    } catch { unreadableProjectIds.push(record.key[1]); }
  }
  activities.sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt) || a.projectId.localeCompare(b.projectId));
  return { activities, unreadableProjectIds };
}

/** Reuse placement without carrying the previous activity's business/private/reference records. */
function placementForNewActivity(source: RoomLayout): RoomLayout {
  const scope = source.id;
  if (!scope) throw new Error('当前布置缺少活动编号，不能沿用。');
  const copy = createLocalProjectBackupV3(source,
    { state: 'ready', scope, brief: { status: 'absent' } },
    { state: 'ready', scope, materialCheckins: { status: 'absent' } },
    undefined, { allowEventProfile: true }).layout;
  // 新活动不继承上一场的日期、预算与分工。
  delete copy.eventProfile;
  delete copy.productionPlan;
  delete copy.eventOperations;
  delete copy.designBook;
  delete copy.itemLayers;
  delete copy.floorPlanImage;
  for (const floor of copy.floors) for (const item of floor.items) {
    delete item.handoff;
    delete item.notes;
  }
  if (copy.backendVenue) delete copy.backendVenue.floorplanAssetId;
  if (copy.backendSceneV2) {
    delete copy.backendSceneV2.venue.floorplanAssetId;
    delete copy.backendSceneV2.design;
    copy.backendSceneV2.sources = [];
    // Image calibration coordinates have no meaning without their source attachment.
    copy.backendSceneV2.dimensions = copy.backendSceneV2.dimensions.filter(dimension => !dimension.sourceAssetId);
    for (const wall of copy.backendSceneV2.structure.walls) delete wall.evidence;
    for (const item of copy.backendSceneV2.objects) item.notes = '';
  }
  return copy;
}

/** Pure creation; provider restore performs the actual layout/brief/ledger transaction. */
export function createLocalActivityBackup(source: RoomLayout, name: string, mode: NewLocalActivityMode): LocalProjectBackupV3 {
  const title = name.trim();
  if (!title || title.length > MAX_NAME_LENGTH) throw new Error(`请填写活动名称，最多 ${MAX_NAME_LENGTH} 个字。`);
  if (mode !== 'empty' && mode !== 'reuse-layout') throw new Error('请选择空场地或沿用当前布置。');
  const id = `house-${crypto.randomUUID()}`;
  if (id === source.id) throw new Error('新活动编号未能独立生成，请重试。');
  const layout: RoomLayout = mode === 'reuse-layout' ? placementForNewActivity(source)
    : { ...structuredClone(INITIAL_LAYOUT), floors: [{ ...structuredClone(INITIAL_GROUND_FLOOR), items: [] }] };
  layout.id = id;
  layout.name = title;
  return createLocalProjectBackupV3(layout,
    { state: 'ready', scope: id, brief: { status: 'absent' } },
    { state: 'ready', scope: id, materialCheckins: { status: 'absent' } });
}
