// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas, { type OutdoorPlanCanvasHandle } from './outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('locks a completed redline, returns to browsing, and allows explicit editing to unlock it again', () => {
  const plan = createStarterOutdoorPlan();
  const anchor = plan.anchor!;
  const ref = createRef<OutdoorPlanCanvasHandle>();
  const commit = vi.fn();
  render(<Canvas ref={ref} plan={plan} onPlanChange={commit} searchArea={{ label: '场地', polygon: [
    [anchor.lng, anchor.lat], [anchor.lng + 0.001, anchor.lat],
    [anchor.lng + 0.001, anchor.lat + 0.001], [anchor.lng, anchor.lat + 0.001],
  ] }} />);
  act(() => ref.current!.setMode('boundary'));
  expect(screen.getByTestId('layer-lock-boundary').getAttribute('aria-pressed')).toBe('false');
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0][0].boundary).toHaveLength(4);
  expect(commit.mock.calls[0][0].designScope).toHaveLength(4);
  expect(ref.current!.getMode()).toBe('view');
  expect(screen.getByTestId('layer-lock-boundary').getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(/红线和范围已锁定，需要调整时点锁解锁/)).toBeTruthy();
  act(() => ref.current!.setMode('boundary-vertex'));
  expect(screen.getByTestId('layer-lock-boundary').getAttribute('aria-pressed')).toBe('false');
});
