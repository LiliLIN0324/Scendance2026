import { describe, expect, it } from 'vitest';
import { restoreOutdoorFlow } from './outdoor-flow-restore';

const STAGES = ['place', 'scope', 'zones', 'main-routes', 'objects', 'sub-routes', 'people', 'refine-3d'] as const;
const base = (patch: Record<string, unknown>) => ({
  scope: 'proj-1',
  stage: 'zones',
  brief: { zones: ['签到'], items: ['摊位 x6'], people: [] },
  confirmedBoundary: 'b1',
  completed: ['place', 'scope'],
  ...patch,
});

describe('restoreOutdoorFlow（刷新恢复口径）', () => {
  it('字段齐全时原样恢复', () => {
    const { state, notes } = restoreOutdoorFlow({ raw: base({}), scope: 'proj-1', stages: STAGES });
    expect(state.stage).toBe('zones');
    expect(state.brief.zones).toEqual(['签到']);
    expect(state.confirmedBoundary).toBe('b1');
    expect(notes).toEqual([]);
  });

  it('旧草稿缺 brief.people 时补空数组，不把分区物料一起丢掉', () => {
    const raw = base({ brief: { zones: ['签到'], items: ['摊位 x6'] } });
    const { state, notes } = restoreOutdoorFlow({ raw, scope: 'proj-1', stages: STAGES });
    expect(state.brief.people).toEqual([]);
    expect(state.brief.zones).toEqual(['签到']);
    expect(notes).toContain('brief_filled');
  });

  it('不认识的阶段退回 place，其余字段保留', () => {
    const { state, notes } = restoreOutdoorFlow({ raw: base({ stage: 'legacy-stage' }), scope: 'proj-1', stages: STAGES });
    expect(state.stage).toBe('place');
    expect(state.brief.items).toEqual(['摊位 x6']);
    expect(notes).toContain('stage_downgraded');
  });

  it('登录等待的方案版本与当前不一致时丢掉，不禁输入框', () => {
    const raw = base({ pendingLogin: { message: '帮我分区', planVersion: 'old-v1' } });
    const { state, notes } = restoreOutdoorFlow({ raw, scope: 'proj-1', stages: STAGES, planVersion: 'new-v2' });
    expect(state.pendingLogin).toBeUndefined();
    expect(notes).toContain('stale_login_dropped');
  });

  it('登录等待版本一致时保留，登录回来还能接着做', () => {
    const raw = base({ pendingLogin: { message: '帮我分区', planVersion: 'v9' } });
    const { state } = restoreOutdoorFlow({ raw, scope: 'proj-1', stages: STAGES, planVersion: 'v9' });
    expect(state.pendingLogin?.message).toBe('帮我分区');
  });

  it('未确认边界缺字段就丢掉，但基准版本不同仍保留（刷新后重新预览、仍需确认）', () => {
    const incomplete = base({ pendingBoundary: { name: '草稿' } });
    expect(restoreOutdoorFlow({ raw: incomplete, scope: 'proj-1', stages: STAGES }).state.pendingBoundary).toBeUndefined();

    const otherVersion = base({
      pendingBoundary: { anchor: { lng: 120, lat: 30 }, boundary: [{ x: 0, y: 0 }], name: '草稿', base: 'old' },
    });
    const { state } = restoreOutdoorFlow({ raw: otherVersion, scope: 'proj-1', stages: STAGES, planVersion: 'new' });
    expect(state.pendingBoundary?.name).toBe('草稿');
    expect(state.confirmedBoundary).toBe('b1');
  });

  it('别的活动的草稿一律不拿来用', () => {
    const { state, notes } = restoreOutdoorFlow({ raw: base({ scope: 'proj-2' }), scope: 'proj-1', stages: STAGES });
    expect(state.stage).toBe('place');
    expect(notes).toEqual(['other_scope']);
  });

  it('completed 只留认识的阶段并去重', () => {
    const raw = base({ completed: ['place', 'ghost', 'scope', 'scope'] });
    const { state, notes } = restoreOutdoorFlow({ raw, scope: 'proj-1', stages: STAGES });
    expect(state.completed).toEqual(['place', 'scope']);
    expect(notes).toContain('completed_filtered');
  });

  it('存的是坏 JSON（raw=null）时给空白状态', () => {
    const { state, notes } = restoreOutdoorFlow({ raw: null, scope: 'proj-1', stages: STAGES });
    expect(state.scope).toBe('proj-1');
    expect(state.stage).toBe('place');
    expect(notes).toEqual(['no_draft']);
  });
});
