import { assertNoLocalRecordsCloudTransition } from '../components/room-organizer/lib/handoff-cloud-guard';
import { readOutdoorProjectRecord } from '../components/room-organizer/lib/outdoor-project-store';
import { projectLinkKind } from '../components/room-organizer/lib/project-identity';
import { isRoomLayout, parseLayoutEventOperations } from '../components/room-organizer/lib/schema';
import { readMaterialCheckins } from './material-checkin-storage';
import type { BackendSession } from './backend-session';
import type { RoomLayout } from '../components/room-organizer/lib/types';

/**
 * URL 里的 project id 哪些属于本机身份（不是待加载的云项目）。
 * `house-*` 与 `default-outdoor` 跟账户、评审链接用同一套 `projectLinkKind`。
 * `replica-*` 有本机记录时才是本机；缺记录按旧链接/云处理。账户侧则一律不把 replica 当云项目打开。
 */
function isLocalProjectParam(id: string): boolean {
  if (id.startsWith('replica-')) return !!readOutdoorProjectRecord(id);
  return projectLinkKind(id) === 'local-draft';
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
