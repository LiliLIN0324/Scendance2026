import { useCallback, useRef, type MutableRefObject } from 'react';
import { findFreePosition, hasCollisions, type KeepOutRect } from '../lib/geometry';
import { isWallHung } from '../lib/mount-band';
import { isWallMounted, settleWallMountedItem, type WallGap } from '../lib/opening-snap';
import { layoutGeometryIsAcceptable, structuralItemCollides } from '../lib/structural-layout';
import {
  advanceGroupScaleSession,
  advanceTransformSession,
  createGroupScaleSession,
  createTransformSession,
  type GizmoMode,
  type GroupScaleSession,
  type TransformSession,
} from '../lib/transform';
import type { LayoutActions } from './use-layout-state';
import type { FloorLayout, RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

export interface UseItemDragParams {
  activeFloor: FloorLayout;
  layout?: RoomLayout;
  activeFloorIndex: number;
  roomWidth: number;
  roomDepth: number;
  /** The porch of a recessed entrance, out of bounds like the walls (#285). */
  keepOut: readonly KeepOutRect[];
  /** The recessed entrance's span of the front wall: openings settle on its piers (#394). */
  frontGap: WallGap | null;
  actions: LayoutActions;
  allSelectedIds: ReadonlySet<string>;
  /** 'move' is the ground-plane drag; 'rotate'/'scale' dial the item instead (#P0-3). */
  gizmoMode?: GizmoMode;
  /**
   * Fired once per gesture when the scale ratio hits the 0.2×/5× clamp, so the
   * editor can surface a toast instead of silently stopping at the limit.
   */
  onScaleLimit?: (limit: 'min' | 'max') => void;
}

export interface DragCancelOptions {
  /** Move the fast-path groups back to the session's origins (#292). */
  restore?: boolean;
}

export interface UseItemDragResult {
  /**
   * useThreeScene is called after this hook (its options include the drag
   * callbacks below), so its scene ref and invalidate fn are late-bound
   * through these boxes for use in the fast-path helpers.
   */
  sceneBoxRef: MutableRefObject<MutableRefObject<ThreeNS.Scene | null> | null>;
  invalidateBoxRef: MutableRefObject<() => void>;
  handleDragStart(primaryId: string): void;
  handleDrag(id: string, x: number, z: number): void;
  handleDragEnd(id: string): void;
  /**
   * Discard the session without committing anything. Either the canvas
   * handler's captured group was rebuilt away (#207 follow-up) — state is
   * authoritative, leave the scene alone — or the browser cancelled the
   * pointer (`restore`, #292): put every member's group back at its origin.
   */
  handleDragCancel(id: string, options?: DragCancelOptions): void;
  /** True between a drag session opening (past the threshold) and release. */
  isDragActive(): boolean;
}

/**
 * Drag fast-path. While a drag is in progress the Three.js groups are moved
 * directly and the single state dispatch is deferred to drag end —
 * dispatching per mousemove (the old behaviour) tore down and rebuilt every
 * furniture mesh on each pointer event. `origins` snapshots the selection's
 * starting positions for group drags; `latest` accumulates in-flight
 * positions and becomes one bulkSetPositions on release (which also gives
 * undo a single entry per gesture instead of one per mousemove).
 */
// True if any entry's latest position differs from its origin. A pure
// click-select (or any gesture with no net movement) leaves latest === origins,
// which must not commit state or lock the item.
function sessionMoved(
  origins: Map<string, { x: number; z: number }>,
  latest: Map<string, { x: number; z: number }>
): boolean {
  const EPS = 1e-4;
  for (const [id, origin] of origins) {
    const now = latest.get(id);
    if (!now) continue;
    if (Math.abs(now.x - origin.x) > EPS || Math.abs(now.z - origin.z) > EPS) {
      return true;
    }
  }
  return false;
}

export function useItemDrag({
  activeFloor,
  layout,
  activeFloorIndex,
  roomWidth,
  roomDepth,
  keepOut,
  frontGap,
  actions,
  allSelectedIds,
  gizmoMode = 'move',
  onScaleLimit,
}: UseItemDragParams): UseItemDragResult {
  const sceneBoxRef = useRef<MutableRefObject<ThreeNS.Scene | null> | null>(null);
  const invalidateBoxRef = useRef<() => void>(() => {});

  /** A rotate/scale gesture dials either one item or (scale only) the whole selection. */
  type TransformGesture =
    | { kind: 'single'; session: TransformSession; noticedLimit: 'min' | 'max' | null }
    | { kind: 'group-scale'; session: GroupScaleSession; noticedLimit: 'min' | 'max' | null };

  const dragSessionRef = useRef<{
    primaryId: string;
    origins: Map<string, { x: number; z: number }>;
    latest: Map<string, { x: number; z: number }>;
    valid: Map<string, { x: number; z: number }>;
    /** Rotate/scale sessions dial the primary item instead of translating it. */
    transform: TransformGesture | null;
  } | null>(null);

  const findFurnitureGroup = useCallback(
    (itemId: string) =>
      sceneBoxRef.current?.current?.children.find(
        (obj) =>
          obj.userData.type === 'furniture' &&
          obj.userData.id === itemId &&
          obj.userData.floorIndex === activeFloorIndex
      ) ?? null,
    [activeFloorIndex]
  );

  // Live collision feedback during the fast-path: tint the dragged group's
  // emissive channel instead of rebuilding its meshes. Original emissive
  // values (lamp glow, TV screens) are stashed on material.userData and
  // restored on release.
  const setDragCollisionTint = useCallback((group: ThreeNS.Object3D, colliding: boolean) => {
    group.traverse((node) => {
      const material = (node as ThreeNS.Mesh).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const mat of materials) {
        const std = mat as ThreeNS.MeshStandardMaterial;
        if (!std.emissive) continue;
        if (colliding) {
          if (std.userData.dragTint === undefined) std.userData.dragTint = std.emissive.getHex();
          std.emissive.setHex(0x7f1d1d);
        } else if (std.userData.dragTint !== undefined) {
          std.emissive.setHex(std.userData.dragTint as number);
          delete std.userData.dragTint;
        }
      }
    });
  }, []);

  const handleDragStart = useCallback(
    (primaryId: string) => {
      // Rotate dials the primary item only; scale can dial a multi-selection as
      // a group around its centroid (keyboard R still rotates groups).
      if (gizmoMode !== 'move') {
        if (gizmoMode === 'scale' && allSelectedIds.size > 1) {
          const members = activeFloor.items.filter(
            (entry) => allSelectedIds.has(entry.id) && !entry.locked && entry.position
          );
          const groupSession = members.length > 1 ? createGroupScaleSession(members) : null;
          if (groupSession) {
            dragSessionRef.current = {
              primaryId,
              origins: new Map(),
              latest: new Map(),
              valid: new Map(),
              transform: { kind: 'group-scale', session: groupSession, noticedLimit: null },
            };
            return;
          }
        }
        const item = activeFloor.items.find((entry) => entry.id === primaryId);
        const transform = item ? createTransformSession(item) : null;
        dragSessionRef.current = {
          primaryId,
          origins: new Map(),
          latest: new Map(),
          valid: new Map(),
          transform: transform ? { kind: 'single', session: transform, noticedLimit: null } : null,
        };
        return;
      }
      const ids = allSelectedIds.size > 1 ? allSelectedIds : new Set([primaryId]);
      const origins = new Map<string, { x: number; z: number }>();
      for (const id of ids) {
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (!item?.position) continue;
        // Locked co-selected items stay put during a group drag — only the
        // session's members are translated and committed (#115). The primary
        // is always unlocked: the canvas handler refuses to start a drag on a
        // locked item.
        if (item.locked && id !== primaryId) continue;
        origins.set(id, { x: item.position.x, z: item.position.z });
      }
      dragSessionRef.current = {
        primaryId,
        origins,
        latest: new Map(origins),
        valid: new Map(origins),
        transform: null,
      };
    },
    [allSelectedIds, activeFloor.items, gizmoMode]
  );

  const handleDrag = useCallback(
    (id: string, x: number, z: number) => {
      const session = dragSessionRef.current;
      if (!session || session.primaryId !== id) {
        // No drag session (programmatic move) — dispatch directly.
        actions.moveItem(id, x, z);
        return;
      }
      if (session.transform) {
        const gesture = session.transform;
        if (gesture.kind === 'group-scale') {
          const t = advanceGroupScaleSession(gesture.session, x, z);
          for (const member of t.members) {
            const group = findFurnitureGroup(member.id);
            if (!group) continue;
            group.position.x = member.x;
            group.position.z = member.z;
            group.scale.set(member.scaleX, 1, member.scaleZ);
          }
          invalidateBoxRef.current();
          if (t.limit && gesture.noticedLimit !== t.limit) {
            gesture.noticedLimit = t.limit;
            onScaleLimit?.(t.limit);
          }
          return;
        }
        const t = advanceTransformSession(gesture.session, x, z, gizmoMode as 'rotate' | 'scale');
        const group = findFurnitureGroup(id);
        if (group) {
          if (gizmoMode === 'rotate') {
            group.rotation.y = t.rotation;
          } else {
            group.scale.set(t.width / gesture.session.baseWidth, 1, t.depth / gesture.session.baseDepth);
          }
        }
        invalidateBoxRef.current();
        if (t.limit && gesture.noticedLimit !== t.limit) {
          gesture.noticedLimit = t.limit;
          onScaleLimit?.(t.limit);
        }
        return;
      }
      session.latest.set(id, { x, z });

      // Group drag: translate every other selected group by the same delta.
      // The primary group was already moved by the canvas drag handler.
      const primaryOrigin = session.origins.get(id);
      if (primaryOrigin && session.origins.size > 1) {
        const dx = x - primaryOrigin.x;
        const dz = z - primaryOrigin.z;
        for (const [otherId, origin] of session.origins) {
          if (otherId === id) continue;
          const next = { x: origin.x + dx, z: origin.z + dz };
          session.latest.set(otherId, next);
          const group = findFurnitureGroup(otherId);
          if (group) {
            group.position.x = next.x;
            group.position.z = next.z;
          }
        }
      }

      const candidateItems = activeFloor.items.map((item) => {
        const moved = session.latest.get(item.id);
        return moved ? { ...item, position: moved } : item;
      });
      const base = layout ?? { name: '拖动', width: roomWidth, height: roomDepth, floors: [activeFloor] };
      const candidate = { ...base, floors: base.floors.map(f => f.id === activeFloor.id ? { ...f, items: candidateItems } : f) };
      // 2026-11-11 宽松闸门：规划阶段允许"先停住再调"——穿透/尺寸冲突不再让 valid 失效，
      // 只有 schema 非法或洞口 marker 数对不上才拦住。穿透提示由下方 setDragCollisionTint 染红。
      if (layoutGeometryIsAcceptable(base, candidate)) session.valid = new Map(session.latest);
      const dragged = candidateItems.find((item) => item.id === id);
      const primaryGroup = findFurnitureGroup(id);
      if (dragged && primaryGroup) {
        setDragCollisionTint(primaryGroup, structuralItemCollides(dragged, candidate, activeFloorIndex) || hasCollisions(dragged, candidateItems, roomWidth, roomDepth, { keepOut, structureValidated: !!layout?.backendSceneV2, interiorWalls: layout?.backendSceneV2 ? [] : activeFloor.interiorWalls }));
      }
      invalidateBoxRef.current();
    },
    [actions, activeFloor, activeFloorIndex, layout, roomWidth, roomDepth, keepOut, findFurnitureGroup, setDragCollisionTint, gizmoMode, onScaleLimit]
  );

  const handleDragEnd = useCallback(
    (id: string) => {
      const session = dragSessionRef.current;
      dragSessionRef.current = null;
      if (session?.transform) {
        const gesture = session.transform;
        if (gesture.kind === 'group-scale') {
          for (const member of gesture.session.members) {
            const group = findFurnitureGroup(member.id);
            if (!group) continue;
            group.position.x = member.baseX;
            group.position.z = member.baseZ;
            group.scale.set(1, 1, 1);
          }
          invalidateBoxRef.current();
          if (!gesture.session.moved) return;
          const positions = new Map<string, { x: number; z: number }>();
          for (const member of gesture.session.result) {
            const base = gesture.session.members.find((entry) => entry.id === member.id);
            if (!base) continue;
            if (Math.abs(member.x - base.baseX) > 1e-4 || Math.abs(member.z - base.baseZ) > 1e-4) {
              positions.set(member.id, { x: member.x, z: member.z });
            }
            const item = activeFloor.items.find((entry) => entry.id === member.id);
            if (!item) continue;
            if (Math.abs(member.width - item.width) > 1e-4) actions.resizeItem(member.id, 'width', member.width);
            if (Math.abs(member.depth - item.depth) > 1e-4) actions.resizeItem(member.id, 'depth', member.depth);
          }
          if (positions.size > 0) actions.bulkSetPositions(positions);
          return;
        }
        const t = gesture.session;
        const group = findFurnitureGroup(id);
        // Hand the preview back to the rebuild before committing.
        if (group) {
          group.rotation.y = t.baseRotation;
          group.scale.set(1, 1, 1);
        }
        invalidateBoxRef.current();
        if (!t.moved) return;
        if (gizmoMode === 'rotate') {
          actions.setRotation(id, t.rotation);
          // Wall-mounted pieces re-seat onto whichever wall they now face.
          const item = activeFloor.items.find((entry) => entry.id === id);
          if (item) {
            const settled = settleWallMountedItem(
              item,
              item.position ?? { x: 0, z: 0 },
              roomWidth,
              roomDepth,
              activeFloor.interiorWalls ?? [],
              frontGap
            );
            if (settled) actions.updateItem(id, settled);
          }
        } else {
          actions.resizeItem(id, 'width', t.width);
          actions.resizeItem(id, 'depth', t.depth);
        }
        return;
      }
      if (session) {
        session.latest = session.valid;
        for (const [memberId, position] of session.latest) {
          const group = findFurnitureGroup(memberId);
          if (group) { group.position.x = position.x; group.position.z = position.z; setDragCollisionTint(group, false); }
        }
        invalidateBoxRef.current();
      }
      const finalPos = session?.latest.get(id);
      // A gesture that never actually moved anything (a stray zero-distance
      // drag) must not write state or add an undo entry, and must not re-lock
      // the item — otherwise a click silently blocks the next nudge/delete
      // (see #65). A real drag always leaves at least one position changed.
      const moved = session ? sessionMoved(session.origins, session.latest) : false;
      if (session && finalPos && moved) {
        const primaryGroup = findFurnitureGroup(id);
        if (primaryGroup) setDragCollisionTint(primaryGroup, false);
        // 单件落点若和别的物件 / 墙撞上，收手时挪到最近的空位；成组拖动保持相对位置，不拆散。
        if (session.latest.size === 1) {
          const item = activeFloor.items.find((entry) => entry.id === id);
          if (
            item &&
            item.category !== 'outdoor' &&
            item.type !== 'stairs' &&
            !isWallHung(item.type) &&
            !isWallMounted(item.type)
          ) {
            const resolved = findFreePosition({
              item: { ...item, position: finalPos },
              others: activeFloor.items,
              roomWidth,
              roomDepth,
              context: { keepOut, interiorWalls: activeFloor.interiorWalls ?? [] },
            });
            if (resolved) session.latest.set(id, resolved);
          }
        }
        // Single dispatch for the whole gesture; the rebuild effect runs once.
        actions.bulkSetPositions(session.latest);
      }
      if (!moved || !session) return;
      // Position changes do not change the user's explicit lock setting.
      // Otherwise a first drag silently disables every subsequent edit.
      // On release, settle every wall-mounted item in the commit — doors and
      // windows re-snap their position AND wall-aligned rotation (a drag to a
      // different wall otherwise keeps the stale rotation, #62; a group drag
      // otherwise strands them mid-room, #116), and cameras additionally
      // record the wall's inward-normal yaw and re-seat for their mount
      // style. Doing this on drop (not per drag frame) keeps the drag itself
      // smooth instead of flipping between walls. Note: read positions from
      // the drag session — state is one dispatch behind here.
      for (const [movedId, releasePos] of session.latest) {
        const item = activeFloor.items.find((entry) => entry.id === movedId);
        if (!item) continue;
        const settled = settleWallMountedItem(
          item,
          releasePos,
          roomWidth,
          roomDepth,
          activeFloor.interiorWalls ?? [],
          frontGap
        );
        if (settled) actions.updateItem(movedId, settled);
      }
    },
    [activeFloor.items, activeFloor.interiorWalls, roomWidth, roomDepth, frontGap, actions, findFurnitureGroup, setDragCollisionTint, gizmoMode]
  );

  const handleDragCancel = useCallback(
    (id: string, options?: DragCancelOptions) => {
      // No dispatch, no lock, no settle. After a rebuild (cross-tab adopt,
      // library load) the scene already shows authoritative state —
      // committing `latest` would overwrite it with in-flight positions.
      const session = dragSessionRef.current;
      dragSessionRef.current = null;
      if (!session || options?.restore !== true) return;
      if (session.transform) {
        const gesture = session.transform;
        if (gesture.kind === 'group-scale') {
          for (const member of gesture.session.members) {
            const group = findFurnitureGroup(member.id);
            if (!group) continue;
            group.position.x = member.baseX;
            group.position.z = member.baseZ;
            group.scale.set(1, 1, 1);
          }
          invalidateBoxRef.current();
          return;
        }
        const group = findFurnitureGroup(id);
        if (group) {
          group.rotation.y = gesture.session.baseRotation;
          group.scale.set(1, 1, 1);
        }
        invalidateBoxRef.current();
        return;
      }
      // A pointercancel (OS gesture, palm rejection) undoes the drag: the
      // fast path moved the groups directly, so move them back (#292).
      for (const [memberId, origin] of session.origins) {
        const group = findFurnitureGroup(memberId);
        if (!group) continue;
        group.position.x = origin.x;
        group.position.z = origin.z;
        if (memberId === id) setDragCollisionTint(group, false);
      }
      invalidateBoxRef.current();
    },
    [findFurnitureGroup, setDragCollisionTint]
  );

  const isDragActive = useCallback(() => dragSessionRef.current !== null, []);

  return {
    sceneBoxRef,
    invalidateBoxRef,
    handleDragStart,
    handleDrag,
    handleDragEnd,
    handleDragCancel,
    isDragActive,
  };
}
