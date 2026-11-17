// @vitest-environment jsdom
import { act, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { OutdoorPlan3DApi } from './outdoor-plan-3d';
import type { OutdoorPlanOverlayHandle } from './outdoor-plan-overlay';
import { GmCompassHost, gmCompassHostRenders } from './gm-compass-host';
import { gmRoseArtRenders } from './gm-compass';
import { bearingAfterOrbit, roseRotationDeg } from '../lib/gm-compass-bearing';

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let slot: HTMLDivElement | undefined;
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  slot?.remove();
  frames.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function installFrames(): void {
  frames.clear();
  nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
}

function flushOldest(now: number): void {
  const id = Math.min(...frames.keys());
  const callback = frames.get(id);
  if (!callback) throw new Error('no frame');
  frames.delete(id);
  act(() => { callback(now); });
}

function planApi(getBearing: () => number, orbitByDelta = vi.fn(), resetNorth = vi.fn()): OutdoorPlan3DApi {
  return {
    zoomBy: vi.fn(),
    focusLngLat: vi.fn(),
    resetNorth,
    getBearing,
    orbitByDelta,
    captureImage: () => null,
  };
}

function renderHost(mode: '2d' | '3d', plan3dRef: RefObject<OutdoorPlan3DApi | null>, overlayRef: RefObject<OutdoorPlanOverlayHandle | null>): void {
  slot = document.createElement('div');
  slot.className = 'oc-gm-compass-wrap';
  const native = document.createElement('button');
  native.id = 'tool-compass';
  slot.append(native);
  document.body.append(slot);
  mount = document.createElement('div');
  document.body.append(mount);
  root = createRoot(mount);
  act(() => {
    root!.render(<GmCompassHost active mode={mode} plan3dRef={plan3dRef} overlayRef={overlayRef} />);
  });
}

function spin(): HTMLElement {
  const found = document.querySelector('[data-testid="gm-rose-spin"]');
  if (!found) throw new Error('missing rose');
  return found as HTMLElement;
}

it('samples bearing on the 90ms cadence and ignores sub-threshold noise', () => {
  installFrames();
  let camera = 0;
  const plan3dRef = { current: planApi(() => camera) };
  const overlayRef = { current: null };
  renderHost('3d', plan3dRef, overlayRef);
  const native = slot!.querySelector('#tool-compass') as HTMLButtonElement;
  expect(slot!.classList.contains('is-gm-rose')).toBe(true);
  expect(native.getAttribute('aria-hidden')).toBe('true');
  expect(native.tabIndex).toBe(-1);

  flushOldest(0);
  expect(spin().style.transform).toBe('rotate(0deg)');
  camera = 0.001;
  flushOldest(50);
  expect(spin().style.transform).toBe('rotate(0deg)');
  flushOldest(90);
  expect(spin().style.transform).toBe('rotate(0deg)');
  camera = Math.PI / 2;
  flushOldest(100);
  expect(spin().style.transform).toBe('rotate(0deg)');
  flushOldest(180);
  expect(spin().style.transform).toBe('rotate(-90deg)');
});

it('reads the 2D bearing from the plan overlay', () => {
  installFrames();
  const plan3dRef = { current: planApi(() => 0) };
  const overlayRef = {
    current: { getBearing: () => 0.5 } as OutdoorPlanOverlayHandle,
  };
  renderHost('2d', plan3dRef, overlayRef);
  flushOldest(0);
  expect(spin().style.transform).toBe(`rotate(${roseRotationDeg(0.5)}deg)`);
});

it('applies every drag delta immediately and publishes the rose once per frame', () => {
  installFrames();
  let camera = 0;
  const orbitByDelta = vi.fn((delta: number) => {
    camera -= delta;
  });
  const plan3dRef = { current: planApi(() => camera, orbitByDelta) };
  const overlayRef = { current: null };
  renderHost('3d', plan3dRef, overlayRef);
  flushOldest(0);
  const paints = gmRoseArtRenders.count;
  const face = document.querySelector('[aria-label="回正北"]') as HTMLButtonElement;
  face.setPointerCapture = vi.fn();
  face.releasePointerCapture = vi.fn();
  const point = (type: string, x: number, y: number) => {
    act(() => {
      face.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true }));
    });
  };
  point('pointerdown', 80, 0);
  point('pointermove', 0, 80);
  point('pointermove', -80, 0);
  point('pointermove', 0, -80);
  expect(orbitByDelta).toHaveBeenCalledTimes(3);
  expect(spin().style.transform).toBe('rotate(0deg)');
  expect(gmRoseArtRenders.count).toBe(paints);
  const queued = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of queued) callback(16);
  });
  expect(spin().style.transform).toBe(`rotate(${roseRotationDeg(camera)}deg)`);
  expect(gmRoseArtRenders.count).toBe(paints);
});

it('turns immediately from the arrow and does not follow unrelated parent renders', () => {
  installFrames();
  const orbitByDelta = vi.fn();
  const plan3dRef = { current: planApi(() => 0, orbitByDelta) };
  const overlayRef = { current: null };
  function Harness(): JSX.Element {
    const [n, setN] = useState(0);
    return (
      <>
        <button type="button" data-testid="bump" onClick={() => setN(value => value + 1)}>{n}</button>
        <GmCompassHost active mode="3d" plan3dRef={plan3dRef} overlayRef={overlayRef} />
      </>
    );
  }
  slot = document.createElement('div');
  slot.className = 'oc-gm-compass-wrap';
  document.body.append(slot);
  mount = document.createElement('div');
  document.body.append(mount);
  root = createRoot(mount);
  act(() => { root!.render(<Harness />); });
  const hosts = gmCompassHostRenders.count;
  const paints = gmRoseArtRenders.count;
  act(() => { mount!.querySelector<HTMLButtonElement>('[data-testid="bump"]')!.click(); });
  expect(gmCompassHostRenders.count).toBe(hosts);
  expect(gmRoseArtRenders.count).toBe(paints);
  act(() => { document.querySelector<HTMLButtonElement>('[aria-label="向左旋转 90 度"]')!.click(); });
  expect(orbitByDelta).toHaveBeenCalledWith(Math.PI / 2);
  expect(spin().style.transform).toBe('rotate(90deg)');
  expect(gmRoseArtRenders.count).toBe(paints);
});

it('does not observe the document while attaching the compass slot', () => {
  installFrames();
  const observed: Node[] = [];
  const NativeObserver = globalThis.MutationObserver;
  class SpyObserver extends NativeObserver {
    override observe(target: Node, options?: MutationObserverInit): void {
      observed.push(target);
      super.observe(target, options);
    }
  }
  vi.stubGlobal('MutationObserver', SpyObserver);
  const plan3dRef = { current: planApi(() => 0) };
  const overlayRef = { current: null };
  renderHost('3d', plan3dRef, overlayRef);
  expect(observed.includes(document.body)).toBe(false);
  const paints = gmRoseArtRenders.count;
  const extras: HTMLSpanElement[] = [];
  for (let i = 0; i < 20; i += 1) {
    const extra = document.createElement('span');
    extras.push(extra);
    document.body.append(extra);
  }
  expect(gmRoseArtRenders.count).toBe(paints);
  for (const extra of extras) extra.remove();
});

it('turns the 2D plan from the arrows using the live bearing, not the stale sample', () => {
  installFrames();
  let bearing = 0;
  const orbitByDelta = vi.fn((delta: number) => {
    bearing = bearingAfterOrbit(bearing, delta);
  });
  const resetNorth = vi.fn(() => { bearing = 0; });
  const plan3dRef = { current: planApi(() => 1.2) };
  const overlayRef = {
    current: { getBearing: () => bearing, orbitByDelta, resetNorth } as unknown as OutdoorPlanOverlayHandle,
  };
  renderHost('2d', plan3dRef, overlayRef);
  flushOldest(0);
  bearing = Math.PI / 2;

  act(() => { document.querySelector<HTMLButtonElement>('[aria-label="向左旋转 90 度"]')!.click(); });
  expect(orbitByDelta).toHaveBeenCalledWith(Math.PI / 2);
  expect(bearing).toBeCloseTo(0);
  expect(spin().style.transform).toBe('rotate(0deg)');
  expect(spin().querySelectorAll('[data-testid="gm-rose-arrow"]')).toHaveLength(2);
  expect(spin().contains(document.querySelector('[aria-label="向左旋转 90 度"]'))).toBe(true);
  expect(spin().contains(document.querySelector('[aria-label="向右旋转 90 度"]'))).toBe(true);

  act(() => { document.querySelector<HTMLButtonElement>('[aria-label="向右旋转 90 度"]')!.click(); });
  expect(orbitByDelta).toHaveBeenLastCalledWith(-Math.PI / 2);
  expect(bearing).toBeCloseTo(Math.PI / 2);
  expect(spin().style.transform).toBe('rotate(-90deg)');

  act(() => { document.querySelector<HTMLButtonElement>('[aria-label="回正北"]')!.click(); });
  expect(resetNorth).toHaveBeenCalledTimes(1);
  expect(bearing).toBeCloseTo(0);
  expect(spin().style.transform).toBe('rotate(0deg)');
});

it('turns the 3D camera from the arrow using the live heading, not the stale sample', () => {
  installFrames();
  let camera = 0;
  const orbitByDelta = vi.fn((delta: number) => {
    camera = bearingAfterOrbit(camera, delta);
  });
  const plan3dRef = { current: planApi(() => camera, orbitByDelta) };
  const overlayOrbit = vi.fn();
  const overlayRef = { current: { getBearing: () => 0.4, orbitByDelta: overlayOrbit } as unknown as OutdoorPlanOverlayHandle };
  renderHost('3d', plan3dRef, overlayRef);
  flushOldest(0);
  camera = Math.PI / 2;

  act(() => { document.querySelector<HTMLButtonElement>('[aria-label="向左旋转 90 度"]')!.click(); });
  expect(overlayOrbit).not.toHaveBeenCalled();
  expect(orbitByDelta).toHaveBeenCalledWith(Math.PI / 2);
  expect(camera).toBeCloseTo(0);
  expect(spin().style.transform).toBe('rotate(0deg)');
  expect(spin().querySelectorAll('[data-testid="gm-rose-arrow"]')).toHaveLength(2);
});

it('points the rose at the active view as soon as 2D and 3D switch', () => {
  installFrames();
  const camera = Math.PI / 2;
  let planBearing = 0.4;
  const plan3dRef = { current: planApi(() => camera) };
  const overlayRef = { current: { getBearing: () => planBearing } as OutdoorPlanOverlayHandle };
  renderHost('3d', plan3dRef, overlayRef);
  flushOldest(0);
  expect(spin().style.transform).toBe('rotate(-90deg)');

  act(() => {
    root!.render(<GmCompassHost active mode="2d" plan3dRef={plan3dRef} overlayRef={overlayRef} />);
  });
  expect(spin().style.transform).toBe(`rotate(${roseRotationDeg(planBearing)}deg)`);

  act(() => {
    root!.render(<GmCompassHost active mode="3d" plan3dRef={plan3dRef} overlayRef={overlayRef} />);
  });
  expect(spin().style.transform).toBe('rotate(-90deg)');
  expect(planBearing).toBe(0.4);
});
