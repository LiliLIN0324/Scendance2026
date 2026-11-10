import { describe, expect, it } from 'vitest';
import { makeItem } from '../../__testfixtures__/fixtures';
import { backendSceneToLayout } from '../../backend-adapter';
import { initialBriefMemory, parseBriefTurn } from '../../brief-agent';
import { eventPreviewScale, isRoundResizeUtterance } from '../../event-layout-agent';
import { selectFurnishing } from '../../furnishing-select';
import { localPlan } from '../../local-plan';
import { evaluateBanquet } from './index';

const bare = { venueUp: false, scaleTyped: false, hasBase: false, command: null };

/**
 * 西湖·平湖秋月 as it is drawn: the activity frame stays 23.8×16.1, and the
 * indoor floor is the closed wall polyline inside that frame. The walls are
 * not tagged exterior, which is why a shell-only filter still billed chairs
 * that sit past the line into the open side.
 */
function pinghuHall() {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const wall = (n: number, start: { x: number; z: number }, end: { x: number; z: number }) => ({
    id: id(n), start, end, thickness: 0.2, height: 3, kind: 'interior' as const, status: 'confirmed' as const,
  });
  return backendSceneToLayout({
    schemaVersion: 2,
    venue: {
      shape: 'polygon', width: 23.8, depth: 16.1, height: 3, entrances: [], site: { indoorOutdoor: 'outdoor' },
      polygon: [{ x: 0, z: 0 }, { x: 23.8, z: 0 }, { x: 23.8, z: 16.1 }, { x: 0, z: 16.1 }],
    },
    objects: [], camera: 'overview', lighting: 'neutral',
    structure: {
      walls: [
        wall(1, { x: 4, z: 4 }, { x: 19, z: 4 }),
        wall(2, { x: 19, z: 4 }, { x: 19, z: 9 }),
        wall(3, { x: 19, z: 9 }, { x: 15.2, z: 9 }),
        wall(4, { x: 15.2, z: 9 }, { x: 15.2, z: 13 }),
        wall(5, { x: 15.2, z: 13 }, { x: 4, z: 13 }),
        wall(6, { x: 4, z: 13 }, { x: 4, z: 4 }),
      ],
      openings: [], columns: [],
    },
    sources: [], dimensions: [],
  }, { name: '西湖·平湖秋月', projectId: '108da110-50cd-4445-a45a-de309a6f5359' });
}

function banquetInput(hall: ReturnType<typeof pinghuHall>, diameter: number, seatPriority = false) {
  const choice = selectFurnishing({
    occasion: '圆桌宴', notes: `圆桌直径${diameter}米`, statedShape: 'round', statedWidth: diameter,
  });
  return {
    base: hall, floorIndex: 0, widthM: 23.8, depthM: 16.1, variant: 0, guests: 80,
    layoutMode: 'dining' as const, seatingShape: 'ring' as const,
    table: { shape: 'round' as const, width: diameter, depth: diameter },
    furnishing: choice, stage: false, checkin: false,
    ...(seatPriority ? { seatPriority: true } : {}),
  };
}

describe('平湖秋月 banquet design eval', () => {
  it('bills only chairs inside the drawn wall polyline for Ø2.20, Ø1.60, and a full add-seats pass', () => {
    const hall = pinghuHall();
    const baseIds = new Set(hall.floors[0]!.items.map(item => item.id));
    const past = makeItem({
      id: 'past-wall-chair', type: 'dining-chair', name: '餐椅', width: 0.45, depth: 0.45, height: 0.9,
      position: { x: 17.2 - 11.9, z: 11 - 8.05 },
    });
    const dirty = {
      ...hall,
      floors: hall.floors.map((floor, index) => index ? floor : { ...floor, items: [...floor.items, past] }),
    };
    const dirtyCount = dirty.floors[0]!.items.filter(item => item.type === 'dining-chair').length;
    expect(evaluateBanquet(dirty, 0, baseIds, dirtyCount).pass).toBe(false);
    expect(evaluateBanquet(dirty, 0, baseIds, dirtyCount).noCrossing.chairs).toBe(1);

    const first = parseBriefTurn('圆桌直径2.2米，80人，20米乘15米', initialBriefMemory(), bare);
    expect(first.previewLead).not.toContain('每桌 15');
    expect(eventPreviewScale(
      { length: 20, width: 15, origin: 'stated', fromVenue: false },
      first.memory,
      { length: 23.8, width: 16.1 },
    )).toMatchObject({ length: 23.8, width: 16.1, keptHall: true });

    const plan = localPlan(banquetInput(hall, 2.2));
    const preview = plan.layouts.at(-1)!;
    expect(preview.width).toBeCloseTo(23.8);
    expect(preview.height).toBeCloseTo(16.1);
    const ledger = evaluateBanquet(preview, 0, baseIds, plan.seats ?? -1);
    expect(ledger.room.tighterThanFrame).toBe(true);
    expect(ledger.noCrossing).toEqual({ pass: true, chairs: 0 });
    expect(ledger.noChairlessTables).toEqual({ pass: true, tables: 0 });
    expect(ledger.seatsMatch).toEqual({ pass: true, card: plan.seats, inRoom: ledger.seatsMatch.inRoom });
    expect(plan.seats).toBe(ledger.seatsMatch.inRoom);
    expect(plan.seats ?? 0).toBeGreaterThan(0);
    expect(preview.floors[0]!.items.filter(item => item.type === 'dining-table').length).toBeGreaterThan(0);
    expect(plan.seats ?? 0).toBeLessThan(80);
    expect(plan.blocked).toBeTruthy();
    expect(plan.blocked).not.toContain('每桌 15');

    expect(isRoundResizeUtterance('换成 Ø1.60 米', first.memory)).toBe(true);
    const smaller = localPlan(banquetInput(hall, 1.6));
    const smallerPreview = smaller.layouts.at(-1)!;
    expect(smallerPreview.width).toBeCloseTo(23.8);
    const smallerLedger = evaluateBanquet(smallerPreview, 0, baseIds, smaller.seats ?? -1);
    expect(smallerLedger.pass).toBe(true);
    expect(smaller.seats ?? 0).toBeGreaterThan(0);
    expect(smaller.seats).toBe(smallerLedger.seatsMatch.inRoom);
    expect(smaller.blocked ?? '').not.toContain('没接住');

    const added = localPlan(banquetInput(hall, 2.2, true));
    const addedLedger = evaluateBanquet(added.layouts.at(-1)!, 0, baseIds, added.seats ?? -1);
    expect(addedLedger.pass).toBe(true);
    expect(added.layouts.at(-1)!.width).toBeCloseTo(23.8);
    const beforeTables = preview.floors[0]!.items.filter(item => item.type === 'dining-table').length;
    const afterTables = added.layouts.at(-1)!.floors[0]!.items.filter(item => item.type === 'dining-table').length;
    if (afterTables <= beforeTables) {
      expect(added.blocked).toContain('室内已经排满');
      expect(added.seats ?? 0).toBeLessThan(80);
      expect(added.blocked).toBeTruthy();
    }
  });
});
