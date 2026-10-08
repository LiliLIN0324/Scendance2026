import { describe, expect, it } from 'vitest';
import { sceneV2Schema, type SceneV2 } from '../../supabase/functions/_shared/domain';
import { backendSceneToLayout, layoutToBackendScene } from '../components/room-organizer/lib/backend-adapter';
import { parseStoredLayout } from '../components/room-organizer/lib/schema';
import { parseLocalProjectBackupJson, serializeLocalProjectBackup } from './local-project-backup';
import { previewVenueEdit, readEditableVenue } from './venue-edit';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(): SceneV2 {
  const points = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }];
  return sceneV2Schema.parse({ schemaVersion: 2,
    venue: { shape: 'polygon', width: 10, depth: 8, height: 4, polygon: points, entrances: [] },
    objects: [
      { id: id(20), materialId: 'table', position: { x: 2, z: 2 }, rotation: 33, size: { width: 1.2, depth: 0.8, height: 0.75 }, color: '#ac8965', locked: true, notes: '独立演练物料' },
      { id: id(21), materialId: 'asset', assetId: id(22), position: { x: 3, z: 5 }, rotation: 19, size: { width: 0.5, depth: 0.5, height: 1 }, color: '#123456', locked: false, notes: '演练资产' },
    ], camera: 'top', lighting: 'warm',
    structure: {
      walls: [...points.map((start, i) => ({ id: id(i + 1), start, end: points[(i + 1) % 4], thickness: 0.16, height: 4, kind: 'exterior', status: 'inferred' })),
        { id: id(5), start: { x: 5, z: 2 }, end: { x: 5, z: 6 }, thickness: 0.15, height: 3, kind: 'interior', status: 'detected' }],
      openings: [
        { id: id(10), wallId: id(1), kind: 'door', offset: 2, width: 1.2, height: 2.3, sillHeight: 0.2, status: 'inferred' },
        { id: id(11), wallId: id(2), kind: 'window', offset: 3, width: 1, height: 1.1, sillHeight: 1.2, status: 'detected' },
      ],
      columns: [{ id: id(12), position: { x: 8, z: 6 }, size: { width: 0.5, depth: 0.6, height: 4 }, rotation: 22, status: 'detected' }],
    }, sources: [{ assetId: id(30), kind: 'floorplan', name: '独立演练图', width: 800, height: 600 }],
    dimensions: [
      { id: id(40), kind: 'width', valueMeters: 10, status: 'confirmed', label: '演练总宽', sourceAssetId: id(30), start: { x: 0, z: 0 }, end: { x: 1, z: 0 } },
      { id: id(41), kind: 'depth', valueMeters: 8, status: 'inferred', label: '演练总深' },
      { id: id(42), kind: 'wall', targetId: id(5), valueMeters: 4, status: 'confirmed', label: '固定内墙长度' },
      { id: id(43), kind: 'distance', targetId: id(10), measure: 'width', valueMeters: 1.2, status: 'confirmed', label: '演练门宽' },
      { id: id(44), kind: 'distance', targetId: id(10), measure: 'height', valueMeters: 2.3, status: 'inferred', label: '演练门高' },
    ],
    finishes: { floorColor: '#ccbb99', floorPattern: 'wood', wallColors: { [id(1)]: '#123456' } },
    design: { concept: '独立场地演练', palette: ['#ccbb99'], highlights: [{ title: '演练桌', description: '保留原物料', objectIds: [id(20)] }], requirements: [] },
  });
}
function layout(scene = fixture()) {
  return backendSceneToLayout(scene, { projectId: id(50), name: '矩形编辑演练', assetUrls: { [id(22)]: '/assets/fixture.glb' }, assetNames: { [id(22)]: '演练模型' } });
}
function preview(scene = fixture(), width = 12, depth = 9) {
  return previewVenueEdit(layout(scene), { width, depth, openings: scene.structure.openings });
}

describe('manual venue editing with a fixed metre origin', () => {
  it('reads current edited openings and objects instead of the stored scene', () => {
    const base = layout();
    base.floors[0].items.find(item => item.id === id(20))!.notes = '当前编辑备注';
    const door = base.floors[0].items.find(item => item.id === id(10))!;
    door.position = { ...door.position!, x: door.position!.x + 0.3 };
    const read = readEditableVenue(base);
    expect(read.objects[0].notes).toBe('当前编辑备注');
    expect(read.structure.openings[0].offset).toBeCloseTo(2.3, 12);
    expect(base.backendSceneV2!.structure.openings[0].offset).toBe(2);
  });

  it('moves only outer wall endpoints and converts centred editor positions without stretching objects', () => {
    const scene = fixture(), base = layout(scene), untouched = structuredClone(base);
    const table = base.floors[0].items.find(item => item.id === id(20))!;
    table.name = '自定义演练桌'; table.type = 'round-table'; table.price = 17; table.category = 'tables'; table.groupId = 'exercise'; table.source = 'generated';
    const asset = base.floors[0].items.find(item => item.id === id(21))!;
    asset.source = 'generated'; asset.category = 'decor'; asset.price = 99; asset.groupId = 'fixture-model';
    const next = previewVenueEdit(base, { width: 12, depth: 9, openings: scene.structure.openings });
    const wire = layoutToBackendScene(next) as SceneV2;
    expect(wire.objects).toEqual(scene.objects);
    expect(wire.structure.columns).toEqual(scene.structure.columns);
    expect(wire.structure.walls.find(wall => wall.id === id(5))).toEqual(scene.structure.walls[4]);
    expect(wire.structure.walls.slice(0, 4)).toMatchObject([
      { id: id(1), start: { x: 0, z: 0 }, end: { x: 12, z: 0 }, status: 'confirmed' },
      { id: id(2), start: { x: 12, z: 0 }, end: { x: 12, z: 9 }, status: 'confirmed' },
      { id: id(3), start: { x: 12, z: 9 }, end: { x: 0, z: 9 }, status: 'confirmed' },
      { id: id(4), start: { x: 0, z: 9 }, end: { x: 0, z: 0 }, status: 'confirmed' },
    ]);
    expect(wire.venue.polygon).toEqual([{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 9 }, { x: 0, z: 9 }]);
    expect(next.floors[0].items.find(item => item.id === id(20))).toEqual({ ...table, position: { x: -4, z: -2.5 } });
    expect(next.floors[0].items.find(item => item.id === id(21))).toEqual({ ...asset, position: { x: -3, z: 0.5 } });
    expect(wire.design).toEqual(scene.design); expect(wire.finishes).toEqual(scene.finishes); expect(wire.sources).toEqual(scene.sources);
    expect(base.backendSceneV2).toEqual(untouched.backendSceneV2);
    expect(base.width).toBe(10); expect(base.floors[0].items[0].position).toEqual(untouched.floors[0].items[0].position);
  });

  it('keeps unedited evidence states and replaces only explicitly changed overall dimensions', () => {
    const scene = fixture(), wire = layoutToBackendScene(preview(scene)) as SceneV2;
    expect(wire.structure.openings).toEqual(scene.structure.openings);
    expect(wire.structure.columns).toEqual(scene.structure.columns);
    expect(wire.dimensions[0]).toEqual({ ...scene.dimensions[0], valueMeters: 12, status: 'confirmed' });
    expect(wire.dimensions[1]).toEqual({ ...scene.dimensions[1], valueMeters: 9, status: 'confirmed' });
    expect(wire.dimensions.slice(2)).toEqual(scene.dimensions.slice(2));
    const noOp = layoutToBackendScene(preview(scene, 10, 8));
    expect(noOp).toEqual(scene);
  });

  it('updates a door at unchanged frame dimensions and replaces its direct width/height measurements', () => {
    const scene = fixture(), edits = structuredClone(scene.structure.openings);
    edits[0] = { ...edits[0], offset: 2.5, width: 1.5, height: 2.5, sillHeight: 0.3 };
    edits[1].status = 'confirmed';
    const wire = layoutToBackendScene(previewVenueEdit(layout(scene), { width: 10, depth: 8, openings: edits })) as SceneV2;
    expect(wire.structure.openings[0]).toEqual({ ...edits[0], status: 'confirmed' });
    expect(wire.structure.openings[1]).toEqual(scene.structure.openings[1]);
    expect(wire.dimensions[3]).toEqual({ ...scene.dimensions[3], valueMeters: 1.5, status: 'confirmed' });
    expect(wire.dimensions[4]).toEqual({ ...scene.dimensions[4], valueMeters: 2.5, status: 'confirmed' });
    expect(wire.dimensions.slice(0, 3)).toEqual(scene.dimensions.slice(0, 3));
    expect(wire.structure.walls).toEqual(scene.structure.walls);
  });

  it('does not mark untouched door sizes confirmed when only the offset changes', () => {
    const scene = fixture(); scene.dimensions[3].status = 'inferred';
    const openings = structuredClone(scene.structure.openings); openings[0].offset = 2.5;
    const wire = layoutToBackendScene(previewVenueEdit(layout(scene), { width: 10, depth: 8, openings })) as SceneV2;
    expect(wire.structure.openings[0].status).toBe('confirmed');
    expect(wire.dimensions).toEqual(scene.dimensions);
  });

  it('preserves near-corner wire measurements and evidence status on a no-op', () => {
    const scene = fixture(); scene.structure.walls[0].end.x -= 1e-9;
    expect((layoutToBackendScene(preview(scene, 10, 8)) as SceneV2).structure.walls).toEqual(scene.structure.walls);
  });

  it('supports rectangle venue without polygon and reversed/unordered outer walls', () => {
    const scene = fixture(); scene.venue = { shape: 'rectangle', width: 10, depth: 8, height: 4, entrances: [] };
    scene.structure.walls.reverse();
    scene.structure.walls.forEach(wall => { const start = wall.start; wall.start = wall.end; wall.end = start; });
    scene.structure.openings = [];
    scene.dimensions = scene.dimensions.filter(dimension => ![id(10), id(11)].includes(dimension.targetId ?? ''));
    expect((layoutToBackendScene(preview(scene)) as SceneV2).venue).toEqual({ ...scene.venue, width: 12, depth: 9 });
  });

  it('preserves confirmed coupled constraints and rejects a conflicting changed external wall length', () => {
    const scene = fixture();
    scene.dimensions.push({ id: id(45), kind: 'wall', targetId: id(1), valueMeters: 10, status: 'confirmed', label: '不可改写的实测墙长' });
    const base = layout(scene), before = structuredClone(base);
    expect(() => previewVenueEdit(base, { width: 12, depth: 9, openings: scene.structure.openings })).toThrow('不可改写的实测墙长：确认 10 米，实际 12.000 米');
    expect(base).toEqual(before);
  });

  it('keeps valid pixel-linked measurements when editing a door and blocks incompatible resizing', () => {
    const scene = fixture();
    scene.structure.walls[0].evidence = [{ sourceAssetId: id(30), start: { x: 0, z: 0 }, end: { x: 1, z: 0 } }];
    const dimension: SceneV2['dimensions'][number] = { id: id(45), kind: 'distance', targetId: id(1), sourceAssetId: id(30), start: { x: 0.2, z: 0 }, end: { x: 0.32, z: 0 }, measure: 'width', valueMeters: 1.2, status: 'confirmed', label: '图上核对线段' };
    scene.dimensions.push(dimension);
    const openings = structuredClone(scene.structure.openings); openings[0].width = 1.5;
    const wire = layoutToBackendScene(previewVenueEdit(layout(scene), { width: 10, depth: 8, openings })) as SceneV2;
    expect(wire.dimensions[5]).toEqual(dimension);
    expect(() => preview(scene)).toThrow('图上核对线段');
  });

  it('preserves confirmed distances between fixed column centres', () => {
    const scene = fixture();
    scene.structure.columns.push({ id: id(13), position: { x: 7, z: 2 }, size: { width: 0.4, depth: 0.4, height: 4 }, rotation: 0, status: 'confirmed' });
    const dimension: SceneV2['dimensions'][number] = { id: id(45), kind: 'distance', targetId: id(12), targetEndId: id(13), valueMeters: Math.sqrt(17), status: 'confirmed', label: '两个固定柱中心距离' };
    scene.dimensions.push(dimension);
    const wire = layoutToBackendScene(preview(scene)) as SceneV2;
    expect(wire.structure.columns).toEqual(scene.structure.columns);
    expect(wire.dimensions[5]).toEqual(dimension);
  });

  it.each([0, -1, NaN, Infinity, 101])('rejects invalid total dimension %s', width => {
    const scene = fixture();
    expect(() => preview(scene, width)).toThrow('总宽和总深');
  });

  it('rejects complex or incomplete outlines without discarding their structure', () => {
    const scene = fixture(); scene.venue.polygon = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 3, z: 8 }, { x: 0, z: 5 }];
    const base = layout(scene), before = structuredClone(base);
    expect(() => readEditableVenue(base)).toThrow('复杂轮廓'); expect(base).toEqual(before);
    const incomplete = fixture(); incomplete.structure.walls[3].end = { x: 0, z: 1 };
    expect(() => readEditableVenue(layout(incomplete))).toThrow('四条完整闭合');
    const duplicate = fixture(); duplicate.structure.walls[3] = { ...duplicate.structure.walls[0], id: id(4) };
    expect(() => readEditableVenue(layout(duplicate))).toThrow('四条完整闭合');
  });

  it('retains legacy entrance caches and refuses to resize rather than desynchronizing them', () => {
    const scene = fixture(); scene.venue.entrances = [{ id: id(10), position: { x: 2.6, z: 0 }, width: 1.2 }];
    const base = layout(scene), before = structuredClone(base);
    expect(() => readEditableVenue(base)).toThrow('独立出入口记录'); expect(base).toEqual(before);
  });

  it('does not delete, add, duplicate, reassign or change the kind of any opening', () => {
    const scene = fixture(), base = layout(scene), input = { width: 10, depth: 8, openings: scene.structure.openings };
    for (const openings of [input.openings.slice(1), [...input.openings, { ...input.openings[0], id: id(15) }], [input.openings[0], input.openings[0]]]) {
      expect(() => previewVenueEdit(base, { ...input, openings })).toThrow('门窗清单');
    }
    for (const patch of [{ wallId: id(2) }, { kind: 'window' as const }]) {
      expect(() => previewVenueEdit(base, { ...input, openings: [{ ...input.openings[0], ...patch }, input.openings[1]] })).toThrow('所属墙体或类型');
    }
  });

  it('rejects doors past the wall or above wall height without altering the original', () => {
    const scene = fixture(), base = layout(scene), before = structuredClone(base);
    for (const patch of [{ offset: 9 }, { height: 4 }, { width: -1 }, { offset: NaN }]) {
      expect(() => previewVenueEdit(base, { width: 10, depth: 8, openings: [{ ...scene.structure.openings[0], ...patch }, scene.structure.openings[1]] })).toThrow();
      expect(base).toEqual(before);
    }
  });

  it('rejects new object/wall overlap, object bounds, column bounds and interior-wall bounds', () => {
    const scene = fixture();
    expect(() => preview(scene, 8, 9)).toThrow('穿墙'); // fixed column at x=8 no longer fits
    expect(() => preview(scene, 12, 5.9)).toThrow('内墙超出');
    const objectBounds = fixture(); objectBounds.structure.columns = []; objectBounds.structure.walls = objectBounds.structure.walls.slice(0, 4); objectBounds.dimensions = objectBounds.dimensions.filter(dimension => dimension.targetId !== id(5));
    objectBounds.objects[0].position = { x: 7, z: 2 };
    expect(() => preview(objectBounds, 7, 9)).toThrow('穿墙');
    const collision = fixture(); collision.structure.columns = []; collision.structure.walls = collision.structure.walls.slice(0, 4); collision.dimensions = collision.dimensions.filter(dimension => dimension.targetId !== id(5));
    collision.objects[0].position = { x: 8, z: 3 };
    expect(() => preview(collision, 8.5, 9)).toThrow('穿墙');
  });

  it('rejects a rotated column footprint crossing the new boundary even when its centre is inside', () => {
    const scene = fixture();
    expect(scene.structure.columns[0].position.x).toBeLessThan(8.15);
    expect(() => preview(scene, 8.15, 9)).toThrow('超出场地');
  });

  it('rejects affected wall-mounted objects while permitting unchanged frame door edits', () => {
    const scene = fixture();
    scene.objects.push({ id: id(23), materialId: 'decoration', position: { x: 9.82, z: 2 }, rotation: 90, size: { width: 0.6, depth: 0.2, height: 0.5 }, color: '#123456', wallId: id(2), elevation: 1, locked: true, notes: '演练挂件' });
    expect(() => preview(scene)).toThrow('挂墙物件');
    expect(() => preview(scene, 10, 8)).not.toThrow();
  });

  it('roundtrips the complete edited structure through local reopen and the existing backup format', () => {
    const next = preview(), wire = layoutToBackendScene(next);
    const reopened = parseStoredLayout(JSON.parse(JSON.stringify(next)));
    expect(reopened).not.toBeNull(); expect(layoutToBackendScene(reopened!)).toEqual(wire);
    const text = serializeLocalProjectBackup(next, { state: 'ready', scope: id(50), brief: { status: 'absent' } }, '2026-10-08T00:00:00.000Z');
    const restored = parseLocalProjectBackupJson(text);
    expect(restored.layoutWasRepaired).toBe(false);
    expect(layoutToBackendScene(restored.layout)).toEqual(wire);
    expect(restored.layout.backendSceneV2!.dimensions).toEqual(next.backendSceneV2!.dimensions);
  });
});
