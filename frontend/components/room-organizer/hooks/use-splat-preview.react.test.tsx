// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import * as THREE from 'three';
const mock = vi.hoisted(() => ({ controllers: [] as any[] }));
vi.mock('../three/splat-preview', () => ({
  paintSplatLayers: vi.fn(),
  createSplatPreview: () => {
    const controller = {
      shownId: '', worldBounds: null, renderScene: null,
      start: vi.fn(async () => ({ meters: { width: 4, depth: 3, height: 1 }, splats: 10 })),
      setScale: vi.fn((scale: number) => ({ meters: { width: 4 * scale, depth: 3 * scale, height: scale }, walkBounds: null })),
      setPosition: vi.fn(), setRoofCutoff: vi.fn(), setVisible: vi.fn(), setDisplayMode: vi.fn(),
      setTransformMode: vi.fn(), dispose: vi.fn(), stop: vi.fn(), restoreView: vi.fn(),
    };
    mock.controllers.push(controller);
    return controller;
  },
}));
import { useSplatPreview } from './use-splat-preview';
let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
});
afterEach(() => { mem?.clear(); cleanup(); mock.controllers.length = 0; vi.unstubAllGlobals(); });
const source = (assetId: string) => ({ assetId, name: assetId, url: `/${assetId}.spz` });
function setup() {
  const deps = {
    isReady: true, rendererRef: { current: { domElement: document.createElement('canvas') } as unknown as THREE.WebGLRenderer },
    cameraRef: { current: new THREE.PerspectiveCamera() },
    controlsRef: { current: { target: new THREE.Vector3(), enabled: true, update: vi.fn() } },
    invalidate: vi.fn(), requestShadowUpdate: vi.fn(), sizeMeters: 20, roofCutoffY: 10000,
    position: { x: 0, y: 0, z: 0 }, transformMode: 'off' as const,
    onPositionChange: vi.fn(),
  };
  return deps;
}
it('loads the other placed venue alongside the selected venue and keeps its own scale', async () => {
  const deps = setup();
  const other = { id: 'b', source: source('b'), position: { x: 30, y: 0, z: 0 }, scale: 3, floorIndex: 0, roofCutoffY: 10000 };
  const { result, rerender } = renderHook(({ scale }) => useSplatPreview({ ...deps, placementScale: scale, otherScenes: [other] }), { initialProps: { scale: 2 } });
  await act(() => result.current.start(source('a')));
  const b = mock.controllers.find(c => c.start.mock.calls[0]?.[0].assetId === 'b');
  const a = mock.controllers.find(c => c.start.mock.calls[0]?.[0].assetId === 'a');
  expect(a.start).toHaveBeenCalledWith(source('a'), expect.objectContaining({ placementScale: 2 }));
  expect(b.start).toHaveBeenCalledWith(source('b'), expect.objectContaining({ placementScale: 3, position: other.position }));
  rerender({ scale: 5 });
  await waitFor(() => expect(result.current.state.meters?.width).toBe(20));
  expect(b.dispose).not.toHaveBeenCalled();
  expect(b.setScale).toHaveBeenLastCalledWith(3);
});
