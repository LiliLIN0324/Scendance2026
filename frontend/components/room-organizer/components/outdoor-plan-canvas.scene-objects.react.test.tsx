// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas, { type OutdoorPlanCanvasHandle } from './outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';
import type { PlanSceneObject } from '../lib/plan-item-bridge';

/**
 * 2026-11-20 审计 F11：扫描/户型家具只画在画布上（虚线框），点了没反应也没说明。
 * 本轮不改它的只读语义，只把「只读」写进图例，让用户先知道这不是可编辑物件。
 */
const SCENE_OBJECT: PlanSceneObject = {
  id: 'scene:venue-scan',
  kind: 'scene',
  name: '扫描场地',
  center: { x: 10, y: 10 },
  width: 20,
  depth: 14,
  height: 3,
  rotationDeg: 0,
  color: '#8899aa',
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('有场景物件时图例里写明「只读」', () => {
  const ref = createRef<OutdoorPlanCanvasHandle>();
  render(<Canvas ref={ref} plan={createStarterOutdoorPlan()} onPlanChange={vi.fn()} sceneObjects={[SCENE_OBJECT]} />);
  act(() => { fireEvent.click(screen.getByTestId('map-legend').querySelector('button')!); });
  expect(screen.getByText('场景物件（只读）')).toBeTruthy();
});

it('没有场景物件时不多出这一行', () => {
  const ref = createRef<OutdoorPlanCanvasHandle>();
  render(<Canvas ref={ref} plan={createStarterOutdoorPlan()} onPlanChange={vi.fn()} />);
  expect(screen.queryByText('场景物件（只读）')).toBeNull();
});
