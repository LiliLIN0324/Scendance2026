/**
 * First-person walk has to call `requestPointerLock` inside the button's click.
 * The walk hook attaches PointerLockControls a render later; by then the user
 * gesture is gone and the browser refuses the lock (the old "click the canvas
 * again" dead end).
 */
export const WALK_CANVAS_ID = 'sc-viewport-3d';

export type WalkLockRequest = 'locked' | 'requested' | 'missing' | 'refused';

export function requestWalkPointerLock(doc: Document = document): WalkLockRequest {
  const canvas = doc.getElementById(WALK_CANVAS_ID);
  if (!(canvas instanceof HTMLCanvasElement)) return 'missing';
  if (canvas.ownerDocument.pointerLockElement === canvas) return 'locked';
  try {
    // No options object: three's PointerLockControls.lock() passes
    // `{ unadjustedMovement }`, which throws in browsers that only accept
    // the no-arg form. A refused lock rejects the promise; the hook hears
    // `pointerlockerror` too.
    const pending = canvas.requestPointerLock();
    if (pending && typeof (pending as Promise<unknown>).catch === 'function') {
      void (pending as Promise<unknown>).catch(() => undefined);
    }
    return 'requested';
  } catch {
    return 'refused';
  }
}

export function walkPointerLocked(canvas: HTMLCanvasElement | null): boolean {
  return !!canvas && canvas.ownerDocument.pointerLockElement === canvas;
}

/**
 * PointerLockControls only flips `isLocked` inside its own `pointerlockchange`
 * listener. A lock requested by the rail button can land before that listener
 * exists; without this, WASD and mouse-look stay dead while the cursor is
 * already captured.
 */
export function adoptWalkPointerLock(controls: { isLocked: boolean }, canvas: HTMLCanvasElement): boolean {
  const locked = walkPointerLocked(canvas);
  controls.isLocked = locked;
  return locked;
}
