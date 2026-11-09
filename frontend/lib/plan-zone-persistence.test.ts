import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { MAX_ZONES } from '../components/room-organizer/lib/zones';
import { parseStoredLayout } from '../components/room-organizer/lib/schema';
import type { RoomLayout, RoomZone } from '../components/room-organizer/lib/types';
import type { LayoutPlanDraft, PlanAnnotation } from './plan-annotation';
import { appendPlanZones } from './plan-zone-persistence';

const zone = (id: string, x: number, z: number, label = '访客接待'): PlanAnnotation => ({
  id, kind: 'zone', label, stageNo: 2, zoneType: 'checkin', geometry: { kind: 'rect', x, z, width: 1.2345, depth: 1.3456 },
});
const draft = (annotations: PlanAnnotation[]): LayoutPlanDraft => ({ id: 'draft-1', createdAt: 1, annotations,
  stages: [{ stageNo: 2, title: '布置', rationale: '根据需求', annotationIds: annotations.map(item => item.id) }] });
const scene = (): RoomLayout => makeLayout({ width: 12, height: 10, floors: [makeFloor({ items: [] })] });

describe('appendPlanZones', () => {
  it('preserves exact coordinates and name, adds semantics, and retains the unhandled annotations', () => {
    const input = scene();
    const source = draft([
      zone('z1', -4.2345, -3.1234),
      { id: 'z2', kind: 'zone', label: '饮水角', stageNo: 2, geometry: { kind: 'rect', x: 1, z: 1, width: 2, depth: 2 } },
      { id: 'door', kind: 'door', label: '门', stageNo: 2, geometry: { kind: 'door', wall: 'south', position: 0, widthM: 1 } },
      { id: 'route', kind: 'route', label: '路线', stageNo: 2, geometry: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] } },
    ]);
    const original = structuredClone(input), originalDraft = structuredClone(source);
    const result = appendPlanZones(input, 0, source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.addedZones).toHaveLength(2);
    expect(result.addedZones[0]).toMatchObject({ name: '访客接待（签到区）', zoneType:'checkin', color: '#4A7C59', x: -4.2345, z: -3.1234, w: 1.2345, d: 1.3456 });
    expect(result.addedZones[0]!.id).toBe('plan-zone:draft-1:z1:2');
    expect(result.addedZones[1]!.name).toBe('饮水角（普通区域）');
    expect(result.addedZones[1]).not.toHaveProperty('zoneType');
    expect(result.layout.floors[0]!.zones).toEqual(result.addedZones);
    expect(result.ignoredAnnotationIds).toEqual(['door', 'route']);
    expect(result.remainingDraft?.annotations.map(item => item.id)).toEqual(['door', 'route']);
    expect(result.remainingDraft?.stages[0]!.annotationIds).toEqual(['door', 'route']);
    expect(parseStoredLayout(JSON.parse(JSON.stringify(result.layout)))?.floors[0]!.zones).toEqual(result.addedZones);
    expect(input).toEqual(original);
    expect(source).toEqual(originalDraft);
  });

  it('retains reserved semantics across JSON storage without inferring old names',()=>{
    const input=scene(), source=draft([{...zone('keep',-3,-3,'留空'),zoneType:'reserved'}]);
    const result=appendPlanZones(input,0,source);expect(result.ok).toBe(true);if(!result.ok)return;
    const parsed=parseStoredLayout(JSON.parse(JSON.stringify(result.layout)));
    expect(parsed?.floors[0]?.zones?.[0]?.zoneType).toBe('reserved');
    const legacy=scene();legacy.floors[0]!.zones=[{id:'old',name:'预留区',color:'#4A7C59',x:0,z:0,w:1,d:1}];
    expect(parseStoredLayout(JSON.parse(JSON.stringify(legacy)))?.floors[0]?.zones?.[0]).not.toHaveProperty('zoneType');
    const needsRepair=JSON.parse(JSON.stringify(result.layout));needsRepair.floors[0].zones[0].unrecognized='discard';
    const repaired=parseStoredLayout(needsRepair);
    expect(repaired?.floors[0]?.zones?.[0]?.zoneType).toBe('reserved');
    expect(repaired?.floors[0]?.zones?.[0]).not.toHaveProperty('unrecognized');
    needsRepair.floors[0].zones[0].zoneType='fire_exit';expect(parseStoredLayout(needsRepair)).toBeNull();
  });

  it('keeps existing areas and other floors without mutating them', () => {
    const existing: RoomZone = { id: 'old', name: '已有区', color: '#fff', x: 3, z: 3, w: 1, d: 1 };
    const other = makeFloor({ id: 'upper', zones: [{ ...existing, id: 'upper-zone' }] });
    const input = makeLayout({ width: 12, height: 10, floors: [makeFloor({ zones: [existing] }), other] });
    const result = appendPlanZones(input, 0, draft([zone('z1', -4, -3, '签到区')]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.addedZones[0]!.name).toBe('签到区');
    expect(result.layout.floors[0]!.zones![0]).toEqual(existing);
    expect(result.layout.floors[1]).toBe(other);
    expect(result.remainingDraft).toBeNull();
  });

  it('does not turn doors or routes into areas', () => {
    const input = scene();
    const route: PlanAnnotation = { id: 'r', kind: 'route', label: '路线', stageNo: 1, geometry: { kind: 'polyline', points: [] } };
    const result = appendPlanZones(input, 0, draft([route]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout).toBe(input);
    expect(result.addedZones).toEqual([]);
    expect(result.remainingDraft?.annotations).toEqual([route]);
  });

  it('rejects invalid dimensions, unknown semantics, non-rectangles and out-of-bounds areas', () => {
    const input = scene();
    const cases: PlanAnnotation[] = [
      { ...zone('z', 0, 0), geometry: { kind: 'rect', x: NaN, z: 0, width: 1, depth: 1 } },
      { ...zone('z', 0, 0), geometry: { kind: 'rect', x: 0, z: 0, width: 0.2, depth: 1 } },
      { ...zone('z', 5.5, 0) },
      { ...zone('z', 0, 0), geometry: { kind: 'polyline', points: [] } },
      { ...zone('z', 0, 0), zoneType: 'unknown' as NonNullable<PlanAnnotation['zoneType']> },
      { ...zone('z', 0, 0), label: '   ' },
      { ...zone('z', 0, 0), stageNo: 0 },
    ];
    for (const item of cases) expect(appendPlanZones(input, 0, draft([item])).ok).toBe(false);
    expect(appendPlanZones(input, -1, draft([zone('z', 0, 0)])).ok).toBe(false);
    expect(input.floors[0]!.zones).toBeUndefined();
  });

  it('rejects duplicate identifiers and reports overlap without altering either input', () => {
    const base = scene();
    const a = zone('a', 0, 0), b = zone('b', 0.5, 0.5);
    expect(appendPlanZones(base, 0, draft([a, { ...b, id: 'a' }])).ok).toBe(false);
    const overlapping = appendPlanZones(base, 0, draft([a, b]));
    expect(overlapping.ok).toBe(true);
    if (overlapping.ok) expect(overlapping.warnings.join(' ')).toContain('共用空间');
    const collision = makeLayout({ width: 12, height: 10, floors: [makeFloor({ items: [makeItem({ id: 'plan-zone:draft-1:a:2' })] })] });
    expect(appendPlanZones(collision, 0, draft([a])).ok).toBe(false);
    const existing: RoomZone = { id: 'existing', name: '已有', color: '#4A7C59', x: 0, z: 0, w: 2, d: 2 };
    const occupied = makeLayout({ width: 12, height: 10, floors: [makeFloor({ zones: [existing] })] });
    const result = appendPlanZones(occupied, 0, draft([a]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join(' ')).toContain('共用空间');
    expect(occupied.floors[0]!.zones).toEqual([existing]);
  });

  it('rejects overlong or corrupt identifiers and labels rather than truncating data', () => {
    const input = scene();
    expect(appendPlanZones(input, 0, { ...draft([zone('z', 0, 0)]), id: 'x'.repeat(150) }).ok).toBe(false);
    expect(appendPlanZones(input, 0, draft([{ ...zone('z', 0, 0), label: '区'.repeat(201) }])).ok).toBe(false);
    expect(appendPlanZones(input, 0, draft([zone('\ud800', 0, 0)])).ok).toBe(false);
    const old: RoomZone = { id: 'duplicate', name: '已有', color: '#4A7C59', x: -5, z: -4, w: 1, d: 1 };
    const duplicate = makeLayout({ width: 12, height: 10, floors: [makeFloor({ zones: [old, { ...old }] })] });
    expect(appendPlanZones(duplicate, 0, draft([zone('z', 0, 0)])).ok).toBe(false);
    const malformed = makeLayout({ width: 12, height: 10, floors: [makeFloor({ items: [null as unknown as ReturnType<typeof makeItem>] })] });
    expect(appendPlanZones(malformed, 0, draft([zone('z', 0, 0)])).ok).toBe(false);
  });

  it('allows an area exactly touching the room boundary without moving it', () => {
    const input = scene();
    const edge: PlanAnnotation = { id: 'edge', kind: 'zone', label: '休息区', stageNo: 1, zoneType: 'rest',
      geometry: { kind: 'rect', x: 4, z: 3, width: 2, depth: 2 } };
    const result = appendPlanZones(input, 0, draft([edge]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.addedZones[0]).toMatchObject({ x: 4, z: 3, w: 2, d: 2 });
  });

  it('permits exactly the zone limit and rejects overflow', () => {
    const old = Array.from({ length: MAX_ZONES - 1 }, (_, i): RoomZone => ({ id: `old-${i}`, name: '旧区域', color: '#4A7C59', x: -5, z: -4, w: 0.3, d: 0.3 }));
    const input = makeLayout({ width: 12, height: 10, floors: [makeFloor({ zones: old })] });
    const accepted = appendPlanZones(input, 0, draft([zone('new', 1, 1)]));
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.layout.floors[0]!.zones).toHaveLength(MAX_ZONES);
    expect(appendPlanZones(accepted.layout, 0, draft([zone('another', 3, 2)])).ok).toBe(false);
  });

  it('checks an entire rectangle against concave venue boundaries, not only its corners', () => {
    const venue = { width: 10, depth: 8, height: 3, shape: 'polygon' as const, entrances: [], polygon: [
      { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 6, z: 4 },
      { x: 6, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 },
    ] };
    const input = makeLayout({ width: 10, height: 8, backendVenue: venue, floors: [makeFloor()] });
    const cutAcross: PlanAnnotation = { id: 'z', kind: 'zone', label: '签到区', stageNo: 1, zoneType: 'checkin',
      geometry: { kind: 'rect', x: -2, z: -1, width: 4, depth: 2 } };
    const result = appendPlanZones(input, 0, draft([cutAcross]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('多边形场地边界');
    const inside: PlanAnnotation = { ...cutAcross, id: 'inside', geometry: { kind: 'rect', x: -4, z: 0.5, width: 2, depth: 2 } };
    expect(appendPlanZones(input, 0, draft([inside])).ok).toBe(true);
  });
});
