/**
 * 右上角发布改造 · A/B 共享前端类型与预检求值（2026-11-20，集成方所有）。
 *
 * 接口约定见 docs/plans/2026-11-20-publish-flow-interface-contract.md：
 * - 这里是纯前端层，只消费既有类型（BackendSnapshot / PublishGateSnapshot / RoomLayout），
 *   不新增 wire schema，不发请求，不改画布。
 * - A（share-menu 流程态）与 B（share-panel / view 客户页）只消费本文件的类型与
 *   evaluatePublishBlockers；需要变更时在报告提需求，由集成方合入。
 */

import type { BackendSnapshot } from '@/lib/backend-session';
import type { RoomLayout } from './types';
import { assetCloudStateOf, localAssetIdsInLayout } from './asset-cloud';
import type { PublishGateSnapshot } from './project-manifest';

/** 预检阻塞项代码（接口约定 §2，按序短路展示，但清单允许并列多条）。 */
export type PublishCheckCode =
  | 'not-configured'
  | 'login-required'
  | 'no-project'
  | 'read-only'
  | 'unsaved'
  | 'local-assets'
  | 'archive-gaps'
  | 'conflict';

/** 阻塞项对应的既有恢复动作语义；UI 侧把 action 映射到既有入口，不新造链路。 */
export type PublishBlockerAction =
  | 'login'
  | 'save-project'
  | 'save-changes'
  | 'grant-edit'
  | 'archive-page'
  | 'resolve-conflict';

export interface PublishBlocker {
  code: PublishCheckCode;
  /** 给用户看的完整原因（含缺口明细时如实列名）。 */
  message: string;
  action?: PublishBlockerAction;
}

export interface PublishPrecheckResult {
  phase: 'checking' | 'done';
  /** blockers 为空即 ready；唯一「可发布」布尔，B 的绿色主按钮只看它。 */
  ready: boolean;
  blockers: PublishBlocker[];
}

/** 发布任务态（主计划 §4 表）；publishing 需带阶段文案，S2/S3 分开说。 */
export type PublishTaskPhase =
  | 'idle'
  | 'checking'
  | 'blocked'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'new-changes'
  | 'confirm-result'
  | 'failed'
  | 'revoked';

/** 发布进行中的阶段（接口约定 §3.1）；附属产物 siteUrl 属 S3，失败不否定 S2。 */
export type PublishStage = 'gate' | 'create' | 'deliver';

export interface PublishStageNotice {
  stage: PublishStage;
  message: string;
}

/**
 * 预检求值：BackendSnapshot + PublishGateSnapshot → 阻塞清单。
 * 数据源固定这两个快照（接口约定 §2），不另开探测、不发请求。
 * 归档 gaps 的文案沿用发布闸门口径；其余文案与既有报错一致。
 */
export function evaluatePublishBlockers(input: {
  snapshot: BackendSnapshot;
  gate: PublishGateSnapshot;
  layout: RoomLayout;
}): PublishBlocker[] {
  const { snapshot, gate, layout } = input;
  const blockers: PublishBlocker[] = [];
  if (!snapshot.configured) {
    blockers.push({ code: 'not-configured', message: '发布服务还没连上，暂时不能发布。' });
  }
  if (!snapshot.user || snapshot.user.is_anonymous) {
    blockers.push({ code: 'login-required', message: '登录后再发布；登录回来会重新检查，不会自动发布。', action: 'login' });
  }
  if (!snapshot.project?.id) {
    blockers.push({ code: 'no-project', message: '这份方案还没挂到云项目上，先保存为云项目再发布。', action: 'save-project' });
  }
  if (snapshot.writeBlocked) {
    blockers.push({ code: 'read-only', message: '这个项目现在是只读，取回编辑权后再发布。', action: 'grant-edit' });
  }
  const unsaved = !Number.isFinite(snapshot.revision) || snapshot.dirty;
  if (unsaved) {
    blockers.push({ code: 'unsaved', message: '还有改动没保存，保存后再发布。', action: 'save-changes' });
  }
  if (unsaved) {
    const pendingLocal = [...localAssetIdsInLayout(layout)].filter(id => assetCloudStateOf(id).state !== 'uploaded');
    if (pendingLocal.length) {
      blockers.push({
        code: 'local-assets',
        message: '画布里的本机模型还没上云，保存成功后才能发布；本机副本还在，网络恢复后重试保存即可。',
        action: 'save-changes',
      });
    }
  }
  if (!gate.complete) {
    if (gate.gaps.length) {
      const names = gate.gaps.slice(0, 6).map(gap => gap.name).join('、');
      const more = gate.gaps.length > 6 ? ` 等 ${gate.gaps.length} 项` : '';
      blockers.push({
        code: 'archive-gaps',
        message: `还有 ${gate.gaps.length} 项依赖未归档：${names}${more}。请先在账户面板「归档」页补传，本机原件都在。`,
        action: 'archive-page',
      });
    } else {
      blockers.push({ code: 'archive-gaps', message: gate.note || '完整归档状态未接入，不能声称可发布。' });
    }
  }
  if (gate.conflict) {
    blockers.push({
      code: 'conflict',
      message: `存在版本冲突（服务器当前 v${gate.conflict.remoteRevision}），先在项目卡或户外提示里选择保留哪一版，再发布。`,
      action: 'resolve-conflict',
    });
  }
  return blockers;
}

/** 「当前修改未发布」判定（PUB-07/V10）：前端派生，服务端版本以 snapshot.revision 为准。 */
export function hasUnpublishedChanges(snapshot: BackendSnapshot): boolean {
  if (snapshot.dirty) return true;
  if (typeof snapshot.localRevision === 'number' && typeof snapshot.revision === 'number') {
    return snapshot.localRevision > snapshot.revision;
  }
  return false;
}
