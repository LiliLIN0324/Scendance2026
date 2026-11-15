// @vitest-environment jsdom
import { act, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { GeoScaleCompass, type GeoScaleCompassProps } from './geo-scale-compass';

let root: Root | undefined;
let host: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const labelRef: Ref<HTMLSpanElement> = { current: null };
const barRef: Ref<HTMLDivElement> = { current: null };
const needleRef: Ref<HTMLDivElement> = { current: null };

function renderCompass(props: Partial<GeoScaleCompassProps>): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <GeoScaleCompass
        scaleLabelRef={labelRef}
        scaleBarRef={barRef}
        compassRef={needleRef}
        attribution={null}
        {...props}
      />,
    );
  });
  return host.querySelector('[data-testid$="-compass"]') as HTMLDivElement;
}

function press(el: HTMLElement, x: number, y = 10, pointerId = 1): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId, clientX: x, clientY: y, bubbles: true }));
}

function move(el: HTMLElement, x: number, y = 10, pointerId = 1): void {
  el.dispatchEvent(new PointerEvent('pointermove', { pointerId, clientX: x, clientY: y, bubbles: true }));
}

function release(el: HTMLElement, x: number, y = 10, pointerId = 1): void {
  el.dispatchEvent(new PointerEvent('pointerup', { pointerId, clientX: x, clientY: y, bubbles: true }));
}

it('不传回调时为纯展示：不接指针、没有按钮角色', () => {
  const card = renderCompass({ testIdPrefix: 'geo' });
  expect(card.className).not.toContain('interactive');
  expect(card.getAttribute('role')).toBeNull();
});

it('短按罗盘触发回正朝北，不产生转角增量', () => {
  const onResetNorth = vi.fn();
  const onOrbitDelta = vi.fn();
  const card = renderCompass({ testIdPrefix: 'outdoor-3d', onResetNorth, onOrbitDelta });
  card.setPointerCapture = vi.fn();
  card.releasePointerCapture = vi.fn();

  press(card, 20);
  release(card, 20);
  expect(onResetNorth).toHaveBeenCalledTimes(1);
  expect(onOrbitDelta).not.toHaveBeenCalled();
});

it('拖动超过阈值才转角；拖动过后松手不再触发回正', () => {
  const onResetNorth = vi.fn();
  const onOrbitDelta = vi.fn();
  const card = renderCompass({ testIdPrefix: 'outdoor-3d', onResetNorth, onOrbitDelta });
  card.setPointerCapture = vi.fn();
  card.releasePointerCapture = vi.fn();

  press(card, 10);
  move(card, 15); // dx=5，超过 3px 阈值
  release(card, 15);
  expect(onOrbitDelta).toHaveBeenCalled();
  expect(onOrbitDelta.mock.calls[0]![0]).toBeGreaterThan(0);
  expect(onResetNorth).not.toHaveBeenCalled();
});
