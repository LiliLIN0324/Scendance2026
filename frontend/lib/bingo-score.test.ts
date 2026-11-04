import { describe, expect, it } from 'vitest';
import type { FurnitureItem, InteriorWall, RoomLayout } from '../components/room-organizer/lib/types';
import { computeBingoScore, violationCodeLabel } from './bingo-score';
import type { SettleReport } from './settle-placement';

/** 造一件家具，缺省 0.6m × 0.6m 的桌子。 */
function makeItem(
  partial: Partial<FurnitureItem> & Pick<FurnitureItem, 'id' | 'name'>,
): FurnitureItem {
  return {
    type: 'table',
    width: 0.6,
    depth: 0.6,
    height: 0.75,
    position: { x: 0, z: 0 },
    rotation: 0,
    color: '#cccccc',
    icon: '',
    ...partial,
  };
}

/** 造一份 5m × 5m 的极简布局（原点居中，x∈[-2.5,2.5], z∈[-2.5,2.5]）。 */
function makeLayout(opts: {
  width?: number;
  height?: number;
  items?: FurnitureItem[];
  interiorWalls?: InteriorWall[];
}): RoomLayout {
  const width = opts.width ?? 5;
  const height = opts.height ?? 5;
  const floor: RoomLayout['floors'][number] = {
    id: 'f0',
    name: 'f0',
    items: opts.items ?? [],
    floorColor: '#ffffff',
  };
  if (opts.interiorWalls) floor.interiorWalls = opts.interiorWalls;
  return {
    name: 'test-layout',
    width,
    height,
    floors: [floor],
  };
}

describe('computeBingoScore', () => {
  it('全合规夹具 → total=100、failedCount=0', () => {
    // 椅子放在远离主通道（|x|>0.6）、远离墙、孤立无邻的位置 → 不触发任何判据。
    const chair = makeItem({
      id: 'c1',
      name: '椅',
      type: 'chair',
      position: { x: 2, z: 2 },
    });
    const layout = makeLayout({ items: [chair] });
    const score = computeBingoScore(layout);
    expect(score.total).toBe(100);
    expect(score.failedCount).toBe(0);
    expect(score.passedCount).toBe(1);
    expect(score.itemCount).toBe(1);
    expect(score.breakdown.spacing).toBe(100);
    expect(score.breakdown.aisle).toBe(100);
    expect(score.breakdown.bounds).toBe(100);
    expect(score.breakdown.wall).toBe(100);
    expect(score.summary).toContain('体检通过');
  });

  it('一件压内墙 → wall 分项扣分、failedCount=1', () => {
    // 一道横向内墙在 z=0；桌子压上去 → WALL_INTERSECTION。
    const wall: InteriorWall = { id: 'w1', x1: -2, z1: 0, x2: 2, z2: 0 };
    const table = makeItem({ id: 't1', name: '桌', position: { x: 1.8, z: 0 } });
    const layout = makeLayout({ items: [table], interiorWalls: [wall] });
    const score = computeBingoScore(layout);
    expect(score.breakdown.wall).toBeLessThan(100);
    expect(score.failedCount).toBe(1);
  });

  it('一件越界 → bounds 分项扣分', () => {
    const table = makeItem({
      id: 't1',
      name: '桌',
      position: { x: 3.0, z: 0 }, // 5m 场地 x∈[-2.5,2.5]，越界 0.5m
    });
    const layout = makeLayout({ items: [table] });
    const score = computeBingoScore(layout);
    expect(score.breakdown.bounds).toBeLessThan(100);
    expect(score.failedCount).toBe(1);
  });

  it('空场地 → total=100、itemCount=0', () => {
    const layout = makeLayout({ items: [] });
    const score = computeBingoScore(layout);
    expect(score.total).toBe(100);
    expect(score.itemCount).toBe(0);
  });

  it('settleReport 有 fixed / stuck → summary 走「挪不动已标红」分支', () => {
    const chair = makeItem({ id: 'c1', name: '椅', type: 'chair', position: { x: 2, z: 2 } });
    const layout = makeLayout({ items: [chair] });
    const mockReport: SettleReport = {
      layout,
      steps: [
        {
          moved: [
            { itemId: 't1', from: { x: 0, z: 0 }, to: { x: 1, z: 0 } },
            { itemId: 't2', from: { x: 0, z: 0 }, to: { x: -1, z: 0 } },
          ],
          violations: [],
        },
      ],
      remainingViolations: [{ kind: 'WALL', itemId: 'c1', message: '压墙' }],
      converged: false,
      iterations: 1,
    };
    const score = computeBingoScore(layout, mockReport);
    expect(score.fixedCount).toBe(2);
    expect(score.stuckCount).toBe(1);
    expect(score.summary).toContain('挪不动已标红');
    expect(score.summary).toContain('2 处堵点已自动挪开');
  });

  it('settleReport 有 fixed 但 stuck=0 且 total<95 → summary 走「全部就位」分支', () => {
    // 越界件会让 total 低于 95；fixedCount>0、stuckCount=0 → 第二分支。
    const table = makeItem({ id: 't1', name: '桌', position: { x: 3.0, z: 0 } });
    const layout = makeLayout({ items: [table] });
    const mockReport: SettleReport = {
      layout,
      steps: [
        {
          moved: [{ itemId: 't1', from: { x: 3, z: 0 }, to: { x: 1, z: 0 } }],
          violations: [],
        },
      ],
      remainingViolations: [],
      converged: true,
      iterations: 1,
    };
    const score = computeBingoScore(layout, mockReport);
    expect(score.fixedCount).toBe(1);
    expect(score.stuckCount).toBe(0);
    expect(score.summary).toContain('已自动挪开');
  });
});

describe('violationCodeLabel', () => {
  it('把机器 code 映射成中文人话', () => {
    expect(violationCodeLabel('MAIN_AISLE_BLOCKED')).toBe('压主通道');
    expect(violationCodeLabel('OUT_OF_BOUNDS')).toBe('出界');
    expect(violationCodeLabel('WALL_INTERSECTION')).toBe('压墙');
    expect(violationCodeLabel('CHAIR_ISLAND')).toBe('椅子成岛');
    expect(violationCodeLabel('BBOX_OVERLAP')).toBe('家具重叠');
  });

  it('未知 code 原样返回', () => {
    expect(violationCodeLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
