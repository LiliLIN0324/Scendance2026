// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { LOCATE_FAILED_LABEL, LOCATE_FAILED_MS, LOCATE_PENDING_LABEL, LOCATE_PENDING_MS, type LocateOutcome } from '../lib/gm-locate';
import { GmLocateButton } from './gm-locate-button';
import { GmLocateHost } from './gm-locate-host';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.getElementById('tool-focus')?.parentElement?.remove();
  vi.useRealTimers();
});

function renderButton(onLocate: () => LocateOutcome, label = '回到框选场地'): void {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(<GmLocateButton label={label} onLocate={onLocate} />);
  });
}

function button(): HTMLButtonElement {
  const found = document.querySelector('[data-testid="gm-locate"]');
  if (!found) throw new Error('missing locate button');
  return found as HTMLButtonElement;
}

it('shows the Google location dot while a locate is in progress', () => {
  vi.useFakeTimers();
  const onLocate = vi.fn<() => LocateOutcome>(() => 'moved');
  renderButton(onLocate);
  expect(button().querySelector('svg')).toBeTruthy();
  expect(button().querySelector('[data-testid="gm-locate-point"]')).toBeNull();

  act(() => { button().click(); });
  expect(onLocate).toHaveBeenCalledTimes(1);
  expect(button().getAttribute('aria-busy')).toBe('true');
  expect(button().querySelector('svg')).toBeNull();
  expect(button().querySelector('[data-testid="gm-locate-accuracy"]')).toBeTruthy();
  expect(button().querySelector('[data-testid="gm-locate-core"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="gm-locate-status"]')?.textContent).toBe(LOCATE_PENDING_LABEL);

  act(() => { button().click(); });
  expect(onLocate).toHaveBeenCalledTimes(1);

  act(() => { vi.advanceTimersByTime(LOCATE_PENDING_MS); });
  expect(button().getAttribute('aria-busy')).toBe('false');
  expect(button().querySelector('[data-testid="gm-locate-point"]')).toBeNull();
  expect(button().querySelector('svg')).toBeTruthy();
  expect(document.querySelector('[data-testid="gm-locate-status"]')).toBeNull();
});

it('reports a miss beside the button and keeps the crosshair', () => {
  vi.useFakeTimers();
  const onLocate = vi.fn<() => LocateOutcome>(() => 'miss');
  renderButton(onLocate, '定位到设计范围');
  act(() => { button().click(); });
  expect(button().classList.contains('is-failed')).toBe(true);
  expect(button().getAttribute('aria-label')).toBe('定位到设计范围');
  expect(button().querySelector('[data-testid="gm-locate-point"]')).toBeNull();
  expect(button().querySelector('svg')).toBeTruthy();
  expect(document.querySelector('[data-testid="gm-locate-status"]')?.textContent).toBe(LOCATE_FAILED_LABEL);

  act(() => { vi.advanceTimersByTime(LOCATE_FAILED_MS); });
  expect(button().classList.contains('is-failed')).toBe(false);
  expect(document.querySelector('[data-testid="gm-locate-status"]')).toBeNull();
});

it('mounts over the native locate button and leaves it out of the click path', () => {
  const cluster = document.createElement('div');
  cluster.innerHTML = '<button id="tool-focus" type="button" aria-label="回到框选场地">old</button>';
  document.body.append(cluster);
  const onLocate = vi.fn<() => LocateOutcome>(() => 'miss');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(<GmLocateHost active label="回到框选场地" onLocate={onLocate} />);
  });
  const native = document.getElementById('tool-focus');
  expect(native?.getAttribute('aria-hidden')).toBe('true');
  expect(native?.classList.contains('is-gm-locate-native')).toBe(true);
  expect(native?.style.pointerEvents).toBe('none');
  act(() => { button().click(); });
  expect(onLocate).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-testid="gm-locate-status"]')?.textContent).toBe(LOCATE_FAILED_LABEL);
});
