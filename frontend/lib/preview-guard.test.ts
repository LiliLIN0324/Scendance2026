import { describe, expect, it } from 'vitest';
import {
  candidateStillMatches,
  decideOnApply,
  snapshotPreviewContext,
} from './preview-guard';
import type {
  FurnitureItem,
  RoomLayout,
} from '../components/room-organizer/lib/types';

/**
 * 构造测试用布局。
 *
 * 每件 item 缺 position 时默认 {x:0,z:0}，缺 rotation 时默认 0；
 * color / icon / assetId 给一个最小兜底值，避免类型缺字段。
 */
function makeLayout(
  items: Array<
    Partial<FurnitureItem> & {
      id: string;
      type: string;
      name: string;
      width: number;
      depth: number;
      height: number;
    }
  >,
): RoomLayout {
  const normalizedItems: FurnitureItem[] = items.map((it) => ({
    color: it.color ?? '#000',
    icon: it.icon ?? '',
    assetId: it.assetId ?? '',
    position: it.position ?? { x: 0, z: 0 },
    rotation: it.rotation ?? 0,
    ...it,
  })) as FurnitureItem[];

  return {
    name: 'test',
    width: 10,
    height: 8,
    floors: [
      {
        id: 'f0',
        name: 'ground',
        items: normalizedItems,
        floorColor: '#fff',
      },
    ],
  };
}

/** 8 位 hex 字符串正则（指纹格式约束）。 */
const HEX8 = /^[0-9a-f]{8}$/;

describe('snapshotPreviewContext', () => {
  it('baselineFingerprint / candidateFingerprint 都是 8 位 hex 字符串', () => {
    const base = makeLayout([
      { id: 'a', type: 'table', name: 'a', width: 1, depth: 1, height: 1 },
    ]);
    const candidate = makeLayout([
      { id: 'a', type: 'table', name: 'a', width: 1, depth: 1, height: 1 },
      { id: 'b', type: 'chair', name: 'b', width: 0.5, depth: 0.5, height: 1 },
    ]);
    const ctx = snapshotPreviewContext(base, candidate);
    expect(ctx.baselineFingerprint).toMatch(HEX8);
    expect(ctx.candidateFingerprint).toMatch(HEX8);
  });

  it('相同 base 两次 snapshot 出的 baselineFingerprint 相同', () => {
    const base = makeLayout([
      { id: 'a', type: 'table', name: 'a', width: 1, depth: 1, height: 1 },
    ]);
    const candidate = makeLayout([
      { id: 'a', type: 'table', name: 'a', width: 1, depth: 1, height: 1 },
    ]);
    const ctx1 = snapshotPreviewContext(base, candidate, { now: 1 });
    const ctx2 = snapshotPreviewContext(base, candidate, { now: 2 });
    expect(ctx1.baselineFingerprint).toBe(ctx2.baselineFingerprint);
  });

  it('recipeId 透传', () => {
    const base = makeLayout([]);
    const candidate = makeLayout([]);
    const ctx = snapshotPreviewContext(base, candidate, { recipeId: 'a1b2c3d4' });
    expect(ctx.recipeId).toBe('a1b2c3d4');
  });

  it('空布局（floors=[] 也能 snapshot，不抛错）', () => {
    const empty: RoomLayout = {
      name: 'test-empty',
      width: 10,
      height: 8,
      floors: [],
    };
    expect(() => snapshotPreviewContext(empty, empty)).not.toThrow();
    const ctx = snapshotPreviewContext(empty, empty);
    expect(ctx.baselineFingerprint).toMatch(HEX8);
    expect(ctx.candidateFingerprint).toMatch(HEX8);
  });
});

describe('decideOnApply', () => {
  it('当前画布 == 基线 → action=apply', () => {
    const base = makeLayout([
      { id: 'a', type: 'table', name: 'a', width: 1, depth: 1, height: 1 },
    ]);
    const candidate = makeLayout([
      { id: 'a', type: 'table', name: 'a', width: 1, depth: 1, height: 1 },
    ]);
    const ctx = snapshotPreviewContext(base, candidate);
    const decision = decideOnApply(base, ctx);
    expect(decision.action).toBe('apply');
  });

  it('当前画布动了一件家具 → action=prompt，message 含「画布在预览期间被改动过」', () => {
    const base = makeLayout([
      { id: 'a', type: 'table', name: 'a', width: 1, depth: 1, height: 1 },
    ]);
    const candidate = makeLayout([
      { id: 'a', type: 'table', name: 'a', width: 1, depth: 1, height: 1 },
    ]);
    const ctx = snapshotPreviewContext(base, candidate);

    // 用户在预览期间把 a 挪了 0.5 米。
    const moved = makeLayout([
      {
        id: 'a',
        type: 'table',
        name: 'a',
        width: 1,
        depth: 1,
        height: 1,
        position: { x: 0.5, z: 0 },
      },
    ]);
    const decision = decideOnApply(moved, ctx);
    expect(decision.action).toBe('prompt');
    if (decision.action === 'prompt') {
      expect(decision.message).toContain('画布在预览期间被改动过');
    } else {
      throw new Error('expected prompt decision');
    }
  });
});

describe('candidateStillMatches', () => {
  it('候选未改 → true', () => {
    const base = makeLayout([]);
    const candidate = makeLayout([
      { id: 'x', type: 'chair', name: 'x', width: 0.5, depth: 0.5, height: 1 },
    ]);
    const ctx = snapshotPreviewContext(base, candidate);
    expect(candidateStillMatches(ctx, candidate)).toBe(true);
  });

  it('候选被改一件 → false', () => {
    const base = makeLayout([]);
    const candidate = makeLayout([
      { id: 'x', type: 'chair', name: 'x', width: 0.5, depth: 0.5, height: 1 },
    ]);
    const ctx = snapshotPreviewContext(base, candidate);
    const mutated = makeLayout([
      {
        id: 'x',
        type: 'chair',
        name: 'x',
        width: 0.5,
        depth: 0.5,
        height: 1,
        position: { x: 1, z: 0 },
      },
    ]);
    expect(candidateStillMatches(ctx, mutated)).toBe(false);
  });
});
