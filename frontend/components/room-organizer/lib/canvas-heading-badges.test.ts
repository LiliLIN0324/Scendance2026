import { describe, expect, it } from 'vitest';
import { buildHeadingBadges } from './canvas-heading-badges';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';

describe('buildHeadingBadges（CanvasHeading 容量 / 座位徽标视图模型）', () => {
  it('有余量且座位够 → 双 ok，文案带「估算」', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [
      makeItem({ id: 'chair-1', type: 'chair', position: { x: -2, z: 0 } }),
    ] })] });

    const badges = buildHeadingBadges({ layout, activeFloorIndex: 0, headcount: 1 });

    // 8 × 8：上限 16 件；已摆 1 件，余量充足。
    expect(badges.capacity).toEqual({ tone: 'ok', text: '估算上限 16 件 · 已摆 1 件' });
    expect(badges.seating).toEqual({ tone: 'ok', text: '座位已够 1 人（估算）' });
  });

  it('逼近 / 超过上限、座位有缺口 → 双 warn', () => {
    const cabinets = Array.from({ length: 15 }, (_, i) => makeItem({
      id: `cab-${i}`,
      type: 'cabinet',
      position: { x: -3 + (i % 5) * 1.5, z: -2 + Math.floor(i / 5) * 1.5 },
    }));
    const layout = makeLayout({ floors: [makeFloor({ items: [
      ...cabinets,
      makeItem({ id: 'chair-1', type: 'chair', position: { x: 0, z: 3.2 } }),
    ] })] });

    const badges = buildHeadingBadges({ layout, activeFloorIndex: 0, headcount: 5 });

    expect(badges.capacity.tone).toBe('warn');
    expect(badges.capacity.text).toBe('估算上限 16 件 · 已摆 16 件');
    expect(badges.seating).toEqual({ tone: 'warn', text: '座位还差 4（估算）' });
  });

  it('人数镜像为 null → 座位徽标显式「人数待核验」，不补默认人数', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [
      makeItem({ id: 'chair-1', type: 'chair', position: { x: 0, z: 0 } }),
    ] })] });

    const badges = buildHeadingBadges({ layout, activeFloorIndex: 0, headcount: null });

    expect(badges.seating).toEqual({ tone: 'pending', text: '人数待核验' });
    expect(badges.seating.text).not.toMatch(/24|\d+\s*人/);
  });

  it('场地尺寸不完整 → 件数与座位都走待核验', () => {
    const layout = makeLayout({
      width: Number.NaN,
      height: 8,
      floors: [makeFloor({ items: [makeItem({ id: 'chair-1', type: 'chair' })] })],
    });

    const badges = buildHeadingBadges({ layout, activeFloorIndex: 0, headcount: 3 });

    expect(badges.capacity).toEqual({ tone: 'pending', text: '件数估算待核验' });
    expect(badges.seating).toEqual({ tone: 'pending', text: '座位待核验' });
  });

  it('极小场地算不出上限件数 → 件数徽标待核验，不硬给 0 容量结论', () => {
    const layout = makeLayout({ width: 1, height: 1, floors: [makeFloor({ items: [] })] });

    const badges = buildHeadingBadges({ layout, activeFloorIndex: 0, headcount: null });

    expect(badges.capacity.tone).toBe('pending');
    expect(badges.capacity.text).toBe('件数估算待核验');
  });

  it('门 / 柱 / 出入口等结构标记件不计入已摆件数', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [
      makeItem({ id: 'entrance', type: 'entrance', venueEntranceId: 'door-1' }),
      makeItem({ id: 'table-1', type: 'table', position: { x: 0, z: 0 } }),
    ] })] });

    const badges = buildHeadingBadges({ layout, activeFloorIndex: 0, headcount: null });

    expect(badges.capacity.text).toBe('估算上限 16 件 · 已摆 1 件');
  });
});
