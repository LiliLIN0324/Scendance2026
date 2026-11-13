// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUTDOOR_WALK_CANVAS_ID } from '../lib/walk-engage';
import { useOutdoorWalk } from './use-outdoor-walk';

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
  const options = {
    enabled,
    canvasRef: { current: canvas },
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
  it('falls back to drag-look when the browser refuses pointer lock', async () => {
    const { options } = setup(true);
    const { result } = renderHook((props: { options: typeof options }) => useOutdoorWalk(props.options), {
      initialProps: { options },
    });
    await waitFor(() => expect(result.current.phase).toBe('drag'));
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
});
