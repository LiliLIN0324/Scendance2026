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
  createCachedGlbModel,
  disposeOwnedModel,
  ensureGlbAsset,
} from '@/components/room-organizer/three/glb-assets';
import {
  planFootprintShapes,
} from '@/components/room-organizer/lib/plan-footprint-geometry';
import type { PlanSceneObject } from '@/components/room-organizer/lib/plan-item-bridge';
import {
  planCrowdShellPlacements,
  planSceneObjectPlacements,
  type SceneObjectPlacement,
} from '@/components/room-organizer/lib/plan-scene-placement';
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
import { useOutdoorWalk } from '@/components/room-organizer/hooks/use-outdoor-walk';
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



function addDraftOverlay(
  group: THREE.Group,
  frame: SiteFrame,
  draft: PlanEditVisuals["draft"],
  disposables: { dispose: () => void }[],
): void {
  if (!draft) return;
  const y = 0.7;
  const addLine = (points: PlanPoint[], color: string, closed: boolean): void => {
    if (points.length < 2) return;
    const pts = closed && points.length >= 3 ? [...points, points[0]!] : points;
    const positions: number[] = [];
    for (const point of pts) {
      positions.push(point.x - frame.cx, y, -(point.y - frame.cy));
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
  /** 同步渲染一帧后读 canvas：接管态（主画布复用本组件）导出效果图用。 */
  captureImage(): string | null;
}

export interface OutdoorPlan3DProps {
  plan: SitePlanData;
  /** 跟 2D 画布同一个图源，3D 地面直接贴同一套瓦片（默认 osm）。 */
  source?: CanvasBasemapSource;
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
  /** 漫游退出收口（第二次 Esc 或再点漫游钮），交外层把启用态置回 false。 */
  onWalkExit?: () => void;
}

export default function OutdoorPlan3D({
  plan,
  source = 'amap-streets',
  sceneObjects,
  onReady,
  mapView,
  apiRef,
  canvasApiRef,
  active = true,
  walkEnabled = false,
  onWalkExit,
}: OutdoorPlan3DProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);
  // 保活态：隐藏时仍旧跑 LOD，但不渲染（不可见的 GPU 耗时没意义）。
  const activeRef = useRef(active);
  activeRef.current = active;
  // 漫游态镜像给挂载在 three 场景上的指针事件闭包读，避免重跑挂载 effect 掉指针锁。
  const walkEnabledRef = useRef(walkEnabled);
  walkEnabledRef.current = walkEnabled;
  const walkCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const [groundState, setGroundState] = useState<'loading' | 'satellite' | 'paper'>('loading');

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
    apiRef.current = { zoomBy: zoomByStep, focusLngLat, captureImage };
    return () => { apiRef.current = null; };
  }, [apiRef, zoomByStep, focusLngLat, captureImage]);

  // 一期裸第一人称步行：指针锁 / WASD / 边界钳制自管在本组件内，旧室内
  // walkthroughMode 链路不动；退出由 onWalkExit 交外层收口。
  useOutdoorWalk({
    enabled: walkEnabled,
    canvasRef: walkCanvasRef,
    cameraRef,
    orbitRef: controlsRef,
    boundary: plan.boundary,
    onExit: onWalkExit,
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    const disposables: { dispose: () => void }[] = [];
    const anchor = plan.anchor ? { lng: plan.anchor.lng, lat: plan.anchor.lat } : null;
    const siteFrame = ringFrame(plan.boundary);
    const viewFrame = mapView && anchor ? frameFromMapView(mapView, anchor) : siteFrame;
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

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setGroundState('paper');
      return undefined;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    stage.appendChild(renderer.domElement);
    renderer.domElement.id = OUTDOOR_WALK_CANVAS_ID;
    walkCanvasRef.current = renderer.domElement;
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

    // 只有纯纸面规划（没有地图锚点）才铺一块场地大小的纸；
    // 有底图时不要再垫一块灰色平面，否则会在地图背后露出垫块。
    if (!anchor) {
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
    if (anchor) {
      void (async () => {
        const shared = canvasEditApiRef.current?.current?.getTileCache();
        if (shared) tileCache.imageCache = shared;
        let shown = false;
        let settleTimer = 0;
        const showGround = (count: number): void => {
          if (disposed || shown || count <= 0) return;
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
          if (tileKeys.size > 0) showGround(tileKeys.size);
          else setGroundState('paper');
        }, 1600);
        const nearCount = await paintTilePyramid({
          scene,
          disposables,
          closeBounds: frameToBounds(nearFrame, anchor),
          midBounds: frameToBounds(nearFrame, anchor),
          farBounds: frameToBounds(nearFrame, anchor),
          anchor,
          source,
          topZoom: hiZoom,
          isDisposed: () => disposed,
          loaded: tileKeys,
          cache: tileCache,
          focus: focusEnu,
          closeMaxTiles: 64,
          parent: basemapRoot,
        });
        showGround(nearCount);
        if (disposed) return;
        const expandCount = await paintTilePyramid({
          scene,
          disposables,
          closeBounds: frameToBounds(closeFrame, anchor),
          midBounds: frameToBounds(workFrame, anchor),
          farBounds: frameToBounds(workFrame, anchor),
          anchor,
          source,
          topZoom: hiZoom,
          isDisposed: () => disposed,
          loaded: tileKeys,
          cache: tileCache,
          focus: focusEnu,
          closeMaxTiles: 160,
          parent: basemapRoot,
        });
        showGround(expandCount);
        if (disposed) return;
        const backdropCount = await paintTiledGround({
          scene,
          disposables,
          bounds: frameToBounds(groundFrame, anchor),
          anchor,
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
        showGround(backdropCount);
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
      }
    }

    // —— 真实模型层（2D 规划的设施 → 物料库 GLB，共享 builder three/plan-model-layer.ts）——
    // 落点必须与占位体**完全一致**：占位体是 footprint 组的直接子节点，自身偏移
    // (center.x - w/2, 0, center.z - d/2)，footprint 组再补 (w/2, 0, -d/2)。组的外层
    // 偏移在这里设置，内层落位/收缩/藏占位/run guard 全在共享 builder 里——
    // 与主舞台 GeoGround 的模型层同一套口径（docs/42：退出户外也能看到 3D 素材）。
    const shapes = planFootprintShapes(plan, metrics, { clampPoints: false });
    const props = shapes?.props ?? [];
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

    /** 壳体坐标 → three 局部坐标（组再补 (w/2, 0, -d/2) 后与占位体重合）。 */
    const placeAt = (object: THREE.Object3D, shell: { x: number; z: number }, rotationDeg = 0): void => {
      object.position.set(shell.x - metrics.width / 2, 0, shell.z - metrics.depth / 2);
      // 2D 画布顺时针为正；three 绕 Y 正向是逆时针，所以取负（与占位体一致）。
      object.rotation.y = -(rotationDeg * Math.PI) / 180;
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
    planCrowdShellPlacements(
      Array.isArray(plan.workers) ? plan.workers : [],
      plan.boundary,
      metrics,
    ).forEach((placement) => {
      const { shell } = placement;
      if (!placement.glbUrl) {
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.3, 1.7, 12),
          new THREE.MeshBasicMaterial({ color: placement.color, transparent: true, opacity: 0.8 }),
        );
        placeAt(marker, shell, 0);
        marker.position.y = 0.85;
        marker.name = `plan-crowd-marker-${placement.id}`;
        crowdLayer.add(marker);
        return;
      }
      const item: FurnitureItem = {
        id: `plan-crowd-${placement.id}`,
        type: 'glb-asset',
        name: placement.role,
        width: 0.6,
        depth: 0.6,
        height: 1.75,
        color: '#ffffff',
        icon: '☺',
        glbUrl: placement.glbUrl,
        uniformScale: true,
      };
      void ensureGlbAsset(placement.glbUrl, placement.glbUrl)
        .then(() => {
          if (disposed || modelRunRef.current !== run) return;
          const model = createCachedGlbModel(item, false);
          if (!model) return;
          if (disposed || modelRunRef.current !== run) {
            disposeOwnedModel(model);
            return;
          }
          placeAt(model, shell, 0);
          model.name = `plan-crowd-${placement.crowdType}`;
          crowdLayer.add(model);
          modelRoots.push(model);
        })
        .catch(() => {
          /* 人物模型拉不到：保留人位柱。 */
        });
    });

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

    const addSelectedZoneHandles = (group: THREE.Group, nextPlan: SitePlanData, frame: SiteFrame, zoneId: string | null): void => {
      if (!zoneId) return;
      const zone = nextPlan.zones.find((item) => item.id === zoneId);
      if (!zone) return;
      const geometry = new THREE.SphereGeometry(0.7, 16, 12);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      disposables.push(geometry, material);
      for (const point of zone.polygon) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(point.x - frame.cx, 0.82, -(point.y - frame.cy));
        mesh.userData.type = 'plan-vertex-handle';
        group.add(mesh);
      }
    };

    let lastEditKey = '';
    const syncEditVisuals = (): void => {
      const visuals = canvasEditApiRef.current?.current?.getEditVisuals?.();
      if (!visuals) return;
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
      const previous = scene.children.find(
        (child) => child instanceof THREE.Group && child.userData.type === ROOM_OBJECT_TAGS.PlanFootprint,
      );
      if (previous) disposeObject(previous);
      if (!buildPlanFootprint(THREE, scene, nextPlan, nextMetrics, { clampPoints: false })) {
        lineMaterialsRef.current = [];
        return;
      }
      const nextGroup = scene.children.find(
        (child) => child instanceof THREE.Group && child.userData.type === ROOM_OBJECT_TAGS.PlanFootprint,
      ) as THREE.Group | undefined;
      if (!nextGroup) return;
      nextGroup.position.set(nextFrame.cx, 0, -nextFrame.cy);
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
        planModelLayer.syncPositions(nextShapes.props, nextMetrics);
        // 2026-11-12 新放置的设施当场落地真模型：原来要等图源/视口变化触发场景重挂，
        // 用户放个摩天轮只看得到占地轮廓。重建后的占位表同步接管（贴纸隐藏用）。
        planModelLayer.placeNew(nextShapes.props, nextMetrics, collectPlaceholdersByPropId(nextGroup));
      }
      const sceneLayerObj = scene.getObjectByName('plan-scene-objects');
        if (sceneLayerObj) sceneLayerObj.position.set(nextFrame.cx, PLAN_LAYER_BASE_Y, -nextFrame.cy);
      const crowdLayerObj = scene.getObjectByName('plan-crowd');
        if (crowdLayerObj) crowdLayerObj.position.set(nextFrame.cx, PLAN_LAYER_BASE_Y, -nextFrame.cy);
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
    // 2026-11-12 用户拍板：3D 里**中键**才转地图（环绕），左键整个让给物件编辑手势
    // （pointerFromPlan 桥：按下拾取/拖动走和 2D 画布同一套管线）；滚轮缩放、右键平移保持。
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controls.target.copy(lookTarget);
    controls.update();
    cameraRef.current = camera;
    controlsRef.current = controls;
    const tilted = cameraPose(lookTarget, span, MAP_TILT_POLAR, 52);
    const tiltFrom = camera.position.clone();
    const startedAt = performance.now();
    const animateTilt = (now: number) => {
      if (disposed || !cameraRef.current || !controlsRef.current) return;
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
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width < 2 || height < 2) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      lineMaterialsRef.current.forEach((material) => material.resolution.set(width, height));
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    let lodBusy = false;
    let lastLodZoom = preferredZoom;
    let lastLodAt = 0;
    let lastLodFocus = { x: focusEnu.x, y: focusEnu.y };
    const loadCloserTiles = (): void => {
      if (!anchor || disposed || lodBusy) return;
      const now = performance.now();
      if (now - lastLodAt < 80) return;
      const aim = controls?.target ?? lookTarget;
      const canvasH = stage.clientHeight || 600;
      const needed = neededMapZoom(camera, aim, canvasH, anchor.lat);
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
        closeBounds: frameToBounds(visible, anchor),
        midBounds: frameToBounds(midVisible, anchor),
        farBounds: frameToBounds(farVisible, anchor),
        anchor,
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
      // 恒定屏幕尺寸：透视下 world size ∝ 相机距离（等价于 2D 手柄的固定 CSS px）。
      const dist = Math.max(camera.position.distanceTo(controls?.target ?? lookTarget), 2);
      const size = Math.min(60, Math.max(0.25, dist * 0.016));
      cornerHandles.forEach(holder => holder.scale.setScalar(size));
      sideHandles.forEach(holder => holder.scale.setScalar(size * 0.72));
      rotateHandle.scale.setScalar(size * 1.5);
      handleGroup.visible = true;
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
      const hit = eventToPlanHit(event);
      if (!hit) return;
      const consumed = api.pointerFromPlan('down', hit, pointerFlags(event, hit));
      syncEditVisuals();
      if (!consumed) return;
      pointerEditing = true;
      if (controls) controls.enabled = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        renderer?.domElement.setPointerCapture(event.pointerId);
      } catch {
        /* 有的指针已经 captured，忽略。 */
      }
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
      }
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
    renderer.domElement.addEventListener('pointerdown', onPointerDown, { capture: true });
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDblClick);

    let idleTick = 0;
    function loop(): void {
      frame = window.requestAnimationFrame(loop);
      // 保活隐藏（2D 地图态）：每 6 帧只推进一次瓦片 LOD，切回 3D 时地面已经铺好，
      // 不需要再从低清瓦片重新抓一遍。
      if (!activeRef.current) {
        idleTick = (idleTick + 1) % 6;
        if (idleTick !== 0) return;
      }
      controls?.update();
      if (controls) {
        const mode = canvasEditApiRef.current?.current?.getMode() ?? 'view';
        controls.enableRotate = mode === 'view' && !pointerEditing;
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
      layerApiRef.current = null;
      modelRunRef.current += 1;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
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
      modelRoots.forEach((root) => {
        try {
          disposeOwnedModel(root);
        } catch {
          /* 单个模型释放失败不影响卸载。 */
        }
        root.parent?.remove(root);
      });
      scene.traverse((object) => {
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
      walkCanvasRef.current = null;
      if (canvas && canvas.parentNode === stage) stage.removeChild(canvas);
    };
    // 图源 / 初始视口变化才重建场景；规划线的增改走 syncFootprint，避免编辑时镜头被重置。
  }, [onReady, source, mapView, plan.anchor?.lng, plan.anchor?.lat]);

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
          还没画边界时 3D 里只有一块底图面，容易被当成“多余的切片”——这里说清楚下一步。 */}
      {plan.boundary.length < 3 && (
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
          还没有场地边界：切回 2D 画一圈，这里就会立起你的场地
        </div>
      )}
      {walkEnabled && (
        <div
          data-testid="outdoor-walk-hud"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 20,
            transform: 'translateX(-50%)',
            zIndex: 3,
            padding: '6px 12px',
            borderRadius: 10,
            background: 'rgba(18, 20, 26, 0.72)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          WASD / 方向键行走 · Shift 加速 · Esc 退出漫游
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
          地图底图未取到，先用纸面网格（低模草图）
        </div>
      )}
      <GeoScaleCompass
        scaleLabelRef={scaleLabelRef}
        scaleBarRef={scaleBarRef}
        compassRef={compassRef}
        attribution={groundState === 'satellite' ? basemapSourceAttribution(source) : null}
        testIdPrefix="outdoor-3d"
      />
    </div>
  );
}