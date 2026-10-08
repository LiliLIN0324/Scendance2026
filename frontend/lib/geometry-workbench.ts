import { assertNoLocalRecordsCloudTransition } from '../components/room-organizer/lib/handoff-cloud-guard';
import { isRoomLayout, parseLayoutEventOperations } from '../components/room-organizer/lib/schema';
import { readMaterialCheckins } from './material-checkin-storage';
import type { BackendSession } from './backend-session';
import type { RoomLayout } from '../components/room-organizer/lib/types';

/** A scene-service binding does not turn the local activity into a full cloud project. */
export function isLocalActivityWorkspace(controller: BackendSession,
  requestedCloud = typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('project')): boolean {
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
