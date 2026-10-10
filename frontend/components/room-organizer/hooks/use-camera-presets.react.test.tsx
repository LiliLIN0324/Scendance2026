// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIEWPORT_PADDING } from '../lib/camera-framing';
import { useCameraPresets } from './use-camera-presets';

const activeControls: OrbitControls[] = [];
afterEach(() => {
  cleanup();
  for (const controls of activeControls.splice(0)) controls.dispose();
});

function setup(width = 1280, height = 600) {
  const viewport = { width, height };
  const canvas = document.createElement('canvas');
  Object.defineProperties(canvas, {
    clientWidth: { get: () => viewport.width },
    clientHeight: { get: () => viewport.height },
  });
  const camera = new THREE.PerspectiveCamera(75, width / height, 0.3, 25);
  camera.position.set(20, 20, 20);
  const controls = new OrbitControls(camera, canvas);
  activeControls.push(controls);
  controls.maxPolarAngle = Math.PI / 2.5;
  controls.enableDamping = true;
  controls.target.set(0, 4.5, 0);
  controls.update();
  const invalidate = vi.fn();
  const cameraRef = { current: camera };
  const controlsRef = { current: controls };
  const canvasRef = { current: canvas };
  const { result } = renderHook(() => useCameraPresets({
    cameraRef, controlsRef, canvasRef, roomSize: 18, roomWidth: 18, roomDepth: 9,
    buildingHeight: 9, viewportPadding: DEFAULT_VIEWPORT_PADDING, invalidate,
  }));
  function resize(nextWidth: number, nextHeight: number): void {
    viewport.width = nextWidth;
    viewport.height = nextHeight;
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
  }
  return { result, camera, controls, viewport, invalidate, resize };
}

function expectWholeRoomVisible(camera: THREE.PerspectiveCamera, viewport: { width: number; height: number }): void {
  camera.updateMatrixWorld(true);
  for (const x of [-9, 9]) {
    for (const y of [0, 9]) {
      for (const z of [-4.5, 4.5]) {
        const point = new THREE.Vector3(x, y, z).project(camera);
        const pixelX = (point.x + 1) * viewport.width / 2;
        const pixelY = (1 - point.y) * viewport.height / 2;
        expect(pixelX).toBeGreaterThanOrEqual(16 - 1e-5);
        expect(pixelX).toBeLessThanOrEqual(viewport.width - 16 + 1e-5);
        expect(pixelY).toBeGreaterThanOrEqual(44 - 1e-5);
        expect(pixelY).toBeLessThanOrEqual(viewport.height - 16 + 1e-5);
        expect(point.z).toBeGreaterThanOrEqual(-1 - 1e-5);
        expect(point.z).toBeLessThanOrEqual(1 + 1e-5);
      }
    }
  }
}

describe('camera presets with the real orbit controller', () => {
  it.each(['iso', 'top', 'front', 'corner'] as const)('frames %s after polar and maximum-distance limits have applied', preset => {
    const state = setup(227, 600);
    state.controls.maxDistance = 5;
    act(() => state.result.current.applyPreset(preset));
    expectWholeRoomVisible(state.camera, state.viewport);
    expect(state.controls.maxDistance).toBeGreaterThan(5);
    const target = state.controls.target.clone();
    state.controls.update();
    expectWholeRoomVisible(state.camera, state.viewport);
    expect(state.controls.target.equals(target)).toBe(true);
  });

  it('fits the full stacked room in a short canvas and respects the orbit minimum', () => {
    const state = setup(1100, 140);
    state.controls.minDistance = 80;
    state.controls.maxDistance = 90;
    act(() => state.result.current.fitToRoom());
    expect(state.controls.target.toArray()).toEqual([0, 4.5, 0]);
    expect(state.camera.position.distanceTo(state.controls.target)).toBeGreaterThanOrEqual(80);
    expectWholeRoomVisible(state.camera, state.viewport);
    state.controls.update();
    expectWholeRoomVisible(state.camera, state.viewport);
    expect(Number.isFinite(state.camera.far)).toBe(true);
    expect(Number.isFinite(state.controls.maxDistance)).toBe(true);
  });

  it('only dollies out after resize, preserving the current yaw and panned target', () => {
    const state = setup();
    state.controls.target.set(4, 6, 5);
    state.camera.position.set(-3, 13, 19);
    state.controls.update();
    const orientation = state.camera.quaternion.clone();
    const target = state.controls.target.clone();
    const position = state.camera.position.clone();
    state.resize(227, 600);
    const update = vi.spyOn(state.controls, 'update');
    act(() => state.result.current.ensureRoomInView());
    expect(update).not.toHaveBeenCalled();
    expect(state.camera.quaternion.equals(orientation)).toBe(true);
    expect(state.controls.target.equals(target)).toBe(true);
    expect(state.camera.position.distanceTo(target)).toBeGreaterThan(position.distanceTo(target));
    expectWholeRoomVisible(state.camera, state.viewport);
    state.controls.update();
    expectWholeRoomVisible(state.camera, state.viewport);
  });

  it('leaves an enlarged viewport and already visible camera unchanged', () => {
    const state = setup(227, 600);
    act(() => state.result.current.fitToRoom());
    const position = state.camera.position.clone();
    const orientation = state.camera.quaternion.clone();
    const target = state.controls.target.clone();
    state.invalidate.mockClear();
    state.resize(1280, 720);
    act(() => state.result.current.ensureRoomInView());
    expect(state.camera.position.equals(position)).toBe(true);
    expect(state.camera.quaternion.equals(orientation)).toBe(true);
    expect(state.controls.target.equals(target)).toBe(true);
    expect(state.invalidate).not.toHaveBeenCalled();
    expectWholeRoomVisible(state.camera, state.viewport);
  });

  it('keeps explicit upper-floor focus through resize until fit is requested', () => {
    const state = setup();
    act(() => state.result.current.focusOn({ x: 4, z: -2 }, 3, 6));
    expect(state.controls.target.toArray()).toEqual([4, 6, -2]);
    const position = state.camera.position.clone();
    const orientation = state.camera.quaternion.clone();
    state.resize(227, 600);
    act(() => state.result.current.ensureRoomInView());
    expect(state.camera.position.equals(position)).toBe(true);
    expect(state.camera.quaternion.equals(orientation)).toBe(true);
    expect(state.controls.target.toArray()).toEqual([4, 6, -2]);
    act(() => state.result.current.fitToRoom());
    expect(state.controls.target.toArray()).toEqual([0, 4.5, 0]);
    expectWholeRoomVisible(state.camera, state.viewport);
    state.resize(1280, 140);
    act(() => state.result.current.ensureRoomInView());
    expectWholeRoomVisible(state.camera, state.viewport);
  });

  it('restores full-room resize framing when a preset follows explicit focus', () => {
    const state = setup();
    act(() => state.result.current.focusOn({ x: 4, z: -2 }));
    act(() => state.result.current.applyPreset('iso'));
    state.resize(227, 600);
    act(() => state.result.current.ensureRoomInView());
    expectWholeRoomVisible(state.camera, state.viewport);
  });

  it('ignores a hidden canvas without corrupting the current pose', () => {
    const state = setup();
    const position = state.camera.position.clone();
    const orientation = state.camera.quaternion.clone();
    state.resize(0, 0);
    act(() => state.result.current.ensureRoomInView());
    expect(state.camera.position.equals(position)).toBe(true);
    expect(state.camera.quaternion.equals(orientation)).toBe(true);
    expect(Number.isFinite(state.camera.far)).toBe(true);
  });
});
