import { describe, expect, it } from 'vitest';
import { backendSceneToLayout, layoutToBackendScene } from './backend-adapter';
import { assertNoLocalHandoffCloudTransition, hasLocalHandoff, LOCAL_HANDOFF_CLOUD_MESSAGE } from './handoff-cloud-guard';

const scene = { schemaVersion: 1 as const, venue: { width: 12, depth: 10, height: 3, shape: 'rectangle' as const, entrances: [] }, objects: [], camera: 'overview' as const, lighting: 'neutral' as const };
const emptyOperations = { schemaVersion: 1 as const, dataKind: 'unspecified' as const, tasks: [] };

describe('local execution cloud boundary', () => {
  it('protects an empty activity document without changing general scene conversion', () => {
    const layout = { ...backendSceneToLayout(scene), eventOperations: emptyOperations };
    expect(hasLocalHandoff(layout)).toBe(true);
    expect(() => assertNoLocalHandoffCloudTransition(layout)).toThrow(LOCAL_HANDOFF_CLOUD_MESSAGE);
    expect(layoutToBackendScene(layout)).toEqual(scene);
  });

  it('protects activity documents in nested design snapshots', () => {
    const leaf = { ...backendSceneToLayout(scene), eventOperations: emptyOperations };
    const nested = { ...backendSceneToLayout(scene), designBook: { activeId: 'leaf', variants: [{ id: 'leaf', name: '子方案', layout: leaf }] } };
    const layout = { ...backendSceneToLayout(scene), designBook: { activeId: 'nested', variants: [{ id: 'nested', name: '方案', layout: nested }] } };
    expect(() => assertNoLocalHandoffCloudTransition(layout)).toThrow(LOCAL_HANDOFF_CLOUD_MESSAGE);
    expect(leaf.eventOperations).toBe(emptyOperations);
  });

  it('allows old drafts with no execution information', () => {
    const layout = backendSceneToLayout(scene);
    expect(hasLocalHandoff(layout)).toBe(false);
    expect(() => assertNoLocalHandoffCloudTransition(layout)).not.toThrow();
  });
});
