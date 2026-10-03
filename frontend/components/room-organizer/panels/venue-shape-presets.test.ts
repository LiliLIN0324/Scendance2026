import { describe, it, expect } from 'vitest';
import { sceneSchema, sceneWarnings } from '../../../../supabase/functions/_shared/domain';
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
});
