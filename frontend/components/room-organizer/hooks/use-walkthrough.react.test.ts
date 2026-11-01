// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWalkthrough } from './use-walkthrough';

// jsdom has no PointerEvent constructor in every version we test on; the hook
// only reads pointerId / button / clientX / clientY, all present on MouseEvent.
function pointerEvent(type: string, init: { pointerId: number; clientX: number; clientY: number; button?: number }) {
  const Ctor = (window as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent ?? MouseEvent;
  return new Ctor(type, { bubbles: true, cancelable: true, ...init } as PointerEventInit);
}

function setup() {
  const canvas = document.createElement('canvas');
  canvas.id = 'sc-viewport-3d';
  document.body.appendChild(canvas);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 3);
  camera.lookAt(0, 1.6, 0);
  const requestPointerLock = vi.fn((): Promise<void> => Promise.reject(new Error('Write permission denied.')));
  Object.defineProperty(canvas, 'requestPointerLock', { configurable: true, value: requestPointerLock });
  const invalidate = vi.fn();
  const options = {
    enabled: true,
    canvasRef: { current: canvas },
    threeModuleRef: { current: THREE as unknown as typeof import('three') },
    cameraRef: { current: camera },
    orbitRef: { current: null },
    invalidate,
  };
  return { canvas, camera, invalidate, options, requestPointerLock };
}

function mount(options: ReturnType<typeof setup>['options']) {
  return renderHook((props: { options: typeof options }) => useWalkthrough(props.options), {
    initialProps: { options },
  });
}

// The hook adopts PointerLockControls on a dynamic import, so its listeners
// land a microtask later; wait for the fallback to be wired before poking it.
async function refusePointerLock(canvas: HTMLCanvasElement, phase: () => string) {
  await waitFor(() => expect(phase()).toBe('pending'));
  act(() => {
    canvas.ownerDocument.dispatchEvent(new Event('pointerlockerror'));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useWalkthrough pointer-lock fallback', () => {
  it('keeps walking with drag-look when the browser refuses pointer lock', async () => {
    const { canvas, options } = setup();
    const { result } = mount(options);

    await refusePointerLock(canvas, () => result.current.phase);
    // Not "needs-click" (dead end) and not stuck on "正在进入": the walk runs
    // with the cursor visible.
    expect(result.current.phase).toBe('drag');
  });

  it('drags the view without requesting pointer lock', async () => {
    const { canvas, camera, options, requestPointerLock } = setup();
    const { result } = mount(options);
    await refusePointerLock(canvas, () => result.current.phase);
    const before = camera.quaternion.clone();

    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 }));
      canvas.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 160, clientY: 100, button: 0 }));
    });
    expect(camera.quaternion.equals(before)).toBe(false);

    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 160, clientY: 100, button: 0 }));
    });
    // The release of a drag must not be mistaken for a click that retries the lock.
    expect(requestPointerLock).not.toHaveBeenCalled();
  });

  it('does not retry a lock the browser already refused', async () => {
    const { canvas, options, requestPointerLock } = setup();
    const { result } = mount(options);
    await refusePointerLock(canvas, () => result.current.phase);

    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, clientX: 20, clientY: 20, button: 0 }));
      canvas.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 20, clientY: 20, button: 0 }));
    });
    // Retrying only logs pointerlockerror in an environment that refuses it.
    expect(requestPointerLock).not.toHaveBeenCalled();
  });

  it('retries the lock with a click after a working lock was released', async () => {
    const { canvas, options, requestPointerLock } = setup();
    const { result } = mount(options);
    await waitFor(() => expect(result.current.phase).toBe('pending'));

    const lockTo = (element: Element | null) => {
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => element });
      act(() => {
        document.dispatchEvent(new Event('pointerlockchange'));
      });
    };
    lockTo(canvas);
    expect(result.current.phase).toBe('locked');

    // Esc releases the capture; the walk keeps running with drag-look.
    lockTo(null);
    expect(result.current.phase).toBe('unlocked');

    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, clientX: 20, clientY: 20, button: 0 }));
      canvas.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 20, clientY: 20, button: 0 }));
    });
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
    delete (document as unknown as { pointerLockElement?: unknown }).pointerLockElement;
  });

  it('offers the click fallback even when the lock request never answers', async () => {
    vi.useFakeTimers();
    try {
      const { canvas, options } = setup();
      const { result } = mount(options);
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(result.current.phase).toBe('drag');
      expect(canvas.id).toBe('sc-viewport-3d');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to drag when an active lock is released (Esc)', async () => {
    const { canvas, options } = setup();
    const { result } = mount(options);
    await waitFor(() => expect(result.current.phase).toBe('pending'));

    const lockTo = (element: Element | null) => {
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => element });
      act(() => {
        document.dispatchEvent(new Event('pointerlockchange'));
      });
    };
    lockTo(canvas);
    expect(result.current.phase).toBe('locked');

    // The browser reserves Esc and releases the capture; the mode must stay
    // usable (drag-look) instead of freezing on a "click again" dead end.
    lockTo(null);
    expect(result.current.phase).toBe('unlocked');
    delete (document as unknown as { pointerLockElement?: unknown }).pointerLockElement;
  });
});