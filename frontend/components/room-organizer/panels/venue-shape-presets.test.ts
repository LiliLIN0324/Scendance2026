import { describe, it, expect } from 'vitest';
import { sceneSchema, sceneWarnings } from '../../../../supabase/functions/_shared/domain';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { layoutToBackendScene } from '../lib/backend-adapter';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { createVenueShape } from './venue-shape-presets';

describe('blank venue presets', () => {
  it.each(['rectangle', 'square', 'l'] as const)('creates a valid %s with inferred structure and no stale furniture', key => {
    const layout = createVenueShape({ ...INITIAL_LAYOUT, id: '10000000-0000-4000-8000-000000000001' }, key);
    const scene = sceneSchema.parse(layoutToBackendScene(layout));
    expect(scene.objects).toHaveLength(0);
    expect(sceneWarnings(scene)).toEqual([]);
    expect(scene.schemaVersion).toBe(2);
    expect(layout.backendSceneV2!.structure.walls).toHaveLength(key === 'l' ? 6 : 4);
    expect(layout.backendSceneV2!.structure.walls.every(wall => wall.status === 'inferred')).toBe(true);
  });

  it('retains the current project and task evidence without reattaching removed material ids', () => {
    const operations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
      id: '10000000-0000-4000-8000-000000000002', title: '演练布场', phase: 'setup', objectIds: ['removed-table'],
      actualFinishedAt: '2026-10-08T10:00:00+08:00', evidenceNote: '演练记录，尚需现场核对',
    }] });
    const base = { ...INITIAL_LAYOUT, id: 'rehearsal-activity', eventOperations: operations };
    const next = createVenueShape(base, 'rectangle');
    expect(next.id).toBe(base.id); expect(next.name).toBe(base.name);
    expect(next.eventOperations).toBe(operations);
    expect(next.eventOperations!.tasks[0]!.objectIds).toEqual(['removed-table']);
    expect(next.floors.flatMap(floor => floor.items)).toHaveLength(0);
  });
});
