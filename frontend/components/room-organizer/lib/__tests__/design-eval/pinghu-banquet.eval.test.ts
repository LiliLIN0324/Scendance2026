import { describe, expect, it } from 'vitest';
import { makeItem } from '../../__testfixtures__/fixtures';
import { backendSceneToLayout } from '../../backend-adapter';
import { initialBriefMemory, parseBriefTurn } from '../../brief-agent';
import { eventPreviewScale, isRoundResizeUtterance } from '../../event-layout-agent';
import { selectFurnishing } from '../../furnishing-select';
import { localPlan, omitUnlandedBanquetItems } from '../../local-plan';
import { canvasFloor } from '../../floor-reading';
import { roundSeatLayout } from '../../table-seat-plan';
import { structuralItemCollides } from '../../structural-layout';
import { countChairsOnCanvasFloor, evaluateBanquet } from './index';

const bare = { venueUp: false, scaleTyped: false, hasBase: false, command: null };

/**
 * 西湖·平湖秋月 as it is drawn: the activity frame stays 23.8×16.1, and the
 * indoor floor is the closed wall polyline inside that frame. The walls are
 * not tagged exterior, which is why a shell-only filter still billed chairs
 * that sit past the line into the open side.
 */
function pinghuWalls(extraFirst = false, dropLast = false) {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const wall = (n: number, start: { x: number; z: number }, end: { x: number; z: number }) => ({
    id: id(n), start, end, thickness: 0.2, height: 3, kind: 'interior' as const, status: 'confirmed' as const,
  });
  const loop = [
    wall(1, { x: 4, z: 4 }, { x: 19, z: 4 }),
    wall(2, { x: 19, z: 4 }, { x: 19, z: 9 }),
    wall(3, { x: 19, z: 9 }, { x: 15.2, z: 9 }),
    wall(4, { x: 15.2, z: 9 }, { x: 15.2, z: 13 }),
    wall(5, { x: 15.2, z: 13 }, { x: 4, z: 13 }),
    wall(6, { x: 4, z: 13 }, { x: 4, z: 4 }),
  ];
  const walls = dropLast ? loop.slice(0, -1) : loop;
  return extraFirst ? [wall(9, { x: 1, z: 1 }, { x: 2, z: 1 }), ...walls] : walls;
}

function pinghuHall(options: { extraFirst?: boolean; dropLast?: boolean } = {}) {
  return backendSceneToLayout({
    schemaVersion: 2,
    venue: {
      shape: 'polygon', width: 23.8, depth: 16.1, height: 3, entrances: [], site: { indoorOutdoor: 'outdoor' },
      polygon: [{ x: 0, z: 0 }, { x: 23.8, z: 0 }, { x: 23.8, z: 16.1 }, { x: 0, z: 16.1 }],
    },
    objects: [], camera: 'overview', lighting: 'neutral',
    structure: {
      walls: pinghuWalls(options.extraFirst, options.dropLast),
      openings: [], columns: [],
    },
    sources: [], dimensions: [],
  }, { name: '西湖·平湖秋月', projectId: '108da110-50cd-4445-a45a-de309a6f5359' });
}

function banquetInput(hall: ReturnType<typeof pinghuHall>, diameter: number, seatPriority = false, drawnRoomCheck = true) {
  const choice = selectFurnishing({
    occasion: '圆桌宴', notes: `圆桌直径${diameter}米`, statedShape: 'round', statedWidth: diameter,
  });
  return {
    base: hall, floorIndex: 0, widthM: 23.8, depthM: 16.1, variant: 0, guests: 80,
    layoutMode: 'dining' as const, seatingShape: 'ring' as const,
    table: { shape: 'round' as const, width: diameter, depth: diameter },
    furnishing: choice, stage: false, checkin: false,
    ...(seatPriority ? { seatPriority: true } : {}),
    ...(drawnRoomCheck ? {} : { drawnRoomCheck: false }),
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

    const unchecked = localPlan(banquetInput(hall, 2.2, false, false));
    const uncheckedPreview = unchecked.layouts.at(-1)!;
    const uncheckedCount = countChairsOnCanvasFloor(uncheckedPreview, 0, baseIds);
    expect(uncheckedCount.crossing).toBe(15);
    expect(evaluateBanquet(uncheckedPreview, 0, baseIds, unchecked.seats ?? -1).pass).toBe(false);

    const plan = localPlan(banquetInput(hall, 2.2));
    const preview = plan.layouts.at(-1)!;
    expect(preview.width).toBeCloseTo(23.8);
    expect(preview.height).toBeCloseTo(16.1);
    const counted = countChairsOnCanvasFloor(preview, 0, baseIds);
    const ledger = evaluateBanquet(preview, 0, baseIds, plan.seats ?? -1);
    expect(counted.recovered).toBe(true);
    expect(counted.crossing).toBe(0);
    expect(counted.chairless).toBe(0);
    expect(counted.inRoom).toBeGreaterThan(0);
    expect(plan.seats).toBe(counted.inRoom);
    expect(ledger.seatsMatch).toEqual({ pass: true, card: counted.inRoom, inRoom: counted.inRoom });
    expect(ledger.pass).toBe(true);
    expect(preview.floors[0]!.items.filter(item => item.type === 'dining-table').length).toBeGreaterThan(0);
    expect(plan.seats ?? 0).toBeLessThan(80);
    expect(plan.blocked).toBeTruthy();
    expect(plan.blocked).not.toContain('每桌 15');

    expect(isRoundResizeUtterance('换成 Ø1.60 米', first.memory)).toBe(true);
    const smaller = localPlan(banquetInput(hall, 1.6));
    const smallerPreview = smaller.layouts.at(-1)!;
    expect(smallerPreview.width).toBeCloseTo(23.8);
    const smallerCount = countChairsOnCanvasFloor(smallerPreview, 0, baseIds);
    const smallerLedger = evaluateBanquet(smallerPreview, 0, baseIds, smaller.seats ?? -1);
    expect(smallerCount.crossing).toBe(0);
    expect(smaller.seats).toBe(smallerCount.inRoom);
    expect(smallerLedger.pass).toBe(true);
    expect(smaller.seats ?? 0).toBeGreaterThan(0);
    expect(smaller.blocked ?? '').not.toContain('没接住');

    const added = localPlan(banquetInput(hall, 2.2, true));
    const addedCount = countChairsOnCanvasFloor(added.layouts.at(-1)!, 0, baseIds);
    const addedLedger = evaluateBanquet(added.layouts.at(-1)!, 0, baseIds, added.seats ?? -1);
    expect(added.seats).toBe(addedCount.inRoom);
    expect(addedLedger.pass).toBe(true);
    expect(added.layouts.at(-1)!.width).toBeCloseTo(23.8);
    const beforeTables = preview.floors[0]!.items.filter(item => item.type === 'dining-table').length;
    const afterTables = added.layouts.at(-1)!.floors[0]!.items.filter(item => item.type === 'dining-table').length;
    if (afterTables <= beforeTables) {
      expect(added.blocked).toContain('室内已经排满');
      expect(added.seats ?? 0).toBeLessThan(80);
      expect(added.blocked).toBeTruthy();
    }
  }, 20_000);

  it('still reads the room when the first wall is a stub, and fails when the loop does not close', () => {
    const stubbed = pinghuHall({ extraFirst: true });
    expect(canvasFloor(stubbed, 0).recovered).toBe(true);
    const baseIds = new Set(stubbed.floors[0]!.items.map(item => item.id));
    const plan = localPlan(banquetInput(stubbed, 2.2));
    const counted = countChairsOnCanvasFloor(plan.layouts.at(-1)!, 0, baseIds);
    expect(counted.recovered).toBe(true);
    expect(plan.seats).toBe(counted.inRoom);
    expect(evaluateBanquet(plan.layouts.at(-1)!, 0, baseIds, plan.seats ?? -1).pass).toBe(true);

    const open = pinghuHall({ dropLast: true });
    expect(canvasFloor(open, 0).recovered).toBe(false);
    expect(canvasFloor(open, 0).floor).toBeNull();
    const openIds = new Set(open.floors[0]!.items.map(item => item.id));
    const openPlan = localPlan(banquetInput(open, 2.2));
    const openCount = countChairsOnCanvasFloor(openPlan.layouts.at(-1)!, 0, openIds);
    expect(openCount.recovered).toBe(false);
    expect(openCount.inRoom).toBe(0);
    expect(evaluateBanquet(openPlan.layouts.at(-1)!, 0, openIds, openPlan.seats ?? 0).pass).toBe(false);
  }, 20_000);

  it('does not bill the all-cyan southeast table or the chairs a Ø1.60 ring leaves past the wall', () => {
    // The live floor mesh covers both sides of the southeast wall. The brown
    // seat is hidden because the wall stands between it and the landed tables,
    // not because the chair is outside the floor polygon.
    const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
    const edge = (k: number, start: { x: number; z: number }, end: { x: number; z: number }) => ({
      id: id(k), start, end, thickness: 0.2, height: 3, kind: 'interior' as const, status: 'confirmed' as const,
    });
    const wallA = { x: 13, z: 2.2 };
    const wallB = { x: 20.7, z: 11.5 };
    const hall = backendSceneToLayout({
      schemaVersion: 2,
      venue: {
        shape: 'polygon', width: 23.8, depth: 16.1, height: 3, entrances: [], site: { indoorOutdoor: 'outdoor' },
        polygon: [{ x: 0, z: 0 }, { x: 23.8, z: 0 }, { x: 23.8, z: 16.1 }, { x: 0, z: 16.1 }],
      },
      objects: [], camera: 'overview', lighting: 'neutral',
      structure: {
        walls: [
          edge(1, { x: 2.5, z: 2 }, { x: 21, z: 2 }),
          edge(2, { x: 21, z: 2 }, { x: 21, z: 14.5 }),
          edge(3, { x: 21, z: 14.5 }, { x: 2.5, z: 14.5 }),
          edge(4, { x: 2.5, z: 14.5 }, { x: 2.5, z: 2 }),
          edge(5, wallA, wallB),
        ],
        openings: [], columns: [],
      },
      sources: [], dimensions: [],
    }, { name: '西湖·平湖秋月', projectId: 'pinghu-se-cut' });
    expect(hall.width).toBeCloseTo(23.8);
    expect(hall.height).toBeCloseTo(16.1);
    const drawn = canvasFloor(hall, 0);
    expect(drawn.recovered).toBe(true);
    expect(drawn.floor).toHaveLength(4);

    const dx = wallB.x - wallA.x, dz = wallB.z - wallA.z;
    const span = Math.hypot(dx, dz);
    const signed = (x: number, z: number) => (dx * (z - wallA.z) - dz * (x - wallA.x)) / span;
    const along = (t: number, side: number) => {
      const nx = -dz / span, nz = dx / span;
      return { x: wallA.x + dx * t + nx * side, z: wallA.z + dz * t + nz * side };
    };
    const ring = roundSeatLayout(1.6);
    const centers = {
      tl: { x: 6.5, z: 11.5 },
      tc: { x: 11, z: 11 },
      tr: along(0.72, 1.5),
      bl: { x: 6.2, z: 6 },
      bc: along(0.28, 1.5),
      br: along(0.55, -2.2),
    };
    const toLayout = (point: { x: number; z: number }) => ({ x: point.x - 11.9, z: point.z - 8.05 });
    const items = Object.entries(centers).flatMap(([name, center]) => {
      const table = makeItem({
        id: name, type: 'dining-table', name: '圆桌', width: 1.6, depth: 1.6, height: 0.75,
        position: toLayout(center),
      });
      const chairs = ring.chairs.map((place, index) => makeItem({
        id: `${name}-c${index}`, type: 'dining-chair', name: '餐椅', width: 0.45, depth: 0.45, height: 0.9,
        position: toLayout({ x: center.x + place.x, z: center.z + place.z }),
        rotation: place.rotation,
      }));
      return [table, ...chairs];
    });
    const preview = { ...hall, floors: hall.floors.map((floor, index) => index ? floor : { ...floor, items: [...floor.items, ...items] }) };
    const baseIds = new Set(hall.floors[0]!.items.map(item => item.id));
    const contains = (x: number, z: number) => {
      const poly = drawn.floor!;
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!, b = poly[j]!;
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
      }
      return hit;
    };
    expect(contains(centers.br.x, centers.br.z)).toBe(true);
    expect(contains(centers.tr.x, centers.tr.z)).toBe(true);
    const worldOf = (item: { position?: { x: number; z: number } }) => ({ x: item.position!.x + 11.9, z: item.position!.z + 8.05 });
    const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => {
      const abx = bx - ax, abz = bz - az, cdx = dx - cx, cdz = dz - cz;
      const denom = abx * cdz - abz * cdx;
      if (Math.abs(denom) < 1e-8) return false;
      const t = ((cx - ax) * cdz - (cz - az) * cdx) / denom;
      const u = ((cx - ax) * abz - (cz - az) * abx) / denom;
      return t > 1e-8 && t < 1 - 1e-8 && u > 1e-8 && u < 1 - 1e-8;
    };
    const wallBox = (() => {
      const len = span || 1;
      const nx = -dz / len, nz = dx / len;
      const half = 0.1;
      const corners = [
        { x: wallA.x + nx * half, z: wallA.z + nz * half },
        { x: wallB.x + nx * half, z: wallB.z + nz * half },
        { x: wallB.x - nx * half, z: wallB.z - nz * half },
        { x: wallA.x - nx * half, z: wallA.z - nz * half },
      ];
      return corners;
    })();
    const hitsCut = (from: { x: number; z: number }, to: { x: number; z: number }) => {
      for (let index = 0; index < wallBox.length; index++) {
        const a = wallBox[index]!, b = wallBox[(index + 1) % wallBox.length]!;
        if (cross(from.x, from.z, to.x, to.z, a.x, a.z, b.x, b.z)) return true;
      }
      return false;
    };
    const tables = items.filter(item => item.type === 'dining-table');
    const nearTables = tables.filter(table => signed(worldOf(table).x, worldOf(table).z) > 0.8);
    const distanceToCut = (x: number, z: number) => {
      const length = dx * dx + dz * dz;
      const t = length > 0 ? Math.max(0, Math.min(1, ((x - wallA.x) * dx + (z - wallA.z) * dz) / length)) : 0;
      return Math.hypot(x - wallA.x - dx * t, z - wallA.z - dz * t);
    };
    // A solid chair reaches its nearest near-side table without cutting the partition,
    // and its box clears the wall face the canvas uses to hide a brown seat.
    const solid = items.filter(item => {
      if (item.type !== 'dining-chair') return false;
      const chair = worldOf(item);
      if (distanceToCut(chair.x, chair.z) < 0.2 + 0.225) return false;
      let home: { x: number; z: number; distance: number } | null = null;
      for (const table of nearTables) {
        const point = worldOf(table);
        const distance = Math.hypot(point.x - chair.x, point.z - chair.z);
        if (distance > 1.6 / 2 + 2.5) continue;
        if (!home || distance < home.distance) home = { ...point, distance };
      }
      return !!home && !hitsCut(chair, home);
    });
    const billedChairs = items.filter(item => item.type === 'dining-chair');
    expect(billedChairs.length).toBe(66);
    expect(billedChairs.length).toBeGreaterThan(solid.length);
    expect(solid.length).toBeGreaterThan(0);
    expect(items.filter(item => item.type === 'dining-table')).toHaveLength(6);

    const raw = countChairsOnCanvasFloor(preview, 0, baseIds);
    expect(raw.inRoom).toBe(solid.length);
    expect(raw.crossing).toBe(billedChairs.length - solid.length);
    expect(raw.chairless).toBe(1);
    const billedAll = evaluateBanquet(preview, 0, baseIds, billedChairs.length);
    expect(billedAll.pass).toBe(false);
    expect(billedAll.seatsMatch.pass).toBe(false);
    // Rewriting the card to the solid walk still fails while the cyan table is in the preview.
    const billedSolid = evaluateBanquet(preview, 0, baseIds, solid.length);
    expect(billedSolid.pass).toBe(false);
    expect(billedSolid.noChairlessTables.pass).toBe(false);
    expect(billedSolid.noChairlessTables.tables).toBeGreaterThan(0);
    expect(evaluateBanquet(preview, 0, baseIds, 66).pass).toBe(false);

    const cleaned = omitUnlandedBanquetItems(preview, 0, baseIds);
    const cleanedTables = cleaned.floors[0]!.items.filter(item => item.type === 'dining-table');
    expect(cleanedTables.map(item => item.id).sort()).toEqual(['bc', 'bl', 'tc', 'tl', 'tr']);
    expect(cleanedTables.every(item => !structuralItemCollides(item, cleaned, 0))).toBe(true);
    const cleanedChairs = cleaned.floors[0]!.items.filter(item => item.type === 'dining-chair');
    expect(cleanedChairs).toHaveLength(solid.length);
    const landed = countChairsOnCanvasFloor(cleaned, 0, baseIds);
    expect(landed.inRoom).toBe(solid.length);
    expect(landed.crossing).toBe(0);
    expect(landed.chairless).toBe(0);
    expect(evaluateBanquet(cleaned, 0, baseIds, solid.length).pass).toBe(true);

    const plan = localPlan(banquetInput(hall, 1.6));
    const generated = countChairsOnCanvasFloor(plan.layouts.at(-1)!, 0, baseIds);
    expect(plan.seats).toBe(generated.inRoom);
    expect(generated.crossing).toBe(0);
    expect(generated.chairless).toBe(0);
    expect(evaluateBanquet(plan.layouts.at(-1)!, 0, baseIds, plan.seats ?? -1).pass).toBe(true);
    expect(plan.layouts.at(-1)!.width).toBeCloseTo(23.8);
    expect(plan.layouts.at(-1)!.height).toBeCloseTo(16.1);
  }, 20_000);

  it('does not bill chairs whose seat is on the far side of a drawn wall', () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const hall = backendSceneToLayout({
      schemaVersion: 2,
      venue: {
        shape: 'polygon', width: 23.8, depth: 16.1, height: 3, entrances: [], site: { indoorOutdoor: 'outdoor' },
        polygon: [{ x: 0, z: 0 }, { x: 23.8, z: 0 }, { x: 23.8, z: 16.1 }, { x: 0, z: 16.1 }],
      },
      objects: [], camera: 'overview', lighting: 'neutral',
      structure: {
        walls: [
          { id: id(1), start: { x: 4, z: 3 }, end: { x: 20, z: 3 }, thickness: 0.2, height: 3, kind: 'interior', status: 'confirmed' },
          { id: id(2), start: { x: 20, z: 3 }, end: { x: 20, z: 13 }, thickness: 0.2, height: 3, kind: 'interior', status: 'confirmed' },
          { id: id(3), start: { x: 20, z: 13 }, end: { x: 4, z: 13 }, thickness: 0.2, height: 3, kind: 'interior', status: 'confirmed' },
          { id: id(4), start: { x: 4, z: 13 }, end: { x: 4, z: 3 }, thickness: 0.2, height: 3, kind: 'interior', status: 'confirmed' },
          { id: id(5), start: { x: 6, z: 3 }, end: { x: 18, z: 13 }, thickness: 0.2, height: 3, kind: 'interior', status: 'confirmed' },
        ],
        openings: [], columns: [],
      },
      sources: [], dimensions: [],
    }, { name: '西湖·平湖秋月', projectId: 'pinghu-diagonal' });
    const at = (x: number, z: number) => ({ x: x - 11.9, z: z - 8.05 });
    const table = makeItem({ id: 'near-table', type: 'dining-table', name: '圆桌', width: 2.2, depth: 2.2, height: 0.75, position: at(10, 8) });
    const solid = makeItem({ id: 'solid-chair', type: 'dining-chair', name: '餐椅', width: 0.45, depth: 0.45, height: 0.9, position: at(8, 8) });
    const wire = makeItem({ id: 'wire-chair', type: 'dining-chair', name: '餐椅', width: 0.45, depth: 0.45, height: 0.9, position: at(13, 8) });
    const farTable = makeItem({ id: 'far-table', type: 'dining-table', name: '圆桌', width: 1.6, depth: 1.6, height: 0.75, position: at(17, 10) });
    const farChair = makeItem({ id: 'far-chair', type: 'dining-chair', name: '餐椅', width: 0.45, depth: 0.45, height: 0.9, position: at(17, 11.2) });
    const preview = { ...hall, floors: hall.floors.map((floor, index) => index ? floor : { ...floor, items: [...floor.items, table, solid, wire, farTable, farChair] }) };
    const baseIds = new Set(hall.floors[0]!.items.map(item => item.id));
    const counted = countChairsOnCanvasFloor(preview, 0, baseIds);
    expect(counted.inRoom).toBe(1);
    expect(counted.crossing).toBe(2);
    expect(counted.chairless).toBeGreaterThanOrEqual(1);
    expect(evaluateBanquet(preview, 0, baseIds, 3).pass).toBe(false);

    const plan = localPlan(banquetInput(hall, 2.2));
    const landed = countChairsOnCanvasFloor(plan.layouts.at(-1)!, 0, baseIds);
    expect(landed.crossing).toBe(0);
    expect(plan.seats).toBe(landed.inRoom);
    expect(evaluateBanquet(plan.layouts.at(-1)!, 0, baseIds, plan.seats ?? -1).pass).toBe(true);
  });
});
