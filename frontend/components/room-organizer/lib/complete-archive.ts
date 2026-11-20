/**
 * 完整只读分享 / 案例发布前的「已发布可见归档」保障（2026-11-20 集成补齐，C12/C13）。
 *
 * A 契约语义（supabase/review/202611200001_cloud_storage.sql）：
 * - `cloud.share.create` 与 `cloud.case.publish` 的发布快照只取 manifest.dependencies 里
 *   visibility='published' 的依赖，并要求场景引用全部被这些依赖覆盖（cloud_check_scene_covered）；
 * - 而 cloud-panel 的静默完整归档按私有口径保存（依赖全 private）。
 * 两者共享同一个 complete_projects 行（案例草稿在 upsert 时由服务端整份复制），
 * 所以在「生成完整分享链接」或「保存官方案例草稿」之前，需要持当前租约把清单按
 * published 可见性重新保存一次（saveCompleteProject 幂等 + expectedRevision CAS，
 * 不改变 projects.revision）。失败如实返回原因，不伪造成功。
 */

import type { BackendSession } from '@/lib/backend-session';
import type { CompleteSaveInput } from '../../../../supabase/functions/_shared/cloud-storage-contract';
import { publishGateSnapshot, type CompleteProjectManifest, type PublishGateSnapshot } from './project-manifest';

type WireManifest = CompleteSaveInput['manifest'];

export interface PublishedArchiveOutcome {
  ok: boolean;
  /**
   * 本次 published 落库绑定的云项目 id（PUB-06，P0-A）：调用方必须用这一条创建
   * 分享/发布请求，不得在等待后重读快照另取项目；ok 时必有。
   */
  projectId?: string;
  /** 落库绑定的项目 revision（= 开始时捕获的快照版本；CAS 与后续分享请求共用它）。 */
  revision?: number;
  error?: string;
}

/**
 * 纯函数：把依赖可见性整体翻成 published（发布快照只认 published 依赖），
 * 产出 A 契约的 wire 形状。scene 由调用方收窄后显式传入（wire 不收 null）。
 */
export function toPublishedManifest(manifest: CompleteProjectManifest, scene: NonNullable<CompleteProjectManifest['scene']>): WireManifest {
  return {
    version: 1,
    scene,
    outdoor: manifest.outdoor ?? null,
    sources: manifest.sources,
    dependencies: manifest.dependencies.map(dep => ({ ...dep, visibility: 'published' as const })),
  };
}

/**
 * 持当前租约把「发布可见」的完整清单写进云端（saveCompleteProject）。
 * 缺归档依赖 / 无租约 / 未保存 / 场景转码失败都不发请求，如实返回原因。
 *
 * P0-A（主计划 §4 实现约束 1/2）：开始时一次性捕获（项目, 会话, 账号, 版本），
 * 归档清单只对这份快照负责；saveCompleteProject 返回后重新核对项目/会话/账号/版本，
 * 归档期间切项目、换账号或又保存了新版本时结果不再使用（fail-closed）。
 */
export async function ensurePublishedArchive(controller: BackendSession, gate: PublishGateSnapshot): Promise<PublishedArchiveOutcome> {
  let snapshot: ReturnType<BackendSession['getSnapshot']>;
  try { snapshot = controller.getSnapshot(); }
  catch { return { ok: false, error: '会话状态不可用，完整归档没有保存。' }; }
  const projectId = snapshot.project?.id ?? null;
  if (!projectId) return { ok: false, error: '这份方案还没挂到云项目上；先保存到云端项目，再生成完整分享。' };
  // PUB-06：清单与项目必须同源。闸门快照对应别的云项目时按失败处理，不把 A 项目的清单落到 B 项目。
  if ((gate.projectId ?? null) !== projectId) return { ok: false, error: '依赖清单对应的不是当前云项目，请重新打开发布页后再试。' };
  if (snapshot.dirty) return { ok: false, error: '还有改动没保存；保存后再生成完整分享。' };
  if (!gate.manifest || !gate.complete) {
    const gaps = gate.gaps.length
      ? `还有 ${gate.gaps.length} 项依赖未归档（${gate.gaps.slice(0, 4).map(gap => gap.name).join('、')}${gate.gaps.length > 4 ? ' 等' : ''}），请先在账户面板「归档」页补传。`
      : (gate.note || '完整归档状态未就绪。');
    return { ok: false, error: gaps };
  }
  const manifest = gate.manifest;
  if (!manifest.scene) return { ok: false, error: '场景转码失败；完整归档没有生成，本机内容未改动。' };
  const lease = snapshot.lease;
  if (!lease || lease.projectId !== projectId) return { ok: false, error: '没有当前项目的编辑租约；先取得编辑权，再生成完整分享。' };
  if (!Number.isFinite(snapshot.revision)) return { ok: false, error: '还有改动没保存；保存成功后再生成完整分享。' };
  const expectedRevision = snapshot.revision ?? 0;
  // 闸门若带清单构建版本（2026-11-20 P0-A 接口要求，room-organizer 提供），与本次落库版本不一致时 fail-closed。
  if (gate.capturedRevision != null && gate.capturedRevision !== expectedRevision) {
    return { ok: false, error: `依赖清单对应 v${gate.capturedRevision}，当前保存版本是 v${expectedRevision}；请重试，让清单与版本对齐。` };
  }
  try {
    await controller.saveCompleteProject(projectId, {
      requestId: crypto.randomUUID(),
      sessionId: lease.sessionId,
      generation: lease.generation,
      expectedRevision,
      manifest: toPublishedManifest(manifest, manifest.scene),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '完整归档没有保存到云端，请稍后重试。' };
  }
  // 等待点后核对：归档期间切项目/换会话/换账号，published 清单不再使用。
  let after: ReturnType<BackendSession['getSnapshot']> | null = null;
  try { after = controller.getSnapshot(); } catch { after = null; }
  if (!after || after.project?.id !== projectId || after.sessionId !== snapshot.sessionId
    || (after.user?.id ?? null) !== (snapshot.user?.id ?? null)) {
    return { ok: false, error: '项目或会话在归档期间已变化，published 清单不再使用；请在当前项目重新操作。' };
  }
  if (!Number.isFinite(after.revision) || after.revision !== expectedRevision) {
    // 归档期间又保存了新版本：这次清单对应的已不是当前版本，如实失败而不是发布旧清单。
    return { ok: false, error: `归档期间方案又保存了新版本（v${String(after.revision)}）；这次清单对应 v${expectedRevision}，请重新生成完整分享。` };
  }
  return { ok: true, projectId, revision: expectedRevision };
}

/** 便捷封装：现读发布闸门快照再落库（分享卡/案例页签同一条口径）。 */
export async function ensurePublishedArchiveNow(controller: BackendSession): Promise<PublishedArchiveOutcome> {
  return ensurePublishedArchive(controller, await publishGateSnapshot());
}
