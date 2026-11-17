'use client';

/**
 * 户外规划 3D 视角（P2-k，2026-11-11 换成完整渲染管线）。
 *
 * 用户口径：**一进来先是 2D 地图，右侧「视角」钮才切 3D**；3D 要和主编辑器看到的
 * 那套场地一致，而不是临时低模（m02145 图1/图2）。所以：
 *
 * - 地面：按场地边界范围抓一块瓦片影像（2D 同一图源；天地图两档走 /api/tdt-tiles），
 *   直接贴在地面上；拿不到瓦片时退回纸面底色 + 米制网格。
 * - 场地实体：调 `buildPlanFootprint`——边界轮廓 + 分区色块 + 设施占地 + 设施实体
 *   （帐篷/舞台/餐车/厕位/摊位/岗亭/垃圾桶）+ 动线 + 出入口/人员点位 + 地面文字，
 *   与 2D 画布同一份 `SitePlanData`，不再手写矮墙/盒子。
 * - 环绕/缩放用 OrbitControls（滚轮与右侧工具排缩放）；切回 2D 由外层按钮负责。
 *
 * 坐标系：站点 ENU（x 东、y 北，单位米）→ three（x, y 上, -y）。
 * 这样「北」朝屏幕里侧（-Z），与底图影像上北下南一致。
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { enuToLngLat, lngLatToEnu, planMetersPerPixel, planPointToPixel, type PlanViewport } from '@/components/room-organizer/lib/outdoor-plan-canvas';
import { basemapSourceAttribution } from '@/components/room-organizer/lib/tdt-probe';
import { BasemapTileCache } from '@/components/room-organizer/lib/plan-tile-cache';
import { GeoScaleCompass } from '@/components/room-organizer/components/geo-scale-compass';
import { buildPlanFootprint } from '@/components/room-organizer/three/plan-footprint-builder';
import {
  collectPlaceholdersByPropId,
  createPlanModelLayer,
} from '@/components/room-organizer/three/plan-model-layer';
import {
  type SiteFrame,
  type TilePaintCache,
  coverFrameFromFrustum,
  frameFromMapView,
  frameToBounds,
  maxZoomForSource,
  neededMapZoom,
  paintTiledGround,
  paintTilePyramid,
  ringFrame,
  squareFrame,
  tileHeight,
  unionFrames,
  zoomFromSpan,
} from '@/components/room-organizer/three/plan-basemap-tiles';
import { ROOM_OBJECT_TAGS } from '@/components/room-organizer/three/room-builder';
import {
  advanceGlbAnimations,
  createCachedGlbModel,
  createWalkAvatar,
  disposeOwnedModel,
  ensureGlbAsset,
} from '@/components/room-organizer/three/glb-assets';
import { advancePeopleAnimations, registerPersonAnim, takePersonControl } from '@/components/room-organizer/three/people-anim';
import { buildProceduralPerson } from '@/components/room-organizer/three/builders/builders-people';
import { findWalkRole } from '@/components/room-organizer/lib/walk-roles';
import { createPlanTrafficLayer } from '@/components/room-organizer/three/plan-traffic-layer';
import { createPlanVehicleEntitiesLayer } from '@/components/room-organizer/three/plan-vehicle-entities';
import { createPlanRoleLabels } from '@/components/room-organizer/three/plan-role-labels';
import { libraryEntryColor } from '@/components/room-organizer/lib/oneplan-library';
import { workerRoleColor, workerSticker } from '@/components/room-organizer/lib/oneplan-stickers';
import type { WalkViewMode } from '@/components/room-organizer/lib/walk-view-modes';
import {
  InteractRegistry,
  nearestNearbyEntry,
  type InteractableEntry,
} from '@/components/room-organizer/lib/interact-registry';
import { facilityInteractables, interactHintLabel, seatInteractables, workerInteractables } from '@/components/room-organizer/lib/outdoor-interactables';
import {
  facilityProp,
  planFootprintShapes,
  planShellFrame,
  type PlanPropShape,
} from '@/components/room-organizer/lib/plan-footprint-geometry';
import type { PlanSceneObject } from '@/components/room-organizer/lib/plan-item-bridge';
import { acquireWebGLSurface } from '@/components/room-organizer/lib/webgl-context';
import {
  planCrowdShellPlacements,
  planSceneObjectPlacements,
  type SceneObjectPlacement,
} from '@/components/room-organizer/lib/plan-scene-placement';
import { assignCrowdWalkRoutes } from '@/components/room-organizer/lib/plan-crowd-routes';
import {
  splatPlacementOffset,
  splatVenueSpan,
  splatWorldPosition,
} from '@/components/room-organizer/lib/plan-splat-placement';
import { createSplatPreview, type SplatPreview } from '@/components/room-organizer/three/splat-preview';
import { RESEARCH_BASEMAP_TAG } from '@/components/room-organizer/three/research-basemap';
import {
  FACILITY_HANDLE_MIN_FOOTPRINT_PX,
  FACILITY_ROTATE_GAP_PX,
  facilityFootprintRing,
  facilityHandles,
  facilityContainsPoint,
} from '@/components/room-organizer/lib/site-plan-facilities';
import {
  findAholoAsset,
  resolveAholoAssetUrl,
} from '@/components/room-organizer/lib/aholo-assets';
import {
  defaultSiteCalibration,
  readSiteCalibration,
} from '@/components/room-organizer/lib/site-capture';
import type { FurnitureItem } from '@/components/room-organizer/lib/types';
import { OUTDOOR_WALK_CANVAS_ID } from '@/components/room-organizer/lib/walk-engage';
import { clearPlanFacilityDrag, getPlanFacilityDrag } from '@/components/room-organizer/lib/plan-facility-drag';
import { clearPlanCatalogDrag, getPlanCatalogDrag, parsePlanCatalogDrag, PLAN_CATALOG_DRAG_MIME } from '@/components/room-organizer/lib/plan-catalog-drag';
import { CATALOG_DRAG_MIME } from '@/components/room-organizer/lib/catalog-drag';
import { useOutdoorWalk, type SeatWalkState } from '@/components/room-organizer/hooks/use-outdoor-walk';
import type { CanvasBasemapSource, OutdoorPlanCanvasHandle, PlanEditVisuals } from '@/components/room-organizer/components/outdoor-plan-canvas';
import { type PlanFacility, type PlanPoint, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** 没锚点的场地（纯纸面规划）用的地面底色。 */
const PAPER_GROUND = '#efece4';
/** 倾斜后画面上方露出的天空/雾色，不要再露出一块裁切底。 */
const SKY_GROUND = '#c9d4dc';

/** 规划贴地层（真模型/室内物件投影/人群）的公共底面：瓦片金字塔最高点 z19=0.048 m 之上 4 mm。
 *  2026-11-12 用户反馈「物体没放在平面上」：模型底面原来在 y=0，被 4 cm 高的瓦片盖住脚。
 *  syncFootprint 重摆时也必须带回这个底面，否则一编辑就又沉回 0。 */
const PLAN_LAYER_BASE_Y = 0.052;

/** 漫游视角档位按钮文案（与 walk-view-modes 四档对齐）。 */
const WALK_VIEW_LABEL: Record<WalkViewMode, string> = {
  orbit: '鸟瞰',
  first: '第一人称',
  third: '第三人称',
  shoulder: '过肩',
};



function addDraftOverlay(
  group: THREE.Group,
  frame: SiteFrame,
  draft: PlanEditVisuals["draft"],
  disposables: { dispose: () => void }[],
): void {
  if (!draft) return;
  const y = 0.7;
  const addLine = (points: PlanPoint[], color: string, closed: boolean, lineY = y): void => {
    if (points.length < 2) return;
    const pts = closed && points.length >= 3 ? [...points, points[0]!] : points;
    const positions: number[] = [];
    for (const point of pts) {
      positions.push(point.x - frame.cx, lineY, -(point.y - frame.cy));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    const material = new THREE.LineBasicMaterial({ color, depthTest: true });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 12;
    group.add(line);
    disposables.push(geometry, material);
  };
  const addDots = (points: PlanPoint[], color: string): void => {
    if (!points.length) return;
    const geometry = new THREE.SphereGeometry(0.55, 12, 10);
    const material = new THREE.MeshBasicMaterial({ color });
    disposables.push(geometry, material);
    for (const point of points) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(point.x - frame.cx, y + 0.04, -(point.y - frame.cy));
      group.add(mesh);
    }
  };
  if (draft.ring.length) {
    if (draft.fill && draft.ring.length >= 3) {
      const shape = new THREE.Shape();
      draft.ring.forEach((point, index) => {
        const x = point.x - frame.cx;
        const yy = point.y - frame.cy;
        if (index === 0) shape.moveTo(x, yy);
        else shape.lineTo(x, yy);
      });
      shape.closePath();
      const geometry = new THREE.ShapeGeometry(shape);
      const material = new THREE.MeshBasicMaterial({
        color: draft.ringColor,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y - 0.04;
      group.add(mesh);
      disposables.push(geometry, material);
    }
    addLine(draft.ring, draft.ringColor, draft.fill);
    addDots(draft.ring, "#ffffff");
  }
  /**
   * 2026-11-16 设施落位幽灵：与 2D 画布同一份 footprint ring（含旋转），
   * 越界红、合法绿；贴地画填充 + 闭口轮廓，不再只在隐藏的 2D 画布上。
   */
  if (draft.facilityGhost && draft.facilityGhost.ring.length >= 3) {
    const color = draft.facilityGhost.invalid ? "#c0392b" : "#2f9e44";
    const ghostY = 0.12;
    const shape = new THREE.Shape();
    draft.facilityGhost.ring.forEach((point, index) => {
      const x = point.x - frame.cx;
      const yy = point.y - frame.cy;
      if (index === 0) shape.moveTo(x, yy);
      else shape.lineTo(x, yy);
    });
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = ghostY - 0.02;
    group.add(mesh);
    disposables.push(geometry, material);
    // 贴地画：幽灵轮廓不跟随 zone/boundary 的 0.7m 抬高，否则像浮在空中。
    addLine(draft.facilityGhost.ring, color, true, ghostY);
  }
  if (draft.route.length) {
    addLine(draft.route, draft.routeColor, false);
    addDots(draft.route, draft.routeColor);
  }
  if (draft.measure.length) {
    const closed = draft.measure.length >= 3;
    addLine(draft.measure, draft.measureColor, closed);
    addDots(draft.measure, draft.measureColor);
  }
  if (draft.annotate.length) {
    addLine(draft.annotate, draft.annotateColor, draft.annotate.length >= 3);
    addDots(draft.annotate, draft.annotateColor);
  }
  if (draft.ghostMarker) addDots([draft.ghostMarker.position], draft.ghostMarker.color);
}


/** 从正上方向南侧斜看：北朝屏幕里，和 2D 地图上北下南一致。 */
const MAP_TILT_POLAR = (58 * Math.PI) / 180;
const MAP_TILT_MS = 650;

function cameraPose(target: THREE.Vector3, span: number, polar: number, fovDeg: number): THREE.Vector3 {
  const dist = (span * 0.55) / Math.tan((fovDeg * Math.PI) / 360);
  const horiz = dist * Math.sin(polar);
  return new THREE.Vector3(target.x, target.y + dist * Math.cos(polar), target.z + horiz);
}

export interface OutdoorPlan3DApi {
  zoomBy(direction: 1 | -1): void;
  focusLngLat(lng: number, lat: number): void;
  /**
   * 回到框选场地（右下回选址靶心）：有设计范围就框设计范围，没圈就框场地边界，
   * 镜头回到「北在上、俯视整块场地」的默认机位。与 2D 那颗回调同口径（2026-11-16）。
   */
  focusVenue(): void;
  /** 相机回正正北（保留距离与俯仰角）；右上指北针钮调用。 */
  resetNorth(): void;
  /** 当前相机水平方位角（弧度，0 = 正北）；右列大罗盘实时读指针用。 */
  getBearing(): number;
  /** 罗盘左右拖动：按弧度增量绕目标旋转相机，保留距离与俯仰角。 */
  orbitByDelta(deltaTheta: number): void;
  /** 同步渲染一帧后读 canvas：接管态（主画布复用本组件）导出效果图用。 */
  captureImage(): string | null;
}

export interface OutdoorPlan3DProps {
  plan: SitePlanData;
  /** 跟 2D 画布同一个图源，3D 地面直接贴同一套瓦片（默认 osm）。 */
  source?: CanvasBasemapSource;
  /**
   * docs/46 V-P1：地面形态（2D 覆盖层的纸面开关写进 ground-mode store，外层订阅传入）。
   * paper = 纸面虚拟场地：不铺瓦片，落纸面地面 + 米制网格（与「无锚点纯纸面」同一套）。
   */
  groundMode?: 'map' | 'paper';
  /** 2D 上的物料 / 场景落点（由 plan-item-bridge 派生）。 */
  sceneObjects?: readonly PlanSceneObject[] | undefined;
  /** 顶左角状态文案（切回 2D 由外层按钮负责，这里只报状态）。 */
  onReady?: () => void;
  /** 切进来时所对的 2D 视口：镜头从正上方斜到这个中心，地面覆盖同一块地图。 */
  mapView?: PlanViewport | undefined;
  /** 外层覆盖层的缩放 / 搜地点飞点。 */
  apiRef?: MutableRefObject<OutdoorPlan3DApi | null>;
  /** 2D 画布句柄：3D 里点选/绘制走同一套编辑手势。 */
  canvasApiRef?: RefObject<OutdoorPlanCanvasHandle | null>;
  /**
   * 2026-11-12 保活：切换 2D/3D 时组件**不卸载**（重建 three 场景 + 抓瓦片 + 重新起倾斜
   * 动画会明显顿一下）。active=false 时只推进瓦片 LOD、不提交渲染；切回来即用当前镜头。
   */
  active?: boolean;
  /**
   * 一期户外第一人称漫游启用态：外层独立信号（不翻旧室内 `walkthroughMode` 链路）。
   * 为真时停用 OrbitControls、挂 PointerLockControls，步行钳制在 `plan.boundary` 内。
   */
  walkEnabled?: boolean;
  walkChooserOpen?: boolean;
  onCloseWalkChooser?: () => void;
  onWalkStart?: (mode: WalkViewMode) => void;
  /** 漫游退出收口（第二次 Esc 或再点漫游钮），交外层把启用态置回 false。 */
  onWalkExit?: () => void;
  /** 漫游视角档位（orbit/first/third/shoulder）；first 为相机即锚点，third/shoulder 显示占位 avatar 并后拉相机。 */
  viewMode?: WalkViewMode;
  /** 点视角切换钮时交外层循环到下一档（快捷键也走外层状态）。 */
  onCycleView?: () => void;
  /** E 键触发可交互物时回调条目（一期占位，#61 对话接这里）。 */
  onInteract?: (entry: InteractableEntry) => void;
}

interface WalkActor {
  id: string;
  label: string;
  image: string | null;
  group: THREE.Group;
}

export default function OutdoorPlan3D({
  plan,
  source = 'amap-streets',
  groundMode = 'map',
  sceneObjects,
  onReady,
  mapView,
  apiRef,
  canvasApiRef,
  active = true,
  walkEnabled = false,
  walkChooserOpen = false,
  onCloseWalkChooser,
  onWalkStart,
  onWalkExit,
  viewMode = 'first',
  onCycleView,
  onInteract,
}: OutdoorPlan3DProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);
  // 保活态：隐藏时仍旧跑 LOD，但不渲染（不可见的 GPU 耗时没意义）。
  const activeRef = useRef(active);
  activeRef.current = active;
  // 漫游态镜像给挂载在 three 场景上的指针事件闭包读，避免重跑挂载 effect 掉指针锁。
  const walkEnabledRef = useRef(walkEnabled);
  walkEnabledRef.current = walkEnabled;
  // 视角档位镜像给主 loop / 事件闭包读（同 walkEnabledRef 口径，避免重跑挂载 effect）。
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const [walkCanvas, setWalkCanvas] = useState<HTMLCanvasElement | null>(null);
  const walkChooserRef = useRef<HTMLDialogElement>(null);
  const [walkActors, setWalkActors] = useState<WalkActor[]>([]);
  const controlledActorRef = useRef<{
    actor: WalkActor;
    control: NonNullable<ReturnType<typeof takePersonControl>>;
    spawn: { x: number; z: number; yaw: number };
  } | null>(null);
  const onWalkExitRef = useRef(onWalkExit);
  onWalkExitRef.current = onWalkExit;
  const releaseControlledActor = useCallback(() => {
    const controlled = controlledActorRef.current;
    if (!controlled) return false;
    controlled.control.release();
    controlledActorRef.current = null;
    return true;
  }, []);

  useEffect(() => {
    if (!walkEnabled) {
      releaseControlledActor();
      // 退出漫游清掉落座，避免下次进漫游钉在旧座位。
      seatStateRef.current = null;
      setSeatActiveId(null);
    }
  }, [walkEnabled, releaseControlledActor]);

  useEffect(() => {
    const dialog = walkChooserRef.current;
    if (!dialog) return;
    if (walkChooserOpen && !dialog.open) dialog.showModal();
    if (!walkChooserOpen && dialog.open) dialog.close();
  }, [walkChooserOpen]);

  const startWalk = (actor?: WalkActor) => {
    if (!onWalkStart) return;
    if (actor) {
      const group = actor.group;
      const control = takePersonControl(actor.id, group);
      if (!control) return;
      const world = group.getWorldPosition(new THREE.Vector3());
      controlledActorRef.current = {
        actor, control, spawn: { x: world.x, z: world.z, yaw: group.rotation.y },
      };
    }
    walkFrameRef.current = null;
    walkChooserRef.current?.close();
    onWalkStart(actor ? 'third' : 'first');
  };
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  // 组件级引用（renderer/scene 本体在 mount effect 里）：captureImage 同步抓帧用。
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  // 真实模型层的“换代号”：plan 变化或组件卸载后自增，晚到的模型直接丢掉。
  const modelRunRef = useRef(0);
  const canvasEditApiRef = useRef(canvasApiRef);
  canvasEditApiRef.current = canvasApiRef;
  const layerApiRef = useRef<{ syncFootprint: (next: SitePlanData, selectedZoneId?: string | null) => void; syncEditVisuals: () => void } | null>(null);
  const compassRef = useRef<HTMLDivElement | null>(null);
  const scaleBarRef = useRef<HTMLDivElement | null>(null);
  const scaleLabelRef = useRef<HTMLSpanElement | null>(null);
  const lineMaterialsRef = useRef<{ resolution: THREE.Vector2 }[]>([]);
  // 漫游占位 avatar：第三人称 / 过肩档显示；帧姿态由 useOutdoorWalk 每帧写 ref，主 loop 摆位。
  const avatarGroupRef = useRef<THREE.Group | null>(null);
  const walkFrameRef = useRef<{ x: number; y: number; z: number; yaw: number; moving: boolean; thirdPerson: boolean } | null>(null);
  // E 键交互：注册表实例 + 当前近邻条目（HUD 提示 / E 键触发用）。
  const interactRegistryRef = useRef<InteractRegistry | null>(null);
  if (!interactRegistryRef.current) interactRegistryRef.current = new InteractRegistry();
  const [nearEntry, setNearEntry] = useState<InteractableEntry | null>(null);
  const nearEntryIdRef = useRef<string | null>(null);
  const nearEntryRef = useRef<InteractableEntry | null>(null);
  // 落座态：E 键座位条目写入 / 起身清空；hook 每帧据此钉住锚点与坐姿眼高。
  const seatStateRef = useRef<SeatWalkState | null>(null);
  const [seatActiveId, setSeatActiveId] = useState<string | null>(null);

  // 座位条目落座 / 起身：同一座位再按一次 E 起身。
  // 落座锚点按真实坐姿：朝椅面外、背靠椅背，髂部落在座面偏后一点。
  const SEAT_HIP_BACK_M = 0.12;
  const toggleSeatEntry = (entry: InteractableEntry) => {
    const seat = entry.seat;
    if (!seat) return;
    const current = seatStateRef.current;
    if (current?.active && current.seatId === entry.id) {
      seatStateRef.current = { active: false, x: current.x, z: current.z, eyeY: 1.6 };
      setSeatActiveId(null);
      return;
    }
    seatStateRef.current = {
      active: true,
      seatId: entry.id,
      // 与设施模型同一套朝向：模型 rotation.y = -deg，且资产默认朝「画布上方」= 北（three 的 -Z），
      // 而人物模型正面是 +Z，所以人要转 π - deg 才与椅面同向、背靠椅背；
      // 再沿朝向后退一点，让髂部落在座面偏后（游戏里通行的坐姿锚点）。
      x: seat.x - Math.sin(Math.PI - THREE.MathUtils.degToRad(seat.rotationDeg)) * SEAT_HIP_BACK_M,
      z: -seat.y - Math.cos(Math.PI - THREE.MathUtils.degToRad(seat.rotationDeg)) * SEAT_HIP_BACK_M,
      eyeY: seat.eyeY,
      ...(typeof seat.seatHeight === 'number' ? { seatHeight: seat.seatHeight } : {}),
      yaw: Math.PI - THREE.MathUtils.degToRad(seat.rotationDeg),
    };
    setSeatActiveId(entry.id);
  };
  nearEntryRef.current = nearEntry;
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  // 2026-11-17：多一个 unavailable——设备根本给不出 WebGL 时，3D 画不出来是事实，
  // 别再假称“正在取底图”或“先用纸面网格”，那两句话会把人引到错的地方。
  const [groundState, setGroundState] = useState<'loading' | 'satellite' | 'paper' | 'unavailable'>('loading');

  const zoomBy = useCallback((factor: number) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
    const distance = offset.length();
    if (distance < controls.minDistance || distance > controls.maxDistance) return;
    camera.position.copy(controls.target.clone().add(offset));
    controls.update();
  }, []);

  const zoomByStep = useCallback((direction: 1 | -1) => {
    zoomBy(direction > 0 ? 0.8 : 1.25);
  }, [zoomBy]);

  const focusLngLat = useCallback((lng: number, lat: number) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const anchor = plan.anchor;
    if (!camera || !controls || !anchor) return;
    const enu = lngLatToEnu(lng, lat, anchor.lng, anchor.lat);
    const target = new THREE.Vector3(enu.x, 0, -enu.y);
    const offset = camera.position.clone().sub(controls.target);
    controls.target.copy(target);
    camera.position.copy(target.clone().add(offset));
    controls.update();
  }, [plan.anchor]);

  /**
   * 回到框选场地：2D 焦点钮在 3D 接管态落到这里（此前只动了主场景相机，用户看到的
   * 3D 相机毫无反应）。取景口径与初始机位、漫游退出后的鸟瞰一致：目标点 = 场地中心，
   * 距离按包围盒跨度算到能看全，俯仰回到默认斜角、正北朝上。只动相机，不改 plan。
   */
  const focusVenue = useCallback((): void => {
    if (walkEnabledRef.current) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const scope = plan.designScope ?? [];
    const ring = scope.length >= 3 ? scope : plan.boundary;
    const frame = ringFrame(ring);
    const target = new THREE.Vector3(frame.cx, 0, -frame.cy);
    const span = Math.max(12, frame.span);
    camera.position.copy(cameraPose(target, span, MAP_TILT_POLAR, camera.fov));
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
  }, [plan.boundary, plan.designScope]);

  /** 罗盘回正朝北：保留目标点、距离与俯仰角，只把水平方位角归 0（北 = -z）。 */
  const resetNorth = useCallback((): void => {
    if (walkEnabledRef.current) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    const radius = offset.length();
    if (radius < 1e-6) return;
    const phi = Math.acos(THREE.MathUtils.clamp(offset.y / radius, -1, 1));
    // theta = 0：x = 0、z = +radius·sinφ，相机位于目标正南、看向正北，与初始机位一致。
    offset.set(0, radius * Math.cos(phi), radius * Math.sin(phi));
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }, []);

  /** 罗盘拖动转盘：按增量弧度绕目标水平旋转，保留距离与俯仰角。 */
  const orbitByDelta = useCallback((deltaTheta: number): void => {
    if (walkEnabledRef.current) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls || !deltaTheta) return;
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += deltaTheta;
    offset.setFromSpherical(spherical);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }, []);

  /** 当前水平方位角（弧度）。与渲染循环里的 heading 同口径，0 = 正北。 */
  const getBearing = useCallback((): number => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return 0;
    const dx = camera.position.x - controls.target.x;
    const dz = camera.position.z - controls.target.z;
    return Math.atan2(-dx, dz);
  }, []);

  const captureImage = useCallback((): string | null => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return null;
    // 主渲染器没有 preserveDrawingBuffer：先同步渲染一帧再立即读 canvas。
    renderer.render(scene, camera);
    try {
      return renderer.domElement.toDataURL('image/png');
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = { zoomBy: zoomByStep, focusLngLat, focusVenue, resetNorth, getBearing, orbitByDelta, captureImage };
    return () => { apiRef.current = null; };
  }, [apiRef, zoomByStep, focusLngLat, focusVenue, resetNorth, getBearing, orbitByDelta, captureImage]);

  // 一期裸第一人称步行：指针锁 / WASD / 边界钳制自管在本组件内，旧室内
  // walkthroughMode 链路不动；退出由 onWalkExit 交外层收口。
  const { phase: walkPhase } = useOutdoorWalk({
    enabled: walkEnabled,
    canvas: walkCanvas,
    cameraRef,
    orbitRef: controlsRef,
    spawn: controlledActorRef.current?.spawn,
    boundary: plan.designScope?.length ? plan.designScope : plan.boundary,
    viewMode,
    seatRef: seatStateRef,
    onWalkFrame: (frame) => {
      walkFrameRef.current = frame;
      const controlled = controlledActorRef.current;
      const group = controlled?.actor.group;
      if (!controlled || !group?.parent) return;
      group.position.x = frame.x - group.parent.position.x;
      group.position.z = frame.z - group.parent.position.z;
      group.rotation.y = frame.yaw;
      group.visible = viewModeRef.current !== 'first';
      controlled.control.setMoving(frame.moving);
      controlled.control.setSeated(frame.seated === true, frame.seatHeight);
    },
    onExit: onWalkExit,
  });

  // #82 漫游鸟瞰档：退出指针锁、重新启用 OrbitControls 摆高空俯视机位，左键环绕 / 滚轮缩放；
  // 步行档把 OrbitControls 交回 hook（停用），非漫游态不动既有编辑环绕手势。
  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;
    const aerial = walkEnabled && viewMode === 'orbit';
    if (!aerial) {
      if (walkEnabled) controls.enabled = false;
      controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
      return;
    }
    const doc = walkCanvas?.ownerDocument ?? document;
    if (doc.pointerLockElement) {
      try { doc.exitPointerLock(); } catch { /* already unlocked */ }
    }
    controls.enabled = true;
    controls.enableRotate = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    // 高空 target 取玩家锚点；空方案 / 未出帧回退边界质心。
    const frame = ringFrame(plan.boundary);
    const player = walkFrameRef.current;
    const target = player
      ? new THREE.Vector3(player.x, 0, player.z)
      : new THREE.Vector3(frame.cx, 0, -frame.cy);
    controls.target.copy(target);
    const span = Math.max(12, frame.span);
    const aerialEye = cameraPose(target, span, Math.min(MAP_TILT_POLAR + 0.28, Math.PI * 0.42), 52);
    camera.position.copy(aerialEye);
    camera.lookAt(target);
    controls.update();
  }, [walkEnabled, viewMode, plan.boundary, walkCanvas]);

  // 岗位点位 / 设施 → 可交互条目：plan 变化时清空重登；动作回调交外层 onInteract（#61 对话接这里）。
  useEffect(() => {
    const registry = interactRegistryRef.current;
    if (!registry) return;
    registry.clear();
    const bind = (entry: InteractableEntry) =>
      registry.register(entry, ({ entry: e }) => onInteractRef.current?.(e));
    const workers = Array.isArray(plan.workers) ? plan.workers : [];
    for (const entry of workerInteractables(workers)) bind(entry);
    const facilities = Array.isArray(plan.facilities) ? plan.facilities : [];
    const seatEntries = seatInteractables(facilities);
    const seatIds = new Set(seatEntries.map((entry) => entry.id));
    for (const entry of facilityInteractables(facilities.filter((facility) => !seatIds.has(facility.id)))) bind(entry);
    for (const entry of seatEntries) {
      registry.register(entry, ({ entry: e }) => toggleSeatEntry(e));
    }
  }, [plan.workers, plan.facilities]);

  // E 键触发：仅漫游激活态绑定；跳过重复触发与输入框聚焦；近邻条目才生效。
  useEffect(() => {
    if (!walkEnabled) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || (event.target instanceof HTMLElement && event.target.matches('input, textarea, [contenteditable=true]'))) return;
      if (event.code !== 'KeyE') return;
      const registry = interactRegistryRef.current;
      const entry = nearEntryRef.current;
      if (!registry || !entry) return;
      registry.actionFor(entry.id)?.({ entry });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walkEnabled]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let disposed = false;
    let frame = 0;
    // 尺寸重试：挂载时容器可能还没量到，留着每帧重试（约 2 s 预算）。
    let sizeFrame = 0;
    let sizeRetryLeft = 120;
    let appliedWidth = 0;
    let appliedHeight = 0;
    let pixelRatioSettled = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    const disposables: { dispose: () => void }[] = [];
    // docs/46 V-P1：paper 形态（纸面虚拟场地）不铺瓦片——纸面地面 + 米制网格，
    // 与「无锚点纯纸面」同一套；锚点保留（瓦片层跳过即可，镜头对位照常）。
    const paperGround = groundMode === 'paper';
    const tileAnchor = paperGround ? null : (plan.anchor ? { lng: plan.anchor.lng, lat: plan.anchor.lat } : null);
    const anchor = plan.anchor ? { lng: plan.anchor.lng, lat: plan.anchor.lat } : null;
    const siteFrame = ringFrame(plan.boundary);
    const viewFrame = mapView && tileAnchor ? frameFromMapView(mapView, tileAnchor) : siteFrame;
    const span = Math.max(12, viewFrame.span);
    const aspect = Math.max(0.2, (stage.clientWidth || 800) / Math.max(1, stage.clientHeight || 600));

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(SKY_GROUND);
    // 雾只在很远处才淡出，避免默认俯视时地图上沿被洗成灰带。
    scene.fog = new THREE.Fog(SKY_GROUND, 25000, 90000);

    const camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 150000);
    const lookTarget = new THREE.Vector3(viewFrame.cx, 0, -viewFrame.cy);
    camera.position.copy(cameraPose(lookTarget, span, 0.02, 52));
    camera.lookAt(lookTarget);
    const tiltedEye = cameraPose(lookTarget, span, MAP_TILT_POLAR, 52);
    const orbitEye = cameraPose(lookTarget, span, Math.min(MAP_TILT_POLAR + 0.28, Math.PI * 0.42), 52);
    const groundFrame = unionFrames([
      siteFrame,
      viewFrame,
      coverFrameFromFrustum(lookTarget, tiltedEye, 52, aspect),
      coverFrameFromFrustum(lookTarget, orbitEye, 52, aspect),
    ]);

    // 2026-11-17：先自己拿上下文。three 建失败会先 console.error 再抛，Next 开发面板
    // 会把那条 error 记成 issue；这里拿到就复用，拿不到就直接停在“打不开 3D”的说明上。
    const surface = acquireWebGLSurface({ antialias: true, alpha: false });
    if (!surface) {
      setGroundState('unavailable');
      return undefined;
    }
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: surface.canvas,
        context: surface.context,
        antialias: true,
        alpha: false,
      });
    } catch {
      setGroundState('unavailable');
      return undefined;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    stage.appendChild(renderer.domElement);
    renderer.domElement.id = OUTDOOR_WALK_CANVAS_ID;
    setWalkCanvas(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    scene.add(new THREE.HemisphereLight('#ffffff', '#6c757d', 1.05));
    const sun = new THREE.DirectionalLight('#fff6e6', 1.15);
    sun.position.set(siteFrame.cx + span, span * 1.4, -siteFrame.cy - span);
    scene.add(sun);

    const basemapRoot = new THREE.Group();
    basemapRoot.name = "plan-basemap";
    scene.add(basemapRoot);

    // 只有纯纸面规划（没有地图锚点 / docs/46 V-P1 纸面形态）才铺一块场地大小的纸；
    // 有底图时不要再垫一块灰色平面，否则会在地图背后露出垫块。
    if (!tileAnchor) {
      const paperW = Math.max(viewFrame.width, siteFrame.width) * 1.2;
      const paperD = Math.max(viewFrame.depth, siteFrame.depth) * 1.2;
      const paperGeometry = new THREE.PlaneGeometry(paperW, paperD);
      const paperMaterial = new THREE.MeshBasicMaterial({ color: PAPER_GROUND });
      disposables.push(paperGeometry, paperMaterial);
      const paper = new THREE.Mesh(paperGeometry, paperMaterial);
      paper.rotation.x = -Math.PI / 2;
      paper.position.set(viewFrame.cx, -0.02, -viewFrame.cy);
      paper.userData.type = RESEARCH_BASEMAP_TAG;
      basemapRoot.add(paper);
    }

    // 米制网格只罩当前视口，避免铺满地平线后密成一片。
    const gridSize = Math.ceil(Math.max(span, viewFrame.span) / 5) * 5;
    const grid = new THREE.GridHelper(gridSize, Math.max(2, Math.round(gridSize / 10)), '#c8c2b4', '#ded8ca');
    grid.position.set(viewFrame.cx, 0, -viewFrame.cy);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.userData.type = RESEARCH_BASEMAP_TAG;
    disposables.push(grid);
    basemapRoot.add(grid);

    // 底图：远处低级别铺满画面（关闭 mip，免得靠近时被拉成糊图）；
    // 场地和镜头周围直接铺图源最高级别，同时缓存往上 4 级，缺高清时用祖先裁切兜底。
    const tileKeys = new Set<string>();
    const tileCache: TilePaintCache = {
      imageCache: canvasEditApiRef.current?.current?.getTileCache() ?? new BasemapTileCache({ max: 1200 }),
      textures: new Map<string, THREE.Texture>(),
      fallbackMeshes: new Map<string, THREE.Mesh>(),
      readyKeys: new Set<string>(),
    };
    const preferredZoom = mapView?.zoom ?? zoomFromSpan(viewFrame.span);
    const hiZoom = maxZoomForSource(source);
    const workRange = Math.max(viewFrame.span * 6, siteFrame.span * 3, 800);
    const workFrame = unionFrames([
      siteFrame,
      viewFrame,
      coverFrameFromFrustum(lookTarget, tiltedEye, 52, aspect, workRange, 1.25),
    ]);
    const closePad = 1600;
    const closeFrame = unionFrames([
      squareFrame(siteFrame.cx, siteFrame.cy, Math.max(siteFrame.span * 2, closePad)),
      squareFrame(viewFrame.cx, viewFrame.cy, closePad),
    ]);
    // 先铺场地边界附近，再往外补；焦点用场地中心，不是视口中心。
    const focusEnu = { x: siteFrame.cx, y: siteFrame.cy };
    const nearPad = Math.max(siteFrame.span * 1.3, siteFrame.span + 240, 320);
    const nearFrame = squareFrame(siteFrame.cx, siteFrame.cy, nearPad);
    if (tileAnchor) {
      void (async () => {
        const shared = canvasEditApiRef.current?.current?.getTileCache();
        if (shared) tileCache.imageCache = shared;
        let shown = false;
        let settleTimer = 0;
        const showGround = (): void => {
          // 按真实挂上纹理的瓦片数（readyKeys）判定，不能用调度键集合 tileKeys——
          // pending / 超时失败的键也在集合里，会把「一张都没出图」误判成已有底图。
          if (disposed || shown || tileCache.readyKeys.size <= 0) return;
          shown = true;
          if (settleTimer) window.clearTimeout(settleTimer);
          grid.visible = false;
          setGroundState('satellite');
          onReady?.();
        };
        // 2026-11-12 用户反馈切换「不丝滑」：瓦片请求慢/被限流时，paintTilePyramid 会一直
        // 等不返回，画面就永远挂着「正在取地图底图…」。给一个兜底：1.6s 后已落了部分瓦片
        // 就按可用底图结算（剩下的继续后台补），一张都没到才退回纸面网格。
        settleTimer = window.setTimeout(() => {
          if (disposed || shown) return;
          if (tileCache.readyKeys.size > 0) showGround();
          else setGroundState('paper');
        }, 1600);
        await paintTilePyramid({
          scene,
          disposables,
          closeBounds: frameToBounds(nearFrame, tileAnchor),
          midBounds: frameToBounds(nearFrame, tileAnchor),
          farBounds: frameToBounds(nearFrame, tileAnchor),
          anchor: tileAnchor,
          source,
          topZoom: hiZoom,
          isDisposed: () => disposed,
          loaded: tileKeys,
          cache: tileCache,
          focus: focusEnu,
          closeMaxTiles: 64,
          parent: basemapRoot,
        });
        showGround();
        if (disposed) return;
        await paintTilePyramid({
          scene,
          disposables,
          closeBounds: frameToBounds(closeFrame, tileAnchor),
          midBounds: frameToBounds(workFrame, tileAnchor),
          farBounds: frameToBounds(workFrame, tileAnchor),
          anchor: tileAnchor,
          source,
          topZoom: hiZoom,
          isDisposed: () => disposed,
          loaded: tileKeys,
          cache: tileCache,
          focus: focusEnu,
          closeMaxTiles: 160,
          parent: basemapRoot,
        });
        showGround();
        if (disposed) return;
        await paintTiledGround({
          scene,
          disposables,
          bounds: frameToBounds(groundFrame, tileAnchor),
          anchor: tileAnchor,
          source,
          preferredZoom: Math.min(preferredZoom - 3, 11),
          maxTiles: 80,
          height: tileHeight(8),
          isDisposed: () => disposed,
          loaded: tileKeys,
          mipmaps: false,
          cache: tileCache,
          focus: focusEnu,
          parent: basemapRoot,
        });
        showGround();
        if (disposed) return;
        if (!shown) setGroundState('paper');
      })();
    } else {
      setGroundState('paper');
    }

    // 场地 footprint：复用 RoomOrganizer 那套完整渲染管线（buildPlanFootprint）——
    // 边界轮廓 + 分区色块 + 设施占地 + 设施实体（帐篷/舞台/餐车/厕位/摊位/岗亭/垃圾桶）
    // + 动线 + 出入口/人员点位 + 地面文字，全部与 2D 同一份数据。
    // 该管线在壳体坐标里算几何：shapePoint 把框归中到原点。组要放到场地中心
    // (cx, 0, -cy)，最终落点才是原始 ENU：three.x = plan.x，three.z = -plan.y。
    const trafficLayer = createPlanTrafficLayer(PLAN_LAYER_BASE_Y);
    scene.add(trafficLayer.group);
    trafficLayer.sync(plan);
    // 独立车辆实体层（plan.vehicles）：与 2D vehicle-markers 同源口径，挂动线的巡游、缺线的停放。
    const vehicleEntitiesLayer = createPlanVehicleEntitiesLayer(PLAN_LAYER_BASE_Y);
    scene.add(vehicleEntitiesLayer.group);
    vehicleEntitiesLayer.sync(plan);
    const hideAnimatedVehiclePlaceholders = (group: THREE.Group) => {
      for (const child of group.children) {
        const id = child.userData.planPropId;
        if (typeof id === 'string' && trafficLayer.movesFacility(id)) child.visible = false;
      }
    };
    const metrics = { width: siteFrame.width, depth: siteFrame.depth };
    let footprintGroup: THREE.Group | undefined;
    if (buildPlanFootprint(THREE, scene, plan, metrics, { clampPoints: false })) {
      footprintGroup = scene.children.find(
        (child) => child instanceof THREE.Group && child.userData.type === ROOM_OBJECT_TAGS.PlanFootprint,
      ) as THREE.Group | undefined;
      if (footprintGroup) {
        // 壳组中心落到场地 ENU 中心，这样 three.x = plan.x、three.z = -plan.y，和瓦片对齐。
        // y 保持 0：贴地层高度由 buildPlanFootprint 的 ELEVATION 自带（瓦片顶之上 5–15 cm）。
        footprintGroup.position.set(siteFrame.cx, 0, -siteFrame.cy);
        hideAnimatedVehiclePlaceholders(footprintGroup);
      }
    }

    // —— 真实模型层（2D 规划的设施 → 物料库 GLB，共享 builder three/plan-model-layer.ts）——
    // 落点必须与占位体**完全一致**：占位体是 footprint 组的直接子节点，自身偏移
    // (center.x - w/2, 0, center.z - d/2)，footprint 组再补 (w/2, 0, -d/2)。组的外层
    // 偏移在这里设置，内层落位/收缩/藏占位/run guard 全在共享 builder 里——
    // 与主舞台 GeoGround 的模型层同一套口径（docs/42：退出户外也能看到 3D 素材）。
    const shapes = planFootprintShapes(plan, metrics, { clampPoints: false });
    const props = shapes?.props.filter(prop => !trafficLayer.movesFacility(prop.id)) ?? [];
    const planModelLayer = createPlanModelLayer({
      parent: scene,
      props,
      metrics,
      placeholders: footprintGroup ? collectPlaceholdersByPropId(footprintGroup) : undefined,
      isDisposed: () => disposed,
    });
    planModelLayer.group.position.set(siteFrame.cx, PLAN_LAYER_BASE_Y, -siteFrame.cy);

    const modelRoots: THREE.Object3D[] = [];
    const run = modelRunRef.current + 1;
    modelRunRef.current = run;

    // —— 2D 物料 / 场景落点层（sceneObjects：室内家具 + 实景扫描场景）——
    // 落点口径与上面的真实模型层完全一致：组补 (w/2, 0, -d/2)，子对象用壳体偏移，
    // 所以 2D 上摆在哪，3D 就落在哪。
    const sceneLayer = new THREE.Group();
    sceneLayer.name = 'plan-scene-objects';
    sceneLayer.position.set(siteFrame.cx, PLAN_LAYER_BASE_Y, -siteFrame.cy);
    scene.add(sceneLayer);

    // —— 不同人群落点层（2D 岗位点位 → N 个人）——
    const crowdLayer = new THREE.Group();
    crowdLayer.name = 'plan-crowd';
    crowdLayer.position.set(siteFrame.cx, PLAN_LAYER_BASE_Y, -siteFrame.cy);
    scene.add(crowdLayer);
    const roleLabels = createPlanRoleLabels();

    // —— 漫游占位 avatar（第三人称 / 过肩档显示；世界坐标，不挂场地偏移层）——
    const avatarGroup = new THREE.Group();
    avatarGroup.name = 'plan-walk-avatar';
    const avatarMat = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.8 });
    const avatarSkinMat = new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.7 });
    const avatarBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 10), avatarMat);
    avatarBody.position.y = 0.95;
    const avatarHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), avatarSkinMat);
    avatarHead.position.y = 1.62;
    avatarGroup.add(avatarBody, avatarHead);
    avatarGroup.visible = false;
    scene.add(avatarGroup);
    avatarGroupRef.current = avatarGroup;

    /** 壳体坐标 → three 局部坐标（组再补 (w/2, 0, -d/2) 后与占位体重合）。 */
    const placeAt = (object: THREE.Object3D, shell: { x: number; z: number }, rotationDeg = 0): void => {
      object.position.set(shell.x - metrics.width / 2, 0, shell.z - metrics.depth / 2);
      // 2D 画布顺时针为正；three 绕 Y 正向是逆时针，所以取负（与占位体一致）。
      object.rotation.y = -(rotationDeg * Math.PI) / 180;
    };

    // —— 人群层随 plan.workers / boundary 刷新（#84）：重建前清掉旧实例并释放 GPU / 内置 mixer，
    // 代际号拦过期异步回调；人物动画注册表按 group.parent 在下一帧摘除脱离实例，无需手动反注册。
    let crowdGen = 0;
    let crowdSignature = '';
    const releaseCrowdChildren = (): void => {
      while (crowdLayer.children.length > 0) {
        const child = crowdLayer.children[0];
        crowdLayer.remove(child);
        const rootIndex = modelRoots.indexOf(child);
        if (rootIndex >= 0) modelRoots.splice(rootIndex, 1);
        const label = child.getObjectByName('plan-person-role-label');
        if (label instanceof THREE.Sprite) label.material.dispose();
        try { disposeOwnedModel(child); } catch { /* 单个释放失败不阻断重建 */ }
      }
    };
    const rebuildCrowd = (nextPlan: SitePlanData): void => {
      if (disposed) return;
      const nextFrame = ringFrame(nextPlan.boundary);
      if (!nextFrame) return;
      const nextMetrics = { width: nextFrame.width, depth: nextFrame.depth };
      const signature = JSON.stringify({
        workers: nextPlan.workers ?? [],
        boundary: nextPlan.boundary,
        metrics: nextMetrics,
        routes: nextPlan.routes.map(({ kind, points, carrier, oneWay }) => ({ kind, points, carrier, oneWay })),
      });
      if (signature === crowdSignature) return;
      crowdSignature = signature;
      if (releaseControlledActor()) onWalkExitRef.current?.();
      releaseCrowdChildren();
      const gen = ++crowdGen;
      const crowdPlacements = planCrowdShellPlacements(
        Array.isArray(nextPlan.workers) ? nextPlan.workers : [],
        nextPlan.boundary,
        nextMetrics,
      );
      // 可走人物从最近的兼容动线接入。
      const walkRouteMap = assignCrowdWalkRoutes(
        crowdPlacements,
        Array.isArray(nextPlan.routes) ? nextPlan.routes : [],
        nextPlan.boundary,
        nextMetrics,
      );
      const totals = new Map<string, number>();
      const ordinals = new Map<string, number>();
      const colors = new Map(nextPlan.workers.map(worker => [worker.id, worker.color]));
      for (const { role } of crowdPlacements) {
        totals.set(role, (totals.get(role) ?? 0) + 1);
      }
      const actors = crowdPlacements.map((placement): WalkActor => {
        const { assetId, glbUrl, role, shell } = placement;
        const customColor = colors.get(placement.workerId);
        // 主题色（2026-11-16）：点位自带色 > 岗位表写死的九岗色 > slug 调色板。
        const roleColor = customColor
          ?? workerRoleColor(role)
          ?? libraryEntryColor({ slug: workerSticker(role)?.slug ?? 'information-point' });
        const ordinal = (ordinals.get(role) ?? 0) + 1;
        ordinals.set(role, ordinal);
        const walkRoute = walkRouteMap.get(placement.id);
        const item: FurnitureItem = {
          id: `plan-crowd-${placement.id}`, type: 'person', name: role,
          width: 0.6, depth: 0.6, height: 1.75, color: roleColor, icon: '',
          ...(assetId ? { assetId } : {}),
          ...(glbUrl ? { glbUrl } : {}),
          ...(walkRoute ? { walkRoute } : {}),
          uniformScale: true,
        };
        // 人形实例可立即巡游和接管；下载完成只替换外观，路线与实例引用保持稳定。
        const group = buildProceduralPerson({ THREE, item, hasCollision: false, baseColor: roleColor, opacity: 1 }, true);
        const lightweightFigure = group.children[0]!;
        roleLabels.add(group, role, roleColor, item.height);
        if (!walkRoute) group.position.set(shell.x - nextMetrics.width / 2, 0, shell.z - nextMetrics.depth / 2);
        group.name = `plan-crowd-${placement.crowdType}`;
        crowdLayer.add(group);
        modelRoots.push(group);

        if (assetId && glbUrl) {
          const modelItem: FurnitureItem = { ...item, type: 'glb-asset', color: '#ffffff' };
          void ensureGlbAsset(assetId, glbUrl).then(() => {
            if (disposed || modelRunRef.current !== run || gen !== crowdGen) return;
            const avatar = createWalkAvatar(modelItem);
            if (!avatar) return;
            group.remove(lightweightFigure);
            disposeOwnedModel(lightweightFigure);
            group.add(avatar.group);
            registerPersonAnim(group, {
              id: item.id,
              mixer: avatar.mixer,
              rig: null,
              clips: { idle: avatar.idle.getClip(), talk: null, walk: avatar.walk.getClip(), sit: avatar.sit ? avatar.sit.getClip() : null },
              action: 'idle',
              paused: false,
              route: walkRoute ?? null,
            });
          }).catch(() => { /* The lightweight character remains active. */ });
        }

        return {
          id: item.id, label: (totals.get(role) ?? 0) > 1 ? `${role} ${ordinal}` : role,
          image: assetId ? findWalkRole(assetId).image : null, group,
        };
      });
      setWalkActors(actors);
    };

    // 实景扫描（高斯点云）：先把地面轮廓标记画出来，点云本体等 controls 建好再起
    //（预览器要 renderer + camera + 环绕控制器）。
    const splatRequests: {
      placement: SceneObjectPlacement;
      patch: THREE.Mesh;
      outline: THREE.LineLoop;
      assetId: string;
      url: string;
    }[] = [];
    let splatPreview: SplatPreview | null = null;

    planSceneObjectPlacements(sceneObjects ?? [], plan.boundary, metrics).forEach((placement) => {
      const { shell } = placement;
      if (placement.kind === 'scene') {
        // 实景扫描（高斯点云）：先画地面轮廓标记当占位；点云加载成功后这块标记会被隐藏。
        const width = Math.max(0.5, placement.width);
        const depth = Math.max(0.5, placement.depth);
        const patch = new THREE.Mesh(
          new THREE.PlaneGeometry(width, depth),
          new THREE.MeshBasicMaterial({ color: placement.color, transparent: true, opacity: 0.12 }),
        );
        patch.rotation.x = -Math.PI / 2;
        placeAt(patch, shell, 0);
        patch.position.y = 0.015;
        patch.name = `plan-scene-patch-${placement.id}`;
        sceneLayer.add(patch);
        const outline = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-width / 2, 0, -depth / 2),
            new THREE.Vector3(width / 2, 0, -depth / 2),
            new THREE.Vector3(width / 2, 0, depth / 2),
            new THREE.Vector3(-width / 2, 0, depth / 2),
          ]),
          new THREE.LineBasicMaterial({ color: placement.color, transparent: true, opacity: 0.9 }),
        );
        placeAt(outline, shell, 0);
        outline.position.y = 0.03;
        outline.name = `plan-scene-outline-${placement.id}`;
        sceneLayer.add(outline);
        // 实景扫描（高斯点云）：本机 Aholo 注册表里能取到这份资产才起点云；
        // 点云起不来时这块轮廓就留在原地当占位标记（静默降级，不打断其它落点）。
        const assetId = placement.assetId;
        const url = assetId ? resolveAholoAssetUrl(assetId) : undefined;
        if (assetId && url) {
          splatRequests.push({ placement, patch, outline, assetId, url });
        }
        return;
      }
      // 物料：优先上真模型，没有模型就用彩色体块占位。
      const boxWidth = placement.width;
      const boxDepth = placement.depth;
      const boxHeight = placement.height;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth),
        new THREE.MeshBasicMaterial({ color: placement.color, transparent: true, opacity: 0.45 }),
      );
      placeAt(box, shell, placement.rotationDeg);
      box.position.y = boxHeight / 2;
      box.name = `plan-scene-box-${placement.id}`;
      sceneLayer.add(box);
      const modelUrl = placement.modelUrl;
      if (!modelUrl) return;
      const item: FurnitureItem = {
        id: `plan-scene-${placement.id}`,
        type: 'glb-asset',
        name: placement.name,
        width: boxWidth,
        depth: boxDepth,
        height: boxHeight,
        color: '#ffffff',
        icon: '◇',
        glbUrl: modelUrl,
        uniformScale: true,
      };
      void ensureGlbAsset(modelUrl, modelUrl)
        .then(() => {
          if (disposed || modelRunRef.current !== run) return;
          const model = createCachedGlbModel(item, false);
          if (!model) return;
          if (disposed || modelRunRef.current !== run) {
            disposeOwnedModel(model);
            return;
          }
          placeAt(model, shell, placement.rotationDeg);
          model.name = `plan-scene-model-${placement.id}`;
          sceneLayer.add(model);
          modelRoots.push(model);
          box.visible = false;
        })
        .catch(() => {
          /* 模型拉不到：保留体块占位。 */
        });
    });

    // 不同人群：2D 岗位点位按 count 展开成 N 个人（没模型的岗位先画人位柱）。
    rebuildCrowd(plan);

    // —— 2026-11-12 P2-i 3D 版：选中设施的编辑手柄（虚线占地框 + 四角方柄 + 四边圆柄 + 顶部旋转柄）——
    // 视觉与 2D 画布同款（深底白边）；位置每帧按 2D 同一套 facilityHandles 数学折回 plan 坐标，
    // 与 pointerFromPlan 桥里的命中区域逐像素一致（含小物件虚拟外扩盒）。
    // 拖拽数学/提交/撤销完全走 2D 管线：3D 只负责抓取（射线拾取 → 合成该柄精确 px/pt 喂桥）。
    const handleFacilityRef: { current: PlanFacility | null } = { current: null };
    const handleInfoRef: { current: { mode: string | null; editable: boolean; selectedId: string | null } } = { current: { mode: null, editable: false, selectedId: null } };
    // 2026-11-12 P2-i 3D 版坐标口径：footprint 组的“组偏移 + 子元素居中”相互抵消，
    // 最终 world = (plan.x, y, -plan.y)（buildPlanFootprint 同一约定），手柄直接用 plan 坐标落 world。
    const handleGroup = new THREE.Group();
    handleGroup.name = 'plan-facility-handles';
    handleGroup.visible = false;
    scene.add(handleGroup);
    const handleMeshes: THREE.Mesh[] = [];
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const sphereGeometry = new THREE.SphereGeometry(0.5, 14, 10);
    const handleWhiteMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 });
    const handleDarkMaterial = new THREE.MeshBasicMaterial({ color: '#181a20', depthTest: false, transparent: true, opacity: 0.92 });
    disposables.push(boxGeometry, sphereGeometry, handleWhiteMaterial, handleDarkMaterial);
    const makeHandle = (kind: 'resize' | 'side' | 'rotate', index: number): THREE.Group => {
      const holder = new THREE.Group();
      holder.userData.planHandle = { kind, index };
      const backing = new THREE.Mesh(kind === 'resize' ? boxGeometry : sphereGeometry, handleWhiteMaterial);
      const front = new THREE.Mesh(kind === 'resize' ? boxGeometry : sphereGeometry, handleDarkMaterial);
      backing.scale.setScalar(1.28);
      backing.renderOrder = 30;
      front.renderOrder = 31;
      backing.userData.planHandle = { kind, index };
      front.userData.planHandle = { kind, index };
      holder.add(backing, front);
      handleMeshes.push(backing, front);
      handleGroup.add(holder);
      return holder;
    };
    const cornerHandles = [0, 1, 2, 3].map(index => makeHandle('resize', index));
    const sideHandles = [0, 1, 2, 3].map(index => makeHandle('side', index));
    const rotateHandle = makeHandle('rotate', 0);
    const frameGeometry = new THREE.BufferGeometry();
    const frameMaterial = new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.9, gapSize: 0.7, depthTest: false, transparent: true, opacity: 0.85 });
    disposables.push(frameGeometry, frameMaterial);
    const frameLine = new THREE.LineLoop(frameGeometry, frameMaterial);
    frameLine.renderOrder = 29;
    frameLine.raycast = () => {};
    handleGroup.add(frameLine);
    const connectorGeometry = new THREE.BufferGeometry();
    const connectorMaterial = new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.85 });
    disposables.push(connectorGeometry, connectorMaterial);
    const connectorLine = new THREE.Line(connectorGeometry, connectorMaterial);
    connectorLine.renderOrder = 29;
    connectorLine.raycast = () => {};
    handleGroup.add(connectorLine);

    const collectLineMaterials = (root: THREE.Object3D): void => {
      const listed = (root as THREE.Object3D & { userData: { planLineMaterials?: { resolution: THREE.Vector2 }[] } }).userData.planLineMaterials;
      if (Array.isArray(listed)) lineMaterialsRef.current = listed;
      else lineMaterialsRef.current = [];
    };
    if (footprintGroup) collectLineMaterials(footprintGroup);

    const disposeObject = (object: THREE.Object3D): void => {
      object.traverse((child) => {
        const stickerDispose = child.userData.planStickerDispose;
        if (typeof stickerDispose === 'function') stickerDispose();
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      object.parent?.remove(object);
    };

    // 2026-11-16 用户「你看这个点 超级夸张的大」：顶点球原来按固定世界半径 0.7m 画，
    // 近景/远景观感完全失控（一颗球能盖住半个分区）。改成逐帧按镜头距离重算世界尺寸，
    // 在屏幕上恒定为 2D 手柄那种“一点点大”的尺寸。
    const zoneVertexHandles: { mesh: THREE.Mesh; outline: THREE.Mesh }[] = [];
    /** 顶点球的几何半径（米）：世界尺寸 = 这个半径 × 逐帧缩放。 */
    const ZONE_VERTEX_BASE_RADIUS = 0.7;
    /** 顶点球在屏幕上的目标半径（CSS px）：2D 画布手柄是 4.5px 心 + 细描边，这里略放大一点好点。 */
    const ZONE_VERTEX_PX = 6;

    const addSelectedZoneHandles = (group: THREE.Group, nextPlan: SitePlanData, frame: SiteFrame, zoneId: string | null): void => {
      zoneVertexHandles.length = 0;
      if (!zoneId) return;
      const zone = nextPlan.zones.find((item) => item.id === zoneId);
      if (!zone) return;
      const geometry = new THREE.SphereGeometry(ZONE_VERTEX_BASE_RADIUS, 16, 12);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      // 2026-11-16 用户：「3D 下的点没有描边」—— 2D 的顶点手柄是白心 + 分区色描边，
      // 3D 原来只有一颗纯白球，压在浅色底图/分区块上边界直接消失。
      // 用一颗略大的「只画背面」的球当描边：透视下只在轮廓外露一圈，和 2D 的细描边同观感。
      const outlineMaterial = new THREE.MeshBasicMaterial({ color: zone.color ?? '#6e5fd0', side: THREE.BackSide });
      disposables.push(geometry, material, outlineMaterial);
      for (const point of zone.polygon) {
        const outline = new THREE.Mesh(geometry, outlineMaterial);
        outline.position.set(point.x - frame.cx, 0.82, -(point.y - frame.cy));
        outline.scale.setScalar(0.16 * 1.28);
        outline.userData.type = 'plan-vertex-handle';
        group.add(outline);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(point.x - frame.cx, 0.82, -(point.y - frame.cy));
        mesh.scale.setScalar(0.16);
        mesh.userData.type = 'plan-vertex-handle';
        group.add(mesh);
        zoneVertexHandles.push({ mesh, outline });
      }
    };

    let lastEditKey = '';
    /** 落位后短暂不要重建预览：否则同一次放置的指针位置会立刻再叠一个预览模型。 */
    let previewMutedUntil = 0;
    /** 2026-11-16 物料卡落位前预览：用卡片 slug 构造 3D 预览 prop；没有 catalog 载荷就不挂模型。 */
    const previewPropFor = (
      nextPlan: SitePlanData,
      draft?: PlanEditVisuals['draft'],
    ): PlanPropShape | null => {
      const preview = draft?.facilityGhost?.preview;
      if (!preview) return null;
      const frame = ringFrame(nextPlan.boundary);
      if (!frame) return null;
      const shell = planShellFrame(nextPlan.boundary, { width: frame.width, depth: frame.depth }, { clampPoints: false });
      if (!shell) return null;
      return facilityProp({
        id: '__plan-preview__',
        templateId: preview.templateId,
        name: preview.name,
        position: preview.position,
        rotationDeg: preview.rotationDeg,
        size: { width: preview.width, depth: preview.depth },
        modelOverride: preview.slug,
      }, shell);
    };
    /** 预览压在已有设施上时，找到这一件：旧模型与旧占地都要先藏起来，落位后原地换。 */
    const previewTargetId = (
      nextPlan: SitePlanData,
      draft?: PlanEditVisuals['draft'],
    ): string | null => {
      const preview = draft?.facilityGhost?.preview;
      if (!preview) return null;
      return [...nextPlan.facilities].reverse().find(f => facilityContainsPoint(preview.position, f))?.id ?? null;
    };
    const syncEditVisuals = (): void => {
      const visuals = canvasEditApiRef.current?.current?.getEditVisuals?.();
      if (!visuals) return;
      // 预览模型每帧跟手；真正落地仍走 plan 设施，避免预览和已落模型混淆。
      planModelLayer.setPreview(
        Date.now() < previewMutedUntil ? null : previewPropFor(visuals.plan, visuals.draft),
        previewTargetId(visuals.plan, visuals.draft),
      );
      // 2026-11-12 3D 手柄目标：可编辑且有选中设施才挂柄（每帧按最新目标重摆位置）。
      handleFacilityRef.current = visuals.facilityEditable && visuals.selectedFacilityId
        ? visuals.plan.facilities.find(f => f.id === visuals.selectedFacilityId) ?? null
        : null;
      handleInfoRef.current = { mode: canvasEditApiRef.current?.current?.getMode?.() ?? null, editable: visuals.facilityEditable, selectedId: visuals.selectedFacilityId };
      const key = JSON.stringify({
        selectedZoneId: visuals.selectedZoneId,
        plan: visuals.plan,
        draft: visuals.draft ?? null,
      });
      if (key === lastEditKey) return;
      lastEditKey = key;
      syncFootprint(visuals.plan, visuals.selectedZoneId, visuals.draft);
    };

    const syncFootprint = (nextPlan: SitePlanData, selectedZoneId?: string | null, draft?: PlanEditVisuals["draft"]): void => {
      if (disposed) return;
      const nextFrame = ringFrame(nextPlan.boundary);
      if (!nextFrame) return;
      const nextMetrics = { width: nextFrame.width, depth: nextFrame.depth };
      trafficLayer.sync(nextPlan);
      vehicleEntitiesLayer.sync(nextPlan);
      const previous = scene.children.find(
        (child) => child instanceof THREE.Group && child.userData.type === ROOM_OBJECT_TAGS.PlanFootprint,
      );
      if (previous) disposeObject(previous);
      const hiddenPreviewId = previewTargetId(nextPlan, draft);
      // 预览压住的旧设施：3D 占地也不画（旧默认尺寸）；设施本体仍留在 plan 里，落位时原地换模型。
      const footprintPlan = hiddenPreviewId
        ? { ...nextPlan, facilities: nextPlan.facilities.filter(f => f.id !== hiddenPreviewId) }
        : nextPlan;
      if (!buildPlanFootprint(THREE, scene, footprintPlan, nextMetrics, { clampPoints: false })) {
        lineMaterialsRef.current = [];
        return;
      }
      const nextGroup = scene.children.find(
        (child) => child instanceof THREE.Group && child.userData.type === ROOM_OBJECT_TAGS.PlanFootprint,
      ) as THREE.Group | undefined;
      if (!nextGroup) return;
      nextGroup.position.set(nextFrame.cx, 0, -nextFrame.cy);
      hideAnimatedVehiclePlaceholders(nextGroup);
      addSelectedZoneHandles(nextGroup, nextPlan, nextFrame, selectedZoneId ?? null);
      if (draft) addDraftOverlay(nextGroup, nextFrame, draft, disposables);
      collectLineMaterials(nextGroup);
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width > 1 && height > 1) {
        lineMaterialsRef.current.forEach((material) => material.resolution.set(width, height));
      }
      const nextShapes = planFootprintShapes(nextPlan, nextMetrics, { clampPoints: false });
      if (nextShapes) {
        planModelLayer.group.position.set(nextFrame.cx, PLAN_LAYER_BASE_Y, -siteFrame.cy);
        const parkedProps = nextShapes.props.filter(prop => !trafficLayer.movesFacility(prop.id));
        planModelLayer.syncPositions(parkedProps, nextMetrics);
        // 2026-11-12 新放置的设施当场落地真模型：原来要等图源/视口变化触发场景重挂，
        // 用户放个摩天轮只看得到占地轮廓。重建后的占位表同步接管（贴纸隐藏用）。
        planModelLayer.placeNew(parkedProps, nextMetrics, collectPlaceholdersByPropId(nextGroup));
        // metrics 刚更新，预览模型按新场地框重新落位；压住的旧设施模型隐藏。
        planModelLayer.setPreview(
          Date.now() < previewMutedUntil ? null : previewPropFor(nextPlan, draft),
          hiddenPreviewId,
        );
      }
      const sceneLayerObj = scene.getObjectByName('plan-scene-objects');
        if (sceneLayerObj) sceneLayerObj.position.set(nextFrame.cx, PLAN_LAYER_BASE_Y, -nextFrame.cy);
      const crowdLayerObj = scene.getObjectByName('plan-crowd');
        if (crowdLayerObj) crowdLayerObj.position.set(nextFrame.cx, PLAN_LAYER_BASE_Y, -nextFrame.cy);
      // #84：岗位 / 边界变化时重建人群层（设施模型层走 planModelLayer.syncPositions/placeNew）。
      rebuildCrowd(nextPlan);
    };
    layerApiRef.current = { syncFootprint, syncEditVisuals };

        controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI * 0.46;
    // 2026-11-12 用户「放大倍数不够」：原来最近只能到 8m 距离（≈看 7.8m 高一片），
    // 摆小设施/对照尺寸时不够贴近。再放宽到最快 1.2m、并按场地大小自适应。
    controls.minDistance = Math.max(1.2, Math.min(siteFrame.span * 0.02, 8));
    controls.maxDistance = Math.max(span * 8, groundFrame.span * 0.5);
    controls.zoomSpeed = 0.85;
    // 2026-11-14 成熟编辑器口径：左键命中物件走拾取/拖动（pointerFromPlan 桥独占），
    // 左键命中空白则环绕；中键同样环绕，右键平移，滚轮缩放。是否真正响应左键旋转
    // 由每帧 enableRotate（仅 view 且非编辑态）与按下命中结果共同决定。
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controls.target.copy(lookTarget);
    controls.update();
    cameraRef.current = camera;
    controlsRef.current = controls;
    const tilted = cameraPose(lookTarget, span, MAP_TILT_POLAR, 52);
    const tiltFrom = camera.position.clone();
    const startedAt = performance.now();
    const animateTilt = (now: number) => {
      if (disposed || walkEnabledRef.current || !cameraRef.current || !controlsRef.current) return;
      const t = Math.min(1, (now - startedAt) / MAP_TILT_MS);
      const ease = 1 - (1 - t) ** 3;
      camera.position.lerpVectors(tiltFrom, tilted, ease);
      controls.target.copy(lookTarget);
      controls.update();
      if (t < 1) requestAnimationFrame(animateTilt);
    };
    requestAnimationFrame(animateTilt);

    // —— 实景扫描（高斯点云）——
    // 预览器要 renderer + camera + 环绕控制器，所以等 controls 建好再起。
    // 一个预览器同一时刻只挂一份点云，因此只起第一块（场地那块）实景扫描。
    const startVenueSplat = (request: (typeof splatRequests)[number]): void => {
      if (!renderer || !controls) return;
      const { placement, patch, outline, assetId, url } = request;
      const preview = createSplatPreview({
        renderer,
        camera,
        orbitControls: {
          target: controls.target,
          enabled: controls.enabled,
          update: () => controls.update(),
        },
        // 渲染循环在本组件里自己转，这里只作 LOD 统计回调，用不上。
        invalidate: () => {},
      });
      splatPreview = preview;
      const asset = findAholoAsset(assetId);
      const calibration = readSiteCalibration(assetId) ?? defaultSiteCalibration(assetId);
      // 落点口径与 patch / outline 同一条链路（壳体 → three 世界）。
      const target = splatWorldPosition(placement.shell, metrics);
      // 预览器默认 roofCutoffY = 3（室内按楼层切天花板用），室外整场扫描不能这么裁：
      // 3 米以上会被整片削掉（树冠、楼体、屋顶）。这里给一个足够大的上限，等于不裁切。
      const roofCutoffY = Math.max(60, (asset?.meters?.height ?? 0) * 2);
      void preview
        .start(
          {
            assetId,
            url,
            name: placement.name,
            ...(asset?.meters ? { meters: asset.meters } : {}),
            ...(asset?.lodUrl ? { lodUrl: asset.lodUrl } : {}),
          },
          {
            sizeMeters: splatVenueSpan(metrics),
            upAxis: 'Z',
            roofCutoffY,
            position: splatPlacementOffset(target, calibration.origin),
            calibration: {
              scale: calibration.scale,
              yawDeg: calibration.yawDeg,
              origin: calibration.origin,
              ground: calibration.ground,
              anchors: calibration.anchors,
            },
          },
        )
        .then(() => {
          if (disposed) return;
          // 点云起来了就把地面轮廓收掉，避免两层标记叠着。
          patch.visible = false;
          outline.visible = false;
        })
        .catch(() => {
          // 静默降级：保留 patch / outline 当占位标记。
          preview.dispose();
          if (splatPreview === preview) splatPreview = null;
        });
    };
    splatRequests.slice(0, 1).forEach(startVenueSplat);

    function resize(): void {
      if (!renderer || !stage) return;
      const size = readStageSize();
      if (!size) {
        // 2026-11-15「3D 视觉没同步」的真因之一：3D 面板常在隐藏页签里挂载，
        // 那一刻 clientWidth=0，旧代码直接 return，renderer 就一直是 three 的默认 300×150 缓冲，
        // 而 canvas 的 CSS 被拉满——画面糊成一片，看着像没画东西。
        if (sizeRetryLeft > 0) {
          sizeRetryLeft -= 1;
          sizeFrame = window.requestAnimationFrame(resize);
        }
        return;
      }
      if (size.width === appliedWidth && size.height === appliedHeight) return;
      appliedWidth = size.width;
      appliedHeight = size.height;
      // 首次拿到实测尺寸时才锁定 dpr：挂载时窗口可能在另一块屏上。
      if (!pixelRatioSettled) {
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        pixelRatioSettled = true;
      }
      renderer.setSize(size.width, size.height, false);
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      lineMaterialsRef.current.forEach((material) => material.resolution.set(size.width, size.height));
    }

    /** 先量 content-box，再量 border-box；两种都拿不到才算「还没就绪」。 */
    function readStageSize(): { width: number; height: number } | null {
      const element = stage;
      if (!element) return null;
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      if (width >= 2 && height >= 2) return { width, height };
      const rect = element.getBoundingClientRect();
      const rectWidth = Math.round(rect.width);
      const rectHeight = Math.round(rect.height);
      if (rectWidth >= 2 && rectHeight >= 2) return { width: rectWidth, height: rectHeight };
      return null;
    }

    resize();
    // 首帧再量一次：挂载当下样式可能还没应用完（切页签 / 面板动画）。
    sizeFrame = window.requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    // 窗口级也兵：分屏、缩窗口时 ResizeObserver 有时只报父容器。
    window.addEventListener('resize', resize);

    let lodBusy = false;
    let lastLodZoom = preferredZoom;
    let lastLodAt = 0;
    let lastLodFocus = { x: focusEnu.x, y: focusEnu.y };
    const loadCloserTiles = (): void => {
      if (!tileAnchor || disposed || lodBusy) return;
      const now = performance.now();
      if (now - lastLodAt < 80) return;
      const aim = controls?.target ?? lookTarget;
      const canvasH = stage.clientHeight || 600;
      const needed = neededMapZoom(camera, aim, canvasH, tileAnchor.lat);
      const cap = maxZoomForSource(source);
      // 只要靠近看场地，就直接拉到图源最高级别，避免 16→17→18 一档一跳。
      const zoom = needed >= 15 || needed >= preferredZoom + 0.3
        ? cap
        : Math.max(preferredZoom, Math.min(cap, Math.ceil(needed)));
      const moved = Math.hypot(aim.x - lastLodFocus.x, -aim.z - lastLodFocus.y) > 100;
      if (zoom <= lastLodZoom && !moved && now - lastLodAt < 800) return;
      const range = Math.min(80000, Math.max(aim.distanceTo(camera.position) * 4, zoom >= cap - 1 ? 1600 : 400));
      const visible = coverFrameFromFrustum(aim, camera.position, 52, camera.aspect || aspect, range, 1.2);
      lastLodAt = now;
      lastLodZoom = Math.max(lastLodZoom, zoom);
      lastLodFocus = { x: aim.x, y: -aim.z };
      lodBusy = true;
      const midVisible = coverFrameFromFrustum(aim, camera.position, 52, camera.aspect || aspect, Math.min(80000, range * 2), 1.2);
      const farVisible = coverFrameFromFrustum(aim, camera.position, 52, camera.aspect || aspect, Math.min(80000, range * 4), 1.2);
      const shared = canvasEditApiRef.current?.current?.getTileCache();
      if (shared) tileCache.imageCache = shared;
      void paintTilePyramid({
        scene,
        disposables,
        closeBounds: frameToBounds(visible, tileAnchor),
        midBounds: frameToBounds(midVisible, tileAnchor),
        farBounds: frameToBounds(farVisible, tileAnchor),
        anchor: tileAnchor,
        source,
        topZoom: zoom,
        isDisposed: () => disposed,
        loaded: tileKeys,
        cache: tileCache,
        focus: { x: aim.x, y: -aim.z },
        closeMaxTiles: 160,
        parent: basemapRoot,
      }).finally(() => {
        lodBusy = false;
      });
    };
    controls.addEventListener('change', loadCloserTiles);


    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const groundHit = new THREE.Vector3();
    let pointerEditing = false;
    /** 本次左键按下未被物件/框选消费、已放行给轨道控制器环绕（仅 view 空白）。 */
    let blankReleased = false;

    /** 当前镜头推导的 2D 规划视口（eventToPlanHit 与 3D 手柄同步共用同一套口径）。 */
    const derivedViewportNow = (): PlanViewport | null => {
      if (!renderer) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      const target = controls?.target ?? lookTarget;
      const dist = Math.max(camera.position.distanceTo(target), 4);
      const metersPerPixel = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(rect.height, 1);
      const look = anchor
        ? enuToLngLat(target.x, -target.z, anchor.lng, anchor.lat)
        : { lng: mapView?.lng ?? 0, lat: mapView?.lat ?? 0 };
      const zoom = Math.log2((40075016.686 * Math.cos((look.lat * Math.PI) / 180)) / Math.max(metersPerPixel * 256, 1e-6));
      return {
        lng: look.lng,
        lat: look.lat,
        zoom,
        canvasW: rect.width,
        canvasH: rect.height,
        ...(anchor ? { anchorLng: anchor.lng, anchorLat: anchor.lat } : {}),
      };
    };

    const eventToPlanHit = (event: PointerEvent | MouseEvent): { px: { x: number; y: number }; pt: PlanPoint; viewport: PlanViewport } | null => {
      if (!renderer) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      const viewport = derivedViewportNow();
      if (!viewport) return null;
      pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      if (!raycaster.ray.intersectPlane(groundPlane, groundHit)) return null;
      const pt = { x: groundHit.x, y: -groundHit.z };
      return { pt, px: planPointToPixel(pt, viewport), viewport };
    };

    const pointerFlags = (event: PointerEvent | MouseEvent, hit: { viewport: PlanViewport } | null) => ({
      button: 'button' in event ? event.button : 0,
      shiftKey: event.shiftKey,
      // 2026-11-16 用户「按住 Alt 在原来的点上添加线」：修饰键必须一并送到 2D 桥，
      // 否则 3D 里按了 Alt 跟没按一样。
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      clientX: event.clientX,
      clientY: event.clientY,
      ...(hit ? { viewport: hit.viewport } : {}),
    });

    /**
     * 2026-11-12 P2-i 3D 版：把手柄解析到 plan 坐标（与 2D facilityHandles 同一套数学，
     * 含小物件虚拟外扩盒与旋转柄外推）。不经过 px↔plan 的视口中心换算——纸面规划
     * （无锚点）时接管实例的视口中心不可信，plan 空间原生计算才与几何同坐标系。
     */
    const facilityHandlePlanPoints = (facility: PlanFacility, viewport: PlanViewport) => {
      const mppRaw = planMetersPerPixel(viewport);
      const mpp = Number.isFinite(mppRaw) && mppRaw > 0 ? mppRaw : 0.05;
      let virtual = facility;
      const maxSidePx = Math.max(facility.size.width, facility.size.depth) / mpp;
      if (maxSidePx < FACILITY_HANDLE_MIN_FOOTPRINT_PX) {
        const scale = FACILITY_HANDLE_MIN_FOOTPRINT_PX / Math.max(1e-6, maxSidePx);
        virtual = { ...facility, size: { width: facility.size.width * scale, depth: facility.size.depth * scale } };
      }
      const ring = facilityFootprintRing(virtual);
      const corners = ring.map(point => ({ x: point.x, y: point.y }));
      const sides = corners.map((point, index) => {
        const next = corners[(index + 1) % corners.length]!;
        return { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
      });
      const theta = (facility.rotationDeg * Math.PI) / 180;
      const gap = virtual.size.depth / 2 + FACILITY_ROTATE_GAP_PX * mpp;
      const rotate = { x: facility.position.x - gap * Math.sin(theta), y: facility.position.y + gap * Math.cos(theta) };
      const topMid = { x: (corners[2]!.x + corners[3]!.x) / 2, y: (corners[2]!.y + corners[3]!.y) / 2 };
      return { corners, sides, rotate, topMid };
    };

    /** 2026-11-12 P2-i 3D 版：按当前镜头与选中设施重摆手柄（每帧调用；无选中即整组隐藏）。 */
    const updateFacilityHandles = (): void => {
      const facility = handleFacilityRef.current;
      if (!facility || disposed) {
        handleGroup.visible = false;
        return;
      }
      const viewport = derivedViewportNow();
      if (!viewport) {
        handleGroup.visible = false;
        return;
      }
      // 与 2D 命中同一套数学（含小物件虚拟外扩盒）：柄的 plan 位置直接落 world，
      // 保证「看到的柄」就是 pointerFromPlan 桥命中判定里的柄。
      const planPoints = facilityHandlePlanPoints(facility, viewport);
      const baseY = PLAN_LAYER_BASE_Y + 0.02;
      const toThree = (point: PlanPoint, y: number): THREE.Vector3 => new THREE.Vector3(point.x, y, -point.y);
      cornerHandles.forEach((holder, index) => holder.position.copy(toThree(planPoints.corners[index]!, baseY)));
      sideHandles.forEach((holder, index) => holder.position.copy(toThree(planPoints.sides[index]!, baseY)));
      rotateHandle.position.copy(toThree(planPoints.rotate, PLAN_LAYER_BASE_Y + 1.0));
      connectorLine.geometry.setFromPoints([toThree(planPoints.topMid, baseY), toThree(planPoints.rotate, PLAN_LAYER_BASE_Y + 1.0)]);
      frameLine.geometry.setFromPoints(facilityFootprintRing(facility).map(point => toThree(point, PLAN_LAYER_BASE_Y + 0.03)));
      frameLine.computeLineDistances();
      // 2026-11-16 用户：「3D 里选中柄的缩放比例好奇怪」——旧式用「相机到 OrbitControls 目标」的
      // 距离算世界尺寸：镜头贴近地面、目标却在远处时，柄会被放大成遮住半个场地的大球。
      // 改成逐柄按「相机到该柄」的距离缩放（这才是恒定屏幕尺寸的正确数学），并给世界尺寸上下限兜底。
      const sizeHandle = (holder: THREE.Group, factor: number): void => {
        const distance = Math.max(camera.position.distanceTo(holder.position), 1);
        const size = Math.min(1.5, Math.max(0.05, distance * 0.012));
        holder.scale.setScalar(size * factor);
      };
      cornerHandles.forEach(holder => sizeHandle(holder, 1));
      sideHandles.forEach(holder => sizeHandle(holder, 0.72));
      sizeHandle(rotateHandle, 1.5);
      handleGroup.visible = true;
    };

    /**
     * 2026-11-16 用户「这个点 超级夸张的大」：顶点球按「相机到该球」的距离换算世界尺寸，
     * 让它在屏幕上恒定为 ZONE_VERTEX_PX 像素半径（透视投影：每像素对应 distance*2*tan(fov/2)/H 米）。
     * 拾取不走这颗球（命中仍由 2D 画布的顶点热区判定），所以缩小不影响点选手感。
     */
    const updateZoneVertexHandles = (): void => {
      if (!zoneVertexHandles.length) return;
      const height = Math.max(1, stage.clientHeight);
      const worldPerPixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / height;
      const worldPosition = new THREE.Vector3();
      for (const entry of zoneVertexHandles) {
        entry.mesh.getWorldPosition(worldPosition);
        const distance = Math.max(camera.position.distanceTo(worldPosition), 0.5);
        const worldRadius = ZONE_VERTEX_PX * worldPerPixel * distance;
        const scale = worldRadius / ZONE_VERTEX_BASE_RADIUS;
        entry.mesh.scale.setScalar(scale);
        entry.outline.scale.setScalar(scale * 1.28);
      }
    };

    /**
     * 2026-11-12 P2-i 3D 版：pointerdown 先射线抓编辑柄；抓中就把「该柄的精确 px/pt」
     * 合成按下事件喂 pointerFromPlan 桥（2D 命中判定与该柄零距离，必然接管），
     * 后续 move/up 与 2D 手柄拖拽完全同一条管线。返回 true 表示这次按下已接管。
     */
    const tryFacilityHandleGrab = (event: PointerEvent): boolean => {
      const api = canvasEditApiRef.current?.current;
      if (!api || !handleGroup.visible || disposed || !renderer) return false;
      const mode = api.getMode();
      if (mode !== 'view' && mode !== 'select') return false;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const grabbed = raycaster.intersectObjects(handleMeshes, false)[0]?.object;
      const handle = grabbed?.userData?.planHandle as { kind: 'resize' | 'side' | 'rotate'; index: number } | undefined;
      if (!handle) return false;
      const hit = eventToPlanHit(event);
      const facility = handleFacilityRef.current;
      if (!hit || !facility) return false;
      const handlesPx = facilityHandles(facility, hit.viewport, FACILITY_HANDLE_MIN_FOOTPRINT_PX);
      const planPoints = facilityHandlePlanPoints(facility, hit.viewport);
      const px = handle.kind === 'resize'
        ? handlesPx.corners[handle.index]!
        : handle.kind === 'side'
          ? handlesPx.sides[handle.index]!
          : handlesPx.rotate;
      // pt 用 plan 空间原生的柄位置（与 px 同一套数学的 plan 版本），纸面规划也不会偏。
      const pt = handle.kind === 'resize'
        ? planPoints.corners[handle.index]!
        : handle.kind === 'side'
          ? planPoints.sides[handle.index]!
          : planPoints.rotate;
      api.pointerFromPlan('down', { px, pt }, pointerFlags(event, hit));
      syncEditVisuals();
      // 抓取路径独占这次按下：即使 2D 侧未接管（理论上不会，px 零距离）也不落到地面命中，
      // 避免同一次按下喂两次 down 让 2D 状态错乱。
      return true;
    };

    const onPointerDown = (event: PointerEvent): void => {
      // 漫游态：左键让给指针锁视角，不进 2D 编辑桥手势。
      if (walkEnabledRef.current) return;
      if (event.button !== 0) return;
      const api = canvasEditApiRef.current?.current;
      if (!api) return;
      // 2026-11-12 P2-i 3D 版：手柄优先——抓中编辑柄就走 2D 拖拽管线（旋转/单边/改尺寸）。
      if (tryFacilityHandleGrab(event)) {
        pointerEditing = true;
        if (controls) controls.enabled = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          renderer?.domElement.setPointerCapture(event.pointerId);
        } catch {
          /* 有的指针已经 captured，忽略。 */
        }
        return;
      }
      const mode = api.getMode();
      const hit = eventToPlanHit(event);
      if (!hit) {
        // 放置/绘制模式下点到天空或场地外：左键也只吞掉，不转视角、不落位。
        if (mode !== 'view') {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      const consumed = api.pointerFromPlan('down', hit, pointerFlags(event, hit));
      syncEditVisuals();
      // 2026-11-16 放置/绘制模式：左键只服务落位/拾取，空白处也不再交给 OrbitControls。
      // 右键平移、滚轮缩放仍由 controls 自己处理（这里只吞左键这一次按下）。
      if (mode !== 'view') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (consumed) {
        pointerEditing = true;
        if (controls) controls.enabled = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          renderer?.domElement.setPointerCapture(event.pointerId);
        } catch {
          /* 有的指针已经 captured，忽略。 */
        }
        return;
      }
      // 未命中物件/手柄：view 模式放行给左键环绕；不拦截事件、不关控制器。
      // select 空白起框选时 2D 桥会回 consumed=true，不会走到这里。
      blankReleased = true;
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (walkEnabledRef.current) return;
      const api = canvasEditApiRef.current?.current;
      if (!api) return;
      const drawing = api.getMode() !== 'view';
      if (!pointerEditing && !drawing) return;
      const hit = eventToPlanHit(event);
      api.pointerFromPlan('move', hit, {
        ...pointerFlags(event, hit),
        button: event.buttons & 1 ? 0 : event.button,
      });
      syncEditVisuals();
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (walkEnabledRef.current) return;
      const api = canvasEditApiRef.current?.current;
      if (!api) return;
      if (pointerEditing || api.getMode() !== 'view') {
        const hit = eventToPlanHit(event);
        api.pointerFromPlan('up', hit, pointerFlags(event, hit));
        syncEditVisuals();
      } else if (blankReleased) {
        // view 空白放行环绕：短按回喂 up，2D 按位移阈值判定单击清空；
        // 环绕拖拽位移超阈值，2D 不会误选中或清空。
        const hit = eventToPlanHit(event);
        if (hit) api.pointerFromPlan('up', hit, pointerFlags(event, hit));
        syncEditVisuals();
      }
      blankReleased = false;
      if (!pointerEditing) return;
      pointerEditing = false;
      if (controls) controls.enabled = true;
      try {
        renderer?.domElement.releasePointerCapture(event.pointerId);
      } catch {
        /* 未捕获时忽略。 */
      }
    };
    const onDblClick = (event: MouseEvent): void => {
      const api = canvasEditApiRef.current?.current;
      if (!api) return;
      const hit = eventToPlanHit(event);
      if (!hit) return;
      api.pointerFromPlan('dblclick', hit, pointerFlags(event, hit));
      syncEditVisuals();
    };
    // 2026-11-16 2D 画布发来的草稿变更：R 旋转 / Esc 取消 / 落位后用同一事件通知，
    // 3D 不用等下一次指针移动就能重画待放置幽灵。
    const onPlanVisuals = (): void => syncEditVisuals();
    window.addEventListener('sc-outdoor-plan-visuals', onPlanVisuals);

    // 2026-11-16 物件库拖进 3D：dragover 期间 dataTransfer 读不到模板，用拖起时记下的 id；
    // 地面射线命中后走 canvas 的同一份绿/红幽灵，逐帧合并避免每个 dragover 重建整层。
    let dragPreviewFrame = 0;
    let lastDragOver: DragEvent | null = null;
    let lastDropAt = 0;
    const onDragOver = (event: DragEvent): void => {
      if (walkEnabledRef.current) return;
      const dragTypes = Array.from(event.dataTransfer?.types ?? []);
      if (dragTypes.includes(PLAN_CATALOG_DRAG_MIME)) {
        if (!getPlanCatalogDrag()) return;
      } else if (dragTypes.includes(CATALOG_DRAG_MIME)) {
        return;
      } else if (!getPlanFacilityDrag()) return;
      const api = canvasEditApiRef.current?.current;
      if (!api) return;
      // 拖放期间也不让左键/中键转视角；右键平移、滚轮缩放保持。
      if (controls) controls.enableRotate = false;
      event.preventDefault();
      // 2D 画布在 3D 接管时仍保活；别让同一次 dragover 再冒泡到下面那层画布。
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      lastDragOver = event;
      if (dragPreviewFrame) return;
      dragPreviewFrame = window.requestAnimationFrame(() => {
        dragPreviewFrame = 0;
        const queued = lastDragOver;
        lastDragOver = null;
        if (!queued) return;
        const catalog = getPlanCatalogDrag();
        const templateId = getPlanFacilityDrag();
        if (!catalog && !templateId) return;
        const hit = eventToPlanHit(queued);
        if (!hit) return;
        if (catalog) api.previewCatalogDrop(catalog, hit.pt);
        else if (templateId) api.previewFacilityDrop(templateId, hit.pt);
        syncEditVisuals();
      });
    };
    const onDragLeave = (event: DragEvent): void => {
      // 从 canvas 移到同一 stage 内的浮层不算离开。
      const next = event.relatedTarget as Node | null;
      if (next && stage.contains(next)) return;
      if (Date.now() - lastDropAt < 250) return;
      const api = canvasEditApiRef.current?.current;
      if (!api) return;
      api.clearFacilityDropPreview();
      syncEditVisuals();
    };
    const onDrop = (event: DragEvent): void => {
      if (walkEnabledRef.current) return;
      const types = Array.from(event.dataTransfer?.types ?? []);
      if (types.includes(PLAN_CATALOG_DRAG_MIME)) {
        const catalogDrag = parsePlanCatalogDrag(event.dataTransfer?.getData(PLAN_CATALOG_DRAG_MIME) ?? '') ?? getPlanCatalogDrag();
        clearPlanCatalogDrag();
        if (!catalogDrag) return;
        event.preventDefault();
        event.stopPropagation();
        lastDropAt = Date.now();
        if (controls) controls.enableRotate = false;
        if (dragPreviewFrame) {
          window.cancelAnimationFrame(dragPreviewFrame);
          dragPreviewFrame = 0;
        }
        lastDragOver = null;
        const hit = eventToPlanHit(event);
        if (!hit) return;
        const api = canvasEditApiRef.current?.current;
        if (!api) return;
        previewMutedUntil = Date.now() + 350;
        api.dropCatalogAt(catalogDrag, hit.pt);
        syncEditVisuals();
        // 落位完成后强制移除预览模型；2D 幽灵若还没清，也不能留第二个模型在真模型上。
        planModelLayer.setPreview(null);
        return;
      }
      // 物料卡没带户外载荷时不要落成上一次的设施模板。
      if (types.includes(CATALOG_DRAG_MIME)) return;
      const templateId = event.dataTransfer?.getData('text/plain') || getPlanFacilityDrag();
      if (!templateId) return;
      event.preventDefault();
      event.stopPropagation();
      lastDropAt = Date.now();
      if (controls) controls.enableRotate = false;
      if (dragPreviewFrame) {
        window.cancelAnimationFrame(dragPreviewFrame);
        dragPreviewFrame = 0;
      }
      lastDragOver = null;
      clearPlanFacilityDrag();
      const hit = eventToPlanHit(event);
      if (!hit) return;
      const api = canvasEditApiRef.current?.current;
      if (!api) return;
      previewMutedUntil = Date.now() + 350;
      api.dropFacilityAt(templateId, hit.pt);
      syncEditVisuals();
      planModelLayer.setPreview(null);
    };
    stage.addEventListener('dragover', onDragOver);
    stage.addEventListener('dragleave', onDragLeave);
    stage.addEventListener('drop', onDrop);
    renderer.domElement.addEventListener('pointerdown', onPointerDown, { capture: true });
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDblClick);

    let idleTick = 0;
    let lastFrameAt = performance.now();
    function loop(): void {
      frame = window.requestAnimationFrame(loop);
      const frameNow = performance.now();
      // 切标签页回来时别把整段暂停一次补上；0.1 s 上限足够跟手（与室内循环同口径）。
      const deltaSeconds = Math.min((frameNow - lastFrameAt) / 1000, 0.1);
      lastFrameAt = frameNow;
      // 保活隐藏（2D 地图态）：每 6 帧只推进一次瓦片 LOD，切回 3D 时地面已经铺好，
      // 不需要再从低清瓦片重新抓一遍。
      if (!activeRef.current) {
        idleTick = (idleTick + 1) % 6;
        if (idleTick !== 0) return;
      }
      const walking = walkEnabledRef.current;
      const aerialView = walking && viewModeRef.current === 'orbit';
      // 步行 / 第三人称档相机由 useOutdoorWalk 每帧接管位置与朝向。OrbitControls 即便
      // enabled=false，其 update() 仍会按内部过期球坐标把相机拽回环绕 target 并 lookAt，
      // 与步行落点 / 指针锁朝向打架（表现为按 WASD 时视角剧烈甩动）。仅非漫游态与鸟瞰
      // 环绕档调用 update()。
      if (!walking || aerialView) controls?.update();
      if (controls) {
        const mode = canvasEditApiRef.current?.current?.getMode() ?? 'view';
        // 2026-11-16 放置 / 拖放期间左键一律不转视角（中键环绕仍留给浏览态）。
        // 拖放用模块级 store 判定：dragover 时还没轮到 pointer 事件，也要提前锁住。
        // 2026-11-16 合流：漫游鸟瞰档（aerialView）仍要能环绕，不被放置锁一起挡掉。
        const placing = mode !== 'view' || getPlanFacilityDrag() !== null;
        controls.enableRotate = aerialView || (!placing && !pointerEditing);
      }
      const api = canvasEditApiRef.current?.current;
      if (api?.getBasemapVisible) basemapRoot.visible = api.getBasemapVisible();
      if (controls && compassRef.current) {
        const dx = camera.position.x - controls.target.x;
        const dz = camera.position.z - controls.target.z;
        const heading = Math.atan2(-dx, dz);
        compassRef.current.style.transform = `rotate(${-heading}rad)`;
      }
      if (controls && stage && scaleBarRef.current && scaleLabelRef.current) {
        const canvasH = stage.clientHeight || 600;
        const dist = Math.max(camera.position.distanceTo(controls.target), 4);
        const metersPerPixel = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / canvasH;
        const targetM = metersPerPixel * 80;
        const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
        const meters = nice.find((value) => value >= targetM) ?? Math.round(targetM);
        const width = Math.max(24, Math.min(140, meters / Math.max(metersPerPixel, 0.01)));
        scaleBarRef.current.style.width = `${width}px`;
        scaleLabelRef.current.textContent = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
      }
      loadCloserTiles();
      if (!activeRef.current) return;
      // 2026-11-12 P2-i 3D 版：选中设施编辑手柄逐帧跟随镜头与拖拽预览（位置 + 恒定屏幕尺寸）。
      updateFacilityHandles();
      updateZoneVertexHandles();
      // 户外人物动画：注册表推进待机/步态 + 自动播放的非人物 GLB 实例。
      advancePeopleAnimations(deltaSeconds, scene);
      advanceGlbAnimations(deltaSeconds);
      trafficLayer.advance(deltaSeconds);
      vehicleEntitiesLayer.advance(deltaSeconds);
      // 漫游占位 avatar：第三人称 / 过肩档按帧姿态摆位；第一人称、鸟瞰或退出漫游时隐藏。
      const walkAvatar = avatarGroupRef.current;
      const walkFrame = walkFrameRef.current;
      if (walkAvatar) {
        const showAvatar = walkEnabledRef.current && !controlledActorRef.current && Boolean(walkFrame?.thirdPerson);
        walkAvatar.visible = showAvatar;
        if (showAvatar && walkFrame) {
          walkAvatar.position.set(walkFrame.x, PLAN_LAYER_BASE_Y, walkFrame.z);
          walkAvatar.rotation.y = walkFrame.yaw;
        }
      }
      // E 键交互：每帧用漫游锚点（非漫游回退相机位置）预筛最近条目，仅 id 变化回写 state。
      const interactRegistry = interactRegistryRef.current;
      if (interactRegistry) {
        // 鸟瞰档相机在高空、或退出漫游回到编辑环绕态：跳过预筛、清空既有近邻条目，避免 E 提示残留。
        const walking = walkEnabledRef.current;
        const aerialView = walking && viewModeRef.current === 'orbit';
        if (!walking || aerialView) {
          if (nearEntryIdRef.current !== null) {
            nearEntryIdRef.current = null;
            setNearEntry(null);
          }
        } else {
          const frameNow = walkFrameRef.current;
          // 近邻按地面平面距离判定：玩家锚点 y 是眼高，这里压到地面基准，垂直差不参与可达半径。
          const playerPos = frameNow
            ? { x: frameNow.x, y: PLAN_LAYER_BASE_Y, z: frameNow.z }
            : { x: camera.position.x, y: PLAN_LAYER_BASE_Y, z: camera.position.z };
          const near = nearestNearbyEntry(interactRegistry.list(), playerPos);
          const nearId = near?.id ?? null;
          if (nearId !== nearEntryIdRef.current) {
            nearEntryIdRef.current = nearId;
            setNearEntry(near);
          }
        }
      }
      if (process.env.NODE_ENV !== 'production') {
        // 本机验收桥：3D 手柄屏幕坐标（CSS px）+ 选中设施尺寸，Playwright 脚本直接点柄用。
        const facility = handleFacilityRef.current;
        const viewport = derivedViewportNow();
        const project = (object: THREE.Object3D): { x: number; y: number } | null => {
          if (!renderer) return null;
          const rect = renderer.domElement.getBoundingClientRect();
          const v = object.getWorldPosition(new THREE.Vector3()).project(camera);
          return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
        };
        (window as unknown as { __scendancePlan3dDebug?: unknown }).__scendancePlan3dDebug = {
          selectedId: facility?.id ?? null,
          info: handleInfoRef.current,
          facility: facility
            ? { id: facility.id, name: facility.name, width: facility.size.width, depth: facility.size.depth, rotationDeg: facility.rotationDeg, plan: { x: facility.position.x, y: facility.position.y } }
            : null,
          rig: {
            groupPos: footprintGroup ? footprintGroup.position.toArray() : null,
            target: controls ? controls.target.toArray() : null,
            camPos: camera.position.toArray(),
          },
          screenToPlan: (clientX: number, clientY: number): { pt: PlanPoint; px: { x: number; y: number } } | null => {
            const hit = eventToPlanHit({ clientX, clientY } as MouseEvent);
            return hit ? { pt: hit.pt, px: hit.px } : null;
          },
          screen: handleGroup.visible
            ? {
                corners: cornerHandles.map(project),
                sides: sideHandles.map(project),
                rotate: project(rotateHandle),
              }
            : null,
          crowd: crowdLayer.children.map((c) => {
            let meshCount = 0;
            c.traverse((n) => { if ((n as THREE.Mesh).isMesh) meshCount += 1; });
            return {
              name: c.name,
              pos: c.position.toArray().map((n) => +n.toFixed(2)),
              status: (c.userData as { glbStatus?: string }).glbStatus ?? null,
              staticMixer: Boolean((c.userData as { glbMixer?: unknown }).glbMixer),
              meshCount,
              visible: c.visible,
            };
          }),
          interact: interactRegistryRef.current
            ? {
                size: interactRegistryRef.current.size,
                entries: interactRegistryRef.current.list().map((e) => ({ id: e.id, kind: e.kind, label: e.label, position: e.position })),
                near: nearEntryRef.current?.id ?? null,
              }
            : null,
          traffic: trafficLayer.group.children.map(root => ({ name: root.name, position: root.position.toArray() })),
          vehicles: vehicleEntitiesLayer.group.children.map(root => ({
            name: root.name,
            slotIndex: root.userData.slotIndex,
            modelMissing: root.userData.modelMissing,
            position: root.position.toArray(),
          })),
          /** 本机验收桥：把轨道镜头拉近到第 index 个 crowd 实体（近景目检用，生产不调用）。 */
          focusCrowd: (index = 0, distance = 3) => {
            const target = crowdLayer.children[index];
            if (!target || !camera || !controls) return false;
            const p = target.getWorldPosition(new THREE.Vector3());
            controls.target.copy(p);
            camera.position.set(p.x + distance * 0.5, p.y + 1.7, p.z + distance);
            controls.update();
            return { target: p.toArray(), camPos: camera.position.toArray() };
          },
          ...(viewport ? { viewport: { metersPerPixel: planMetersPerPixel(viewport) } } : {}),
        };
      }
      // 点云在场时走预览器的分层绘制（点云当背景层，主场景再叠上去）。
      if (splatPreview && splatPreview.shownId && renderer) {
        splatPreview.renderFrame(renderer, scene, camera);
        return;
      }
      renderer?.render(scene, camera);
    }
    loop();

    return () => {
      disposed = true;
      if (releaseControlledActor()) onWalkExitRef.current?.();
      layerApiRef.current = null;
      modelRunRef.current += 1;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(sizeFrame);
      window.removeEventListener('resize', resize);
      observer.disconnect();
      window.removeEventListener('sc-outdoor-plan-visuals', onPlanVisuals);
      stage.removeEventListener('dragover', onDragOver);
      stage.removeEventListener('dragleave', onDragLeave);
      stage.removeEventListener('drop', onDrop);
      if (dragPreviewFrame) window.cancelAnimationFrame(dragPreviewFrame);
      renderer?.domElement.removeEventListener('pointerdown', onPointerDown, true);
      renderer?.domElement.removeEventListener('pointermove', onPointerMove);
      renderer?.domElement.removeEventListener('pointerup', onPointerUp);
      renderer?.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer?.domElement.removeEventListener('dblclick', onDblClick);
      // 点云预览器要显式释放：解码出来的 GPU 资源不会随场景 traverse 走。
      try {
        splatPreview?.dispose();
      } catch {
        /* 点云释放失败不影响卸载。 */
      }
      splatPreview = null;
      controls?.dispose();
      cameraRef.current = null;
      controlsRef.current = null;
      disposables.forEach((item) => {
        try {
          item.dispose();
        } catch {
          /* 单个资源释放失败不影响卸载。 */
        }
      });
      tileCache.textures.forEach((texture) => {
        try {
          texture.dispose();
        } catch {
          /* 共享纹理释放失败不影响卸载。 */
        }
      });
      tileCache.textures.clear();
      tileCache.fallbackMeshes.clear();
      // 设施 GLB 模型层（共享 builder 自管 run guard 与 dispose；场景物件模型在 modelRoots 里）。
      planModelLayer.dispose();
      trafficLayer.dispose();
      vehicleEntitiesLayer.dispose();
      releaseCrowdChildren();
      roleLabels.dispose();
      modelRoots.forEach((root) => {
        try {
          disposeOwnedModel(root);
        } catch {
          /* 单个模型释放失败不影响卸载。 */
        }
        root.parent?.remove(root);
      });
      avatarGroup.parent?.remove(avatarGroup);
      avatarGroupRef.current = null;
      walkFrameRef.current = null;
      interactRegistryRef.current?.clear();
      nearEntryIdRef.current = null;
      scene.traverse((object) => {
        const disposeSticker = object.userData.planStickerDispose;
        if (typeof disposeSticker === 'function') disposeSticker();
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          const material = object.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose();
          object.geometry?.dispose();
        }
      });
      const canvas = renderer?.domElement;
      renderer?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      setWalkCanvas(null);
      if (canvas && canvas.parentNode === stage) stage.removeChild(canvas);
    };
    // 图源 / 初始视口变化才重建场景；规划线的增改走 syncFootprint，避免编辑时镜头被重置。
  }, [onReady, source, groundMode, mapView, plan.anchor?.lng, plan.anchor?.lat, releaseControlledActor]);

  useEffect(() => {
    if (layerApiRef.current?.syncEditVisuals) layerApiRef.current.syncEditVisuals();
    else layerApiRef.current?.syncFootprint(plan);
  }, [plan]);

  // 2026-11-12 P2-i 3D 版：接管/覆盖层激活时重读一次编辑视觉——2D 里最后的状态变化
  // （选中设施、退回浏览模式）不一定伴随 plan 变化，不补这次同步手柄会拿旧快照。
  useEffect(() => {
    if (active && layerApiRef.current?.syncEditVisuals) layerApiRef.current.syncEditVisuals();
  }, [active]);


  return (
    <div
      ref={stageRef}
      data-testid="outdoor-plan-3d"
      style={{ position: 'absolute', inset: 0, background: '#d9e3ea', overflow: 'hidden' }}
    >
      {groundState === 'loading' && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            top: 16,
            zIndex: 2,
            padding: '4px 10px',
            borderRadius: 8,
            background: 'rgba(18, 20, 26, 0.72)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          正在取地图底图…
        </div>
      )}
      {/* 2026-11-11 用户 m00274「只做了一个切片…就是场地的3d就行了」：
          还没画边界时 3D 里只有一块底图面，容易被当成“多余的切片”——这里说清楚下一步。
          漫游沉浸态隐藏这条编辑引导，避免与漫游 HUD 在顶部居中位置重合。 */}
      {plan.boundary.length < 3 && !walkEnabled && (
        <div
          data-testid="outdoor-3d-empty-hint"
          style={{
            position: 'absolute',
            left: '50%',
            top: 24,
            transform: 'translateX(-50%)',
            zIndex: 2,
            padding: '6px 12px',
            borderRadius: 10,
            background: 'rgba(18, 20, 26, 0.72)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
            pointerEvents: 'none',
          }}
        >
          还没有用地红线：切回 2D 画一圈，这里就会立起你的场地
        </div>
      )}
      <dialog
        ref={walkChooserRef}
        aria-labelledby="outdoor-walk-chooser-title"
        onCancel={event => { event.preventDefault(); onCloseWalkChooser?.(); }}
        className="m-auto w-[min(420px,calc(100%-32px))] max-h-[80vh] overflow-auto rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/30"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="outdoor-walk-chooser-title" className="text-lg font-semibold">选择漫游角色</h2>
          <button type="button" className="rounded-lg px-2 py-1 text-sm hover:bg-neutral-100" onClick={onCloseWalkChooser}>取消</button>
        </div>
        {walkActors.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {walkActors.map(actor => (
              <button
                key={actor.id}
                type="button"
                className="flex min-w-0 items-center gap-2 rounded-lg border border-neutral-200 p-2 text-left text-sm hover:border-green-600 hover:bg-green-50"
                onClick={() => startWalk(actor)}
              >
                {actor.image && <img src={actor.image} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />}
                <span className="truncate">{actor.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="my-3 text-sm text-neutral-600">当前场地没有可接管的人物。</p>
        )}
        <button type="button" className="mt-4 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100" onClick={() => startWalk()}>
          自由漫游
        </button>
      </dialog>
      {walkEnabled && walkCanvas && (
        <div
          data-testid="outdoor-walk-hud"
          style={{
            position: 'absolute',
            left: '50%',
            top: 16,
            transform: 'translateX(-50%)',
            zIndex: 35,
            padding: '6px 12px',
            borderRadius: 10,
            background: 'rgba(18, 20, 26, 0.72)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          {controlledActorRef.current && <span>接管中 · {controlledActorRef.current.actor.label}</span>}
          <span>{viewMode === 'orbit' ? 'WASD 移动角色 · 左键环绕 · 滚轮缩放 · Esc 退出漫游' : 'WASD / 方向键行走 · Shift 加速 · Esc 退出漫游'}</span>
          {viewMode !== 'orbit' && (walkPhase === 'drag' || walkPhase === 'unlocked') && <span>拖动鼠标转头</span>}
          {onCycleView && (
            <button
              type="button"
              data-testid="outdoor-walk-view"
              onClick={onCycleView}
              style={{
                pointerEvents: 'auto',
                border: '1px solid rgba(255,255,255,0.35)',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                fontSize: 12,
                lineHeight: '18px',
                padding: '2px 8px',
                cursor: 'pointer',
              }}
            >
              {WALK_VIEW_LABEL[viewMode]} · F5
            </button>
          )}
        </div>
      )}
      {nearEntry && (
        <div
          data-testid="outdoor-interact-hint"
          style={{
            position: 'absolute',
            left: '50%',
            top: 56,
            transform: 'translateX(-50%)',
            zIndex: 35,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: '6px 12px',
            borderRadius: 10,
            background: 'rgba(18, 20, 26, 0.72)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 5,
              padding: '0 6px',
              fontWeight: 600,
            }}
          >
            E
          </span>
          <span>
            {interactHintLabel(nearEntry, seatActiveId === nearEntry.id)}
            {nearEntry.subtitle ? ` · ${nearEntry.subtitle}` : ''}
          </span>
        </div>
      )}
      {groundState === 'unavailable' && (
        <div
          data-testid="outdoor-3d-unavailable"
          role="status"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 2,
            maxWidth: 360,
            padding: '14px 18px',
            borderRadius: 12,
            background: 'rgba(18, 20, 26, 0.86)',
            color: '#fff',
            fontSize: 13,
            lineHeight: '20px',
            textAlign: 'center',
          }}
        >
          这台设备暂时打不开 3D 画面（浏览器没给 WebGL）。
          <br />
          布置和保存都不受影响，切回 2D 继续就行。
        </div>
      )}
      {groundState === 'paper' && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            zIndex: 2,
            padding: '4px 10px',
            borderRadius: 8,
            background: 'rgba(18, 20, 26, 0.62)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          {groundMode === 'paper'
            ? '纸面模式 · 虚拟场地（不关联真实地图）'
            : '地图底图未取到，先用纸面网格（低模草图）'}
        </div>
      )}
      <GeoScaleCompass
        scaleLabelRef={scaleLabelRef}
        scaleBarRef={scaleBarRef}
        compassRef={compassRef}
        attribution={groundState === 'satellite' ? basemapSourceAttribution(source) : null}
        testIdPrefix="outdoor-3d"
        onResetNorth={resetNorth}
        onOrbitDelta={orbitByDelta}
        showCompass={false}
      />
    </div>
  );
}
