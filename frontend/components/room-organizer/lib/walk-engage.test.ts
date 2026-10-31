/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WALK_CANVAS_ID, adoptWalkPointerLock, requestWalkPointerLock, walkPointerLocked } from './walk-engage';

afterEach(() => {
  document.getElementById(WALK_CANVAS_ID)?.remove();
});

describe('requestWalkPointerLock', () => {
  it('asks the 3D canvas for pointer lock from the same click that arms walk', () => {
    const canvas = document.createElement('canvas');
    canvas.id = WALK_CANVAS_ID;
    const request = vi.fn(() => Promise.resolve());
    canvas.requestPointerLock = request as HTMLCanvasElement['requestPointerLock'];
    document.body.appendChild(canvas);
    expect(requestWalkPointerLock()).toBe('requested');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual([]);
  });

  it('does not ask again when the canvas is already locked', () => {
    const canvas = document.createElement('canvas');
    canvas.id = WALK_CANVAS_ID;
    const request = vi.fn();
    canvas.requestPointerLock = request as HTMLCanvasElement['requestPointerLock'];
    document.body.appendChild(canvas);
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    expect(requestWalkPointerLock()).toBe('locked');
    expect(request).not.toHaveBeenCalled();
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
  });

  it('reports a missing canvas and a thrown lock request without throwing', () => {
    expect(requestWalkPointerLock()).toBe('missing');
    const canvas = document.createElement('canvas');
    canvas.id = WALK_CANVAS_ID;
    canvas.requestPointerLock = (() => { throw new Error('no gesture'); }) as HTMLCanvasElement['requestPointerLock'];
    document.body.appendChild(canvas);
    expect(requestWalkPointerLock()).toBe('refused');
  });
});

describe('adoptWalkPointerLock', () => {
  it('marks controls locked when the button already captured the pointer', () => {
    const canvas = document.createElement('canvas');
    canvas.id = WALK_CANVAS_ID;
    document.body.appendChild(canvas);
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    const controls = { isLocked: false };
    expect(adoptWalkPointerLock(controls, canvas)).toBe(true);
    expect(controls.isLocked).toBe(true);
    expect(walkPointerLocked(canvas)).toBe(true);
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
    expect(adoptWalkPointerLock(controls, canvas)).toBe(false);
    expect(controls.isLocked).toBe(false);
  });
});
