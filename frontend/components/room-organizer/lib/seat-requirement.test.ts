import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { checkRequiredSeats, checkRestArea, countSingleSeats } from './seat-requirement';

describe('independent seat count', () => {
  it('requires a known valid headcount when everyone must be seated', () => {
    for (const count of [null, undefined, 0, -1, 1.5, NaN]) {
      expect(checkRequiredSeats(makeLayout(), 0, count, true).status).toBe('unknown');
    }
  });
  it('does not turn unknown capacity into a claim that the room is impossible', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [makeItem({ id: 'bench', type: 'bench', name: '长椅' })] })] });
    const result = checkRequiredSeats(layout, 0, 2, true);
    expect(result.status).toBe('unknown');
    expect(result.message).toContain('识别到 0 把单人椅');
    expect(result.message).not.toContain('最多');
    expect(checkRequiredSeats(layout, 1, 2, true).status).toBe('unknown');
    expect(checkRequiredSeats(layout, 0, 2, false).status).toBe('not_required');
  });

  it('counts only explicit single-person chairs, including locked chairs', () => {
    const layout = makeLayout({ floors: [makeFloor({ items: [
      makeItem({ id: 'one', type: 'chair', name: '椅子', position: { x: -2, z: 0 }, locked: true }),
      makeItem({ id: 'two', type: 'dining-chair', name: '餐椅' }),
      makeItem({ id: 'three', type: 'desk-chair', name: '讲座椅', position: { x: 2, z: 0 } }),
    ] })] });
    expect(checkRequiredSeats(layout, 0, 3, true)).toMatchObject({ status: 'quantity_met', message: expect.stringContaining('观众用途') });
  });
  it('excludes unplaced, invalid and outside chairs even when locked, and counts only the current floor', () => {
    const valid = makeItem({ id: 'valid', type: 'chair', position: { x: 0, z: 0 }, locked: true });
    const { position: _position, ...unplacedBase } = valid;
    const unplaced = { ...unplacedBase, id: 'unplaced' };
    const invalid = { ...valid, id: 'invalid', position: { x: NaN, z: 0 } };
    const outside = { ...valid, id: 'outside', position: { x: 100, z: 0 } };
    const layout = makeLayout({ width: 10, height: 8, floors: [
      makeFloor({ id: 'one', items: [valid, unplaced, invalid, outside] }),
      makeFloor({ id: 'two', items: [{ ...valid, id: 'other' }] }),
    ] });
    expect(countSingleSeats(layout, 0)).toBe(1);
    expect(countSingleSeats(layout, 1)).toBe(1);
    expect(checkRequiredSeats(layout, 0, 2, true).status).toBe('unknown');
    expect(checkRequiredSeats(layout, 0, 1, true).status).toBe('quantity_met');
    expect(checkRequiredSeats({ ...layout, width: NaN }, 0, 1, true).status).toBe('unknown');
  });
  it('does not count overlapping chairs, known obstacles or explicitly staff seats as audience chair quantity', () => {
    const chair = makeItem({ id: 'a', type: 'chair', name: '椅子', width: 0.5, depth: 0.5, position: { x: 0, z: 0 } });
    const overlap = { ...chair, id: 'b' };
    const staff = { ...chair, id: 'staff', name: '工作人员专用椅', position: { x: 2, z: 0 } };
    const obstacle = makeItem({ id: 'box', type: 'cabinet', width: 1, depth: 1, position: { x: -2, z: 0 } });
    const blocked = { ...chair, id: 'blocked', position: { x: -2, z: 0 } };
    const unknownRole = { ...chair, id: 'unknown-role', position: { x: 4, z: 0 } };
    const layout = makeLayout({ width: 12, height: 8, floors: [makeFloor({ items: [chair, overlap, staff, obstacle, blocked, unknownRole] })] });
    expect(countSingleSeats(layout, 0)).toBe(1);
    const result = checkRequiredSeats(layout, 0, 1, true);
    expect(result.status).toBe('quantity_met');
    expect(result.message).toContain('观众用途');
    expect(result.message).toContain('仍需核验');
  });
  it('checks the entire rotated footprint and rejects invalid geometry', () => {
    const chair = makeItem({ type: 'chair', width: 2, depth: 1, rotation: Math.PI / 2, position: { x: 4.4, z: 0 } });
    const layout = makeLayout({ width: 10, height: 8, floors: [makeFloor({ items: [chair] })] });
    expect(countSingleSeats(layout, 0)).toBe(1);
    expect(countSingleSeats({ ...layout, floors: [makeFloor({ items: [{ ...chair, rotation: 0 }] })] }, 0)).toBe(0);
    expect(countSingleSeats({ ...layout, floors: [makeFloor({ items: [{ ...chair, width: NaN }] })] }, 0)).toBe(0);
    expect(countSingleSeats({ ...layout, floors: [makeFloor({ items: [{ ...chair, rotation: NaN }] })] }, 0)).toBe(0);
  });

});

it('does not treat a chair as an explicitly marked rest area', () => {
  const base = makeLayout({ floors: [makeFloor({ items: [makeItem({ id: 'one', type: 'chair', name: '椅子' })] })] });
  expect(checkRestArea(base, 0, true).status).toBe('unknown');
  const withRest = { ...base, floors: [{ ...base.floors[0]!, zones: [{ id: 'rest', name: '休息区', color: '#fff', x: 0, z: 0, w: 2, d: 2 }] }] };
  expect(checkRestArea(withRest, 0, true).status).toBe('present');
  const outside = { ...base, floors: [{ ...base.floors[0]!, zones: [{ id: 'rest', name: '休息区', color: '#fff', x: 30, z: 0, w: 2, d: 2 }] }] };
  expect(checkRestArea(outside, 0, true).status).toBe('unknown');
});
