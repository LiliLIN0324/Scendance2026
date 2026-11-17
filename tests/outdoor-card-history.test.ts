import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, owner, outsider } from './fixtures.ts';

/**
 * 2026-11-17：户外引导卡历史的后端副本（迁移 20261117120000_outdoor_card_history.sql）。
 * 在 PGlite 里把全部迁移跑一遍，直接验证 RPC 行为：按用户+活动隔离、坏数据被拒。
 */
describe('户外引导卡历史（后端副本）', () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { f = await database(); }, 120000);
  afterAll(async () => { await f?.db.close(); });

  const card = {
    at: 1_700_000_000_000,
    stage: 'scope',
    kind: 'scope',
    title: '确认“IN77”的活动范围',
    decision: 'confirmed',
    notes: ['商场轮廓只是候选；只用到一部分就重画。'],
    actions: ['确认并应用这一版', '在地图上重画实际活动范围', '撤回预览'],
  };

  it('写入后按用户+活动读回', async () => {
    await f.rpc(owner, 'outdoor-history.put', { projectId: 'p1', entries: [card] });
    await expect(f.rpc(owner, 'outdoor-history.get', { projectId: 'p1' })).resolves.toEqual([card]);
  });

  it('换活动 / 换用户互不可见', async () => {
    await expect(f.rpc(owner, 'outdoor-history.get', { projectId: 'p2' })).resolves.toEqual([]);
    await expect(f.rpc(outsider, 'outdoor-history.get', { projectId: 'p1' })).resolves.toEqual([]);
  });

  it('坏记录与空 projectId 被拒，不写进后端', async () => {
    await expect(
      f.rpc(owner, 'outdoor-history.put', { projectId: 'p1', entries: [{ at: 'x', title: '坏' }] }),
    ).rejects.toThrow(/INVALID_HISTORY_ENTRY/);
    await expect(
      f.rpc(owner, 'outdoor-history.put', { projectId: 'p1', entries: 'nope' as unknown as unknown[] }),
    ).rejects.toThrow(/INVALID_HISTORY/);
    await expect(f.rpc(owner, 'outdoor-history.get', { projectId: '' })).rejects.toThrow(/PROJECT_REQUIRED/);
  });
});
