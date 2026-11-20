import { describe, expect, it, vi } from 'vitest';
import {
  createOutdoorWriteGuard,
  outdoorWriteLockName,
  OUTDOOR_WRITE_LOCK_PREFIX,
} from './outdoor-write-guard';

type Grant = (lock: { name: string; mode: 'exclusive' } | null) => unknown;

/**
 * 最小 LockManager：同一个名字同时只能有一个持有者；`ifAvailable` 拿不到就回 null，
 * 否则排队等释放。够验「两个窗口同一活动只有一个是写入者」这条语义。
 */
function fakeLocks() {
  const holders = new Set<string>();
  const queue = new Map<string, (() => void)[]>();
  const request = (name: string, options: LockOptions | undefined, callback: Grant): Promise<unknown> => {
    const start = async (): Promise<unknown> => {
      holders.add(name);
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        holders.delete(name);
        const next = queue.get(name)?.shift();
        if (next) next();
      }
    };
    if (!holders.has(name)) return start();
    if (options?.ifAvailable) return Promise.resolve(callback(null));
    return new Promise((resolve, reject) => {
      const waiting = () => { void start().then(resolve, reject); };
      const list = queue.get(name) ?? [];
      list.push(waiting);
      queue.set(name, list);
    });
  };
  return { request: vi.fn(request), holders };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('户外写租约（B6：同源多窗口写入保护）', () => {
  it('租约名按活动隔离，前缀稳定', () => {
    expect(outdoorWriteLockName('activity-1')).toBe(`${OUTDOOR_WRITE_LOCK_PREFIX}activity-1`);
    expect(outdoorWriteLockName('activity-1')).not.toBe(outdoorWriteLockName('activity-2'));
  });

  it('第一个窗口拿到租约，第二个窗口被挡住且明确不可写', async () => {
    const locks = fakeLocks() as unknown as LockManager;
    const first = createOutdoorWriteGuard({ projectId: 'activity-1', locks });
    const second = createOutdoorWriteGuard({ projectId: 'activity-1', locks });
    await tick();

    expect(first.mode()).toBe('granted');
    expect(first.canWrite()).toBe(true);
    expect(first.canPush()).toBe(true);

    expect(second.mode()).toBe('blocked');
    expect(second.canWrite()).toBe(false);
    expect(second.canPush()).toBe(false);
    expect(second.blockedDetail()).toContain('另一个窗口');

    await first.release();
    await second.release();
  });

  it('不同活动各有各的租约，互不挡', async () => {
    const locks = fakeLocks() as unknown as LockManager;
    const a = createOutdoorWriteGuard({ projectId: 'activity-a', locks });
    const b = createOutdoorWriteGuard({ projectId: 'activity-b', locks });
    await tick();
    expect(a.mode()).toBe('granted');
    expect(b.mode()).toBe('granted');
    await Promise.all([a.release(), b.release()]);
  });

  it('占用方释放后，排队的那一个自动转 granted 并通知（补存积压编辑）', async () => {
    const locks = fakeLocks() as unknown as LockManager;
    const first = createOutdoorWriteGuard({ projectId: 'activity-1', locks });
    await tick();
    const second = createOutdoorWriteGuard({ projectId: 'activity-1', locks });
    await tick();
    expect(second.mode()).toBe('blocked');

    const seen: string[] = [];
    second.onModeChange(mode => seen.push(mode));
    await first.release();
    await tick();

    expect(second.mode()).toBe('granted');
    expect(second.canWrite()).toBe(true);
    expect(seen).toEqual(['granted']);
    await second.release();
  });

  it('没有 Web Locks 时如实标 unavailable：仍可写，但不假装有互斥', async () => {
    const guard = createOutdoorWriteGuard({ projectId: 'activity-1', locks: null });
    await tick();
    expect(guard.mode()).toBe('unavailable');
    expect(guard.canWrite()).toBe(true);
    expect(guard.canPush()).toBe(true);
    expect(guard.blockedDetail()).toBeNull();
    await guard.release();
  });

  it('释放后不再通知，也不再可写', async () => {
    const locks = fakeLocks() as unknown as LockManager;
    const guard = createOutdoorWriteGuard({ projectId: 'activity-1', locks });
    await tick();
    const listener = vi.fn();
    guard.onModeChange(listener);
    await guard.release();
    expect(listener).not.toHaveBeenCalled();
    // 释放后另一个窗口能立刻接手。
    const next = createOutdoorWriteGuard({ projectId: 'activity-1', locks });
    await tick();
    expect(next.mode()).toBe('granted');
    await next.release();
  });
});
