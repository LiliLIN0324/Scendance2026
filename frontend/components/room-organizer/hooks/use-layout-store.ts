'use client';

// ---------------------------------------------------------------------------
// POC — Zustand layout store (target pattern for issue #3)
// ---------------------------------------------------------------------------
//
// This is the SINGLE SOURCE OF TRUTH for layout state and the pattern the
// maintainer is evaluating before migrating all ~35 panels off React Context.
//
// Key ideas demonstrated here:
//   • The store REUSES the existing `layoutReducer` verbatim — no reducer logic
//     is reimplemented, so behavior is identical and the 153-test reducer suite
//     still fully covers state transitions.
//   • Panels subscribe via ATOMIC selectors (e.g. `useLayoutStore((s) => s.layout.name)`)
//     and therefore re-render ONLY when their own slice changes, not on every
//     unrelated layout mutation (moving furniture no longer re-renders the
//     lot-badge, floor switcher, etc.).
//   • React Context is retained as a passthrough: `use-layout-state.ts` is now a
//     thin adapter that reads from this store, so the ~30 not-yet-migrated panels
//     keep working UNCHANGED. Migration can proceed panel-by-panel.
//
// ---------------------------------------------------------------------------
// 退役状态（2026-11-26 批4 判定：条件②未完成）
//
// 本 store 仍是编辑器内家具 / 分区 / 场地 / 入口的**临时状态正源**；plan（SitePlanData）
// 目前只接管地面、锚点与快照，尚未接管编辑器摆放态。整链退役前置：plan 正源接管
// 摆放 / 分区 / 碰撞 / 评分之后，再按清单逐面板切走，最后删本 store、layout-reducer、
// use-layout-state 适配层。在此之前不得硬删——会崩掉整个工作台。
//
// 冻结口径：
// - 不再新增 layout action 或面板写入口；多楼层写入已拆（批1）；plan↔layout 双向
//   镜像写点冻结（`lib/layout-plan-mirror.ts`），新增跨双源写点必须先登记。
// - 剩余生产消费点清单与角色：`docs/evidence/decouple-2026-11-26/s2-indoor-render-retirement.md` §11.18。
// ---------------------------------------------------------------------------

import { createStore, useStore } from 'zustand';
import { randomId, withHouseId } from '../lib/ids';
import { parseLayoutEventOperations } from '../lib/schema';
import { randomStreetSeed } from '../lib/street-row';
import {
  layoutReducer,
  INITIAL_GROUND_FLOOR,
  INITIAL_LAYOUT,
  type LayoutAction,
  type LayoutState,
} from './layout-reducer';
import type { LayoutActions } from './use-layout-state';
import type {
  CatalogItem,
  FloorLayout,
  FurnitureItem,
  FloorPattern,
  FloorPlanFitMode,
  RoofStyle,
  RoomLayout,
  SofaShape,
  WallId,
  WallPattern,
} from '../lib/types';

const nextId = randomId;

interface LayoutStoreState extends LayoutState {
  readonly actions: LayoutActions;
  /**
   * 结论失效计数器：任何走 dispatch 的布局 / 家具 / 墙体变更都 +1。
   * 消费侧（评分 / reachability / 门弧检查）依赖它重算，旧结论标记 stale。
   */
  readonly revision: number;
}

// A store (not a hook) so state lives outside the React tree and can be read by
// atomic selectors from any component. The actions facade is created ONCE inside
// the initializer, so `useLayoutActions()` returns a stable reference forever.
export const createLayoutStore = (initialState?: LayoutState) => createStore<LayoutStoreState>()((set, get) => {
  // Internal dispatch: delegate to the existing reducer, never reimplement it.
  // 所有数据变更都过这里，统一 bump revision——消费侧靠它判断旧评分/violation 是否失效。
  const dispatch = (action: LayoutAction): void => {
    set((state) => ({ ...layoutReducer(state, action), revision: state.revision + 1 }));
  };

  const actions: LayoutActions = {
    setProductionPlan: (value) => {
      if (!parseLayoutEventOperations({ ...get().layout, productionPlan: value })) {
        throw new Error('制作计划未保存，请核对人数、时间、金额及填写依据。');
      }
      dispatch({ type: 'setProductionPlan', value });
    },
    setEventOperations: (value) => {
      if (!parseLayoutEventOperations({ ...get().layout, eventOperations: value })) {
        throw new Error('活动安排未保存，请核对任务内容及关联物料是否有重复编号。');
      }
      dispatch({ type: 'setEventOperations', value });
    },
    setPlanSettings: (value) => dispatch({ type: 'setPlanSettings', value }),
    setName: (name) => dispatch({ type: 'setName', name }),
    setWidth: (width) => dispatch({ type: 'setWidth', width }),
    setHeight: (height) => dispatch({ type: 'setHeight', height }),
    setFloorColor: (color) => dispatch({ type: 'setFloorColor', color }),
    setFloorPattern: (pattern: FloorPattern) => dispatch({ type: 'setFloorPattern', pattern }),
    setWallPattern: (pattern: WallPattern) => dispatch({ type: 'setWallPattern', pattern }),
    setStoreyHeight: (height) => dispatch({ type: 'setStoreyHeight', height }),
    setWallColor: (wall: WallId, color: string | null) => dispatch({ type: 'setWallColor', wall, color }),
    setFloorPlan: (image) => dispatch({ type: 'setFloorPlan', image }),
    setFloorPlanOpacity: (opacity) => dispatch({ type: 'setFloorPlanOpacity', opacity }),
    setFloorPlanFitMode: (mode: FloorPlanFitMode) => dispatch({ type: 'setFloorPlanFitMode', mode }),
    setRoofStyle: (style: RoofStyle) => dispatch({ type: 'setRoofStyle', style }),
    setRoofColor: (color) => dispatch({ type: 'setRoofColor', color }),
    addDormer: (dormer) => {
      const id = nextId('dormer');
      dispatch({ type: 'addDormer', dormer: { ...dormer, id } });
      return id;
    },
    updateDormer: (id, patch) => dispatch({ type: 'updateDormer', id, patch }),
    removeDormer: (id) => dispatch({ type: 'removeDormer', id }),
    setTerrain: (terrain) => dispatch({ type: 'setTerrain', terrain }),
    setNeighbour: (side, present) => dispatch({ type: 'setNeighbour', side, present }),
    shuffleStreet: () => dispatch({ type: 'shuffleStreet', seed: randomStreetSeed() }),
    setEntrance: (entrance) => dispatch({ type: 'setEntrance', entrance }),
    setFrontage: (frontage) => dispatch({ type: 'setFrontage', frontage }),
    setSillHeight: (id, sillHeight) => dispatch({ type: 'setSillHeight', id, sillHeight }),
    setStairsShape: (id, shape, leadIn) =>
      dispatch({ type: 'setStairsShape', id, shape, ...(leadIn !== undefined ? { leadIn } : {}) }),
    addCatalogItem: (catalogItem: CatalogItem, position) => {
      const id = nextId(catalogItem.type);
      dispatch({ type: 'addCatalogItem', catalogItem, id, ...(position ? { position } : {}) });
      return id;
    },
    removeItem: (id) => dispatch({ type: 'removeItem', id }),
    duplicateItem: (id) => {
      const newId = nextId('copy');
      dispatch({ type: 'duplicateItem', sourceId: id, newId });
      return newId;
    },
    rotateItem: (id) => dispatch({ type: 'rotateItem', id }),
    moveItem: (id, x, z) => dispatch({ type: 'moveItem', id, x, z }),
    resizeItem: (id, dimension, value) => dispatch({ type: 'resizeItem', id, dimension, value }),
    updateItem: (id, patch: Partial<FurnitureItem>) => dispatch({ type: 'updateItem', id, patch }),
    setSofaShape: (id, shape: SofaShape) => dispatch({ type: 'setSofaShape', id, shape }),
    setSignalRange: (id, range) => dispatch({ type: 'setSignalRange', id, range }),
    setColor: (id, color) => dispatch({ type: 'setColor', id, color }),
    setLocked: (id, locked) => dispatch({ type: 'setLocked', id, locked }),
    toggleMirror: (id) => dispatch({ type: 'toggleMirror', id }),
    setRotation: (id, rotation) => dispatch({ type: 'setRotation', id, rotation }),
    replaceItems: (items: FurnitureItem[]) => dispatch({ type: 'replaceItems', items }),
    addItems: (items: FurnitureItem[]) => dispatch({ type: 'addItems', items }),
    bulkSetPositions: (positions) => dispatch({ type: 'bulkSetPositions', positions }),
    toggleExteriorWall: (wallId: WallId) => dispatch({ type: 'toggleExteriorWall', wallId }),
    rotateSelection: (ids, radians) => dispatch({ type: 'rotateSelection', ids, radians }),
    // The group id is rolled here so the reducer stays pure (#154).
    setGroup: (ids) => {
      const groupId = nextId('group');
      dispatch({ type: 'setGroup', ids, groupId });
      return groupId;
    },
    clearGroup: (ids) => dispatch({ type: 'clearGroup', ids }),
    setLockAll: (locked) => dispatch({ type: 'setLockAll', locked }),
    clearItems: () => dispatch({ type: 'clearItems' }),

    setActiveFloorIndex: (index) => dispatch({ type: 'setActiveFloorIndex', index }),
    renameFloor: (index, name) => dispatch({ type: 'renameFloor', index, name }),

    applyLayout: (next: RoomLayout) => dispatch({ type: 'applyLayout', layout: withHouseId(next) }),

    // Room zones (#155).
    addZone: (zone) => {
      const id = nextId('zone');
      dispatch({ type: 'addZone', zone: { ...zone, id } });
      return id;
    },
    updateZone: (id, patch) => dispatch({ type: 'updateZone', id, patch }),
    removeZone: (id) => dispatch({ type: 'removeZone', id }),
  };

  return {
    layout: initialState?.layout ?? withHouseId(INITIAL_LAYOUT),
    activeFloorIndex: initialState?.activeFloorIndex ?? 0,
    revision: 0,
    actions,
  };
});

declare global {
  interface ImportMeta {
    webpackHot?: {
      data?: { layoutState?: LayoutState };
      dispose(callback: (data: { layoutState?: LayoutState }) => void): void;
    };
  }
}

const hot = process.env.NODE_ENV === 'development' ? import.meta.webpackHot : undefined;
export const layoutStore = createLayoutStore(hot?.data?.layoutState);
// Fast Refresh can keep the hydrated editor tree alive while replacing this module.
hot?.dispose((data) => {
  const { layout, activeFloorIndex } = layoutStore.getState();
  data.layoutState = { layout, activeFloorIndex };
});

// Raw hook for arbitrary atomic selectors:
//   const name = useLayoutStore((s) => s.layout.name);
export function useLayoutStore<T>(selector: (state: LayoutStoreState) => T): T {
  return useStore(layoutStore, selector);
}

// Convenience selector hooks -------------------------------------------------

export function useLayout(): RoomLayout {
  return useStore(layoutStore, (s) => s.layout);
}

export function useActiveFloorIndex(): number {
  return useStore(layoutStore, (s) => s.activeFloorIndex);
}

export function useActiveFloor(): FloorLayout {
  return useStore(layoutStore, (s) => {
    const { layout, activeFloorIndex } = s;
    return layout.floors[activeFloorIndex] ?? layout.floors[0] ?? INITIAL_GROUND_FLOOR;
  });
}

/**
 * 布局结论失效计数器：任何家具 / 墙体 / 场地变更都 +1。
 * 消费侧用 `useEffect(() => { 重跑评分/reachability/门弧检查 }, [useLayoutRevision(), planAnnot.revision])`
 * 触发重算；重算未完成期间 UI 应显示「核验中」而非沿用旧结论。
 */
export function useLayoutRevision(): number {
  return useStore(layoutStore, (s) => s.revision);
}

// Actions are created once and never change identity, so this hook never causes
// a re-render on its own.
export function useLayoutActions(): LayoutActions {
  return useStore(layoutStore, (s) => s.actions);
}
