import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { generateScoredPlans } from './plan-scoring';
import { sceneDoorAnnotations } from './plan-scene-doors';
import { extractPlanSizeFacts } from './plan-size-facts';
import type { PlanAnnotation } from './plan-annotation';

describe('scene door records', () => {
  it('keeps a recorded center when the width is missing or invalid', () => {
    for (const width of [0, NaN, Infinity, undefined]) {
      const marker = makeItem({ id: 'door', name: '东门', type: 'door', width: width ?? 1, depth: 0.12,
        position: { x: 5, z: 1 }, venueEntranceId: 'entrance-id' });
      if (width === undefined) delete (marker as { width?: number }).width;
      const layout = makeLayout({ width: 10, height: 8, floors: [makeFloor({ items: [marker] })] });
      const doors = sceneDoorAnnotations(layout, 0);
      expect(doors).toHaveLength(1);
      expect(doors[0]!.geometry).toMatchObject({ kind: 'door', wall: 'east', position: 1, widthM: null, inferred: true, source: 'scene' });
    }
  });
  it('uses a recorded east entrance as a pending fact and never claims the door swing was checked', () => {
    const marker = makeItem({ id: 'door', name: '东门', type: 'door', width: 1.2, depth: 0.12,
      position: { x: 5, z: 1 }, venueEntranceId: 'entrance-id' });
    const layout = makeLayout({ width: 10, height: 8, floors: [makeFloor({ items: [marker] })] });
    const doors = sceneDoorAnnotations(layout, 0);
    expect(doors).toHaveLength(1);
    expect(doors[0]!.geometry).toMatchObject({ kind: 'door', wall: 'east', position: 1, widthM: 1.2, inferred: true, source: 'scene' });
    const zone: PlanAnnotation = { id: 'zone', kind: 'zone', label: '座席', stageNo: 1,
      zoneType: 'desk', geometry: { kind: 'rect', x: -4, z: -3, width: 6, depth: 5 } };
    const plans = generateScoredPlans([zone, ...doors], { roomSize: { width: 10, height: 8 } });
    expect(plans[0]!.violations.some(v => v.zoneId === 'entrance-id' && v.status === 'unknown' && v.message.includes('场景记录'))).toBe(true);
    expect(plans[0]!.assurance).toBe('draft_unverified');
  });

  it('does not manufacture an exterior wall for an internal, corner or unlinked door object', () => {
    const items = [
      makeItem({ id: 'inner', name: '内门', type: 'door', width: 1, depth: 0.1, position: { x: 0, z: 0 }, structuralOpeningId: 'inner' }),
      makeItem({ id: 'corner', name: '角门', type: 'door', width: 1, depth: 0.1, position: { x: 5, z: 4 }, structuralOpeningId: 'corner' }),
      makeItem({ id: 'object', name: '道具门', type: 'door', width: 1, depth: 0.1, position: { x: 0, z: -4 } }),
    ];
    const layout = makeLayout({ width: 10, height: 8, floors: [makeFloor({ items })] });
    expect(sceneDoorAnnotations(layout, 0)).toEqual([]);
  });
});

it('keeps a numerical canvas size unverified without matching source records', () => {
  const layout = makeLayout({ width: 19, height: 15 });
  const facts = extractPlanSizeFacts(layout, 0);
  const plan = generateScoredPlans([], { roomSize: { width: 19, height: 15, facts } })[0]!;
  expect(plan.violations.some(v => v.code === 'ROOM_SIZE_UNKNOWN' && v.status === 'unknown')).toBe(true);
  expect(plan.feasibilityStatus).toBe('INSUFFICIENT_INPUT');
  expect(plan.assurance).toBe('draft_unverified');
});
