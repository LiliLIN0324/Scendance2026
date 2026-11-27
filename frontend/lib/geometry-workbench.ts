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

/**
 * 账户深链可以静默跳过的本机身份。
 * `house-*` / `default-outdoor` 从来不是云端项目；`replica-*` 是经典案例副本，
 * 即使本机记录还没落盘，它也不是可打开的云端 uuid。
 */
export function isEditorLocalProjectLink(id: string): boolean {
  return projectLinkKind(id) === 'local-draft';
}

/** 案例链接 / 本机活动指向本机规划，并非待加载的云项目。 */
export function hasRequestedCloudProject(): boolean {
  if (typeof window === 'undefined') return false;
  const id = new URL(window.location.href).searchParams.get('project');
  if (id === null) return false;
  return !isLocalProjectParam(id);
}

/** URL 里 `?project=` 的原始值；只取参数，不做身份判断。 */
function requestedProjectParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URL(window.location.href).searchParams.get('project');
}

/** A scene-service binding does not turn the local activity into a full cloud project. */
export function isLocalActivityWorkspace(controller: BackendSession,
  requestedCloud = hasRequestedCloudProject()): boolean {
  const current = controller.getSnapshot();
  if (!requestedCloud) return !current.project || !!current.geometryBinding && controller.isGeometryBound(current.geometryBinding.localActivityId);
  // 2026-11-24（B1/P3）：URL 点名了云号，不再凭格式早返回。正源顺序：
  // 挂着云项目 → 云通道；本机前缀（含已有记录的 replica）→ 本机；
  // 裸 uuid 只有本机存着这个 scope 的信封时才算本机草稿（历史裸槽）；
  // 没信封又没挂云项目 → 按云端 / 待加载处理，交给云守卫，不静默当本机。
  if (current.project) return false;
  const id = requestedProjectParam() ?? '';
  if (isLocalProjectParam(id)) return true;
  return !!readOutdoorProjectRecord(id);
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
