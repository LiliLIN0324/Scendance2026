import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { PLAN_TTL_MS, layoutContentHash, makePlanArtifact, markPlanApplied, planCoversLayout, planIsApplicable } from './plan-artifact';
import type { RoomLayout } from './types';

const NOW = 1_760_000_000_000;

function layoutWith(items = [makeItem({ id: 'a', position: { x: 1, z: 2 } })]): RoomLayout {
  return makeLayout({ width: 12, height: 9, floors: [makeFloor({ items })] });
}

function artifactOf(base: RoomLayout, candidate: RoomLayout = base) {
  return makePlanArtifact({ base, candidate, now: NOW });
}

describe('plan-artifact — 确认比内容，不比对象引用', () => {
  it('同内容、不同对象引用也算同一块场地', () => {
    const base = layoutWith();
    const clone: RoomLayout = { ...base, floors: [{ ...base.floors[0]!, items: base.floors[0]!.items.map(item => ({ ...item })) }] };
    expect(planIsApplicable(artifactOf(base), clone, NOW)).toEqual({ ok: true });
  });

  it('物料顺序不是内容：reducer 重排后仍然有效', () => {
    const a = makeItem({ id: 'a', position: { x: 1, z: 1 } });
    const b = makeItem({ id: 'b', type: 'sofa', position: { x: 4, z: 1 } });
    const base = layoutWith([a, b]);
    const reordered = layoutWith([b, a]);
    expect(planIsApplicable(artifactOf(base), reordered, NOW)).toEqual({ ok: true });
  });

  it('浮点噪声按毫米取整，不算场地变', () => {
    const base = layoutWith([makeItem({ id: 'a', position: { x: 1, z: 2 } })]);
    const noisy = layoutWith([makeItem({ id: 'a', position: { x: 1.0004, z: 1.9996 } })]);
    expect(planIsApplicable(artifactOf(base), noisy, NOW)).toEqual({ ok: true });
  });

  it('挪了一件物料就作废：stale-base', () => {
    const base = layoutWith();
    const moved = layoutWith([makeItem({ id: 'a', position: { x: 6, z: 2 } })]);
    expect(planIsApplicable(artifactOf(base), moved, NOW)).toEqual({ ok: false, reason: 'stale-base' });
  });

  it('改了场地尺寸也作废', () => {
    const base = layoutWith();
    const resized: RoomLayout = { ...base, width: 10 };
    expect(planIsApplicable(artifactOf(base), resized, NOW)).toEqual({ ok: false, reason: 'stale-base' });
  });

  it('默认十分钟过期；到点即失效', () => {
    const base = layoutWith();
    const artifact = artifactOf(base);
    expect(artifact.ttlMs).toBe(PLAN_TTL_MS);
    expect(planIsApplicable(artifact, base, NOW + PLAN_TTL_MS - 1)).toEqual({ ok: true });
    expect(planIsApplicable(artifact, base, NOW + PLAN_TTL_MS)).toEqual({ ok: false, reason: 'expired' });
  });

  it('已经确认过的身份不能再用一次', () => {
    const base = layoutWith();
    const applied = markPlanApplied(artifactOf(base), NOW + 5);
    expect(planIsApplicable(applied, base, NOW + 6)).toEqual({ ok: false, reason: 'already-applied' });
  });

  it('要落盘的候选必须是身份里记下的那一版', () => {
    const base = layoutWith();
    const candidate = layoutWith([makeItem({ id: 'new', position: { x: 3, z: 3 } })]);
    const artifact = artifactOf(base, candidate);
    expect(planCoversLayout(artifact, candidate)).toBe(true);
    expect(planCoversLayout(artifact, base)).toBe(false);
  });

  it('只改名字、底图透明度这类本地字段不影响场地指纹', () => {
    const base = layoutWith();
    const cosmetic: RoomLayout = { ...base, name: '另一个名字', floorPlanOpacity: 0.3 };
    expect(layoutContentHash(cosmetic)).toBe(layoutContentHash(base));
  });
});
