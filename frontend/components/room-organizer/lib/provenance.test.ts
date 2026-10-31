import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { itemProvenance, stampChangedItems, stampImportedItems } from './provenance';
import { parseStoredLayout } from './schema';
import { deliveryMaterials, sceneDeliveryCsv, sceneExecutionCsv } from './scene-delivery';
import type { RoomLayout } from './types';

const at = new Date('2026-10-31T10:00:00.000Z');
const proposal = itemProvenance('proposal', at, 'proposal-42');
const chairId = '10000000-0000-4000-8000-000000000001';
const chairId2 = '10000000-0000-4000-8000-000000000002';

function layoutWith(items: ReturnType<typeof makeItem>[]): RoomLayout {
  return makeLayout({ roof: { style: 'none', color: '#5d3a23' }, floors: [makeFloor({ items })] });
}

describe('item provenance', () => {
  it('stamps only instances a proposal added or changed', () => {
    const previous = layoutWith([
      makeItem({ id: 'kept' }),
      makeItem({ id: 'moved', position: { x: 1, z: 1 } }),
    ]);
    const next = layoutWith([
      makeItem({ id: 'kept' }),
      makeItem({ id: 'moved', position: { x: 1, z: 2 } }),
      makeItem({ id: 'added' }),
    ]);

    const stamped = stampChangedItems(previous, next, proposal);

    expect(stamped.floors[0]!.items[0]!.provenance).toBeUndefined();
    expect(stamped.floors[0]!.items[1]!.provenance).toEqual(proposal);
    expect(stamped.floors[0]!.items[2]!.provenance).toEqual(proposal);
    expect(previous.floors[0]!.items.every((item) => item.provenance === undefined)).toBe(true);
  });

  it('is a no-op when the proposal changed nothing', () => {
    const previous = layoutWith([makeItem()]);
    expect(stampChangedItems(previous, previous, proposal)).toBe(previous);
  });

  it('keeps earlier provenance on untouched instances and rewrites the ones a proposal replaces', () => {
    const imported = itemProvenance('import', at, 'booth.json');
    const previous = layoutWith([
      makeItem({ id: 'kept', provenance: imported }),
      makeItem({ id: 'replaced', provenance: imported }),
    ]);
    const next = layoutWith([
      makeItem({ id: 'kept', provenance: imported }),
      makeItem({ id: 'replaced', color: '#123456' }),
    ]);

    const stamped = stampChangedItems(previous, next, proposal);

    expect(stamped.floors[0]!.items[0]!.provenance).toEqual(imported);
    expect(stamped.floors[0]!.items[1]!.provenance).toEqual(proposal);
  });

  it('an import claims unrecorded instances and leaves recorded provenance intact', () => {
    const earlier = itemProvenance('cloud', at, 'project-7');
    const imported = itemProvenance('import', at, 'venue.json');
    const layout = layoutWith([
      makeItem({ id: 'recorded', provenance: earlier }),
      makeItem({ id: 'fresh' }),
    ]);

    const stamped = stampImportedItems(layout, imported);

    expect(stamped.floors[0]!.items[0]!.provenance).toEqual(earlier);
    expect(stamped.floors[0]!.items[1]!.provenance).toEqual(imported);
  });

  it('survives the save round trip and refuses unknown origins', () => {
    const layout = stampChangedItems(undefined, layoutWith([makeItem()]), proposal);
    const restored = parseStoredLayout(JSON.parse(JSON.stringify(layout)));

    expect(restored?.floors[0]!.items[0]!.provenance).toEqual(proposal);

    const corrupted = JSON.parse(JSON.stringify(layout)) as { floors: { items: { provenance: { origin: string } }[] }[] };
    corrupted.floors[0]!.items[0]!.provenance.origin = 'hacked';
    expect(parseStoredLayout(corrupted)).toBeNull();
  });

  it('discloses provenance per material group, execution row and CSV column', async () => {
    const layout = stampChangedItems(undefined, layoutWith([makeItem({ id: chairId })]), proposal);

    expect(deliveryMaterials(layout)[0]!.provenance).toEqual([proposal]);
    expect(sceneDeliveryCsv(layout)).toContain('助手方案@2026-10-31T10:00:00.000Z (proposal-42)');
    expect(await sceneExecutionCsv(layout)).toContain('助手方案@2026-10-31T10:00:00.000Z (proposal-42)');
  });

  it('lists every origin when one material group mixes them', () => {
    const imported = itemProvenance('import', at, 'venue.json');
    const layout = layoutWith([
      makeItem({ id: chairId, provenance: proposal }),
      makeItem({ id: chairId2, position: { x: 2, z: 0 }, provenance: imported }),
    ]);

    const [material] = deliveryMaterials(layout);

    expect(material!.quantity).toBe(2);
    expect(material!.provenance).toEqual([proposal, imported]);
  });
});
