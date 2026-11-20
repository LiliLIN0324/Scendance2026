import { describe, expect, it } from 'vitest';
import { resolveBridgedHit } from './plan-pointer-bridge';

/**
 * 2026-11-20 审计 B5：3D 射线打不到地面时不能回落到 clientX/Y 反算。
 * 这些用例锁的是「命中丢失时用哪个落点」这一条规则。
 */
const hitAt = (x: number, y: number) => ({ px: { x: x * 10, y: y * 10 }, pt: { x, y } });

describe('3D → 2D 指针桥 · 命中丢失时的落点', () => {
  it('有命中时用新命中，并记成上一个有效落点', () => {
    const next = hitAt(3, 4);
    const out = resolveBridgedHit('move', next, hitAt(1, 1));
    expect(out.hit).toBe(next);
    expect(out.lastHit).toBe(next);
    expect(out.ignore).toBe(false);
  });

  it('命中丢失（拖过地平线）时停在上一次有效落点，而不是像素反算', () => {
    const last = hitAt(2, 5);
    const out = resolveBridgedHit('move', null, last);
    expect(out.hit).toBe(last);
    expect(out.lastHit).toBe(last);
    expect(out.ignore).toBe(false);
  });

  it('松手时同样沿用上一次有效落点（不会落到与 3D 表面对不上的点）', () => {
    const last = hitAt(-1, 2);
    const out = resolveBridgedHit('up', null, last);
    expect(out.hit).toBe(last);
    expect(out.ignore).toBe(false);
  });

  it('一次有效落点都没有（点天空起手）就不猜坐标', () => {
    expect(resolveBridgedHit('down', null, null).ignore).toBe(true);
    expect(resolveBridgedHit('move', null, null).ignore).toBe(true);
    expect(resolveBridgedHit('up', null, null).ignore).toBe(true);
  });

  it('leave 清掉缓存，下一次按下不会借到旧落点', () => {
    const out = resolveBridgedHit('leave', null, hitAt(9, 9));
    expect(out.hit).toBeNull();
    expect(out.lastHit).toBeNull();
    expect(out.ignore).toBe(false);
    expect(resolveBridgedHit('up', null, out.lastHit).ignore).toBe(true);
  });

  it('新手势点天空不能借到上一次 move 的落点，松手后也清缓存', () => {
    const old = hitAt(9, 9);
    expect(resolveBridgedHit('down', null, old)).toEqual({ hit: null, lastHit: null, ignore: true });
    expect(resolveBridgedHit('up', null, old)).toEqual({ hit: old, lastHit: null, ignore: false });
    expect(resolveBridgedHit('dblclick', null, old).ignore).toBe(true);
  });

  it('天空右键仍派发取消/撤点，但不借旧坐标打开物件菜单', () => {
    expect(resolveBridgedHit('contextmenu', null, hitAt(9, 9)))
      .toEqual({ hit: null, lastHit: null, ignore: false });
  });
});
