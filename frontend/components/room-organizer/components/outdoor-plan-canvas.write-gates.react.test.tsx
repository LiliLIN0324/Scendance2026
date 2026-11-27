// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas, { type OutdoorPlanCanvasHandle } from './outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';
import { planPointToPixel } from '../lib/outdoor-plan-canvas';
import type { PlanFacility, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const facility: PlanFacility = {
  id: '11111111-1111-4111-8111-111111111111', templateId: 'oneplan:scale:tent',
  name: '审计样机A', position: { x: 4, y: 4 }, rotationDeg: 0,
  size: { width: 3, depth: 3 }, notes: '',
};
const hit = { px: { x: 200, y: 200 }, pt: facility.position };

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(readOnly = false, extra: Partial<SitePlanData> = {}) {
  const ref = createRef<OutdoorPlanCanvasHandle>();
  const commit = vi.fn();
  const plan = { ...createStarterOutdoorPlan(), facilities: [facility], ...extra };
  render(<Canvas ref={ref} plan={plan} {...(!readOnly ? { onPlanChange: commit } : {})} />);
  return { ref, commit, plan };
}
function rightClick(ref: React.RefObject<OutdoorPlanCanvasHandle>) {
  act(() => { ref.current!.pointerFromPlan('contextmenu', hit, { button: 2 }); });
}
const status = () => screen.getAllByRole('status').map(node => node.textContent).join(' ');

it.each(['hidden', 'locked'] as const)('%s 设施层：画布右键拒绝弹出可写菜单', state => {
  const { ref, commit } = mount();
  if (state === 'hidden') fireEvent.click(screen.getByRole('checkbox', { name: '显示帐篷图层' }));
  else fireEvent.click(screen.getByTestId('layer-lock-facility'));
  rightClick(ref);
  expect(screen.queryByTestId('plan-context-menu')).toBeNull();
  expect(status()).toContain(state === 'hidden' ? '已隐藏' : '已锁定');
  expect(commit).not.toHaveBeenCalled();
});

it.each(['duplicate', 'delete', 'order-top'])('菜单打开后再锁层：%s 仍必须拒绝写入', action => {
  const other = { ...facility, id: crypto.randomUUID(), name: 'B', position: { x: 12, y: 4 } };
  const { ref, commit, plan } = mount(false, { facilities: [facility, other] });
  rightClick(ref);
  const menuAction = screen.getByTestId(`plan-context-${action}`);
  // 用键盘激活锁按钮，不产生关闭菜单的 pointerdown。
  fireEvent.click(screen.getByTestId('layer-lock-facility'));
  fireEvent.click(menuAction);
  expect(commit).not.toHaveBeenCalled();
  expect(ref.current!.getEditVisuals().plan.facilities).toEqual(plan.facilities);
});

it('Agent 增删改和整批提案：锁层后全部返回 false 且不写方案', () => {
  const { ref, commit, plan } = mount();
  fireEvent.click(screen.getByTestId('layer-lock-facility'));
  act(() => {
    expect(ref.current!.addFacility({ ...facility, id: crypto.randomUUID() })).toBe(false);
    expect(ref.current!.removeFacility(facility.id)).toBe(false);
    expect(ref.current!.updateFacility(facility.id, { name: '不应写入' })).toBe(false);
    const current = ref.current!.getEditVisuals().plan;
    expect(ref.current!.applyWorkflowPlan({ ...plan, facilities: [] }, JSON.stringify(current))).toBe(false);
  });
  expect(commit).not.toHaveBeenCalled();
});

it('只读画布的公共写句柄也必须拒绝', () => {
  const { ref } = mount(true);
  act(() => {
    expect(ref.current!.addFacility({ ...facility, id: crypto.randomUUID() })).toBe(false);
    expect(ref.current!.removeFacility(facility.id)).toBe(false);
    expect(ref.current!.applyMeasurements([measurement])).toBe(false);
  });
  expect(ref.current!.getEditVisuals().plan.facilities).toEqual([facility]);
});

const node = { id: '22222222-2222-4222-8222-222222222222', kind: 'entry' as const, name: '入口', position: { x: 12, y: 12 }, notes: '' };
const route = { id: '33333333-3333-4333-8333-333333333333', kind: 'pedestrian' as const, name: '动线', points: [{ x: 12, y: 12 }, { x: 16, y: 12 }], oneWay: false, notes: '' };
const worker = { id: '44444444-4444-4444-8444-444444444444', role: '保安', count: 1, position: { x: 18, y: 18 }, notes: '' };
const measurement = { id: '55555555-5555-4555-8555-555555555555', kind: 'distance' as const, name: '尺寸', points: [{ x: 2, y: 12 }, { x: 8, y: 12 }], notes: '' };
const annotation = { id: '66666666-6666-4666-8666-666666666666', kind: 'note' as const, name: '标注', points: [{ x: 15, y: 18 }], text: '文字', notes: '' };
const extra = { nodes: [node], routes: [route], workers: [worker], measurements: [measurement], annotations: [annotation] };

it.each(['route', 'access', 'worker', 'annotate'])('锁住 %s 层：Agent 批量写入原子拒绝并如实返回 false', layer => {
  const { ref, commit } = mount(false, extra);
  fireEvent.click(screen.getByTestId(`layer-lock-${layer}`));
  act(() => {
    const api = ref.current!;
    if (layer === 'route') expect(api.applyRoutes([{ ...route, id: crypto.randomUUID() }], [])).toBe(false);
    if (layer === 'access') expect(api.applyRoutes([{ ...route, id: crypto.randomUUID() }], [{ ...node, id: crypto.randomUUID() }])).toBe(false);
    if (layer === 'worker') expect(api.applyWorkers([{ ...worker, id: crypto.randomUUID() }])).toBe(false);
    if (layer === 'annotate') expect(api.applyAnnotations([{ ...annotation, id: crypto.randomUUID() }])).toBe(false);
  });
  expect(commit).not.toHaveBeenCalled();
});

it('隐藏/锁定之后的树行右键拒绝写菜单，重新解锁后菜单删除照常可撤销', () => {
  const { ref, commit } = mount();
  const row = screen.getByTestId(`layer-entity-facility-${facility.id}`);
  fireEvent.click(screen.getByTestId('layer-lock-facility'));
  fireEvent.contextMenu(row);
  expect(screen.queryByTestId('plan-context-menu')).toBeNull();
  fireEvent.click(screen.getByTestId('layer-lock-facility'));
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByTestId('plan-context-delete'));
  expect(commit.mock.calls.at(-1)![0].facilities).toHaveLength(0);
  act(() => { ref.current!.undo(); });
  expect(ref.current!.getEditVisuals().plan.facilities).toEqual([facility]);
});

it('3D 桥中单选后 Shift 点第二件，保留第一件组成可缩放组选', () => {
  const other = { ...facility, id: crypto.randomUUID(), name: 'B', position: { x: 12, y: 4 } };
  const { ref, commit } = mount(false, { facilities: [facility, other] });
  const viewport = { ...ref.current!.getView(), zoom: 21, canvasW: 1200, canvasH: 900 };
  act(() => { ref.current!.setMode('select'); });
  for (const [index, item] of [facility, other].entries()) {
    const point = { pt: item.position, px: planPointToPixel(item.position, viewport) };
    act(() => {
      const flags = { button: 0, shiftKey: index === 1, viewport };
      ref.current!.pointerFromPlan('down', point, flags);
      ref.current!.pointerFromPlan('up', point, flags);
    });
  }
  expect(ref.current!.getEditVisuals().multiSelectedFacilityIds).toEqual([facility.id, other.id]);
  expect(commit).not.toHaveBeenCalled();
});

it('放置中隐藏目标层，2D/3D 幽灵一起消失，拖放句柄如实拒绝写入', () => {
  const { ref, commit } = mount();
  const payload = { slug: 'tent', name: '帐篷', width: 3, depth: 3, templateId: facility.templateId };
  act(() => {
    ref.current!.armCatalogFacility(payload);
    ref.current!.previewCatalogDrop(payload, { x: 16, y: 4 });
  });
  expect(ref.current!.getEditVisuals().draft.facilityGhost).not.toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '显示帐篷图层' }));
  act(() => { expect(ref.current!.dropCatalogAt(payload, { x: 16, y: 4 })).toBe(false); });
  const visuals = ref.current!.getEditVisuals();
  expect(visuals.draft.facilityGhost).toBeNull();
  expect(visuals.plan.facilities).toEqual([facility]);
  expect(commit).not.toHaveBeenCalled();
});

it('默认红线锁不挡空白活动首次选址，但保护已存在的轮廓', () => {
  const { ref } = mount(false, { facilities: [] });
  const anchor = { lng: 120, lat: 30, crs: 'gcj-02' as const, source: 'manual' as const };
  const boundary = [{ x: -20, y: -15 }, { x: 20, y: -15 }, { x: 20, y: 15 }, { x: -20, y: 15 }];
  act(() => {
    expect(ref.current!.applyVenue(anchor, boundary)).toBe(true);
    expect(ref.current!.applyVenue(anchor, boundary.map(p => ({ x: p.x * 2, y: p.y })))).toBe(false);
  });
  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(boundary);
});

it('2026-11-27 档2：updateFacility 落分组/高度/桌形/饰面/锁定五字段', () => {
  const { ref } = mount();
  act(() => {
    expect(ref.current!.updateFacility(facility.id, {
      groupId: 'A', heightM: 1.2, shape: 'round', finish: 'linen', locked: true,
    })).toBe(true);
  });
  const f = ref.current!.getEditVisuals().plan.facilities[0]!;
  expect(f.groupId).toBe('A');
  expect(f.heightM).toBeCloseTo(1.2);
  expect(f.shape).toBe('round');
  expect(f.finish).toBe('linen');
  expect(f.locked).toBe(true);
});

it('2026-11-27 档2：清空草稿传 undefined，可选键从 plan 删除（不写 undefined 冒充真值）', () => {
  const { ref } = mount();
  act(() => {
    ref.current!.updateFacility(facility.id, {
      groupId: 'A', heightM: 1.2, shape: 'round', finish: 'linen', locked: true,
    });
    ref.current!.updateFacility(facility.id, {
      groupId: undefined, heightM: undefined, shape: undefined, finish: undefined, locked: undefined,
    });
  });
  const f = ref.current!.getEditVisuals().plan.facilities[0]!;
  for (const key of ['groupId', 'heightM', 'shape', 'finish', 'locked'] as const) {
    expect(Object.hasOwn(f, key)).toBe(false);
  }
});

it('2026-11-27 档2：单件锁定后 removeFacility 拒绝写入且不提交', () => {
  const { ref, commit } = mount();
  act(() => { ref.current!.updateFacility(facility.id, { locked: true }); });
  const committedBefore = commit.mock.calls.length;
  act(() => { expect(ref.current!.removeFacility(facility.id)).toBe(false); });
  expect(ref.current!.getEditVisuals().plan.facilities).toHaveLength(1);
  expect(commit.mock.calls.length).toBe(committedBefore);
});
