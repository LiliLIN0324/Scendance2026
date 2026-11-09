// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { revisePlan } from '../lib/agent-proposal';
import { parseRevisionRequest } from '../lib/workbench-agent';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { useHistory } from './use-history';
import { useLayoutState } from './use-layout-state';
import { layoutStore } from './use-layout-store';
import { INITIAL_LAYOUT } from './layout-reducer';
import type { RoomLayout } from '../lib/types';

const stage = makeItem({
  id: 'stage-1', type: 'stage-platform', name: '舞台平台',
  width: 5, depth: 1.2, height: 3, position: { x: 0, z: -6 }, rotation: 0,
});
const chairA = makeItem({ id: 'chair-a', type: 'chair', name: '椅子 A', width: 0.5, depth: 0.5, height: 0.9, position: { x: -3, z: 2 } });
const chairB = makeItem({ id: 'chair-b', type: 'chair', name: '椅子 B', width: 0.5, depth: 0.5, height: 0.9, position: { x: 3, z: 2 } });

const base: RoomLayout = makeLayout({
  width: 24, height: 16,
  floors: [makeFloor({ items: [stage, chairA, chairB] })],
});

afterEach(() => {
  cleanup();
  layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
});

describe('plan.revise — 预览/确认边界', () => {
  it('未确认前画布不变：提案与预览帧只存在候选里，不写 store', () => {
    const request = parseRevisionRequest('把舞台往西挪 1.5 米，在舞台两侧各加一盏灯，朝向观众席')!;
    layoutStore.setState({ layout: base, activeFloorIndex: 0 });
    const plan = revisePlan({ base, floorIndex: 0, ops: request.ops, bands: request.bands });

    // 提案阶段：store 里的场地一件没动，也没有灯。
    const canvasItems = layoutStore.getState().layout.floors[0]!.items;
    expect(canvasItems).toHaveLength(3);
    expect(canvasItems.find(item => item.id === 'stage-1')!.position).toEqual({ x: 0, z: -6 });
    expect(canvasItems.some(item => item.type === 'lamp')).toBe(false);
    // 改完的样子只在候选帧里，等用户点「确认部署」。
    expect(plan.layouts[plan.layouts.length - 1]!.floors[0]!.items).toHaveLength(5);
    expect(layoutStore.getState().layout.floors[0]!.items).toEqual(base.floors[0]!.items);
  });
});

describe('plan.revise — 确认后撤销整步退回', () => {
  it('挪舞台 + 加两盏灯只占一步撤销，撤销后回到原场地', () => {
    const request = parseRevisionRequest('把舞台往西挪 1.5 米，在舞台两侧各加一盏灯，朝向观众席')!;
    const plan = revisePlan({ base, floorIndex: 0, ops: request.ops, bands: request.bands });
    // 预览是逐帧的，但确认只落最后一帧：多次改动仍是一步历史。
    expect(plan.layouts).toHaveLength(3);

    layoutStore.setState({ layout: base, activeFloorIndex: 0 });
    const { result } = renderHook(() => {
      const state = useLayoutState();
      return { ...state, history: useHistory(state.layout, state.actions.applyLayout, { debounceMs: 10 }) };
    });

    act(() => {
      // 和 room-organizer 的 onApplyCreative 同序：先 commitHistoryNow，再 applyLayout。
      result.current.history.commitNow();
      result.current.actions.applyLayout(plan.layouts[plan.layouts.length - 1]!);
    });

    const applied = layoutStore.getState().layout;
    const items = applied.floors[0]!.items;
    expect(items.filter(item => item.type === 'lamp')).toHaveLength(2);
    expect(items.find(item => item.id === 'stage-1')!.position).toEqual({ x: -1.5, z: -6 });
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.history.undo());
    const undone = layoutStore.getState().layout;
    // applyLayout 会给场地补内部 id；撤销要比的是楼层与物料本身。
    expect(undone.floors).toEqual(base.floors);
    expect(undone.floors[0]!.items).toHaveLength(3);
    expect(undone.floors[0]!.items.find(item => item.id === 'stage-1')!.position).toEqual({ x: 0, z: -6 });
    expect(undone.floors[0]!.items.some(item => item.type === 'lamp')).toBe(false);
  });
});
