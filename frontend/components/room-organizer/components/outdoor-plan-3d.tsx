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

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GeoScaleCompass } from '@/components/room-organizer/components/geo-scale-compass';
import { useOutdoorWalk, type OutdoorWalkFrame, type SeatWalkState } from '@/components/room-organizer/hooks/use-outdoor-walk';
import {
  DIRECT_BASE,
  findAholoAsset,
  resolveAholoAssetUrl,
} from '@/components/room-organizer/lib/aholo-assets';
import { CATALOG_DRAG_MIME } from '@/components/room-organizer/lib/catalog-drag';
import { storedAholoSceneSource } from '@/components/room-organizer/lib/aholo-model-placement';
import { createCrowdIdlePacer } from '@/components/room-organizer/lib/idle-crowd-pacer';
import {
  InteractRegistry,
  nearestNearbyEntry,
  type InteractableEntry,
} from '@/components/room-organizer/lib/interact-registry';
import { createPlanPreviewRefresh } from '../lib/plan-preview-refresh';
import { libraryEntryColor } from '@/components/room-organizer/lib/oneplan-library';
import { workerRoleColor, workerSticker } from '@/components/room-organizer/lib/oneplan-stickers';
import { facilityInteractables, interactHintLabel, seatInteractables, workerInteractables } from '@/components/room-organizer/lib/outdoor-interactables';
import { enuToLngLat, lngLatToEnu, planMetersPerPixel, planPixelToPoint, planPointToPixel, type PlanViewport } from '@/components/room-organizer/lib/outdoor-plan-canvas';
import { BasemapTileCache } from '@/components/room-organizer/lib/plan-tile-cache';
import { basemapSourceAttribution } from '@/components/room-organizer/lib/tdt-probe';
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
import { createPlanRoleLabels } from '@/components/room-organizer/three/plan-role-labels';
import { createPlanTrafficLayer } from '@/components/room-organizer/three/plan-traffic-layer';
import { ROOM_OBJECT_TAGS } from '@/components/room-organizer/three/room-builder';
import {
  advanceGlbAnimations,
  createCachedGlbModel,
  createWalkAvatar,
  disposeOwnedModel,
  ensureGlbAsset,
} from '@/components/room-organizer/three/glb-assets';
import { advancePeopleAnimations, registerPersonAnim, setPersonSeatContext, setPersonWalkContext, setPersonZoneContext, takePersonControl } from '@/components/room-organizer/three/people-anim';
import { buildProceduralPerson } from '@/components/room-organizer/three/builders/builders-people';
import { findWalkRole } from '@/components/room-organizer/lib/walk-roles';
import { createSplatPreview, type SplatPreview, type SplatWalkBounds } from '@/components/room-organizer/three/splat-preview';
import { type PlanFacility, type PlanPoint, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { CanvasBasemapSource, OutdoorPlanCanvasHandle, PlanEditVisuals } from '@/components/room-organizer/components/outdoor-plan-canvas';
import type { PlanSceneObject } from '@/components/room-organizer/lib/plan-item-bridge';
import { createPlanVehicleEntitiesLayer } from '@/components/room-organizer/three/plan-vehicle-entities';
import type { WalkViewMode } from '@/components/room-organizer/lib/walk-view-modes';
import {
  facilityProp,
  planFootprintShapes,
  planShellFrame,
  type PlanPropShape,
} from '@/components/room-organizer/lib/plan-footprint-geometry';
import { acquireWebGLSurface } from '@/components/room-organizer/lib/webgl-context';
import {
  planCrowdShellPlacements,
  planSceneObjectPlacements,
} from '@/components/room-organizer/lib/plan-scene-placement';
import { assignCrowdWalkRoutes } from '@/components/room-organizer/lib/plan-crowd-routes';
import { DERIVED_CROWD_NOTE, deriveCrowdFromRoutes, mergeDerivedCrowd, shouldDeriveCrowd } from '@/components/room-organizer/lib/plan-crowd-derived';
import { planFacilityColliders, planSeatAnchors, planWalkBounds, planZoneRings } from '@/components/room-organizer/lib/plan-walk-context';
import { planPlayerColliders } from '@/components/room-organizer/lib/plan-player-colliders';
import { seatWalkAnchor } from '@/components/room-organizer/lib/seat-placement';
import { workerPresetLine } from '@/components/room-organizer/lib/outdoor-worker-lines';
import { auditWalkability } from '@/components/room-organizer/lib/walk-audit';
import { describeRouteGuidance, guidanceAlongRoute } from '@/components/room-organizer/lib/walk-route-guidance';
import { encodeWalkSpot, readWalkSpotFromHash, upsertWalkSpot, type WalkSpot } from '@/components/room-organizer/lib/walk-spots';
import type { WalkCollider } from '@/components/room-organizer/lib/walk-collision';
import {
  splatPlacementOffset,
  splatVenueSpan,
  splatWorldPosition,
} from '@/components/room-organizer/lib/plan-splat-placement';
import { RESEARCH_BASEMAP_TAG } from '@/components/room-organizer/three/research-basemap';
import {
  FACILITY_HANDLE_MIN_FOOTPRINT_PX,
  FACILITY_ROTATE_GAP_PX,
  facilityFootprintRing,
  facilityHandles,
  facilityContainsPoint,
} from '@/components/room-organizer/lib/site-plan-facilities';
import {
  defaultSiteCalibration,
  readSiteCalibration,
} from '@/components/room-organizer/lib/site-capture';
import type { FurnitureItem } from '@/components/room-organizer/lib/types';
import { OUTDOOR_WALK_CANVAS_ID } from '@/components/room-organizer/lib/walk-engage';
import { consumePlanFacilityDrag, getPlanFacilityDrag } from '@/components/room-organizer/lib/plan-facility-drag';
import { consumePlanCatalogDrag, getPlanCatalogDrag, PLAN_CATALOG_DRAG_MIME, PLAN_CATALOG_TEXT_PREFIX, readPlanCatalogDrag } from '@/components/room-organizer/lib/plan-catalog-drag';
import { SCOPE_FROST_BLUR_PX, SCOPE_FROST_VEIL, drawScopeFrost } from '@/components/room-organizer/lib/outdoor-scope-frost';

/** 没锚点的场地（纯纸面规划）用的地面底色。 */
const PAPER_GROUND = '#efece4';
/** 倾斜后画面上方露出的天空/雾色，不要再露出一块裁切底。 */
const SKY_GROUND = '#c9d4dc';

/** 规划贴地层（真模型/室内物件投影/人群）的公共底面：瓦片金字塔最高点 z19=0.048 m 之上 4 mm。
 *  2026-11-12 用户反馈「物体没放在平面上」：模型底面原来在 y=0，被 4 cm 高的瓦片盖住脚。
 *  syncFootprint 重摆时也必须带回这个底面，否则一编辑就又沉回 0。 */
const PLAN_LAYER_BASE_Y = 0.052;

/**
 * 2026-11-20 审计 B9/K12/K13：草稿、落位幽灵、选中反馈的覆盖层组标签。
 * 这些内容不属于占地组（没有闭合红线时占地组不存在），单独一组才能每轮同步稳定重建。
 */
const PLAN_OVERLAY_TAG = 'plan-edit-overlay';

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
  /** 封面机位：框住当前这套高斯重建（含高斯层）抓一帧，抓完把相机还回去；没有就绪的重建时返回 null。 */
  captureScanImage(): string | null;
}

/**
 * 实景扫描加载状态（由 OutdoorPlan3D 上报）。
 * 2026-11-19 用户拍板拆除室内点云管线（B 方案）：
 * 尺寸校准与漫游边界不能再问隐藏管线要，这里改成由可见的 3D 画布报出来。
 */
export type SplatScanState = Readonly<{
  assetId: string;
  name: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** 0..1；未知时不带。 */
  progress?: number;
  error?: string;
  /** 点云落地后的真实米制尺寸（尺寸校准用）。 */
  meters?: { width: number; depth: number; height: number };
  /** 漫游可走边界（米，第一人称围栏用）；没有就是不带。 */
  walkBounds?: SplatWalkBounds;
}>;

/** 一份场地高斯重建的落位请求：地面占位标记 + 世界落点 + 资产地址。 */
type VenueSplatRequest = {
  patch: THREE.Mesh;
  outline: THREE.LineLoop;
  assetId: string;
  url: string;
  name: string;
  world: { x: number; z: number };
};

/**
 * 已挂上的那份高斯重建。与底图场景分开持有：换扫描才重新加载，
 * 挪落点只按差值平移（offset 是预览器的落位偏移，世界中心 = calibration.origin + offset）。
 */
type VenueSplat = VenueSplatRequest & {
  /** 加载失败时置 null，占位标记留在原地当降级提示。 */
  preview: SplatPreview | null;
  offset: THREE.Vector3;
  meters?: { width: number; depth: number; height: number };
  walkBounds?: SplatWalkBounds | null;
};

export interface OutdoorPlan3DProps {  plan: SitePlanData;
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
  /** 当前选中的漫游角色 GLB（左侧「漫游角色」的同一份选择）；缺省或加载失败时退回几何占位人。 */
  walkRoleUrl?: string;
  walkRoleName?: string;
  /**
   * 2026-11-19：把场地实景（高斯点云）的加载状态报给外层。
   * 室内点云管线已退役，外层（room-organizer）只看这一份：顶部状态条、漫游可用性、
   * 尺寸校准、加载失败重试都以它为准。
   */
  onScanState?(state: SplatScanState): void;
  /** 2026-11-19：当前正在看的实景扫描（世界坐标）；不传就只有地面轮廓、看不到点云。 */
  scan?: {
    assetId: string;
    name: string;
    x: number;
    z: number;
    meters?: { width: number; depth: number; height: number };
  } | undefined;
}

interface WalkActor {
  id: string;
  label: string;
  image: string | null;
  group: THREE.Group;
}

/**
 * 坐姿头部相对高度（米）：让角色按落座眼高对齐，而不是一律扣 1.6 m。
 * 坐姿 clip 自带根位移，各角色下陷量不同，所以每个模型量一次。
 */
function measureWalkSitHeadY(actor: NonNullable<ReturnType<typeof createWalkAvatar>>): number | null {
  if (!actor.sit) return null;
  actor.sit.reset().setEffectiveWeight(1).play();
  actor.mixer.setTime(0.6);
  actor.group.updateMatrixWorld(true);
  let found: THREE.Object3D | null = null;
  actor.group.traverse((node) => {
    if (!found && /head/i.test(node.name)) found = node;
  });
  actor.sit.stop();
  if (!found) return null;
  const world = new THREE.Vector3();
  (found as THREE.Object3D).getWorldPosition(world);
  const height = world.y - actor.group.position.y;
  return Number.isFinite(height) ? height : null;
}

/** 2026-11-20 审计 K5：3D 放置浮条上的小按钮（与 2D 浮条同一套白底按钮口径的深底版）。 */
const hudButtonStyle: React.CSSProperties = {
  padding: '0 7px',
  height: 20,
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'rgba(255,255,255,0.10)',
  color: '#fff',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  lineHeight: 1,
};

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
  walkRoleUrl,
  walkRoleName,
  onScanState,
  scan,
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
  /** 接管面板只列用户自己放的人：派生路人（`plan-crowd-route:`）是示意用的，不能拿来当化身。 */
  const pickableWalkActors = walkActors.filter(actor => !actor.id.includes('plan-crowd-route:'));
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
  // 存观景位：记下当前机位，并把可回放的链接复制到剪贴板（分享 / 评审用）。
  const saveWalkSpot = () => {
    const frame = walkFrameRef.current;
    if (!frame) return;
    const spot: WalkSpot = {
      name: `观景位 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
      x: frame.x,
      z: frame.z,
      yaw: frame.yaw,
      view: viewMode,
    };
    try {
      const key = 'scendance-walk-spots-v1';
      const raw = window.localStorage.getItem(key);
      const list = raw ? (JSON.parse(raw) as WalkSpot[]) : [];
      window.localStorage.setItem(key, JSON.stringify(upsertWalkSpot(Array.isArray(list) ? list : [], spot)));
    } catch { /* 隐私模式 / 配额满：只复制链接 */ }
    const url = `${window.location.origin}${window.location.pathname}#${encodeWalkSpot(spot)}`;
    void navigator.clipboard?.writeText(url).catch(() => {});
    setSpotNotice('观景位已存，链接已复制');
    window.setTimeout(() => setSpotNotice(null), 2400);
  };

  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  // 组件级引用（renderer/scene 本体在 mount effect 里）：captureImage 同步抓帧用。
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  // 场地高斯重建独立持有：换扫描重新加载、挪落点只平移，都不重建底图场景。
  const venueSplatRef = useRef<VenueSplat | null>(null);
  const venueSplatApiRef = useRef<{ start(request: VenueSplatRequest): void; dispose(): void } | null>(null);
  const scanRef = useRef(scan);
  scanRef.current = scan;
  const onScanStateRef = useRef(onScanState);
  onScanStateRef.current = onScanState;
  const disposeVenueSplat = useCallback((): void => {
    const entry = venueSplatRef.current;
    if (!entry) return;
    venueSplatRef.current = null;
    // 解码出来的 GPU 资源不会随场景 traverse 走，要显式释放。
    try {
      entry.preview?.dispose();
    } catch {
      /* 释放失败不影响卸载。 */
    }
    entry.patch.parent?.remove(entry.patch);
    entry.outline.parent?.remove(entry.outline);
    entry.patch.geometry.dispose();
    (entry.patch.material as THREE.Material).dispose();
    entry.outline.geometry.dispose();
    (entry.outline.material as THREE.Material).dispose();
  }, []);
  // 真实模型层的“换代号”：plan 变化或组件卸载后自增，晚到的模型直接丢掉。
  const modelRunRef = useRef(0);
  const canvasEditApiRef = useRef(canvasApiRef);
  canvasEditApiRef.current = canvasApiRef;
  const layerApiRef = useRef<{ syncFootprint: (next: SitePlanData, selectedZoneId?: string | null) => void; syncEditVisuals: () => void } | null>(null);
  const compassRef = useRef<HTMLDivElement | null>(null);
  const scaleBarRef = useRef<HTMLDivElement | null>(null);
  const scaleLabelRef = useRef<HTMLSpanElement | null>(null);
  /** 3D 框外毛玻璃层（backdrop-filter + clip-path 挖洞）。 */
  /** 3D 框外毛玻璃层：叠在 WebGL 上面的透明 canvas（只在框外糊底图）。 */
  const frostRef = useRef<HTMLCanvasElement | null>(null);
  /** 设计范围环的最新点位：镜头每帧动，环只在 plan 变时换。 */
  const scopeRingRef = useRef<readonly PlanPoint[]>([]);
  const lineMaterialsRef = useRef<{ resolution: THREE.Vector2 }[]>([]);
  // 漫游占位 avatar：第三人称 / 过肩档显示；帧姿态由 useOutdoorWalk 每帧写 ref，主 loop 摆位。
  const avatarGroupRef = useRef<THREE.Group | null>(null);
  /** 选中漫游角色的真模型容器（GLB）；加载失败时为 null，占位胶囊继续兜底。 */
  const walkRoleAvatarRef = useRef<{
    root: THREE.Group;
    actor: NonNullable<ReturnType<typeof createWalkAvatar>>;
    seated: boolean;
    moving: boolean;
    sitHeadY: number | null;
  } | null>(null);
  const walkFrameRef = useRef<OutdoorWalkFrame | null>(null);
  /** 玩家世界系设施碰撞盒：plan 变化时重算一次，RAF 只读。 */
  const playerCollidersRef = useRef<WalkCollider[]>([]);
  // E 键交互：注册表实例 + 当前近邻条目（HUD 提示 / E 键触发用）。
  const interactRegistryRef = useRef<InteractRegistry | null>(null);
  if (!interactRegistryRef.current) interactRegistryRef.current = new InteractRegistry();
  const [nearEntry, setNearEntry] = useState<InteractableEntry | null>(null);
  const nearEntryIdRef = useRef<string | null>(null);
  const nearEntryRef = useRef<InteractableEntry | null>(null);
  // W3：岗位 E 键预设短台词。只做一句话提示条，同一岗位再按 E 关闭；不接对话。
  const [interactLine, setInteractLine] = useState<{ id: string; text: string } | null>(null);
  const interactLineRef = useRef<{ id: string; text: string } | null>(null);
  interactLineRef.current = interactLine;
  // 落座态：E 键座位条目写入 / 起身清空；hook 每帧据此钉住锚点与坐姿眼高。
  const seatStateRef = useRef<SeatWalkState | null>(null);
  const [seatActiveId, setSeatActiveId] = useState<string | null>(null);

  // 座位条目落座 / 起身：同一座位再按一次 E 起身。
  // 落座锚点按真实坐姿：朝椅面外、背靠椅背，髂部落在座面偏后一点。
  // 起身落点再沿朝向退一段（与 `planSeatAnchors` 的 approach 同口径），避免站进椅子里。
  const SEAT_HIP_BACK_M = 0.12;
  const SEAT_STANDOFF_M = 0.45;
  const toggleSeatEntry = (entry: InteractableEntry) => {
    const seat = entry.seat;
    if (!seat) return;
    const current = seatStateRef.current;
    if (current?.active && current.seatId === entry.id) {
      seatStateRef.current = {
        active: false,
        x: current.x,
        z: current.z,
        eyeY: 1.6,
        ...(typeof current.standX === 'number' ? { standX: current.standX } : {}),
        ...(typeof current.standZ === 'number' ? { standZ: current.standZ } : {}),
      };
      setSeatActiveId(null);
      return;
    }
    const seatAnchor = seatWalkAnchor(seat, { hipBackM: SEAT_HIP_BACK_M, standoffM: SEAT_STANDOFF_M });
    seatStateRef.current = {
      active: true,
      seatId: entry.id,
      // 与设施模型同一套朝向：模型 rotation.y = -deg，资产默认朝北（three 的 -Z），
      // 人物正面是 +Z，所以人转 π − deg 才与椅面同向、背靠椅背；
      // 髂部落在座面偏后、起身落点再让一段（公式在 lib/seat-placement.ts，可单测）。
      x: seatAnchor.x,
      z: seatAnchor.z,
      eyeY: seat.eyeY,
      ...(typeof seat.seatHeight === 'number' ? { seatHeight: seat.seatHeight } : {}),
      yaw: seatAnchor.yaw,
      standX: seatAnchor.standX,
      standZ: seatAnchor.standZ,
    };
    setSeatActiveId(entry.id);
  };
  nearEntryRef.current = nearEntry;
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  // 2026-11-17：多一个 unavailable——设备根本给不出 WebGL 时，3D 画不出来是事实，
  // 别再假称“正在取底图”或“先用纸面网格”，那两句话会把人引到错的地方。
  const [groundState, setGroundState] = useState<'loading' | 'satellite' | 'paper' | 'unavailable'>('loading');
  /** 2026-11-18：当前 3D 场景里派生出来的示意路人数（0 = 没派生，不显示说明）。 */
  const [derivedCrowdCount, setDerivedCrowdCount] = useState(0);
  const derivedCrowdCountRef = useRef(0);
  /** 漫游角色 GLB 的加载态：失败时退回几何占位人，并留一句不吓人的说明。 */
  const [walkRoleAvatar, setWalkRoleAvatar] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; message?: string; hasSit?: boolean }>({ status: 'idle' });
  /** 这一帧是不是被红线挡住（HUD 提示用，只在变化时 setState）。 */
  const [atBoundary, setAtBoundary] = useState(false);
  /** 沿流线走的导航行（离流线近时才显示）。 */
  const [routeLine, setRouteLine] = useState<string | null>(null);
  const atBoundaryRef = useRef(false);
  const routeTickRef = useRef(0);
  /** 观景位保存后的短提示。 */
  const [spotNotice, setSpotNotice] = useState<string | null>(null);
  /**
   * 2026-11-20 审计 K5：3D 自己的放置浮条。2D 浮条在 3D 接管态整块被 visibility:hidden
   * 藏起来，于是 3D 里连「正在放置、怎么取消、当前多少度」都看不到。这里只镜像状态，
   * 旋转/取消仍走画布句柄上同一个 `rotatePendingFacility` / `cancelPendingPlacement`。
   */
  const [pendingPlacement, setPendingPlacement] = useState<{ name: string; width: number; depth: number; rotationDeg: number } | null>(null);
  /** 从 #wspot1… 链接带进来的机位：进漫游时作为出生点。 */
  const spotSpawnRef = useRef<{ x: number; z: number; yaw: number } | null>(null);
  /** 重试按一次换一个代次，重新走一遍加载。 */
  const [avatarAttempt, setAvatarAttempt] = useState(0);
  /** 无 sit 剪辑时下沉对位，HUD 要说清“这不是坐姿动画”。 */
  const [seatedNoSit, setSeatedNoSit] = useState(false);
  const seatedNoSitRef = useRef(false);

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
    // 高斯重建在独立绘制层（paintAsBackLayer），只 render(scene) 抓出来是纯底图。
    const preview = venueSplatRef.current?.preview;
    if (preview?.shownId) preview.renderFrame(renderer, scene, camera);
    else renderer.render(scene, camera);
    try {
      return renderer.domElement.toDataURL('image/png');
    } catch {
      return null;
    }
  }, []);

  const captureScanImage = useCallback((): string | null => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const entry = venueSplatRef.current;
    if (!camera || !entry?.preview?.shownId) return null;
    const bounds = entry.walkBounds;
    const width = bounds ? bounds.maxX - bounds.minX : (entry.meters?.width ?? 4);
    const depth = bounds ? bounds.maxZ - bounds.minZ : (entry.meters?.depth ?? 3);
    const height = entry.meters?.height ?? 3;
    const center = new THREE.Vector3(
      bounds ? (bounds.minX + bounds.maxX) / 2 : entry.world.x,
      (bounds?.minY ?? 0) + height / 2,
      bounds ? (bounds.minZ + bounds.maxZ) / 2 : entry.world.z,
    );
    const span = Math.max(width, depth, height, 1);
    const savedPosition = camera.position.clone();
    const savedTarget = controls ? controls.target.clone() : null;
    camera.position.set(center.x + span * 1.1, center.y + span * 0.8, center.z + span * 1.5);
    if (controls) controls.target.copy(center);
    camera.lookAt(center);
    const image = captureImage();
    camera.position.copy(savedPosition);
    if (controls && savedTarget) {
      controls.target.copy(savedTarget);
      controls.update();
    }
    camera.lookAt(controls ? controls.target : center);
    return image;
  }, [captureImage]);

  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = { zoomBy: zoomByStep, focusLngLat, focusVenue, resetNorth, getBearing, orbitByDelta, captureImage, captureScanImage };
    return () => { apiRef.current = null; };
  }, [apiRef, zoomByStep, focusLngLat, focusVenue, resetNorth, getBearing, orbitByDelta, captureImage, captureScanImage]);

  // 玩家设施碰撞：plan 变化时按世界系重算一次；RAF 里只读 ref，不每帧建盒。
  // 口径见 `lib/plan-player-colliders.ts`：设施盒是场地局部系，玩家在世界系，差一个场地中心平移。
  useEffect(() => {
    const boundary = Array.isArray(plan.boundary) ? plan.boundary : [];
    const facilities = Array.isArray(plan.facilities) ? plan.facilities : [];
    const frame = ringFrame(boundary);
    playerCollidersRef.current = planPlayerColliders(facilities, boundary, {
      width: frame.width,
      depth: frame.depth,
    });
  }, [plan.boundary, plan.facilities]);

  // 通行体检：可达面积 / 走不到的设施 / 被压住的流线 / 最窄通道。
  // 纯函数在 `lib/walk-audit.ts`，这里只在 plan 变化时跑一次，HUD 只读结论字符串。
  const walkAudit = useMemo(() => {
    const boundary = Array.isArray(plan.boundary) ? plan.boundary : [];
    if (boundary.length < 3) return null;
    const frame = ringFrame(boundary);
    const routes = (Array.isArray(plan.routes) ? plan.routes : []).map((route) => ({
      points: route.points,
      ...(route.kind ? { kind: route.kind } : {}),
    }));
    try {
      return auditWalkability({
        facilities: Array.isArray(plan.facilities) ? plan.facilities : [],
        boundary,
        metrics: { width: frame.width, depth: frame.depth },
        routes,
      });
    } catch {
      return null;
    }
  }, [plan.boundary, plan.facilities, plan.routes]);

  // 观景位深链接：#wspot1… 带进来就直接当出生点（再点漫游即到位）。
  useEffect(() => {
    const spot = readWalkSpotFromHash(window.location.hash);
    if (spot) spotSpawnRef.current = { x: spot.x, z: spot.z, yaw: spot.yaw };
  }, []);

  // 化身预加载：3D 编辑态先把角色 GLB 拉进 HTTP 缓存（不解析、不建对象），
  // 进漫游时直接命中缓存，避免每次都先看 10 秒几何人。
  useEffect(() => {
    if (!walkRoleUrl) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void fetch(walkRoleUrl, { cache: 'force-cache' })
        .then((response) => { response.body?.cancel().catch(() => {}); })
        .catch(() => {});
    }, 1500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [walkRoleUrl]);

  // 一期裸第一人称步行：指针锁 / WASD / 边界钳制自管在本组件内，旧室内
  // walkthroughMode 链路不动；退出由 onWalkExit 交外层收口。
  const { phase: walkPhase } = useOutdoorWalk({
    enabled: walkEnabled,
    canvas: walkCanvas,
    cameraRef,
    orbitRef: controlsRef,
    spawn: spotSpawnRef.current ?? controlledActorRef.current?.spawn,
    boundary: plan.designScope?.length ? plan.designScope : plan.boundary,
    viewMode,
    seatRef: seatStateRef,
    collidersRef: playerCollidersRef,
    onStandUp: () => {
      // 落座中按移动键自动起身：清掉落座态，E 提示回「坐下」。
      seatStateRef.current = null;
      setSeatActiveId(null);
    },
    onWalkFrame: (frame) => {
      walkFrameRef.current = frame;
      // 触到红线：只在变化时 setState，避免每帧重渲染。
      if (Boolean(frame.atBoundary) !== atBoundaryRef.current) {
        atBoundaryRef.current = Boolean(frame.atBoundary);
        setAtBoundary(Boolean(frame.atBoundary));
      }
      // 沿流线走：4 次/秒算一次最近流线的剩余距离与 ETA（离流线 8 m 内才显示）。
      const nowMs = performance.now();
      if (nowMs - routeTickRef.current > 250) {
        routeTickRef.current = nowMs;
        const routes = Array.isArray(plan.routes) ? plan.routes : [];
        let best: { text: string; off: number } | null = null;
        for (const route of routes) {
          if (!Array.isArray(route?.points) || route.points.length < 2) continue;
          const world = route.points.map((point) => ({ x: point.x, z: -point.y }));
          const guidance = guidanceAlongRoute(world, { x: frame.x, z: frame.z }, 1.8);
          if (!guidance) continue;
          if (!best || guidance.offRouteM < best.off) {
            best = { text: describeRouteGuidance(guidance), off: guidance.offRouteM };
          }
        }
        setRouteLine(best && best.off < 8 ? best.text : null);
      }
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
      // 岗位：一句预设台词，同一条目再按 E 收起。座位继续走 toggleSeatEntry，不抢同一条。
      if (entry.kind === 'npc') {
        setInteractLine((current) =>
          current?.id === entry.id ? null : { id: entry.id, text: workerPresetLine(entry.label) }
        );
      }
      registry.actionFor(entry.id)?.({ entry });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walkEnabled]);

  // 退出漫游 / 切鸟瞰时关掉台词，避免回到编辑态还残留一句。
  useEffect(() => {
    if (!walkEnabled || viewMode === 'orbit') setInteractLine(null);
  }, [walkEnabled, viewMode]);

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
        // 设施只取影响几何 / 可坐判定的字段：vendor、日期这些改了不必重建人群。
        facilities: (nextPlan.facilities ?? []).map((facility) => ({
          id: facility.id,
          name: facility.name,
          templateId: facility.templateId,
          position: facility.position,
          size: facility.size,
          rotationDeg: facility.rotationDeg,
        })),
        // 分区轮廓变了就要重算「从哪儿进区」（B2）。
        zones: (nextPlan.zones ?? []).map((zone) => ({ id: zone.id, polygon: zone.polygon })),
        // 出入口位置变了，派生人群的穿场/折返判定也要重算。
        nodes: (nextPlan.nodes ?? []).map((node) => ({ id: node.id, kind: node.kind, position: node.position })),
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
      const pointRouteMap = assignCrowdWalkRoutes(
        crowdPlacements,
        Array.isArray(nextPlan.routes) ? nextPlan.routes : [],
        nextPlan.boundary,
        nextMetrics,
      );
      // 2026-11-18 用户：「不是所有用户都有放很多人的意识，能不能给人的流线就直接加人在走」。
      // 没放观众/游客类点位时，按人行流线补一批派生路人：不写 plan、不进人员统计与容量，
      // 只让 3D 里看得出人沿哪条线走。放了点位就以点位为准，派生退场。
      const derivedCrowd = shouldDeriveCrowd(Array.isArray(nextPlan.workers) ? nextPlan.workers : [])
        ? deriveCrowdFromRoutes({
            routes: Array.isArray(nextPlan.routes) ? nextPlan.routes : [],
            nodes: Array.isArray(nextPlan.nodes) ? nextPlan.nodes : [],
            boundary: nextPlan.boundary,
            metrics: nextMetrics,
          })
        : null;
      const { roster: crowdRoster, routeMap: walkRouteMap, derivedCount } = mergeDerivedCrowd({
        placements: crowdPlacements,
        routeMap: pointRouteMap,
        derived: derivedCrowd,
      });
      derivedCrowdCountRef.current = derivedCount;
      setDerivedCrowdCount(derivedCount);
      // 行走上下文（B1）：碰撞盒 + 可走矩形 + 座位锚点。此前户外从未注入—
      // 人群是「无碰撞、无围栏、只沿折线」在走。座椅自身不进碰撞盒：人要走到椅子
      // 后面才坐得下，椅子当障碍会永远到不了（见 lib/plan-walk-context.ts 注释）。
      const facilitiesForWalk = Array.isArray(nextPlan.facilities) ? nextPlan.facilities : [];
      const localRoutes = [...walkRouteMap.values()].map((route) => route.points);
      setPersonWalkContext(
        {
          colliders: planFacilityColliders(facilitiesForWalk, nextPlan.boundary, nextMetrics, localRoutes),
          bounds: planWalkBounds(nextMetrics),
        },
        'outdoor',
      );
      setPersonSeatContext({ seats: planSeatAnchors(facilitiesForWalk, nextPlan.boundary, nextMetrics) });
      // 分区漫游（B2）：流线从区外穿进区内时，人有概率拐进去走一段再回线。
      // 分区太窝（< 4 m²）直接丢弃：进去也只能原地转身。
      const zonesForWalk = Array.isArray(nextPlan.zones) ? nextPlan.zones : [];
      setPersonZoneContext({ zones: planZoneRings(zonesForWalk, nextPlan.boundary, nextMetrics) });
      const totals = new Map<string, number>();
      const ordinals = new Map<string, number>();
      const colors = new Map(nextPlan.workers.map(worker => [worker.id, worker.color]));
      for (const { role } of crowdRoster) {
        totals.set(role, (totals.get(role) ?? 0) + 1);
      }
      const actors = crowdRoster.map((placement): WalkActor => {
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

    // 实景扫描（高斯重建）：先把地面轮廓标记画出来，本体等 controls 建好再起
    //（预览器要 renderer + camera + 环绕控制器）。
    const splatRequests: VenueSplatRequest[] = [];

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
        // 实景扫描（高斯重建）：本机 Aholo 注册表里能取到这份资产才起本体；
        // 起不来时这块轮廓就留在原地当占位标记（静默降级，不打断其它落点）。
        const assetId = placement.assetId;
        const url = assetId ? resolveAholoAssetUrl(assetId) : undefined;
        if (assetId && url) {
          const at = splatWorldPosition(placement.shell, metrics);
          splatRequests.push({ patch, outline, assetId, url, name: placement.name, world: { x: at.x, z: at.z } });
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
    const groupCornerMeshes: THREE.Mesh[] = [];
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
      overlayDisposables.push(geometry, material, outlineMaterial);
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
    let lastFootprintKey = '';
    let lastCommittedPlan = plan;
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
    /** 一句话布置的批量虚影：半透明体块，确认前不进 plan。 */
    const arrangePreviewProps = (visuals: PlanEditVisuals) => {
      const items = visuals.arrangePreview;
      if (!items?.length) return [];
      const frame = ringFrame(visuals.plan.boundary);
      if (!frame) return [];
      const shell = planShellFrame(visuals.plan.boundary, { width: frame.width, depth: frame.depth }, { clampPoints: false });
      if (!shell) return [];
      return items.map((item, index) => facilityProp({
        id: `__arrange_${index}`,
        templateId: item.templateId,
        name: item.name,
        position: item.position,
        rotationDeg: item.rotationDeg,
        size: { width: item.width, depth: item.depth },
        ...(item.modelOverride ? { modelOverride: item.modelOverride } : {}),
      }, shell));
    };
    const syncEditVisuals = (): void => {
      const visuals = canvasEditApiRef.current?.current?.getEditVisuals?.();
      if (!visuals) return;
      // 预览模型每帧跟手；真正落地仍走 plan 设施，避免预览和已落模型混淆。
      planModelLayer.setPreview(
        Date.now() < previewMutedUntil ? null : previewPropFor(visuals.plan, visuals.draft),
        previewTargetId(visuals.plan, visuals.draft),
      );
      const arrangeGhosts = arrangePreviewProps(visuals);
      // 2026-11-12 3D 手柄目标：可编辑且有选中设施才挂柄（每帧按最新目标重摆位置）。
      handleFacilityRef.current = visuals.facilityEditable && visuals.selectedFacilityId
        ? visuals.plan.facilities.find(f => f.id === visuals.selectedFacilityId) ?? null
        : null;
      handleInfoRef.current = { mode: canvasEditApiRef.current?.current?.getMode?.() ?? null, editable: visuals.facilityEditable, selectedId: visuals.selectedFacilityId };
      const key = JSON.stringify({
        selectedZoneId: visuals.selectedZoneId,
        // 2026-11-20 审计 B8/B9/K13：选中态与框选矩形都进推送键，否则清单换选、
        // 框选过程在 3D 里看不到任何变化。
        selectedFacilityId: visuals.selectedFacilityId,
        selectedRouteId: visuals.selectedRouteId,
        selectedNodeId: visuals.selectedNodeId,
        selectedWorkerId: visuals.selectedWorkerId,
        selectedVehicleId: visuals.selectedVehicleId,
        selectedAnnotationId: visuals.selectedAnnotationId,
        selectedMeasurementId: visuals.selectedMeasurementId,
        multiSelectedFacilityIds: visuals.multiSelectedFacilityIds,
        multiSelectedRouteIds: visuals.multiSelectedRouteIds,
        multiSelectedNodeIds: visuals.multiSelectedNodeIds,
        marquee: visuals.marquee,
        plan: visuals.plan,
        committedPlan: visuals.committedPlan,
        draft: visuals.draft ?? null,
      });
      if (key === lastEditKey) {
        planModelLayer.setBatchPreview(arrangeGhosts);
        return;
      }
      lastEditKey = key;
      // 选中/框选/草稿每次更新，和重建全场地几何分开。模型变换同样实时跟手。
      syncOverlay(visuals);
      const frame = ringFrame(visuals.plan.boundary);
      const metrics = { width: frame.width, depth: frame.depth };
      const shapes = planFootprintShapes(visuals.plan, metrics, { clampPoints: false });
      if (shapes) {
        planModelLayer.group.position.set(frame.cx, PLAN_LAYER_BASE_Y, -frame.cy);
        planModelLayer.syncPositions(shapes.props.filter(prop => !trafficLayer.movesFacility(prop.id)), metrics);
      }
      const footprintKey = JSON.stringify({ plan: visuals.plan, hidden: previewTargetId(visuals.plan, visuals.draft) });
      if (footprintKey !== lastFootprintKey || (visuals.committedPlan && visuals.committedPlan !== lastCommittedPlan)) {
        lastFootprintKey = footprintKey;
        lastCommittedPlan = visuals.committedPlan ?? visuals.plan;
        previewRefresh.request(visuals, !!visuals.committedPlan && visuals.plan !== visuals.committedPlan);
      }
      planModelLayer.setBatchPreview(arrangeGhosts);
    };

    /**
     * 2026-11-20 审计 B9/K13：3D 选中反馈。
     *
     * 3D 原来只画「单件设施手柄 + 分区顶点球」：点中一条动线/出入口/人员/车辆/标注时
     * 屏幕上毫无变化，紧接着按 Delete 却真的删掉了它（看不见被选中）。这里按 visuals 里的
     * 选中 id 画底环/加粗线，并为组选补包围盒、为 2D 框选补矩形投影。
     */
    const SELECTION_ACCENT = '#3d8fa8';
    const SELECTION_WHITE = '#ffffff';
    /** 覆盖层（草稿/幽灵/选中反馈）自己的可释放表：每轮同步重建，不跟着占地组一起释放。 */
    let overlayDisposables: { dispose: () => void }[] = [];

    /**
     * 取覆盖层组并清空上一轮内容（2026-11-20 审计 K12）：草稿不再只能画在占地组里，
     * 没有闭合红线、或占地建不起来时也必须能画。
     */
    const clearOverlayGroup = (): THREE.Group => {
      let group = scene.children.find(
        (child) => child instanceof THREE.Group && child.userData.type === PLAN_OVERLAY_TAG,
      ) as THREE.Group | undefined;
      if (!group) {
        group = new THREE.Group();
        group.userData.type = PLAN_OVERLAY_TAG;
        scene.add(group);
      }
      for (const child of [...group.children]) group.remove(child);
      for (const item of overlayDisposables) item.dispose();
      overlayDisposables = [];
      return group;
    };

    const addSelectionOverlay = (group: THREE.Group, frame: SiteFrame, visuals: PlanEditVisuals): void => {
      const currentPlan = visuals.plan;
      const lineY = 0.9;
      const local = (point: PlanPoint): { x: number; y: number } => ({ x: point.x - frame.cx, y: point.y - frame.cy });
      const addRing = (point: PlanPoint, color: string, radius: number): void => {
        const geometry = new THREE.RingGeometry(radius * 0.62, radius, 28);
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        const spot = local(point);
        mesh.position.set(spot.x, lineY, -spot.y);
        mesh.renderOrder = 15;
        group.add(mesh);
        overlayDisposables.push(geometry, material);
      };
      /** 动线/包围盒用细管代替线宽：WebGL 的 linewidth 在多数平台被忽略，细线看不出选中。 */
      const addRibbon = (points: readonly PlanPoint[], color: string, radius: number, closed = false): void => {
        if (points.length < 2) return;
        const ringPoints = closed && points.length >= 3 ? [...points, points[0]!] : points;
        const vectors = ringPoints.map(point => {
          const spot = local(point);
          return new THREE.Vector3(spot.x, lineY, -spot.y);
        });
        const curve = new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.02);
        const geometry = new THREE.TubeGeometry(curve, Math.max(8, vectors.length * 8), radius, 6, false);
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 15;
        group.add(mesh);
        overlayDisposables.push(geometry, material);
      };
      const routeIds = new Set([visuals.selectedRouteId, ...(visuals.multiSelectedRouteIds ?? [])]);
      for (const route of currentPlan.routes.filter(item => routeIds.has(item.id))) {
        addRibbon(route.points, route.color ?? SELECTION_ACCENT, 0.4);
        for (const point of route.points) addRing(point, SELECTION_WHITE, 0.7);
      }
      const nodeIds = new Set([visuals.selectedNodeId, ...(visuals.multiSelectedNodeIds ?? [])]);
      for (const node of currentPlan.nodes.filter(item => nodeIds.has(item.id))) addRing(node.position, SELECTION_WHITE, 1.5);
      const worker = visuals.selectedWorkerId
        ? currentPlan.workers.find((item) => item.id === visuals.selectedWorkerId)
        : undefined;
      if (worker) addRing(worker.position, SELECTION_WHITE, 1.1);
      const vehicle = visuals.selectedVehicleId
        ? (currentPlan.vehicles ?? []).find((item) => item.id === visuals.selectedVehicleId)
        : undefined;
      if (vehicle) addRing(vehicle.position, SELECTION_WHITE, 1.7);
      const measurement = visuals.selectedMeasurementId
        ? (currentPlan.measurements ?? []).find((item) => item.id === visuals.selectedMeasurementId)
        : undefined;
      if (measurement) {
        addRibbon(measurement.points, SELECTION_WHITE, 0.16);
        for (const point of measurement.points) addRing(point, SELECTION_WHITE, 0.6);
      }
      const annotation = visuals.selectedAnnotationId
        ? (currentPlan.annotations ?? []).find((item) => item.id === visuals.selectedAnnotationId)
        : undefined;
      if (annotation) {
        addRibbon(annotation.points, SELECTION_WHITE, 0.14, annotation.points.length >= 3);
        for (const point of annotation.points) addRing(point, SELECTION_WHITE, 0.5);
      }
      // 组选：底环、包围盒与可拾取角柄共用 2D 的角序及等比缩放逻辑。
      if (visuals.multiSelectedFacilityIds.length) {
        const picks = currentPlan.facilities.filter(item => visuals.multiSelectedFacilityIds.includes(item.id));
        for (const facility of picks) addRing(facility.position, SELECTION_ACCENT, 1.1);
        const corners = picks.flatMap(facility => facilityFootprintRing(facility));
        if (corners.length >= 3) {
          const minX = Math.min(...corners.map(point => point.x));
          const maxX = Math.max(...corners.map(point => point.x));
          const minY = Math.min(...corners.map(point => point.y));
          const maxY = Math.max(...corners.map(point => point.y));
          const box: PlanPoint[] = [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
          ];
          addRibbon(box, SELECTION_ACCENT, 0.09, true);
          if (picks.length >= 2 && visuals.facilityEditable) {
            const geometry = new THREE.BoxGeometry(1, 1, 1);
            const material = new THREE.MeshBasicMaterial({ color: SELECTION_WHITE, depthTest: false });
            overlayDisposables.push(geometry, material);
            for (const point of box) {
              const mesh = new THREE.Mesh(geometry, material);
              const spot = local(point);
              mesh.position.set(spot.x, lineY, -spot.y);
              const distance = camera.position.distanceTo(new THREE.Vector3(point.x, lineY, -point.y));
              mesh.scale.setScalar(Math.min(1.5, Math.max(0.05, distance * 0.012)));
              mesh.renderOrder = 31;
              mesh.userData.planGroupCorner = point;
              groupCornerMeshes.push(mesh);
              group.add(mesh);
            }
          }
        }
      }
      // 2D 框选矩形：按同一视口投回平面画半透明面，框选过程在 3D 里不再是盲选。
      if (visuals.marquee) {
        const viewport = derivedViewportNow();
        if (viewport) {
          const box = visuals.marquee;
          const a = planPixelToPoint({ x: box.x, y: box.y }, viewport);
          const b = planPixelToPoint({ x: box.x + box.w, y: box.y + box.h }, viewport);
          const corners: PlanPoint[] = [
            { x: a.x, y: a.y },
            { x: b.x, y: a.y },
            { x: b.x, y: b.y },
            { x: a.x, y: b.y },
          ];
          const shape = new THREE.Shape();
          corners.forEach((corner, index) => {
            const spot = local(corner);
            if (index === 0) shape.moveTo(spot.x, spot.y);
            else shape.lineTo(spot.x, spot.y);
          });
          shape.closePath();
          const geometry = new THREE.ShapeGeometry(shape);
          const material = new THREE.MeshBasicMaterial({
            color: '#4c8bf5',
            transparent: true,
            opacity: 0.16,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.y = lineY - 0.02;
          mesh.renderOrder = 14;
          group.add(mesh);
          overlayDisposables.push(geometry, material);
          addRibbon(corners, '#4c8bf5', 0.08, true);
        }
      }
    };

    const syncOverlay = (visuals: PlanEditVisuals): void => {
      const frame = ringFrame(visuals.plan.boundary);
      const group = clearOverlayGroup();
      groupCornerMeshes.length = 0;
      group.position.set(frame.cx, 0, -frame.cy);
      addSelectedZoneHandles(group, visuals.plan, frame, visuals.selectedZoneId);
      if (visuals.draft) addDraftOverlay(group, frame, visuals.draft, overlayDisposables);
      addSelectionOverlay(group, frame, visuals);
      const materials = group.userData.planLineMaterials as { resolution: THREE.Vector2 }[] | undefined;
      materials?.forEach(material => material.resolution.set(stage.clientWidth, stage.clientHeight));
    };

    const syncFootprint = (
      nextPlan: SitePlanData,
      _selectedZoneId?: string | null,
      draft?: PlanEditVisuals["draft"],
      visuals?: PlanEditVisuals,
    ): void => {
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
      // 2026-11-20 审计 K12：占地建不起来（没有闭合红线）时不再整体 return 掉草稿，
      // 否则在 3D 里选「画分区/画动线」再点地图毫无反应，看着像功能坏了。
      if (!buildPlanFootprint(THREE, scene, footprintPlan, nextMetrics, { clampPoints: false })) {
        lineMaterialsRef.current = [];
      }
      const nextGroup = scene.children.find(
        (child) => child instanceof THREE.Group && child.userData.type === ROOM_OBJECT_TAGS.PlanFootprint,
      ) as THREE.Group | undefined;
      if (nextGroup) {
        nextGroup.position.set(nextFrame.cx, 0, -nextFrame.cy);
        hideAnimatedVehiclePlaceholders(nextGroup);

      }
      if (nextGroup) collectLineMaterials(nextGroup);
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width > 1 && height > 1) {
        lineMaterialsRef.current.forEach((material) => material.resolution.set(width, height));
      }
      const nextShapes = planFootprintShapes(nextPlan, nextMetrics, { clampPoints: false });
      if (nextShapes) {
        planModelLayer.group.position.set(nextFrame.cx, PLAN_LAYER_BASE_Y, -nextFrame.cy);
        const parkedProps = nextShapes.props.filter(prop => !trafficLayer.movesFacility(prop.id));
        planModelLayer.syncPositions(parkedProps, nextMetrics);
        // 2026-11-12 新放置的设施当场落地真模型：原来要等图源/视口变化触发场景重挂，
        // 用户放个摩天轮只看得到占地轮廓。重建后的占位表同步接管（贴纸隐藏用）。
        planModelLayer.placeNew(parkedProps, nextMetrics, nextGroup ? collectPlaceholdersByPropId(nextGroup) : undefined);
        // metrics 刚更新，预览模型按新场地框重新落位；压住的旧设施模型隐藏。
        planModelLayer.setPreview(
          Date.now() < previewMutedUntil ? null : previewPropFor(nextPlan, draft),
          hiddenPreviewId,
        );
      }
      const sceneLayerObj = scene.getObjectByName('plan-scene-objects');
        if (sceneLayerObj) sceneLayerObj.position.set(nextFrame.cx, PLAN_LAYER_BASE_Y, -nextFrame.cy);
      const crowdLayerObj = scene.getObjectByName('plan-crowd');
      const crowdPlan = visuals?.committedPlan ?? nextPlan;
      const crowdFrame = ringFrame(crowdPlan.boundary);
      if (crowdLayerObj) crowdLayerObj.position.set(crowdFrame.cx, PLAN_LAYER_BASE_Y, -crowdFrame.cy);
      // #84：岗位 / 边界变化时重建人群层（设施模型层走 planModelLayer.syncPositions/placeNew）。
      rebuildCrowd(crowdPlan);
    };
    const previewRefresh = createPlanPreviewRefresh<PlanEditVisuals>(visuals => {
      if (!disposed) syncFootprint(visuals.plan, visuals.selectedZoneId, visuals.draft, visuals);
    });
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

    // —— 实景扫描（高斯重建）——
    // 预览器要 renderer + camera + 环绕控制器，所以等 controls 建好再起。
    // 一个预览器同一时刻只挂一份，因此只起第一块（场地那块）实景扫描。
    const startVenueSplat = (request: VenueSplatRequest): void => {
      if (!renderer || !controls) return;
      const { patch, outline, assetId, url, name, world } = request;
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
      const asset = findAholoAsset(assetId);
      onScanState?.({ assetId, name, status: 'loading', ...(asset?.meters ? { meters: asset.meters } : {}) });
      const calibration = readSiteCalibration(assetId) ?? defaultSiteCalibration(assetId);
      // 落点口径与 patch / outline 同一条链路（壳体 → three 世界）。
      const target = new THREE.Vector3(world.x, 0, world.z);
      // 预览器默认 roofCutoffY = 3（室内按楼层切天花板用），室外整场扫描不能这么裁：
      // 3 米以上会被整片削掉（树冠、楼体、屋顶）。这里给一个足够大的上限，等于不裁切。
      const roofCutoffY = Math.max(60, (asset?.meters?.height ?? 0) * 2);
      const placementOffset = splatPlacementOffset(target, calibration.origin);
      venueSplatRef.current = {
        ...request,
        preview,
        offset: new THREE.Vector3(placementOffset.x, placementOffset.y, placementOffset.z),
      };
      // 进度限频用的时间戳（同一套扫描只在 >120ms 时才上报一次）。
      let lastProgressAt = 0;
      const loadOptions = {
        sizeMeters: splatVenueSpan(metrics),
        upAxis: 'Z' as const,
        roofCutoffY,
        position: placementOffset,
        // 2026-11-19：进度上报。加载器会在 effect 里同步连着打进度事件，
        // 直接 setState 会在同一轮里嵌套更新（React 报 Maximum update depth exceeded），
        // 所以这里限频 + 推到下一帧再报。
        onProgress: (ratio: number | undefined) => {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          if (now - lastProgressAt < 120) return;
          lastProgressAt = now;
          const emit = () => onScanState?.({
            assetId, name, status: 'loading' as const,
            ...(ratio === undefined ? {} : { progress: ratio }),
            ...(asset?.meters ? { meters: asset.meters } : {}),
          });
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(emit);
          else emit();
        },
        calibration: {
          scale: calibration.scale,
          yawDeg: calibration.yawDeg,
          origin: calibration.origin,
          ground: calibration.ground,
          anchors: calibration.anchors,
        },
      };
      const startWith = (src: string) => preview.start({
        assetId,
        url: src,
        name,
        ...(asset?.meters ? { meters: asset.meters } : {}),
        ...(asset?.lodUrl ? { lodUrl: asset.lodUrl } : {}),
      }, loadOptions);
      void startWith(url)
        .catch((error: unknown) => {
          // 2026-11-19：「实景扫描 11/19」实测云端 404、本机 200（194,081,219 B）。
          // 云端没有副本时回退本机代理，不让一条登记写错就永远空画面。
          const local = `${DIRECT_BASE}/asset/${assetId}.${asset?.kind ?? 'spz'}`;
          if (local === url) throw error;
          return startWith(local);
        })
        .then(result => {
          const entry = venueSplatRef.current;
          // 晚到的结果：扫描已换或场景已拆，就别再动画面的占位标记。
          if (entry?.preview !== preview) return;
          entry.meters = result.meters;
          entry.walkBounds = result.walkBounds;
          // 高斯重建起来了就把地面轮廓收掉，避免两层标记叠着。
          patch.visible = false;
          outline.visible = false;
          onScanState?.({ assetId, name, status: 'ready', meters: result.meters, ...(result.walkBounds ? { walkBounds: result.walkBounds } : {}) });
        })
        .catch((error: unknown) => {
          // 静默降级：保留 patch / outline 占位标记，但把失败报到外层（卡片要能标红重试）。
          preview.dispose();
          const entry = venueSplatRef.current;
          if (entry?.preview === preview) entry.preview = null;
          onScanState?.({
            assetId, name, status: 'error',
            ...(error instanceof Error ? { error: error.message } : {}),
          });
        });
    };
    venueSplatApiRef.current = { start: startVenueSplat, dispose: disposeVenueSplat };
    // 当前扫描由独立 effect 按「扫描 + 落点」挂（见下），这里只起 2D 落点派生的场景物件。
    if (!scan) splatRequests.slice(0, 1).forEach(startVenueSplat);

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
      if (!api || (!handleGroup.visible && !groupCornerMeshes.length) || disposed || !renderer) return false;
      const mode = api.getMode();
      if (mode !== 'view' && mode !== 'select') return false;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      scene.updateMatrixWorld(true);
      const groupHandle = raycaster.intersectObjects(groupCornerMeshes, false)[0]?.object;
      const groupPoint = groupHandle?.userData.planGroupCorner as PlanPoint | undefined;
      if (groupPoint) {
        const viewport = derivedViewportNow();
        if (!viewport) return false;
        api.pointerFromPlan('down', { px: planPointToPixel(groupPoint, viewport), pt: groupPoint }, pointerFlags(event, { viewport }));
        syncEditVisuals();
        return true;
      }
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

    // 2026-11-20 审计 K11：右键在 3D 里原来只被 OrbitControls 用来平移，2D 的三件事
    //（取消放置 / 撤草稿上一点 / 设施拷贝层级删除菜单）全部不可达。
    // 这里把右键接回 2D：短按（位移 ≤ 6 px）= 交给 2D 同一份菜单逻辑；右键拖动仍归平移，
    // 不在拖动结束后误弹菜单。
    let rightDown: { x: number; y: number; moved: boolean } | null = null;
    const onContextMenu = (event: MouseEvent): void => {
      if (walkEnabledRef.current) return;
      // 浏览器自带菜单一律不弹（编辑器惯例）。
      event.preventDefault();
      const state = rightDown;
      rightDown = null;
      if (state?.moved) return;
      const api = canvasEditApiRef.current?.current;
      if (!api) return;
      const hit = eventToPlanHit(event);
      api.pointerFromPlan('contextmenu', hit, pointerFlags(event, hit));
      syncEditVisuals();
    };

    const onPointerDown = (event: PointerEvent): void => {
      // 漫游态：左键让给指针锁视角，不进 2D 编辑桥手势。
      if (walkEnabledRef.current) return;
      // 右键：记下起点供 onContextMenu 判断「短按还是拖平移」。
      if (event.button === 2) {
        rightDown = { x: event.clientX, y: event.clientY, moved: false };
        return;
      }
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
        api.pointerFromPlan('leave', null);
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
      if (rightDown && !rightDown.moved
        && Math.hypot(event.clientX - rightDown.x, event.clientY - rightDown.y) > 6) rightDown.moved = true;
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
      if (event.button !== 0) return;
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
    const cancelPointerEdit = (): void => {
      if (pointerEditing || blankReleased) canvasEditApiRef.current?.current?.pointerFromPlan('leave', null);
      pointerEditing = false;
      blankReleased = false;
      rightDown = null;
      if (controls) controls.enabled = true;
      syncEditVisuals();
    };
    // 捕获失败时松手可能落在 renderer 外；取消/失焦必须丢弃预览，不能当作 up 提交。
    const onWindowPointerUp = (event: PointerEvent): void => {
      if ((pointerEditing || blankReleased) && event.target !== renderer?.domElement) onPointerUp(event);
    };
    const onLostPointerCapture = (): void => {
      if (pointerEditing) cancelPointerEdit();
    };
    // 2026-11-16 2D 画布发来的草稿变更：R 旋转 / Esc 取消 / 落位后用同一事件通知，
    // 3D 不用等下一次指针移动就能重画待放置幽灵。
    // 2026-11-20 审计 K5：同一份事件也刷新 3D 放置浮条（旋转角/是否还在放置）。
    const refreshPendingPlacement = (): void => {
      const api = canvasEditApiRef.current?.current;
      setPendingPlacement(api ? api.getEditVisuals().pendingPlacement : null);
    };
    const onPlanVisuals = (): void => {
      syncEditVisuals();
      refreshPendingPlacement();
    };
    window.addEventListener('sc-outdoor-plan-visuals', onPlanVisuals);
    // 挂载时就在放置态（从 2D 选好物料再切 3D）：不依赖下一次指针移动。
    refreshPendingPlacement();

    // 2026-11-16 物件库拖进 3D：dragover 期间 dataTransfer 读不到模板，用拖起时记下的 id；
    // 地面射线命中后走 canvas 的同一份绿/红幽灵，逐帧合并避免每个 dragover 重建整层。
    let dragPreviewFrame = 0;
    let lastDragOver: DragEvent | null = null;
    let lastDropAt = 0;
    const onDragOver = (event: DragEvent): void => {
      if (walkEnabledRef.current) return;
      const catalogArmed = !!getPlanCatalogDrag();
      const facilityArmed = !!getPlanFacilityDrag();
      if (!catalogArmed && !facilityArmed) return;
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
      const text = event.dataTransfer?.getData('text/plain') ?? '';
      const catalogDrag = readPlanCatalogDrag(event.dataTransfer?.getData(PLAN_CATALOG_DRAG_MIME) ?? '', text);
      if (catalogDrag || types.includes(PLAN_CATALOG_DRAG_MIME) || text.startsWith(PLAN_CATALOG_TEXT_PREFIX)) {
        consumePlanCatalogDrag();
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
      const templateId = text || getPlanFacilityDrag();
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
      consumePlanFacilityDrag();
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
    renderer.domElement.addEventListener('pointercancel', cancelPointerEdit);
    renderer.domElement.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('blur', cancelPointerEdit);
    renderer.domElement.addEventListener('dblclick', onDblClick);
    // 2026-11-20 审计 K11：右键菜单桥（不拦住右键拖动平移）。
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    /**
     * 2026-11-17 用户「3D 白框外没有模糊」→（同日回修）「为什么给我设计场地里面都加模糊了」。
     *
     * 第一版是「`backdrop-filter: blur()` 面 + `clip-path` 挖洞」：实测 Chromium 157 的
     * `backdrop-filter` 根本不认 `clip-path`（连只裁一个三角形都不生效），模糊直接铺满整层，
     * 设计范围里面也一起糊了。现在与 2D `drawDesignScopeMask` 同一套：这一帧渲染完，
     * 把画面按 evenodd 只在框外重画一遍（`ctx.filter = blur(7px)`）再压薄白纱，
     * 画进叠在 WebGL 上的透明 canvas——框内像素完全没被碰过。
     *
     * 环在镜头后面时投影会翻面：宁可整层藏掉，也不要把框内糊掉。
     */
    const frostProbe = new THREE.Vector3();
    let lastFrostKey = Number.NaN;
    let lastFrostAt = 0;

    /** 相机 / 尺寸 / 范围都没变就别重画：毛玻璃是纯屏幕空间复算，每帧糊一遍太贵。 */
    function frostSignature(ring: readonly PlanPoint[], width: number, height: number): number {
      let hash = (ring.length * 131 + width * 7 + height * 3) | 0;
      // 逐元素哈希，不展开成临时数组：这个函数每帧都要跑，别给 GC 添活。
      const world = camera.matrixWorld.elements;
      const projection = camera.projectionMatrix.elements;
      for (let index = 0; index < 16; index += 1) hash = (hash * 31 + Math.round(world[index]! * 1e4)) | 0;
      for (let index = 0; index < 16; index += 1) hash = (hash * 31 + Math.round(projection[index]! * 1e4)) | 0;
      for (const point of ring) hash = (hash * 31 + Math.round(point.x * 100) + Math.round(point.y * 100)) | 0;
      return hash;
    }

    function hideScopeFrost(element: HTMLCanvasElement): void {
      if (element.style.display !== 'none') element.style.display = 'none';
      // 下次要露出来时无条件重画，别拿旧快照顶。
      lastFrostKey = Number.NaN;
    }

    function updateScopeFrost(): void {
      const element = frostRef.current;
      const activeRenderer = renderer;
      const ring = scopeRingRef.current;
      const width = stage?.clientWidth ?? 0;
      const height = stage?.clientHeight ?? 0;
      if (!element) return;
      if (!activeRenderer || ring.length < 3 || width <= 0 || height <= 0) return hideScopeFrost(element);

      // 变化时按 ~25 fps 追（糊过的画面看不出帧差），静止时 4 Hz 兜底——
      // 瓦片后到、人物走动都会改底图，框外不能永远停在旧快照上。
      const now = performance.now();
      const key = frostSignature(ring, width, height);
      const changed = key !== lastFrostKey;
      if (now - lastFrostAt < (changed ? 40 : 250)) return;

      const screen: { x: number; y: number }[] = [];
      for (const point of ring) {
        // 世界坐标与 footprint 同一口径：three.x = plan.x、three.z = -plan.y。
        frostProbe.set(point.x, 0.05, -point.y).applyMatrix4(camera.matrixWorldInverse);
        if (frostProbe.z > -0.4) return hideScopeFrost(element);
        const ndc = frostProbe.applyMatrix4(camera.projectionMatrix);
        screen.push({ x: (ndc.x * 0.5 + 0.5) * width, y: (-ndc.y * 0.5 + 0.5) * height });
      }

      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      if (element.width !== pixelWidth) element.width = pixelWidth;
      if (element.height !== pixelHeight) element.height = pixelHeight;
      const frostCtx = element.getContext('2d');
      if (!frostCtx) return hideScopeFrost(element);
      frostCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const painted = drawScopeFrost(frostCtx, {
        width,
        height,
        ring: screen,
        source: activeRenderer.domElement,
        blurPx: SCOPE_FROST_BLUR_PX,
        veil: SCOPE_FROST_VEIL,
      });
      if (!painted) return hideScopeFrost(element);
      if (element.style.display !== 'block') element.style.display = 'block';
      lastFrostKey = key;
      lastFrostAt = now;
    }

    let idleTick = 0;
    /**
     * 2D 地图态（保活隐藏）的人物低频推进（B3 补丁）：不推进的话切回 2D 时人位
     * 状态环会定格在切走那一刻。节拍器按「每一帧的真实耗时」累计，每 0.25 s
     * 交出一段 dt 给人物，速度与 3D 态一致，只是采样稀。
     */
    const IDLE_PEOPLE_STEP_S = 0.25;
    const idleCrowd = createCrowdIdlePacer(IDLE_PEOPLE_STEP_S);
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
        // 每帧都记（不只是 1/6 帧），否则人物只有真实速度的 1/6。
        idleCrowd.tick(deltaSeconds);
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
      if (!activeRef.current) {
        // 隐藏态也按低频把人物推下去（约 4 Hz）：2D 人位的进区/落座色环要跟着变，
        // 否则只能看到「切走那一刻」的定格。不渲染、不碰相机与手柄，开销只有这一步。
        const step = idleCrowd.take();
        if (step !== null) advancePeopleAnimations(step, scene, 'outdoor');
        return;
      }
      // 回到 3D：丢掉未用完的累计，避免切回来那一下补步。
      idleCrowd.reset();
      // 2026-11-12 P2-i 3D 版：选中设施编辑手柄逐帧跟随镜头与拖拽预览（位置 + 恒定屏幕尺寸）。
      updateFacilityHandles();
      updateZoneVertexHandles();
      // 户外人物动画：注册表推进待机/步态 + 自动播放的非人物 GLB 实例。
      // owner 固定 'outdoor'：两套 3D 同挂时各用自己那套碰撞盒与围栏。
      advancePeopleAnimations(deltaSeconds, scene, 'outdoor');
      advanceGlbAnimations(deltaSeconds);
      trafficLayer.advance(deltaSeconds);
      vehicleEntitiesLayer.advance(deltaSeconds);
      // 漫游化身：第三人称 / 过肩档按帧姿态摆位；第一人称、鸟瞰或退出漫游时隐藏。
      // 选中的角色 GLB 就位后占位胶囊退场；加载中 / 失败才继续用几何人兜底。
      const walkAvatar = avatarGroupRef.current;
      const walkFrame = walkFrameRef.current;
      const roleAvatar = walkRoleAvatarRef.current;
      const showAvatar = walkEnabledRef.current && !controlledActorRef.current && Boolean(walkFrame?.thirdPerson);
      if (walkAvatar) {
        walkAvatar.visible = showAvatar && !roleAvatar;
        if (showAvatar && !roleAvatar && walkFrame) {
          walkAvatar.position.set(walkFrame.x, PLAN_LAYER_BASE_Y, walkFrame.z);
          walkAvatar.rotation.y = walkFrame.yaw;
        }
      }
      if (roleAvatar && walkFrame) {
        roleAvatar.root.visible = showAvatar;
        if (showAvatar) {
          roleAvatar.root.position.set(walkFrame.x, PLAN_LAYER_BASE_Y, walkFrame.z);
          roleAvatar.root.rotation.y = walkFrame.yaw;
          // 动作跟状态走：移动 walk、停下 idle、落座 sit。没有 sit 剪辑就保持站姿，
          // 不假称有坐姿动画（别为了「有坐姿」去动 Aholo 绑骨）。
          const seated = walkFrame.seated === true && Boolean(roleAvatar.actor.sit);
          // 没有 sit 剪辑也算“落座”：HUD 要诚实说这是下沉对位，不是坐姿动画。
          const noSitSeated = walkFrame.seated === true && !roleAvatar.actor.sit;
          if (noSitSeated !== seatedNoSitRef.current) {
            seatedNoSitRef.current = noSitSeated;
            setSeatedNoSit(noSitSeated);
          }
          if (seated !== roleAvatar.seated) {
            roleAvatar.seated = seated;
            if (seated) {
              roleAvatar.actor.idle.fadeOut(0.25);
              roleAvatar.actor.walk.fadeOut(0.25);
              roleAvatar.actor.sit!.reset().fadeIn(0.25).play();
            } else {
              roleAvatar.actor.sit?.fadeOut(0.25);
              const next = walkFrame.moving ? roleAvatar.actor.walk : roleAvatar.actor.idle;
              next.reset().fadeIn(0.25).play();
              roleAvatar.moving = walkFrame.moving;
            }
          } else if (!seated && roleAvatar.moving !== walkFrame.moving) {
            roleAvatar.moving = walkFrame.moving;
            const next = walkFrame.moving ? roleAvatar.actor.walk : roleAvatar.actor.idle;
            const previous = walkFrame.moving ? roleAvatar.actor.idle : roleAvatar.actor.walk;
            next.reset().play().crossFadeFrom(previous, 0.16, false);
          }
          // 坐姿对齐：有 sit 剪辑按实测头高、没有就按标称 1.6 m 把头对到落座眼高。
          // 没坐姿动画时身体会沉到地面以下，视觉上由地面遮住腿——这是“下沉对位”，
          // 不假装有坐姿动作；地面以下最多允许沉 0.75 m。
          const sinking = walkFrame.seated === true;
          const headOffset = sinking && roleAvatar.sitHeadY !== null ? roleAvatar.sitHeadY : 1.6;
          roleAvatar.actor.group.position.y = sinking
            ? Math.max(-0.75, walkFrame.y - PLAN_LAYER_BASE_Y - headOffset)
            : 0;
          roleAvatar.actor.mixer.update(deltaSeconds);
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
          if (interactLineRef.current !== null) setInteractLine(null);
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
            // 走开或换到另一个岗位：旧台词跟着退场。
            if (interactLineRef.current && interactLineRef.current.id !== nearId) setInteractLine(null);
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
          // 体检只读快照：真机上“0% 可达”到底是因为边界没就绪还是坐标不对，靠这几个数判。
          audit: walkAudit
            ? {
                areaM2: walkAudit.areaM2,
                ratio: walkAudit.reachableRatio,
                // 应用侧实际拿到的 plan：用于排查“注入草稿”与“应用 plan”是否同一份。
                planFacilities: (Array.isArray(plan.facilities) ? plan.facilities : []).map((f) => ({
                  name: f.name, w: f.size?.width ?? null, d: f.size?.depth ?? null, x: f.position?.x ?? null, y: f.position?.y ?? null,
                })),
                routeCount: Array.isArray(plan.routes) ? plan.routes.length : 0,
                designScopeCount: Array.isArray(plan.designScope) ? plan.designScope.length : 0,
                blockedRoutes: walkAudit.blockedRoutes.length,
                firstBlocker: walkAudit.blockedRoutes[0]?.blockers?.[0] ?? null,
                blockedAtM: walkAudit.blockedRoutes[0]?.distanceAlongM ?? null,
                narrowestRouteWidthM: walkAudit.narrowestRouteWidthM,
                sightline: walkAudit.sightline,
                boundaryPoints: Array.isArray(plan.boundary) ? plan.boundary.length : 0,
                bbox: (() => {
                  const points = Array.isArray(plan.boundary) ? plan.boundary : [];
                  if (points.length === 0) return null;
                  let minX = Infinity;
                  let minY = Infinity;
                  let maxX = -Infinity;
                  let maxY = -Infinity;
                  for (const point of points) {
                    minX = Math.min(minX, point.x);
                    maxX = Math.max(maxX, point.x);
                    minY = Math.min(minY, point.y);
                    maxY = Math.max(maxY, point.y);
                  }
                  return { minX, minY, maxX, maxY };
                })(),
              }
            : null,
          screenToPlan: (clientX: number, clientY: number): { pt: PlanPoint; px: { x: number; y: number } } | null => {
            const hit = eventToPlanHit({ clientX, clientY } as MouseEvent);
            return hit ? { pt: hit.pt, px: hit.px } : null;
          },
          planToScreen: (point: PlanPoint) => {
            if (!renderer) return null;
            const rect = renderer.domElement.getBoundingClientRect();
            const v = new THREE.Vector3(point.x, PLAN_LAYER_BASE_Y, -point.y).project(camera);
            return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
          },
          groupScreen: groupCornerMeshes.map(project),
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
          /** 2026-11-18：派生路人（按流线示意）的在场情况；渲染侧按它显示「非实测人数」说明。 */
          crowdDerived: {
            active: derivedCrowdCountRef.current > 0,
            count: derivedCrowdCountRef.current,
            note: DERIVED_CROWD_NOTE,
          },
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
      // 高斯重建在场时走预览器的分层绘制（重建当背景层，主场景再叠上去）。
      // 毛玻璃取的是「这一帧已经画好的画面」，所以必须排在渲染之后。
      const venueSplat = venueSplatRef.current?.preview;
      if (venueSplat && venueSplat.shownId && renderer) {
        venueSplat.renderFrame(renderer, scene, camera);
        updateScopeFrost();
        return;
      }
      renderer?.render(scene, camera);
      updateScopeFrost();
    }
    loop();

    return () => {
      disposed = true;
      if (releaseControlledActor()) onWalkExitRef.current?.();
      // 场景拆掉：别把旧场地的围栏与座位留给下一份户外方案。
      setPersonWalkContext(null, 'outdoor');
      setPersonSeatContext(null);
      setPersonZoneContext(null);
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
      previewRefresh.dispose();
      renderer?.domElement.removeEventListener('pointerdown', onPointerDown, true);
      renderer?.domElement.removeEventListener('pointermove', onPointerMove);
      renderer?.domElement.removeEventListener('pointerup', onPointerUp);
      renderer?.domElement.removeEventListener('pointercancel', cancelPointerEdit);
      renderer?.domElement.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('blur', cancelPointerEdit);
      renderer?.domElement.removeEventListener('dblclick', onDblClick);
    renderer?.domElement.removeEventListener('contextmenu', onContextMenu);
      // 高斯重建预览器要显式释放：解码出来的 GPU 资源不会随场景 traverse 走。
      venueSplatApiRef.current = null;
      disposeVenueSplat();
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
  }, [onReady, source, groundMode, mapView, plan.anchor?.lng, plan.anchor?.lat, releaseControlledActor, disposeVenueSplat]);

  // 当前场地的高斯重建：跟着「哪份扫描」走，与建场景解耦。
  // 此前它挂在建场景的 effect 里，而那份 effect 不认 scan——先建场景后选扫描时，
  // 落点永远等不到下一次重建，画面就只剩地面轮廓（2026-11-19 实测：全程零 spz 请求）。
  // walkCanvas 是「renderer/controls 已就绪」的信号，场景重建后也会换新，届时重新挂上。
  useEffect(() => {
    const api = venueSplatApiRef.current;
    const scene = sceneRef.current;
    const current = scanRef.current;
    if (!api || !scene || !current) return undefined;
    // 注册表里可能根本没有这条（扫描是别的机器落的盘），那就直接问本机代理要。
    const localUrl = `${DIRECT_BASE}/asset/${current.assetId}.spz`;
    const url = current.assetId.startsWith('shipped-')
      ? storedAholoSceneSource(current.assetId).url
      : resolveAholoAssetUrl(current.assetId) ?? localUrl;
    const width = Math.max(0.5, current.meters?.width ?? 12);
    const depth = Math.max(0.5, current.meters?.depth ?? 9);
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({ color: '#c0392b', transparent: true, opacity: 0.12 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(current.x, 0.015, current.z);
    patch.name = 'plan-scan-patch';
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-width / 2, 0, -depth / 2),
        new THREE.Vector3(width / 2, 0, -depth / 2),
        new THREE.Vector3(width / 2, 0, depth / 2),
        new THREE.Vector3(-width / 2, 0, depth / 2),
      ]),
      new THREE.LineBasicMaterial({ color: '#c0392b', transparent: true, opacity: 0.9 }),
    );
    outline.position.set(current.x, 0.03, current.z);
    outline.name = 'plan-scan-outline';
    // 占位标记直接挂世界系：sceneLayer 带场地中心平移，用世界坐标会偏一个场地。
    scene.add(patch);
    scene.add(outline);
    api.start({ patch, outline, assetId: current.assetId, url, name: current.name, world: { x: current.x, z: current.z } });
    return () => { api.dispose(); };
  }, [walkCanvas, scan?.assetId]);

  // 挪落点：只平移已挂上的高斯重建与占位标记，不重新下载、不重新解码。
  useEffect(() => {
    const entry = venueSplatRef.current;
    const current = scanRef.current;
    if (!entry || !current || entry.assetId !== current.assetId) return;
    const dx = current.x - entry.world.x;
    const dz = current.z - entry.world.z;
    if (dx === 0 && dz === 0) return;
    entry.world = { x: current.x, z: current.z };
    entry.patch.position.set(current.x, 0.015, current.z);
    entry.outline.position.set(current.x, 0.03, current.z);
    entry.offset.set(entry.offset.x + dx, entry.offset.y, entry.offset.z + dz);
    entry.preview?.setPosition({ x: entry.offset.x, y: entry.offset.y, z: entry.offset.z });
    // 漫游围栏跟着落点走，否则第一人称会被关在旧位置。
    const bounds = entry.walkBounds;
    if (entry.preview && bounds) {
      const moved = {
        minX: bounds.minX + dx, maxX: bounds.maxX + dx,
        minZ: bounds.minZ + dz, maxZ: bounds.maxZ + dz,
        minY: bounds.minY,
      };
      entry.walkBounds = moved;
      onScanStateRef.current?.({
        assetId: entry.assetId,
        name: entry.name,
        status: 'ready',
        ...(entry.meters ? { meters: entry.meters } : {}),
        walkBounds: moved,
      });
    }
  }, [scan?.x, scan?.z, scan?.assetId]);

  // 漫游化身：用当前选中的可走角色 GLB（idle / walk / 可选 sit），不再固定用一个胶囊人。
  // 加载失败只降级、不白屏；退出漫游或换角色时摘掉临时化身并释放 GPU 资源。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!walkEnabled || !walkRoleUrl || !scene) {
      setWalkRoleAvatar((current) => (current.status === 'idle' ? current : { status: 'idle' }));
      return undefined;
    }
    let cancelled = false;
    const root = new THREE.Group();
    root.name = 'plan-walk-role';
    root.visible = false;
    scene.add(root);
    setWalkRoleAvatar({ status: 'loading' });
    // 软超时：角色 GLB 动辄 3～4 MB，满载机器上几十秒仍可能只显示“加载中”。
    // 10 s 后先说真话、先用几何人，加载真晚到时再自动换上（不假称已就绪）。
    const softTimer = window.setTimeout(() => {
      if (cancelled) return;
      setWalkRoleAvatar({
        status: 'error',
        message: '角色模型较大，先用几何人代替；下载完会自动换上。',
      });
    }, 10_000);
    void ensureGlbAsset(walkRoleUrl, walkRoleUrl)
      .then(() => {
        if (cancelled) return;
        window.clearTimeout(softTimer);
        const person: FurnitureItem = {
          id: 'outdoor-walk-avatar',
          type: 'person',
          name: walkRoleName ?? '漫游角色',
          glbUrl: walkRoleUrl,
          width: 0.55,
          depth: 0.45,
          height: 1.65,
          color: '#ffffff',
          icon: '◇',
        };
        const actor = createWalkAvatar(person);
        if (!actor) throw new Error('这个角色模型没有站立 / 步行动画，先用几何人代替。');
        actor.idle.play();
        root.add(actor.group);
        walkRoleAvatarRef.current = {
          root,
          actor,
          seated: false,
          moving: false,
          sitHeadY: measureWalkSitHeadY(actor),
        };
        setWalkRoleAvatar({ status: 'ready', hasSit: Boolean(actor.sit) });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        window.clearTimeout(softTimer);
        setWalkRoleAvatar({
          status: 'error',
          message: reason instanceof Error ? reason.message : '角色模型没加载上，先用几何人代替。',
        });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(softTimer);
      const current = walkRoleAvatarRef.current;
      walkRoleAvatarRef.current = null;
      root.removeFromParent();
      if (current) {
        current.actor.mixer.stopAllAction();
        current.actor.mixer.uncacheRoot(current.actor.group);
        current.actor.group.removeFromParent();
        disposeOwnedModel(current.actor.group);
      }
    };
  }, [walkEnabled, walkRoleUrl, walkRoleName, avatarAttempt]);

  useEffect(() => {
    if (layerApiRef.current?.syncEditVisuals) layerApiRef.current.syncEditVisuals();
    else layerApiRef.current?.syncFootprint(plan);
  }, [plan]);

  // 2026-11-17 用户「3D 的时候设计白框外并没有添加蒙版 / 就是没有模糊」：
  // 2D 是屏幕空间 blur(7px) + 白纱；3D 用一层 backdrop-filter 面按设计范围投影挖洞，
  // 两边才是同一个观感。环只在 plan 变时换，投影逐帧算。
  useEffect(() => {
    scopeRingRef.current = plan.designScope && plan.designScope.length >= 3 ? plan.designScope : [];
  }, [plan.designScope]);

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
      {/* 2026-11-20 审计 K5：3D 自己的放置浮条。2D 浮条在 3D 接管态是 hidden 的，
          以前在 3D 里只能凭记忆按 Esc / R。旋转与取消走画布句柄上的同一份实现。 */}
      {pendingPlacement && !walkEnabled && (
        <div
          data-testid="outdoor-3d-placement-bar"
          role="group"
          aria-label={`正在放置：${pendingPlacement.name}`}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 28,
            transform: 'translateX(-50%)',
            zIndex: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 10,
            background: 'rgba(18, 20, 26, 0.82)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
            pointerEvents: 'auto',
            whiteSpace: 'nowrap',
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          <span style={{ fontWeight: 700 }}>放置中</span>
          <span style={{ opacity: 0.86, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {pendingPlacement.name}
          </span>
          <button
            type="button"
            aria-label="待放置物件左转 15 度"
            aria-keyshortcuts="Shift+R"
            title="左转 15°（Shift+R 同效）"
            onClick={() => canvasEditApiRef.current?.current?.rotatePendingFacility(-15)}
            style={hudButtonStyle}
          >
            −15°
          </button>
          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 34, textAlign: 'center' }}>
            {pendingPlacement.rotationDeg}°
          </span>
          <button
            type="button"
            aria-label="待放置物件右转 15 度"
            aria-keyshortcuts="R"
            title="右转 15°（R 同效）"
            onClick={() => canvasEditApiRef.current?.current?.rotatePendingFacility(15)}
            style={hudButtonStyle}
          >
            +15°
          </button>
          <button
            type="button"
            data-testid="outdoor-3d-placement-cancel"
            aria-label="取消放置，返回浏览"
            aria-keyshortcuts="Escape"
            title="取消这次放置（Esc / 右键同效）"
            onClick={() => canvasEditApiRef.current?.current?.cancelPendingPlacement()}
            style={hudButtonStyle}
          >
            取消
          </button>
        </div>
      )}
      {/* 2026-11-17 用户「3D 的时候设计白框外并没有添加蒙版」「就是没有模糊」，
          回修「为什么给我设计场地里面都加模糊了」：
          这层是叠在 WebGL 上的透明 canvas，逐帧只把框外那块画面糊一遍（7 px，与 2D 同档）
          再压薄白纱；框内不画任何像素。不用 `backdrop-filter`——Chromium 里它不认
          `clip-path`，会把整屏一起糊（见 lib/outdoor-scope-frost.ts）。 */}
      <canvas
        ref={frostRef}
        data-testid="outdoor-scope-frost"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          width: '100%',
          height: '100%',
          display: 'none',
          pointerEvents: 'none',
        }}
      />
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
        {pickableWalkActors.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {pickableWalkActors.map(actor => (
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
          {viewMode !== 'orbit' && walkRoleAvatar.status === 'loading' && <span>角色加载中…</span>}
          {viewMode !== 'orbit' && walkRoleAvatar.status === 'error' && (
            <>
              <span>{walkRoleAvatar.message}</span>
              <button
                type="button"
                data-testid="outdoor-walk-avatar-retry"
                onClick={() => setAvatarAttempt((value) => value + 1)}
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
                重试
              </button>
            </>
          )}
          {viewMode !== 'orbit' && seatedNoSit && <span>该角色没有坐姿动作，已按坐姿高度下沉对位</span>}
          {viewMode !== 'orbit' && atBoundary && <span>已到场地边界</span>}
          {viewMode !== 'orbit' && routeLine && <span>{routeLine}</span>}
          {spotNotice && <span>{spotNotice}</span>}
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
          {viewMode !== 'orbit' && (
            <button
              type="button"
              data-testid="outdoor-walk-spot"
              onClick={saveWalkSpot}
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
              存观景位
            </button>
          )}
        </div>
      )}
      {walkEnabled && walkAudit && walkAudit.reachableRatio > 0 && (
        <div
          data-testid="outdoor-walk-audit"
          style={{
            position: 'absolute',
            left: 16,
            top: 16,
            zIndex: 35,
            maxWidth: 340,
            padding: '4px 8px',
            borderRadius: 8,
            background: 'rgba(18, 20, 26, 0.62)',
            color: '#fff',
            fontSize: 11,
            lineHeight: '16px',
          }}
        >
          {walkAudit ? `体检 · ${walkAudit.headline}` : null}
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
      {nearEntry && interactLine && interactLine.id === nearEntry.id && (
        <div
          data-testid="outdoor-interact-line"
          role="status"
          style={{
            position: 'absolute',
            left: '50%',
            top: 92,
            transform: 'translateX(-50%)',
            zIndex: 35,
            maxWidth: 360,
            padding: '6px 12px',
            borderRadius: 10,
            background: 'rgba(18, 20, 26, 0.82)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
            whiteSpace: 'normal',
            textAlign: 'center',
          }}
        >
          {interactLine.text}
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
      {/* 2026-11-18：派生路人在场时说明这是按流线示意，不是实测人数。 */}
      {derivedCrowdCount > 0 && groundState !== 'unavailable' && (
        <div
          data-testid="outdoor-3d-crowd-note"
          style={{
            position: 'absolute',
            left: 16,
            bottom: groundState === 'paper' ? 52 : 16,
            zIndex: 2,
            padding: '4px 10px',
            borderRadius: 8,
            background: 'rgba(18, 20, 26, 0.62)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          {DERIVED_CROWD_NOTE} · {derivedCrowdCount} 人
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
