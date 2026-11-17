// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveWalkerStep } from '../lib/walk-collision';
import { OUTDOOR_WALK_CANVAS_ID } from '../lib/walk-engage';
import { rigOffsetForYaw } from '../lib/walk-view-modes';
import {
  obstaclesToWalkColliders,
  pullWalkCamera,
  useOutdoorWalk,
  WALK_MIN_CAMERA_Y,
  walkCompassHeading,
  type UseOutdoorWalkOptions,
} from './use-outdoor-walk';

function pointerEvent(type: string, init: { pointerId: number; clientX: number; clientY: number; button?: number }) {
  const Ctor = (window as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent ?? MouseEvent;
  return new Ctor(type, { bubbles: true, cancelable: true, ...init } as PointerEventInit);
}

const SQUARE = [
  { x: -10, y: -10 },
  { x: 10, y: -10 },
  { x: 10, y: 10 },
  { x: -10, y: 10 },
];

function setup(enabled: boolean, onExit?: () => void) {
  const canvas = document.createElement('canvas');
  canvas.id = OUTDOOR_WALK_CANVAS_ID;
  document.body.appendChild(canvas);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);
  const requestPointerLock = vi.fn((): Promise<void> => Promise.reject(new Error('Write permission denied.')));
  Object.defineProperty(canvas, 'requestPointerLock', { configurable: true, value: requestPointerLock });
  const options: UseOutdoorWalkOptions = {
    enabled,
    canvas,
    cameraRef: { current: camera },
    orbitRef: { current: null },
    boundary: SQUARE,
    ...(onExit ? { onExit } : {}),
  };
  return { canvas, camera, options, requestPointerLock };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useOutdoorWalk pointer-lock fallback', () => {
  it('spawns at the selected character and faces its current heading', async () => {
    const { camera, options } = setup(true);
    renderHook(() => useOutdoorWalk({ ...options, spawn: { x: 3, z: -2, yaw: Math.PI / 2 } }));
    await waitFor(() => expect(camera.position.toArray()).toEqual([3, 1.6, -2]));
    const direction = camera.getWorldDirection(new THREE.Vector3());
    expect(direction.x).toBeCloseTo(1);
    expect(direction.z).toBeCloseTo(0);
  });

  it('starts walking when the outdoor canvas mounts after activation', async () => {
    const { canvas, camera, options } = setup(true);
    camera.position.y = 12;
    const initialProps: UseOutdoorWalkOptions = { ...options, canvas: null };
    const { rerender, result } = renderHook(useOutdoorWalk, { initialProps });
    expect(camera.position.y).toBe(12);

    rerender({ ...options, canvas });
    await waitFor(() => expect(camera.position.y).toBe(1.6));
    act(() => document.dispatchEvent(new Event('pointerlockerror')));
    expect(result.current.phase).toBe('drag');
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));
    await waitFor(() => expect(camera.position.z).toBeLessThan(0));
  });

  it('falls back to drag-look when the browser refuses pointer lock', async () => {
    const { options } = setup(true);
    const { result } = renderHook((props: { options: typeof options }) => useOutdoorWalk(props.options), {
      initialProps: { options },
    });
    await waitFor(() => expect(result.current.phase).toBe('drag'));
  });

  it('drags the view without requesting pointer lock', async () => {
    const { canvas, camera, options, requestPointerLock } = setup(true);
    const { result } = renderHook((props: { options: typeof options }) => useOutdoorWalk(props.options), {
      initialProps: { options },
    });
    await waitFor(() => expect(result.current.phase).toBe('drag'));
    const before = camera.quaternion.clone();
    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 }));
      canvas.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 160, clientY: 100, button: 0 }));
    });
    expect(camera.quaternion.equals(before)).toBe(false);
    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 160, clientY: 100, button: 0 }));
    });
    expect(requestPointerLock).not.toHaveBeenCalled();
  });

  it('does not retry a lock the browser already refused', async () => {
    const { canvas, options, requestPointerLock } = setup(true);
    const { result } = renderHook((props: { options: typeof options }) => useOutdoorWalk(props.options), {
      initialProps: { options },
    });
    await waitFor(() => expect(result.current.phase).toBe('drag'));
    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, clientX: 20, clientY: 20, button: 0 }));
      canvas.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 20, clientY: 20, button: 0 }));
    });
    expect(requestPointerLock).not.toHaveBeenCalled();
  });

  it('calls onExit on the second Escape once the lock is released', async () => {
    const onExit = vi.fn();
    const { options } = setup(true, onExit);
    renderHook((props: { options: typeof options }) => useOutdoorWalk(props.options), {
      initialProps: { options },
    });
    await waitFor(() => expect(onExit).not.toHaveBeenCalled());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('stays pending while disabled and does not touch the camera', () => {
    const { camera, options } = setup(false);
    const before = camera.position.clone();
    const { result } = renderHook((props: { options: typeof options }) => useOutdoorWalk(props.options), {
      initialProps: { options },
    });
    expect(result.current.phase).toBe('pending');
    expect(camera.position.equals(before)).toBe(true);
  });

  it('turns the view by the same radians per pixel as pointer lock', async () => {
    const { canvas, camera, options } = setup(true);
    renderHook((props: { options: typeof options }) => useOutdoorWalk(props.options), {
      initialProps: { options },
    });
    await waitFor(() => expect(camera.position.y).toBeCloseTo(1.6));
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    const beforeY = euler.y;
    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3, clientX: 0, clientY: 40, button: 0 }));
      canvas.dispatchEvent(pointerEvent('pointermove', { pointerId: 3, clientX: 100, clientY: 40, button: 0 }));
    });
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    const delta = Math.atan2(Math.sin(euler.y - beforeY), Math.cos(euler.y - beforeY));
    expect(delta).toBeCloseTo(-0.2, 5);
  });

  it('stops at a footprint instead of walking through it', async () => {
    const { camera, options } = setup(true);
    const blocked: UseOutdoorWalkOptions = {
      ...options,
      walkSpeed: 16,
      obstacles: [{ x: 0, y: 3, width: 8, depth: 1 }],
    };
    renderHook((props: { options: UseOutdoorWalkOptions }) => useOutdoorWalk(props.options), {
      initialProps: { options: blocked },
    });
    await waitFor(() => expect(camera.position.y).toBeCloseTo(1.6));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));
    await waitFor(() => expect(camera.position.z).toBeLessThan(-0.6));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 280)); });
    expect(camera.position.z).toBeGreaterThan(-2.45);
    expect(camera.position.z).toBeLessThan(-0.6);
  });

  it('keeps the third-person camera behind the current look', async () => {
    const { canvas, camera, options } = setup(true);
    renderHook((props: { options: UseOutdoorWalkOptions }) => useOutdoorWalk(props.options), {
      initialProps: { options: { ...options, viewMode: 'third' } },
    });
    await waitFor(() => expect(camera.position.z).toBeGreaterThan(3));
    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4, clientX: 10, clientY: 10, button: 0 }));
      canvas.dispatchEvent(pointerEvent('pointermove', { pointerId: 4, clientX: 110, clientY: 10, button: 0 }));
    });
    await waitFor(() => {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const yaw = Math.atan2(dir.x, dir.z);
      const rig = rigOffsetForYaw('third', yaw);
      expect(camera.position.x).toBeCloseTo(rig.x, 1);
      expect(camera.position.z).toBeCloseTo(rig.z, 1);
    });
  });

  it('pulls the third-person camera in before it enters a footprint', async () => {
    const { camera, options } = setup(true);
    renderHook((props: { options: UseOutdoorWalkOptions }) => useOutdoorWalk(props.options), {
      initialProps: {
        options: {
          ...options,
          viewMode: 'third',
          obstacles: [{ x: 0, y: -2, width: 8, depth: 1 }],
        },
      },
    });
    await waitFor(() => expect(camera.position.z).toBeGreaterThan(0.5));
    expect(camera.position.z).toBeLessThan(1.5);
  });

  it('restores the saved orbit pose and wins back enabled after a sibling clears it', async () => {
    const { camera, options } = setup(true);
    camera.position.set(5, 12, 7);
    camera.lookAt(4, 1, -3);
    const savedPos = camera.position.clone();
    const savedQuat = camera.quaternion.clone();
    const orbit = {
      enabled: true,
      target: new THREE.Vector3(4, 1, -3),
      _sphericalDelta: { set: vi.fn() },
      _panOffset: { set: vi.fn() },
      _scale: 3,
      update: vi.fn(),
    };
    options.orbitRef.current = orbit as unknown as UseOutdoorWalkOptions['orbitRef']['current'];
    const { rerender } = renderHook(
      (props: { enabled: boolean }) => {
        useOutdoorWalk({ ...options, enabled: props.enabled });
        useEffect(() => {
          if (!props.enabled) return undefined;
          return () => { orbit.enabled = false; };
        }, [props.enabled]);
      },
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(camera.position.y).toBeCloseTo(1.6));
    rerender({ enabled: false });
    await act(async () => { await Promise.resolve(); });
    expect(orbit.enabled).toBe(true);
    expect(camera.position.distanceTo(savedPos)).toBeLessThan(1e-5);
    expect(camera.quaternion.angleTo(savedQuat)).toBeLessThan(1e-5);
    expect(orbit.target.toArray()).toEqual([4, 1, -3]);
    expect(orbit._sphericalDelta.set).toHaveBeenCalledWith(0, 0, 0);
  });

  it('leaves the aerial camera up instead of dropping it to eye height', async () => {
    const { camera, options } = setup(true);
    camera.position.set(0, 36, 18);
    renderHook((props: { options: UseOutdoorWalkOptions }) => useOutdoorWalk(props.options), {
      initialProps: { options: { ...options, viewMode: 'orbit' } },
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
    expect(camera.position.y).toBe(36);
  });

  it('keeps a too-low eye height above the ground', async () => {
    const { camera, options } = setup(true);
    renderHook((props: { options: UseOutdoorWalkOptions }) => useOutdoorWalk(props.options), {
      initialProps: { options: { ...options, eyeHeight: 0.1 } },
    });
    await waitFor(() => expect(camera.position.y).toBeCloseTo(WALK_MIN_CAMERA_Y));
  });

  it('ignores movement keys while typing', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const { camera, options } = setup(true);
    renderHook((props: { options: typeof options }) => useOutdoorWalk(props.options), {
      initialProps: { options },
    });
    await waitFor(() => expect(camera.position.y).toBeCloseTo(1.6));
    const z = camera.position.z;
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
    expect(camera.position.z).toBeCloseTo(z, 2);
  });
});

describe('outdoor walk footprints and compass heading', () => {
  it('uses north as bearing 0', () => {
    expect(walkCompassHeading(0, -1)).toBeCloseTo(0);
    expect(walkCompassHeading(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(walkCompassHeading(0, 1)).toBeCloseTo(Math.PI);
  });

  it('blocks a step on the near face of an ENU footprint', () => {
    const colliders = obstaclesToWalkColliders([{ x: 0, y: 3, width: 8, depth: 1 }]);
    const out = { x: 0, z: 0 };
    resolveWalkerStep(colliders, { x: 0, z: 0 }, { x: 0, z: -10 }, 0.3, out);
    expect(out.z).toBeGreaterThan(-2.4);
    expect(out.z).toBeLessThan(-1.8);
  });

  it('treats a 90 degree footprint as a wall across east-west', () => {
    const colliders = obstaclesToWalkColliders([{ x: 2, y: 0, width: 4, depth: 0.2, rotationDeg: 90 }]);
    const out = { x: 0, z: 0 };
    resolveWalkerStep(colliders, { x: 0, z: 0 }, { x: 6, z: 0 }, 0.3, out);
    expect(out.x).toBeGreaterThan(1.4);
    expect(out.x).toBeLessThan(1.9);
  });

  it('pulls a camera back along the look line before the wall', () => {
    const colliders = obstaclesToWalkColliders([{ x: 0, y: -2, width: 8, depth: 1 }]);
    const pulled = pullWalkCamera(colliders, { x: 0, z: 0 }, { x: 0, z: 4 }, 0.25);
    expect(pulled.z).toBeGreaterThan(1);
    expect(pulled.z).toBeLessThan(1.5);
  });
});
