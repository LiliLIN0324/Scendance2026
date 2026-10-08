// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render2DTopDown } from '../canvas-2d/render';
import { makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { buildEntrance } from '../three/entrance';
import { mountReferenceImage, useSceneEffects, type UseSceneEffectsParams } from './use-scene-effects';

vi.mock('../canvas-2d/render', async importOriginal => ({
  ...await importOriginal<typeof import('../canvas-2d/render')>(), render2DTopDown: vi.fn(),
}));
vi.mock('../three/lighting', () => ({ applyTimeOfDay: vi.fn() }));
vi.mock('../three/entrance', async importOriginal => {
  const actual = await importOriginal<typeof import('../three/entrance')>();
  return { ...actual, buildEntrance: vi.fn(actual.buildEntrance) };
});

function params(): UseSceneEffectsParams {
  const layout = makeLayout({ id: 'reference-test', roof: { style: 'none' } });
  return { isReady: false, invalidate: vi.fn(), requestShadowUpdate: vi.fn(),
    threeModuleRef: { current: THREE }, sceneRef: { current: new THREE.Scene() }, rendererRef: { current: null },
    cameraRef: { current: null }, controlsRef: { current: null }, canvas2DRef: { current: null },
    layout, activeFloor: layout.floors[0], activeFloorIndex: 0,
    view: makeViewSettings({ showOutdoor: false }), selectedItemId: null,
    extraSelectedIds: new Set(), highlightedIds: new Set(), selectedWall: null,
    wallDraft: null, wallSnapResult: null, measurementPoints: [] };
}

describe('main canvas reference effects', () => {
  let loads: Array<{ texture: THREE.Texture<HTMLImageElement>; onLoad: ((texture: THREE.Texture<HTMLImageElement>) => void) | undefined }>;
  beforeEach(() => {
    loads = [];
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
      const texture = new THREE.Texture<HTMLImageElement>(); loads.push({ texture, onLoad }); return texture;
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('maps all four pixel corners into centred 3D space, including skew, without picking', () => {
    const scene = new THREE.Scene();
    const dispose = mountReferenceImage(THREE, scene, { url: 'blob:affine', pixelWidth: 100, pixelHeight: 50,
      imageToWorld: [0.05, 0.01, -0.02, 0.08, 2, 1] }, 10, 8, 0.4, vi.fn());
    expect(scene.children).toHaveLength(0);
    loads[0].onLoad?.(loads[0].texture);
    const mesh = scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const position = mesh.geometry.getAttribute('position');
    expect([position.getX(0), position.getZ(0)]).toEqual([-3, -3]);
    expect([position.getX(1), position.getZ(1)]).toEqual([2, -2]);
    expect([position.getX(2), position.getZ(2)]).toEqual([1, 2]);
    expect([position.getX(3), position.getZ(3)]).toEqual([-4, 1]);
    expect(position.getY(0)).toBeCloseTo(0.002);
    expect(mesh.userData.type).toBe('reference-image');
    expect(mesh.material.opacity).toBe(0.4); expect(mesh.material.depthWrite).toBe(false);
    const hits: THREE.Intersection[] = []; mesh.raycast(new THREE.Raycaster(), hits); expect(hits).toEqual([]);
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose'), materialDispose = vi.spyOn(mesh.material, 'dispose');
    const textureDispose = vi.spyOn(loads[0].texture, 'dispose');
    dispose(); expect(scene.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledOnce(); expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });

  it('never attaches a late texture after cleanup or a scene change', () => {
    const scene = new THREE.Scene(); let current = true;
    const image = { url: 'blob:late', pixelWidth: 10, pixelHeight: 10, imageToWorld: [1, 0, 0, 1, 0, 0] as const };
    const first = mountReferenceImage(THREE, scene, image, 10, 10, 0.5, vi.fn());
    first(); loads[0].onLoad?.(loads[0].texture); expect(scene.children).toHaveLength(0);
    const second = mountReferenceImage(THREE, scene, image, 10, 10, 0.5, vi.fn(), () => current);
    current = false; loads[1].onLoad?.(loads[1].texture); expect(scene.children).toHaveLength(0); second();
  });

  it('ordinary 2D repaint forwards reference visibility, opacity and mapping', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {} }));
    const input = params(), canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 600 });
    input.canvas2DRef = { current: canvas };
    input.view = { ...input.view, view2D: true, showReferenceImage: false, referenceImageOpacity: 0.3 };
    input.referenceImage = { url: 'blob:ordinary', pixelWidth: 10, pixelHeight: 10, imageToWorld: [1, 0, 0, 1, 0, 0] };
    renderHook(() => useSceneEffects(input));
    expect(vi.mocked(render2DTopDown).mock.lastCall?.[0]).toMatchObject({
      referenceImage: input.referenceImage, showFloorPlan: false, floorPlanOpacity: 0.3,
    });
  });

  it('keeps a texture through furniture edits and same-value resolver objects, but replaces it with the scene', () => {
    const input = params(); input.isReady = true;
    const image = { url: 'blob:stable', pixelWidth: 100, pixelHeight: 50,
      imageToWorld: [0.08, 0, 0, 0.16, 0, 0] as const };
    const { rerender } = renderHook(({ referenceImage, layout }) => useSceneEffects({
      ...input, layout, activeFloor: layout.floors[0], referenceImage,
    }), { initialProps: { referenceImage: image, layout: input.layout } });
    expect(loads).toHaveLength(1);
    const layout = { ...input.layout, floors: [{ ...input.activeFloor, items: [makeItem({ position: { x: 1, z: 0 } })] }] };
    rerender({ referenceImage: { ...image, imageToWorld: [...image.imageToWorld] }, layout });
    expect(loads).toHaveLength(1);
    const old = input.sceneRef.current!;
    input.sceneRef.current = new THREE.Scene();
    rerender({ referenceImage: image, layout });
    expect(loads).toHaveLength(2);
    loads[0].onLoad?.(loads[0].texture);
    expect(old.children.some(child => child.userData.type === 'reference-image')).toBe(false);
    loads[1].onLoad?.(loads[1].texture);
    expect(input.sceneRef.current.children.some(child => child.userData.type === 'reference-image')).toBe(true);
  });

  it('legacy visibility preserves wall, foundation and entrance generation decisions', () => {
    const input = params(); input.isReady = true;
    input.layout = { ...input.layout, floorPlanImage: 'data:image/png;base64,legacy', entrance: { width: 1.4, depth: 1.2, offset: 1 } };
    const { rerender } = renderHook(({ view }) => useSceneEffects({ ...input, view }), { initialProps: { view: input.view } });
    const count = () => input.sceneRef.current!.children.filter(child => child.userData.type === 'floor' || child.userData.type === 'wall').map(child => child.userData.type);
    const shown = count(); expect(vi.mocked(buildEntrance)).not.toHaveBeenCalled();
    rerender({ view: { ...input.view, showReferenceImage: false } });
    expect(count()).toEqual(shown); expect(shown).toEqual(['floor']);
    expect(vi.mocked(buildEntrance)).not.toHaveBeenCalled();
    expect(input.layout.floorPlanImage).toBe('data:image/png;base64,legacy');
    // A genuinely removed image takes the original build path. This proves the
    // fixture has a usable entrance, rather than both visibility cases skipping it by accident.
    input.layout = { ...input.layout };
    delete input.layout.floorPlanImage;
    rerender({ view: { ...input.view, showReferenceImage: false } });
    expect(vi.mocked(buildEntrance)).toHaveBeenCalledOnce();
    expect(count().length).toBeGreaterThan(shown.length);
  });
});
