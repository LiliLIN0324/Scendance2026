import { useCallback, useMemo } from 'react';
import { useRoomEditorOptional } from '../contexts/room-editor-context';
import { GRID_SIZE_METERS } from '../lib/constants';
import {
  findFreePosition,
  snapToGrid as snapValueToGrid,
  snapToNeighbors,
  snapToWall as snapPositionToWall,
} from '../lib/geometry';
import { isOpening, snapOpeningToWall, snapWallMountedItem, type WallGap } from '../lib/opening-snap';
import { catalogFacilityTemplateId } from '../lib/plan-catalog-drag';
import { resolveFacilityTarget } from '../lib/plan-facility-mapping';
import { framePoint, hexOrUndefined, makeFrame } from '../lib/plan-migration-frame';
import { canApplyLayoutGeometry, snapMeasuredOpening } from '../lib/structural-layout';
import type { LayoutActions } from './use-layout-state';
import type { CatalogItem, FloorLayout, RoomLayout, ViewSettings } from '../lib/types';

/** AV / 安防视锥类目本轮退役，不进 facility 契约（方案档 §2.1）。 */
const RETIRED_AV_TYPES = new Set(['wifi', 'router', 'cctv', 'security-camera']);

/** 契约 sourceAssetId 区间（1–160）；越界/空串不落键，不编造引用。 */
function boundedSourceAssetId(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length >= 1 && trimmed.length <= 160 ? trimmed : undefined;
}

export interface UseItemPlacementParams {
  activeFloor: FloorLayout;
  layout?: RoomLayout;
  /** World-space Y of the active floor — the drag plane. */
  activeFloorY: number;
  roomWidth: number;
  roomDepth: number;
  /** Current furniture value across the whole building, for the budget guard. */
  buildingCost: number;
  actions: LayoutActions;
  view: Pick<ViewSettings, 'snapToGrid' | 'snapToWall' | 'snapToItems'>;
  /** 网格吸附步长（米）。缺省仍是 0.5。 */
  gridSizeM?: number | undefined;
  /**
   * The multi-selection. A drag on one of its items moves its unlocked
   * members together, so snap-to-items must not target their stale
   * pre-drag positions (#380).
   */
  allSelectedIds?: ReadonlySet<string>;
  /**
   * The span the recessed entrance cuts out of the active storey's north
   * wall (`entrancePlanOutline`): openings snap onto the piers beside it (#394).
   */
  frontGap?: WallGap | null;
}

export interface UseItemPlacementResult {
  /** Adjust a candidate drop position before it's applied (snap-to-grid/-wall/-items). */
  snapPosition(itemId: string, x: number, z: number): { x: number; z: number };
  getDragPlaneY(): number;
  /** Wall-aware catalog placement (snaps doors/windows/cameras to walls). */
  placeCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
}

export function useItemPlacement({
  activeFloor,
  layout,
  activeFloorY,
  roomWidth,
  roomDepth,
  actions,
  view,
  gridSizeM = GRID_SIZE_METERS,
  allSelectedIds,
  frontGap,
}: UseItemPlacementParams): UseItemPlacementResult {
  // B-2a：绑定户外 plan 时，目录件落 plan facility 通道；无绑定（legacy 草稿）为 null，沿用旧 actions。
  const editorChannel = useRoomEditorOptional();
  const planActions = editorChannel?.planActions ?? null;
  const outdoorPlan = editorChannel?.outdoorPlan ?? null;

  // Keyed on the numbers, so a fresh outline object each render doesn't
  // rebuild the callbacks.
  const gapX0 = frontGap?.x0;
  const gapX1 = frontGap?.x1;
  const gap = useMemo(
    () => (gapX0 !== undefined && gapX1 !== undefined ? { frontGap: { x0: gapX0, x1: gapX1 } } : {}),
    [gapX0, gapX1]
  );

  const snapPosition = useCallback(
    (itemId: string, x: number, z: number) => {
      let result = { x, z };
      const item = activeFloor.items.find((entry) => entry.id === itemId);

      // Doors and windows have to live on a wall — there's no such thing as
      // a "free-floating" opening. Force-snap them regardless of the toggle.
      if (item && isOpening(item.type)) {
        if (layout?.backendSceneV2) return snapMeasuredOpening(layout,item,result)?.position ?? item.position ?? result;
        const snapped = snapOpeningToWall({
          position: result,
          itemWidth: item.width,
          roomWidth,
          roomDepth,
          ...gap,
        });
        return snapped.position;
      }

      // Security cameras follow the cursor freely while dragging (no per-frame
      // wall-snap — that made them teleport/flip between walls). They snap onto
      // the nearest wall and orient into the room on release, in handleDragEnd.

      if (view.snapToGrid) {
        const step = Number.isFinite(gridSizeM) && gridSizeM > 0 ? gridSizeM : GRID_SIZE_METERS;
        result = {
          x: snapValueToGrid(result.x, step),
          z: snapValueToGrid(result.z, step),
        };
      }
      if (view.snapToItems && item) {
        // Same membership as the retired drag session: locked co-selected
        // items stay put, so they remain valid targets.
        const group =
          allSelectedIds && allSelectedIds.size > 1 && allSelectedIds.has(itemId)
            ? new Set(
                activeFloor.items
                  .filter((entry) => allSelectedIds.has(entry.id) && !entry.locked)
                  .map((entry) => entry.id)
              )
            : undefined;
        result = snapToNeighbors({
          position: result,
          movingItem: item,
          otherItems: activeFloor.items,
          ...(group ? { excludeIds: group } : {}),
        });
      }
      if (view.snapToWall && item) {
        result = snapPositionToWall({
          position: result,
          item,
          roomWidth,
          roomDepth,
        });
      }
      return result;
    },
    [
      view.snapToGrid,
      view.snapToWall,
      view.snapToItems,
      gridSizeM,
      activeFloor.items,
      layout,
      allSelectedIds,
      gap,
      roomWidth,
      roomDepth,
    ]
  );

  const getDragPlaneY = useCallback(() => activeFloorY, [activeFloorY]);

  /**
   * B-2a：绑定 plan 时把目录件落成一条 facility。
   *
   * 口径（方案档 §4 B-2）：
   * - 结构件（门/窗/隔断/围栏/人物）与 AV/安防视锥类目不进 facility，plan 模式下不落件；
   * - 坐标走既有迁移帧逆变换（壳体 x 东/z 南 → 平面 x 东/y 北，边界退化回落翻轴）；
   * - 颜色 #RRGGBB 兜底；assetId 直通 sourceAssetId；弧度→度在加件时无旋转（0）。
   * - 内置模板（builtin）直传 templateId，尺寸取模板目录；oneplan / misc 走动态模板槽，
   *   名称/宽深取卡片；misc 的 templateId 由 assetId（空回退 type）生成稳定短 web id。
   * - 宽深缺失或非正：回落通道拒收返回空串，不猜默认尺寸；本 hook 拿不到画布 slug，
   *   不把 assetId/glbUrl 硬塞进 modelOverride。
   * - 通道拒收（未知模板/越界等）返回空串，不回写 legacy 双源。
   * - 加件后的解锁/朝向/ provenance 属单件编辑写点，待 B-3 身份桥接后再接，本分支不补 legacy 回写。
   */
  const placeViaPlan = useCallback(
    (catalogItem: CatalogItem, position: { x: number; z: number } | undefined): string => {
      if (!planActions) return '';
      const target = resolveFacilityTarget(catalogItem.type);
      if (target.kind === 'skip') return '';
      if (RETIRED_AV_TYPES.has(catalogItem.type)) return '';

      const frame = makeFrame(outdoorPlan?.boundary ?? [], roomWidth, roomDepth);
      const requested = position ?? { x: 0, z: 0 };
      const planPosition = framePoint(frame, requested.x, requested.z);
      const color = hexOrUndefined(catalogItem.color);
      const sourceAssetId = boundedSourceAssetId(catalogItem.assetId);

      const width = catalogItem.width;
      const depth = catalogItem.depth;
      const hasValidSize = Number.isFinite(width) && Number.isFinite(depth) && width > 0 && depth > 0;

      let templateId: string;
      let dynamicTemplate: { name: string; width: number; depth: number } | undefined;

      if (target.kind === 'builtin') {
        templateId = target.templateId;
      } else {
        // oneplan / misc 都要动态模板；宽深非法不猜默认尺寸，直接回落拒收。
        if (!hasValidSize || width === undefined || depth === undefined) return '';
        if (target.kind === 'oneplan') {
          templateId = target.templateId;
        } else {
          const fallbackKey = (catalogItem.assetId ?? catalogItem.type ?? '').trim();
          if (!fallbackKey) return '';
          templateId = catalogFacilityTemplateId(fallbackKey);
        }
        dynamicTemplate = { name: catalogItem.name, width, depth };
      }

      const result = planActions.applyFacility({
        kind: 'add',
        input: {
          templateId,
          position: planPosition,
          ...(color ? { color } : {}),
          ...(sourceAssetId ? { sourceAssetId } : {}),
          ...(dynamicTemplate ? { template: dynamicTemplate } : {}),
        },
      });
      if (!result.ok) return '';
      const placed = result.value.facilities[result.value.facilities.length - 1];
      return placed?.id ?? '';
    },
    [planActions, outdoorPlan, roomWidth, roomDepth]
  );

  /**
   * Add an item from the catalog. For doors and windows, the requested
   * position is force-snapped to the nearest exterior wall
   * and a default rotation aligned with that wall is applied — these
   * openings only make sense embedded in a wall.
   */
  const placeCatalogItem = useCallback(
    (catalogItem: CatalogItem, position?: { x: number; z: number }) => {
      // 绑定 plan：目录件走 facility 通道；legacy 草稿回落旧 actions（双读保留，不删旧路径）。
      if (planActions) {
        return placeViaPlan(catalogItem, position);
      }
      if (isOpening(catalogItem.type)) {
        if (layout?.backendSceneV2) {
          const item = {...catalogItem,id:crypto.randomUUID()};
          const seated = snapMeasuredOpening(layout,item,position??{x:0,z:0});
          if (!seated) return '';
          const candidate = {...layout,floors:layout.floors.map(f=>f.id===activeFloor.id?{...f,items:[...f.items,{...item,...seated}]}:f)};
          if (!canApplyLayoutGeometry(layout,candidate)) return '';
          return actions.addCatalogItem(catalogItem,seated.position);
        }
        const snapped = snapOpeningToWall({
          position: position ?? { x: 0, z: 0 },
          itemWidth: catalogItem.width,
          roomWidth,
          roomDepth,
          ...gap,
        });
        const id = actions.addCatalogItem(catalogItem, snapped.position);
        // updateItem, not setRotation: catalog items are born locked (#11)
        // and the reducer refuses setRotation on locked items (#209).
        actions.updateItem(id, { rotation: snapped.rotation });
        return id;
      }
      if (catalogItem.type === 'security-camera') {
        const snapped = snapWallMountedItem({
          position: position ?? { x: 0, z: 0 },
          itemWidth: catalogItem.width,
          itemDepth: catalogItem.depth,
          roomWidth,
          roomDepth,
          ...gap,
        });
        const id = actions.addCatalogItem(catalogItem, snapped.position);
        actions.updateItem(id, { rotation: snapped.rotation, wallRotation: snapped.rotation });
        return id;
      }
      // Outdoor items belong outside the building on the ground. `addCatalogItem`
      // targets the ACTIVE floor, so placing one while an upper floor is active
      // lands it on that floor's ring hovering mid-air past the wall (#73c).
      // The drag-plane Y is 0 only on the ground floor, so a non-zero Y means an
      // upper floor is active — block the placement rather than float the item.
      // (Re-homing it onto the ground floor would need a reducer change, which a
      // sibling branch owns, so we no-op instead.)
      if (catalogItem.category === 'outdoor' && activeFloorY > 0) {
        return '';
      }
      // Outdoor items belong outside the building — default them just past
      // the south wall instead of the room centre when no position is given.
      if (catalogItem.category === 'outdoor' && !position) {
        const outsidePos = { x: 0, z: roomDepth / 2 + catalogItem.depth / 2 + 0.5 };
        return actions.addCatalogItem(catalogItem, outsidePos);
      }
      const base = layout ?? { name: '放置', width: roomWidth, height: roomDepth, floors: [activeFloor] };
      // 落点避让：撞上已有物件 / 墙 / 禁入区就沿最近的环位挪开，落进画面的是空位。
      const requested = position ?? { x: 0, z: 0 };
      const resolved = findFreePosition({
        item: { ...catalogItem, id: '__placement_preview__', position: requested, rotation: 0 },
        others: activeFloor.items,
        roomWidth,
        roomDepth,
        context: {},
      });
      if (!resolved) return '';
      const candidateItem = { ...catalogItem, id: '__placement_preview__', position: resolved, rotation: 0 };
      const candidate = { ...base, floors: base.floors.map(f => f.id === activeFloor.id ? { ...f, items: [...f.items, candidateItem] } : f) };
      if (!canApplyLayoutGeometry(base, candidate)) return '';
      const id = actions.addCatalogItem(catalogItem, resolved);
      actions.setLocked(id, false);
      return id;
    },
    [actions, activeFloor, layout, activeFloorY, roomWidth, roomDepth, gap, planActions, placeViaPlan]
  );

  return { snapPosition, getDragPlaneY, placeCatalogItem };
}
