/**
 * First-person walk has to call `requestPointerLock` inside the button's click.
 * The walk hook attaches PointerLockControls a render later; by then the user
 * gesture is gone and the browser refuses the lock (the old "click the canvas
 * again" dead end).
 */
export const WALK_CANVAS_ID = 'sc-viewport-3d';
/** 户外 3D 接管组件的画布 id：户外第一人称漫游（一期）在这个画布上抢指针锁。 */
export const OUTDOOR_WALK_CANVAS_ID = 'sc-outdoor-viewport-3d';

export type WalkLockRequest = 'locked' | 'requested' | 'missing' | 'refused';

function requestLockOnCanvas(canvas: HTMLElement | null, doc: Document): WalkLockRequest {
  if (!(canvas instanceof HTMLCanvasElement)) return 'missing';
  if (doc.pointerLockElement === canvas) return 'locked';
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

export function requestWalkPointerLock(doc: Document = document): WalkLockRequest {
  const canvas = doc.getElementById(WALK_CANVAS_ID);
  return requestLockOnCanvas(canvas, doc);
}

/**
 * 户外漫游入口：和室内同一条手势规则——必须在右轨按钮的点击回调里同步发起，
 * 晚一个 render 用户手势就没了，浏览器会拒绝指针锁。
 */
export function requestOutdoorWalkPointerLock(doc: Document = document): WalkLockRequest {
  const canvas = doc.getElementById(OUTDOOR_WALK_CANVAS_ID);
  return requestLockOnCanvas(canvas, doc);
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
