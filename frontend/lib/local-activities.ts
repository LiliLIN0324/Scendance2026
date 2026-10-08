import { canonical } from '../../supabase/functions/_shared/domain';
import { mergeMaterialCheckinLedgers } from '../../supabase/functions/_shared/material-checkin-contract';
import { INITIAL_GROUND_FLOOR, INITIAL_LAYOUT } from '../components/room-organizer/lib/initial-layout';
import { MAX_NAME_LENGTH } from '../components/room-organizer/lib/schema';
import {
  createLocalProjectBackupV3, parseLocalProjectBackupJson,
  type LocalProjectBackupV3, type ValidatedLocalProjectRestoreCandidate,
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
function backupFromText(text: string, projectId: string): LocalProjectBackupV3 {
  activityKey(projectId);
  const candidate = parseLocalProjectBackupJson(text);
  if (candidate.source !== 'backup' || candidate.backupVersion !== 3 || candidate.brief.status === 'not-in-file' ||
      candidate.materialCheckins.status === 'not-in-file') {
    throw new Error('本机活动归档需要包含数量点验状态的 V3 备份。');
  }
  if (candidate.layout.id !== projectId) throw new Error('归档与活动编号不一致，未切换活动。');
  return createLocalProjectBackupV3(candidate.layout,
    { state: 'ready', scope: projectId, brief: candidate.brief },
    { state: 'ready', scope: projectId, materialCheckins: candidate.materialCheckins }, candidate.createdAt!);
}

function checkedArchive(value: unknown, projectId: string): LocalProjectBackupV3 {
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
  beforeWrite: () => void = () => {}): Promise<LocalProjectBackupV3> {
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
    return createLocalProjectBackupV3(proposal.layout,
      { state: 'ready', scope: expectedProjectId, brief: proposal.brief },
      { state: 'ready', scope: expectedProjectId, materialCheckins }, proposal.createdAt);
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

export async function listLocalActivities(): Promise<LocalActivityList> {
  const records = await listSourceRecords<unknown>(LOCAL_ACTIVITIES_NAMESPACE);
  const activities: LocalActivitySummary[] = [], unreadableProjectIds: string[] = [];
  for (const record of records) {
    try {
      const backup = checkedArchive(record.value, record.key[1]);
      activities.push({ projectId: record.key[1], name: backup.layout.name, archivedAt: backup.createdAt,
        itemCount: backup.layout.floors.reduce((count, floor) => count + floor.items.length, 0) });
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
    { state: 'ready', scope, materialCheckins: { status: 'absent' } }).layout;
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
