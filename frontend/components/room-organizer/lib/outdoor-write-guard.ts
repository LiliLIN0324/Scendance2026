/**
 * 同一浏览器多窗口写入保护（2026-11-20 审计 B6）。
 *
 * 问题：户外规划存在 localStorage 的同一条记录里，`storage` 事件只能「提示对方改了」，
 * 拦不住两边同时写——上一秒读到 A、下一秒覆盖成 B，最后谁在盘上全看调度。
 * 提示不能当保护用。
 *
 * 做法：用 Web Locks 给**每个活动**一把独占写租约（名字按 projectId 隔离）：
 *  - 拿到租约的窗口 = 唯一写入者（本机落盘 + 云端推送）；
 *  - 另一个窗口拿不到 → `blocked`：不写本机、不推云端，只提示「另一个窗口正在编辑」；
 *  - 对方关掉窗口后，排队的那次请求会拿到租约，这里自动翻回 `granted` 并通知调用方补存。
 *
 * 边界（不当成已解决）：
 *  - 浏览器没有 Web Locks（极老的浏览器 / 非浏览器环境）→ `unavailable`：
 *    本机写入照旧，跨窗口只有「版本号 CAS」这一层保护（revision 取自本会话，见 outdoor-plan-session）。
 *    这不是完整的写入互斥，调用方应如实上报，而不是声称已保护。
 *  - 本保护只管**同一个源**的窗口；跨设备并发仍由服务端按 baseRevision 判定冲突。
 *  - 租约落定前（微任务级）先按可写处理：这期间不会有例行写入（防抖 400ms），
 *    但关页 flush 不能因为等租约而丢掉最后一次编辑；租约一旦判定被占用，立即停止写入。
 */

export const OUTDOOR_WRITE_LOCK_PREFIX = 'scendance:outdoor-plan:writer:v1:';

export function outdoorWriteLockName(projectId: string): string {
  return `${OUTDOOR_WRITE_LOCK_PREFIX}${projectId}`;
}

export type OutdoorWriteGuardMode = 'granted' | 'blocked' | 'unavailable';

export interface OutdoorWriteGuard {
  readonly projectId: string;
  /** 当前租约状态（blocked = 另一个窗口在写这份活动）。 */
  mode(): OutdoorWriteGuardMode;
  /**
   * 每次真实写入前同步调用。只有 confirmed 为 true 时才拦：
   * blocked → false；granted/unavailable/尚未落定 → true。
   */
  canWrite(): boolean;
  /** 云端推送闸门：被别的窗口占用时本窗口一律不推（否则就是一次未经授权的覆盖）。 */
  canPush(): boolean;
  /** blocked 时的人话原因；其余为 null。 */
  blockedDetail(): string | null;
  /** 状态变化（blocked → granted 时调用方要补存积压的编辑）。 */
  onModeChange(listener: (mode: OutdoorWriteGuardMode) => void): () => void;
  release(): Promise<void>;
}

export interface OutdoorWriteGuardOptions {
  projectId: string;
  /** `navigator.locks`；没有就传 null（SSR / 老浏览器 / 测试）。 */
  locks?: LockManager | null;
  /** 被占用后多久才对外报 blocked（默认 0ms；用于避开同一次提交内的释放-重取竞争）。 */
  blockGraceMs?: number;
}

export function createOutdoorWriteGuard(options: OutdoorWriteGuardOptions): OutdoorWriteGuard {
  const projectId = options.projectId;
  const locks = options.locks ?? null;
  const grace = Math.max(0, options.blockGraceMs ?? 0);
  const listeners = new Set<(mode: OutdoorWriteGuardMode) => void>();
  let released = false;
  let granted = false;
  let mode: OutdoorWriteGuardMode = locks?.request ? 'granted' : 'unavailable';
  let blockTimer: ReturnType<typeof setTimeout> | null = null;
  let settle: () => void = () => {};
  const hold = new Promise<void>(resolve => { settle = resolve; });
  const abort = new AbortController();

  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(mode); } catch { /* 订阅方的异常不该卡住宿约本身 */ }
    }
  };
  const setMode = (next: OutdoorWriteGuardMode) => {
    if (mode === next) return;
    mode = next;
    notify();
  };
  const markGranted = () => {
    granted = true;
    if (blockTimer !== null) { clearTimeout(blockTimer); blockTimer = null; }
    setMode('granted');
  };

  if (!locks?.request) {
    // 没有 Web Locks：如实标 unavailable，不假装有互斥。
    mode = 'unavailable';
  } else {
    const manager = locks;
    /** 排队等另一个窗口放手；拿到就翻回 granted，让调用方补存。 */
    const waitForTurn = (): void => {
      void manager.request(outdoorWriteLockName(projectId), { mode: 'exclusive', signal: abort.signal }, async lock => {
        if (!lock || released) return;
        markGranted();
        await hold;
      }).catch(() => { /* 被 release 主动取消 / 环境不支持：保持当前状态 */ });
    };
    void manager.request(outdoorWriteLockName(projectId), { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (released) return;
      if (!lock) {
        // 先不急着报 blocked：同一次提交里可能刚释放又重取（React StrictMode 双挂载），
        // 排队请求通常在同一个任务内就拿到，没必要闪一下「另一个窗口在编辑」。
        if (blockTimer !== null) clearTimeout(blockTimer);
        blockTimer = setTimeout(() => {
          blockTimer = null;
          if (!granted && !released) setMode('blocked');
        }, grace);
        waitForTurn();
        return;
      }
      markGranted();
      await hold;
    }).catch(() => {
      // 租约 API 在此环境不可用：退回「只有版本号 CAS」的诚实状态。
      if (!released) setMode('unavailable');
    });
  }

  const guard: OutdoorWriteGuard = {
    projectId,
    mode: () => mode,
    canWrite: () => mode !== 'blocked',
    canPush: () => mode !== 'blocked',
    blockedDetail: () => mode === 'blocked'
      ? '另一个窗口正在编辑这份活动；本窗口暂不保存，避免两边互相覆盖。请关掉那个窗口，或在这里继续等它关闭。'
      : null,
    onModeChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    release() {
      if (released) return Promise.resolve();
      released = true;
      if (blockTimer !== null) { clearTimeout(blockTimer); blockTimer = null; }
      listeners.clear();
      settle();
      abort.abort();
      return Promise.resolve().then(() => undefined);
    },
  };
  return guard;
}
