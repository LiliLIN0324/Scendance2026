/**
 * 户外规划「一次编辑会话」的口径（2026-11-20 审计 B6 / F9）。
 *
 * 这里只做一件事：把「本会话确认的云端版本」和「盘上已经是什么」从共享 localStorage
 * 里摘出来，交给覆盖层当唯一依据。
 *
 * 为什么必须有这一层：
 *  - B6：旧实现每次 flush 都重读共享记录里的 `remoteRevision` 再当 `baseRevision` 推。
 *    同一个浏览器另开一个窗口编辑同一活动时，B 窗口的成功回执会写进同一条记录；
 *    A 窗口下一次 flush 就会拿 B 的版本号去推自己那份**没合过 B 改动**的方案——
 *    服务端若按 baseRevision 做 CAS，这次覆盖会通过，B 的改动被静默盖掉。
 *    正确口径：baseRevision 只能是**本会话**确认过的版本——打开时读一次，
 *    之后只随本会话的成功回执或用户明确「用服务器那版」更新；
 *    冲突到达的远端版本号只用于提示，不自动采纳。
 *  - F9：打开项目时内容与盘上一致就不该写盘、也不该推云端（否则每次打开 updatedAt/revision +1）。
 *    判断依据就是 `isPersisted(plan)`：盘上已是什么，本会话已经写下过什么。
 */

import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { OutdoorProjectRecord } from './outdoor-project-store';

/** 内容判等放在存储层（打开项目不写盘、回执不盖新版都要用），这里转出去方便调用方一处引入。 */
export { samePlanContent } from './outdoor-project-store';

export interface OutdoorPlanSession {
  /** 打开时以本机记录建立基线（活动 id / 版本号 / 创建时间 / 盘上那一版内容）。 */
  hydrate(record: OutdoorProjectRecord | null): void;
  /**
   * 打开时是否有「上次关页只落了本机、还没推上去」的改动。
   * 有就补推一次；没有就什么都不做（F9：干净打开不制造版本噪音）。
   */
  shouldCatchUpPush(): boolean;
  /** 记录里已有的活动名（调用方没给名字时兜底）。 */
  name(): string | null;
  /** 记录里的创建时间；没有记录时给当前时间。 */
  createdAt(): string;
  /** 本会话确认的云端版本；从没确认过为 undefined（推送时不带 baseRevision）。 */
  remoteRevision(): number | undefined;
  /** 本会话确认的后端活动 id。 */
  remoteActivityId(): string | undefined;
  /**
   * 组一份要落盘的记录：云端身份取自**本会话**，不读共享记录里的新值。
   * `unsyncedPlan` 表示这份内容还没被云端确认（关页 flush 时置 true，回执后才清）。
   */
  buildRecord(input: {
    projectId: string;
    plan: SitePlanData;
    name?: string | null | undefined;
    unsyncedPlan?: boolean | undefined;
    /** 只改名字时保留盘上的创建时间戳；缺省用会话基线。 */
    createdAt?: string | undefined;
  }): OutdoorProjectRecord;
  /** 本会话自己的成功回执：推进基线。 */
  confirmSaved(outcome: { remoteActivityId?: string | undefined; remoteRevision: number }): void;
  /** 用户明确选了「用服务器那版」：接受远端版本作为新基线。 */
  acceptRemote(input: { remoteActivityId?: string | undefined; remoteRevision: number }): void;
  /**
   * 撞上版本冲突：只记住远端版本用于提示，**不**推进本会话基线。
   * 基线只能由「本会话成功」或「用户明确接受远端」推进，冲突本身不是授权。
   */
  noteConflict(remoteRevision: number): void;
  /** 盘上/本会话刚写下的那一版是不是就是这份内容（F9 用）。 */
  isPersisted(plan: SitePlanData): boolean;
  /** 本会话刚把这份内容写进了本机记录。 */
  markPersisted(plan: SitePlanData): void;
}

export function createOutdoorPlanSession(now: () => number = Date.now): OutdoorPlanSession {
  let remoteRevision: number | undefined;
  let remoteActivityId: string | undefined;
  let createdAt: string | null = null;
  let name: string | null = null;
  let persistedJson: string | null = null;
  let catchUpPush = false;

  return {
    hydrate(record) {
      remoteRevision = typeof record?.remoteRevision === 'number' ? record.remoteRevision : undefined;
      remoteActivityId = record?.remoteActivityId?.trim() || undefined;
      createdAt = record?.createdAt ?? null;
      name = record?.name?.trim() || null;
      persistedJson = record?.plan ? JSON.stringify(record.plan) : null;
      catchUpPush = record?.unsyncedPlan === true;
    },
    shouldCatchUpPush() {
      return catchUpPush;
    },
    name() {
      return name;
    },
    createdAt() {
      return createdAt ?? new Date(now()).toISOString();
    },
    remoteRevision() {
      return remoteRevision;
    },
    remoteActivityId() {
      return remoteActivityId;
    },
    buildRecord({ projectId, plan, name: nextName, unsyncedPlan, createdAt: nextCreatedAt }) {
      const record: OutdoorProjectRecord = {
        v: 1,
        projectId,
        name: nextName?.trim() || name || '户外规划',
        createdAt: nextCreatedAt ?? createdAt ?? new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
        plan,
        ...(remoteActivityId ? { remoteActivityId } : {}),
        ...(typeof remoteRevision === 'number' ? { remoteRevision } : {}),
        ...(unsyncedPlan === undefined ? {} : { unsyncedPlan }),
      };
      return record;
    },
    confirmSaved(outcome) {
      if (outcome.remoteActivityId) remoteActivityId = outcome.remoteActivityId;
      remoteRevision = outcome.remoteRevision;
      catchUpPush = false;
    },
    acceptRemote(input) {
      if (input.remoteActivityId) remoteActivityId = input.remoteActivityId;
      remoteRevision = input.remoteRevision;
      catchUpPush = false;
    },
    noteConflict() {
      // 故意不写 remoteRevision：拿到远端版本号不等于本会话的改动已经并进去了。
      // 「用我这版」会带 force 覆盖并拿到新回执；「用服务器那版」走 acceptRemote。
    },
    isPersisted(plan) {
      return persistedJson !== null && JSON.stringify(plan) === persistedJson;
    },
    markPersisted(plan) {
      persistedJson = JSON.stringify(plan);
    },
  };
}
