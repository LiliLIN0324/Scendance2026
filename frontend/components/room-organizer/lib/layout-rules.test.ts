import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { checkLayoutRules, layoutRuleErrors } from './layout-rules';
import type { InteriorWall } from './types';

const entrance = { width: 1.6, depth: 1.2, offset: 0 };

describe('layout rules — entrance clearance', () => {
  it('flags furniture inside the 1.2 m porch clearance', () => {
    const layout = makeLayout({
      width: 8,
      height: 8,
      entrance,
      floors: [makeFloor({ items: [makeItem({ id: 'bench', name: '长凳', type: 'bench', width: 1.2, depth: 0.4, position: { x: 0, z: -2.2 } })] })],
    });
    const issues = checkLayoutRules(layout, 0);
    const issue = issues.find((candidate) => candidate.rule === 'entrance-clearance');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('error');
    expect(issue!.objectIds).toContain('bench');
    expect(issue!.evidence.clearanceDepth).toBe(1.2);
  });

  it('accepts a clear porch', () => {
    const layout = makeLayout({
      width: 8,
      height: 8,
      entrance,
      floors: [makeFloor({ items: [makeItem({ id: 'sofa', position: { x: 3, z: 3 } })] })],
    });
    expect(checkLayoutRules(layout, 0)).toEqual([]);
  });

  it('skips the porch once its door has been deleted', () => {
    const layout = makeLayout({
      width: 8,
      height: 8,
      entrance: { ...entrance, door: false },
      floors: [makeFloor({ items: [makeItem({ id: 'bench', position: { x: 0, z: -2.2 } })] })],
    });
    expect(checkLayoutRules(layout, 0).some((issue) => issue.rule === 'entrance-clearance')).toBe(false);
  });
});

describe('layout rules — exit obstruction', () => {
  it('flags a chair in front of a venue entrance door', () => {
    const door = makeItem({ id: 'door-1', name: '主要出入口', type: 'door', width: 1, position: { x: 0, z: -4 }, venueEntranceId: 'door-1' });
    const chair = makeItem({ id: 'chair-1', position: { x: 0, z: -3 } });
    const layout = makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: [door, chair] })] });

    const issue = checkLayoutRules(layout, 0).find((candidate) => candidate.rule === 'exit-obstruction');
    expect(issue).toBeDefined();
    expect(issue!.objectIds).toEqual(expect.arrayContaining(['door-1', 'chair-1']));
    expect(layoutRuleErrors(layout).map((candidate) => candidate.code)).toContain('EXIT_BLOCKED');
  });

  it('ignores wall-hung decor and rugs in the exit zone', () => {
    const door = makeItem({ id: 'door-1', type: 'door', width: 1, position: { x: 0, z: -4 }, venueEntranceId: 'door-1' });
    const rug = makeItem({ id: 'rug-1', type: 'rug', width: 3, depth: 3, height: 0.02, position: { x: 0, z: -3 } });
    const painting = makeItem({ id: 'painting-1', type: 'painting', width: 1, depth: 0.05, height: 0.8, position: { x: 0, z: -3 } });
    const layout = makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: [door, rug, painting] })] });

    expect(checkLayoutRules(layout, 0).some((issue) => issue.rule === 'exit-obstruction')).toBe(false);
  });
});

describe('layout rules — main aisle', () => {
  it('reaches the middle of an open room', () => {
    const layout = makeLayout({ width: 8, height: 8, entrance, floors: [makeFloor()] });
    expect(checkLayoutRules(layout, 0)).toEqual([]);
  });

  it('fails when a partition cuts the entrance off from the room centre', () => {
    const wall: InteriorWall = { id: 'wall-1', x1: -4, z1: -1, x2: 4, z2: -1, thickness: 0.16, height: 3 };
    const layout = makeLayout({ width: 8, height: 8, entrance, floors: [makeFloor({ interiorWalls: [wall] })] });

    const issue = checkLayoutRules(layout, 0).find((candidate) => candidate.rule === 'main-aisle');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('AISLE_BLOCKED');
    expect(issue!.evidence.aisleWidth).toBe(1.2);
  });

  it('checks every floor for delivery', () => {
    const wall: InteriorWall = { id: 'wall-1', x1: -4, z1: -1, x2: 4, z2: -1, thickness: 0.16, height: 3 };
    const layout = makeLayout({
      width: 8,
      height: 8,
      entrance,
      floors: [makeFloor(), makeFloor({ id: 'upper', interiorWalls: [wall] })],
    });
    // The porch is on the ground floor; the upper floor has no door and is not gated.
    expect(layoutRuleErrors(layout)).toEqual([]);
  });
});
