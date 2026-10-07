import { describe, expect, it } from 'vitest';
import { handoffSchema } from '../../../../supabase/functions/_shared/delivery-contract';
import { sceneSchema } from '../../../../supabase/functions/_shared/domain';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { backendSceneToLayout, createMeasuredRoomLayout, layoutToBackendScene } from './backend-adapter';
import { blankHandoff, effectiveHandoffStatus, handoffBasis } from './scene-handoff';
import { deliveryExecution, deliveryMaterials, sceneDeliveryCsv, sceneDeliveryJson, sceneExecutionCsv } from './scene-delivery';
import type { RoomLayout } from './types';

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function ordinary(): RoomLayout {
  return makeLayout({ width: 8, height: 6, roof: { style: 'none' }, floors: [makeFloor({ height: 3,
    items: [1, 2].map(n => makeItem({ id: id(n), materialId: 'chair', position: { x: -2, z: -1 }, rotation: Math.PI / 2 })) })] });
}
async function reviewed(layout: RoomLayout, n = 1) {
  const acceptance = '按图定位并核对尺寸';
  return handoffSchema.parse({ ...blankHandoff(), ownerName: '现场甲', dueDate: '2026-10-09', acceptance,
    status: 'accepted', evidenceNote: '已在现场实测，摆放与尺寸符合条件。', reviewedBasis: await handoffBasis(layout, id(n), acceptance) });
}
function edit(layout: RoomLayout, patch: Partial<RoomLayout['floors'][number]['items'][number]>): RoomLayout {
  return { ...layout, floors: [{ ...layout.floors[0], items: layout.floors[0].items.map((item, i) => i === 0 ? { ...item, ...patch } : item) }] };
}

describe('local execution handoff and reviewable delivery', async () => {
  it.each(['width', 'position', 'rotation', 'color'] as const)('requires a new review after changing %s without discarding evidence', async field => {
    const layout = ordinary(); layout.floors[0].items[0].handoff = await reviewed(layout);
    const changed = edit(layout, { [field]: field === 'position' ? { x: -1, z: -1 } : field === 'color' ? '#aaaaaa' : 2 });
    expect(await effectiveHandoffStatus(changed, id(1))).toBe('needs_review');
    expect((await deliveryExecution(changed))[0]).toMatchObject({ status: 'accepted', effectiveStatus: 'needs_review', evidenceNote: '已在现场实测，摆放与尺寸符合条件。' });
    expect(await effectiveHandoffStatus(layout, id(1))).toBe('accepted');
  });
  it('reviews again when the venue or acceptance changes, and restores the previous effective state on undo', async () => {
    const layout = ordinary(); layout.floors[0].items[0].handoff = await reviewed(layout);
    expect(await effectiveHandoffStatus({ ...layout, width: 9 }, id(1))).toBe('needs_review');
    const changed = edit(layout, { handoff: { ...layout.floors[0].items[0].handoff!, acceptance: '还要安装固定件' } });
    expect(await effectiveHandoffStatus(changed, id(1))).toBe('needs_review');
    expect(await effectiveHandoffStatus(layout, id(1))).toBe('accepted');
  });
  it('reviews changed structure at the same venue dimensions while camera and lighting remain unrelated', async () => {
    const layout = createMeasuredRoomLayout(ordinary(), { width: 8, depth: 6, height: 3 });
    layout.floors[0].items[0].handoff = await reviewed(layout);
    const changed = { ...layout, floors: [{ ...layout.floors[0], interiorWalls: layout.floors[0].interiorWalls!.map((wall, index) => index === 0 ? { ...wall, thickness: wall.thickness! + .02 } : wall) }] };
    expect(await effectiveHandoffStatus(changed, id(1))).toBe('needs_review');
    expect(await effectiveHandoffStatus({ ...layout, backendCamera: 'customer', backendLighting: 'cool' }, id(1))).toBe('accepted');
    expect(await sceneExecutionCsv(changed)).toContain('需复核');
  });
  it('reviews relocated entrances without changing the venue footprint', async () => {
    const scene = layoutToBackendScene(ordinary());
    const layout = backendSceneToLayout({ ...scene, venue: { ...scene.venue, entrances: [{ id: id(9), position: { x: 0, z: 3 }, width: 1.2 }] } });
    layout.floors[0].items[0].handoff = await reviewed(layout);
    const changed = { ...layout, floors: [{ ...layout.floors[0], items: layout.floors[0].items.map(item => item.venueEntranceId ? { ...item, position: { x: -4, z: 1 } } : item) }] };
    expect(await effectiveHandoffStatus(changed, id(1))).toBe('needs_review');
    expect(deliveryMaterials(changed)[0].quantity).toBe(2);
  });
  it('records a strong compact basis for a valid complex structure within the shared storage limit', async () => {
    const layout = createMeasuredRoomLayout(ordinary(), { width: 50, depth: 50, height: 3 });
    layout.floors[0].interiorWalls!.push(...Array.from({ length: 124 }, (_, index) => ({
      id: `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      x1: 10 + index % 20 * .05, z1: 10 + Math.floor(index / 20),
      x2: 10 + index % 20 * .05, z2: 12 + Math.floor(index / 20),
      thickness: .1, height: 3, kind: 'interior' as const, status: 'confirmed' as const,
    })));
    const scene = layoutToBackendScene(layout);
    expect(scene.schemaVersion).toBe(2);
    expect(JSON.stringify(scene).length).toBeGreaterThan(16384);
    const handoff = await reviewed(layout);
    expect(handoff.reviewedBasis).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(handoffSchema.safeParse(handoff).success).toBe(true);
    layout.floors[0].items[0].handoff = handoff;
    expect(await effectiveHandoffStatus(layout, id(1))).toBe('accepted');
  });
  it('keeps independent execution records while procurement still groups identical materials', async () => {
    const layout = ordinary(); for (const [index, item] of layout.floors[0].items.entries()) item.handoff = { ...await reviewed(layout, index + 1), ownerName: index ? '现场乙' : '现场甲' };
    expect((await deliveryExecution(layout)).map(row => row.ownerName)).toEqual(['现场甲', '现场乙']);
    expect(deliveryMaterials(layout)).toHaveLength(1);
    expect(deliveryMaterials(layout)[0]).toMatchObject({ quantity: 2, objectIds: [id(1), id(2)] });
  });
  it('exports scene and per-instance handoffs separately using converted coordinates and a common snapshot', async () => {
    const layout = ordinary(); layout.floors[0].items[0].handoff = await reviewed(layout);
    const snapshot = { id: 'handoff-1', generatedAt: '2026-10-07T10:00:00.000Z' };
    const bundle = JSON.parse(await sceneDeliveryJson(layout, snapshot));
    expect(bundle).toMatchObject({ version: 2, snapshot, coordinateOrigin: 'venue-north-west' });
    expect(sceneSchema.safeParse(bundle.scene).success).toBe(true);
    expect(bundle.execution[0]).toMatchObject({ objectId: id(1), position: { x: 2, z: 2 }, rotation: -90, ownerName: '现场甲' });
    expect(bundle.scene.objects[0]).not.toHaveProperty('handoff');
    expect(bundle.execution[0]).not.toHaveProperty('reviewedBasis');
    for (const csv of [sceneDeliveryCsv(layout, snapshot), await sceneExecutionCsv(layout, snapshot)]) {
      expect(csv.startsWith('\uFEFF')).toBe(true); expect(csv).toContain('handoff-1'); expect(csv).toContain(snapshot.generatedAt); expect(csv).toContain('\r\n');
    }
    expect((await sceneExecutionCsv(layout, snapshot)).split('\r\n')).toHaveLength(3);
    expect(await sceneExecutionCsv(layout)).toContain('"-90"');
    expect(await sceneExecutionCsv(layout)).not.toContain("'-90");
  });
  it('escapes execution text and does not leak model loading URLs or local review payloads', async () => {
    const layout = ordinary(); const item = layout.floors[0].items[0];
    item.name = '  =HYPERLINK("unsafe")';
    item.handoff = handoffSchema.parse({ ...blankHandoff(), ownerName: '=1+2', acceptance: '@SUM(1)', evidenceNote: '+甲,"乙"\n已核对' });
    const csv = await sceneExecutionCsv(layout);
    expect(csv).toContain('"\'=1+2"'); expect(csv).toContain('"\'@SUM(1)"'); expect(csv).toContain('"\'  =HYPERLINK(""unsafe"")"');
    expect(csv).toContain('"\'+甲,""乙""\n已核对"');
    item.handoff = { ...await reviewed(layout), reviewedBasis: 'https://storage.example/model?token=private' };
    expect(await sceneDeliveryJson(layout)).not.toContain('token=private');
    expect((await deliveryExecution(layout))[0].effectiveStatus).toBe('needs_review');
  });
  it.each(['scenePreset', 'glbNode', 'entrance', 'multiFloor'] as const)('rejects %s for the new execution export as well', async kind => {
    const layout = ordinary();
    if (kind === 'scenePreset') layout.scenePreset = 'gym';
    if (kind === 'glbNode') layout.floors[0].items[0].glbNode = 'fixture';
    if (kind === 'entrance') layout.entrance = { width: 2, depth: 1 };
    if (kind === 'multiFloor') layout.floors.push(makeFloor({ id: 'upstairs' }));
    await expect(sceneExecutionCsv(layout)).rejects.toThrow();
  });
});
