import { assertNoLocalRecordsCloudTransition } from '../components/room-organizer/lib/handoff-cloud-guard';
import { isRoomLayout, parseLayoutEventOperations } from '../components/room-organizer/lib/schema';
import { readMaterialCheckins } from './material-checkin-storage';
import type { BackendSession } from './backend-session';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { readOutdoorProjectRecord, LOCAL_ACTIVITY_ID_PREFIX, DEFAULT_OUTDOOR_PROJECT_ID } from '../components/room-organizer/lib/outdoor-project-store';

/**
 * URL 里的 project id 哪些属于本机身份（不是待加载的云项目）。
 * - `house-*`：本机新建活动，发号前缀固定；
 * - `default-outdoor`：纯本机默认草稿；
 * - `replica-*`：经典案例副本，有本机记录时才是本机，缺记录按旧链接/云处理。
 */
function isLocalProjectParam(id: string): boolean {
  if (id.startsWith(LOCAL_ACTIVITY_ID_PREFIX) || id === DEFAULT_OUTDOOR_PROJECT_ID) return true;
  return id.startsWith('replica-') && !!readOutdoorProjectRecord(id);
}

/**
 * 账户深链可以静默跳过的本机身份。
 * `house-*` / `default-outdoor` 从来不是云端项目；`replica-*` 是经典案例副本，
 * 即使本机记录还没落盘，它也不是可打开的云端 uuid。
 */
export function isEditorLocalProjectLink(id: string): boolean {
  return id.startsWith(LOCAL_ACTIVITY_ID_PREFIX) || id === DEFAULT_OUTDOOR_PROJECT_ID || id.startsWith('replica-');
}

/** 案例链接 / 本机活动指向本机规划，并非待加载的云项目。 */
export function hasRequestedCloudProject(): boolean {
  if (typeof window === 'undefined') return false;
  const id = new URL(window.location.href).searchParams.get('project');
  if (id === null) return false;
  return !isLocalProjectParam(id);
}

/** A scene-service binding does not turn the local activity into a full cloud project. */
export function isLocalActivityWorkspace(controller: BackendSession,
  requestedCloud = hasRequestedCloudProject()): boolean {
  if (requestedCloud) return false;
  const current = controller.getSnapshot();
  return !current.project || !!current.geometryBinding && controller.isGeometryBound(current.geometryBinding.localActivityId);
}

/** Wire requests use the remote ID; local records always keep the layout's original ID. */
export function geometryProjectId(controller: BackendSession, localId: string | undefined): string | null {
  const current = controller.getSnapshot();
  if (!localId || !current.project) return null;
  if (controller.isGeometryBound(localId)) return current.project.id;
  return !current.geometryBinding && current.project.id === localId ? current.project.id : null;
}

/** Read local facts before scene-only work, without returning or sending them as model context. */
export async function assertGeometryActionSource(layout: RoomLayout, controller: BackendSession): Promise<void> {
  if (!isLocalActivityWorkspace(controller) || !layout.id) {
    await assertNoLocalRecordsCloudTransition(layout);
    return;
  }
  if (!layout.id.trim() || !isRoomLayout(layout) || !parseLayoutEventOperations(layout)) {
    throw new Error('当前活动资料无法完整核对，请先检查本机备份。场景尚未发送，原资料已保留。');
  }
  await readMaterialCheckins(layout.id);
}
