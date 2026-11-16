import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, owner, outsider } from './fixtures.ts';

/**
 * 2026-11-17：户外活动本体入库（迁移 20261117180000_outdoor_plans.sql）。
 * 重点验版本保护：baseRevision 不匹配一律不落库，避免两台设备互相静默覆盖。
 */
describe('户外活动本体入库（后端发号 + 版本保护）', () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { f = await database(); }, 120000);
  afterAll(async () => { await f?.db.close(); });

  it('首次写入发号，按 activityId 读回一致', async () => {
    const created = await f.rpc(owner, 'outdoor-plan.put', {
      localActivityId: 'local-1',
      name: '湖滨夜集',
      plan: { anchor: { lng: 120.16, lat: 30.25 }, zones: [] },
    });
    expect(created).toMatchObject({ conflict: false, revision: 1 });
    expect(typeof created.activityId).toBe('string');

    const got = await f.rpc(owner, 'outdoor-plan.get', { activityId: created.activityId });
    expect(got).toMatchObject({ found: true, revision: 1, name: '湖滨夜集' });
    expect(got.plan).toEqual({ anchor: { lng: 120.16, lat: 30.25 }, zones: [] });
  });

  it('带 baseRevision 才能更新；版本落后时返回冲突且不覆盖', async () => {
    const first = await f.rpc(owner, 'outdoor-plan.put', {
      localActivityId: 'local-2',
      name: '日集',
      plan: { v: 1 },
    });
    const updated = await f.rpc(owner, 'outdoor-plan.put', {
      activityId: first.activityId,
      baseRevision: 1,
      name: '日集',
      plan: { v: 2 },
    });
    expect(updated).toMatchObject({ conflict: false, revision: 2 });

    const stale = await f.rpc(owner, 'outdoor-plan.put', {
      activityId: first.activityId,
      baseRevision: 1,
      name: '日集（另一台设备）',
      plan: { v: 99 },
    });
    expect(stale).toMatchObject({ conflict: true, revision: 2 });

    const got = await f.rpc(owner, 'outdoor-plan.get', { activityId: first.activityId });
    expect(got.plan).toEqual({ v: 2 });
    expect(got.name).toBe('日集');
  });

  it('只列自己的活动，别人一条也看不到', async () => {
    const mine = await f.rpc(owner, 'outdoor-plan.list', {});
    expect(Array.isArray(mine)).toBe(true);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine[0]).toHaveProperty('activityId');
    await expect(f.rpc(outsider, 'outdoor-plan.list', {})).resolves.toEqual([]);
  });

  it('缺名字 / plan 不是对象被拒', async () => {
    await expect(f.rpc(owner, 'outdoor-plan.put', { name: '', plan: {} })).rejects.toThrow(/NAME_REQUIRED/);
    await expect(f.rpc(owner, 'outdoor-plan.put', { name: 'x', plan: 'nope' })).rejects.toThrow(/INVALID_PLAN/);
  });

  it('用户在冲突里选「用我这版」：force 越过版本比对，但仍 +1', async () => {
    const created = await f.rpc(owner, 'outdoor-plan.put', { localActivityId: 'local-3', name: '夜集', plan: { v: 1 } });
    await f.rpc(owner, 'outdoor-plan.put', {
      activityId: created.activityId,
      baseRevision: 1,
      name: '夜集',
      plan: { v: 2 },
    });
    const forced = await f.rpc(owner, 'outdoor-plan.put', {
      activityId: created.activityId,
      baseRevision: 1,
      force: true,
      name: '我这版',
      plan: { v: 3 },
    });
    expect(forced).toMatchObject({ conflict: false, revision: 3 });
    const got = await f.rpc(owner, 'outdoor-plan.get', { activityId: created.activityId });
    expect(got).toMatchObject({ name: '我这版', revision: 3 });
    expect(got.plan).toEqual({ v: 3 });
  });

  it('不存在的活动按 found=false 返回，不抛错', async () => {
    const missing = await f.rpc(owner, 'outdoor-plan.get', {
      activityId: '90000000-0000-4000-8000-000000000009',
    });
    expect(missing).toEqual({ found: false });
  });
});
