import { useEffect, useMemo, useRef, useSyncExternalStore, type RefObject, type MutableRefObject } from 'react';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { addFloorPlanRepaintHandler, render2DTopDown } from '../canvas-2d/render';
import { DEFAULT_FLOOR_PLAN_OPACITY } from '../lib/constants';
import { floorKeepOut, type KeepOutBuilding } from '../lib/floor-keep-out';
import { isMapReferenceImage } from '../lib/amap-venue';
import { hasCollisions } from '../lib/geometry';
import { mountBand } from '../lib/mount-band';
import { readPlanGroundSource, subscribePlanGroundSource } from '../lib/plan-basemap-source';
import { planFootprintShapes } from '../lib/plan-footprint-geometry';
import { planShellFrame } from '../lib/plan-footprint-geometry';
import { mapVenueFootprint } from '../lib/scene-anchor';
import { hasNeighbours, lowestGround } from '../lib/site';
import { buildingHeight, floorElevation, interiorWallHeight, itemForStorey, storeyHeight } from '../lib/storeys';
import { ENTRANCE_WALL_ID, entranceGeometry, entranceWallCut } from '../lib/street';
import { generateStreet } from '../lib/street-row';
import { structuralItemCollides } from '../lib/structural-layout';
import { disposeObject, removeAndDispose } from '../three/builder-utils';
import { addVisionCones } from '../three/camera-vision';
import { FURNITURE_REVISION_KEY } from '../three/drag-handlers';
import {
  type SiteFrame,
  type TilePaintCache,
  coverFrameFromFrustum,
  frameToBounds,
  maxZoomForSource,
  neededMapZoom,
  paintTiledGround,
  paintTilePyramid,
  ringFrame,
  squareFrame,
  tileHeight,
  zoomFromSpan,
} from '../three/plan-basemap-tiles';
import {
  collectPlaceholdersByPropId,
  createPlanModelLayer,
} from '../three/plan-model-layer';
import { buildEntrance } from '../three/entrance';
import { footprintEdges } from '../three/footprint-outline';
import { createFurnitureModel } from '../three/furniture-builders';
import { personWalkBounds, routeIsLoop } from '../lib/person-route';
import { buildWalkColliders } from '../lib/walk-collision';
import { personAnimIds, personFollowSample, setPeopleShadowRefresher, setPersonWalkContext } from '../three/people-anim';
import {
  clearInteriorWalls,
  clearPreview as clearWallPreview,
  renderInteriorWalls,
  renderInteriorWallPreview,
} from '../three/interior-walls';
import { clearItemLabels, renderItemLabels } from '../three/item-labels';
import { applyTimeOfDay } from '../three/lighting';
import { clearMeasurement, clearRoomDimensions, renderMeasurement, renderRoomDimensions } from '../three/measurement';
import { buildNeighbours, removeNeighbours } from '../three/neighbours';
import { setOutdoorVisible } from '../three/outdoor';
import { buildResearchBasemap, clearGeoCrosses, clearResearchBasemap, buildGeoCrosses, parseGeoCrossParam } from '../three/research-basemap';
import { buildRoof, removeRoof } from '../three/roof';
import { ROOM_OBJECT_TAGS, applyWallDisplay, buildRoom, clearFloorPlanImageCache, removeTagged } from '../three/room-builder';
import { createPresetStructure } from '../three/scene-presets';
import { addSignalOverlays } from '../three/signal-overlay';
import { buildStructureShell } from '../three/structure-builder';
import { BasemapTileCache } from '../lib/plan-tile-cache';
import { buildPlanFootprint } from '../three/plan-footprint-builder';
import { computeFloorOpenings, computeWallOpenings } from '../three/wall-openings';
import { useGlbAssets } from './use-glb-assets';
import type { FloorLayout, RoomLayout, ViewSettings } from '../lib/types';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { ReferenceImageLayer } from '@/lib/reference-image';
import type * as ThreeNS from 'three';

export const MAP_VENUE_BOUNDARY = 'map-venue-boundary';

/** A view-only image plane. Its pixels use the existing canonical metre mapping. */
export function mountReferenceImage(
  THREE: typeof import('three'),
  scene: ThreeNS.Scene,
  image: ReferenceImageLayer,
  roomWidth: number,
  roomDepth: number,
  opacity: number,
  invalidate: () => void,
  isCurrent: () => boolean = () => true
): () => void {
  const [a, b, c, d, e, f] = image.imageToWorld;
  const corners = [[0, 0], [image.pixelWidth, 0], [image.pixelWidth, image.pixelHeight], [0, image.pixelHeight]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap(([x, y]) => [
    a * x + c * y + e - roomWidth / 2, 0.002, b * x + d * y + f - roomDepth / 2,
  ]), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.type = 'reference-image';
  mesh.raycast = () => {};
  let alive = true;
  const texture = new THREE.TextureLoader().load(image.url, (loaded) => {
    if (!alive || !isCurrent()) { loaded.dispose(); return; }
    loaded.colorSpace = THREE.SRGBColorSpace;
    material.map = loaded;
    material.needsUpdate = true;
    scene.add(mesh);
    invalidate();
  });
  return () => {
    alive = false;
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
    texture.dispose();
    invalidate();
  };
}

interface MaterialLike {
  transparent: boolean;
  opacity: number;
}

interface MeshLike {
  material?: MaterialLike | readonly MaterialLike[] | null;
}

/**
 * Opacity for another storey's shell and interior walls in "show all floors",
 * or undefined to draw it solid. Other storeys are ghosted so the active one
 * stays readable — except with every wall up, where the point is to see the
 * house as a solid building from outside (#201).
 */
export function otherFloorGhostOpacity(
  showAllFloors: boolean,
  wallDisplay: ViewSettings['wallDisplay'],
  isActive: boolean
): number | undefined {
  return showAllFloors && !isActive && wallDisplay !== 'up' ? 0.25 : undefined;
}

function ghostifyGroup(group: import('three').Object3D, opacity = 0.3): void {
  group.traverse((node) => {
    const material = (node as MeshLike).material;
    if (!material) return;
    const apply = (m: MaterialLike) => {
      m.transparent = true;
      m.opacity = Math.min(m.opacity, opacity);
    };
    if (Array.isArray(material)) {
      material.forEach(apply);
    } else {
      apply(material as MaterialLike);
    }
  });
}

export interface UseSceneEffectsParams {
  isReady: boolean;
  /** Flips once people.glb loads, so placed people rebuild as rigged figures. */
  peopleModelReady?: boolean;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate: () => void;
  /** Recompute the static shadow map — call after a shadow caster/sun change. */
  requestShadowUpdate: () => void;
  threeModuleRef: MutableRefObject<typeof import('three') | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  rendererRef: MutableRefObject<ThreeNS.WebGLRenderer | null>;
  cameraRef: MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: MutableRefObject<import('three/examples/jsm/controls/OrbitControls.js').OrbitControls | null>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
  layout: RoomLayout;
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  /** 实景点云实测四至（SplatWalkBounds）：有值时人物巡游夹取框用它而非布局名义矩形。 */
  personRouteBounds?: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }> | null;
  referenceImage?: ReferenceImageLayer;
  view: ViewSettings;
  selectedItemId: string | null;
  extraSelectedIds: ReadonlySet<string>;
  highlightedIds: ReadonlySet<string>;
  selectedWall: { id: string; kind: 'exterior' | 'interior' } | null;
  wallDraft: { x: number; z: number } | null;
  wallSnapResult: { point: { x: number; z: number }; kind: string } | null;
  measurementPoints: ReadonlyArray<{ x: number; z: number }>;
  showBasemap?: boolean;
  /**
   * 户外 2D 规划（P2-g）：有值时把分区/设施/动线/点位摊到 3D 地面上，
   * 与 `layout.width/height` 同一个壳体口径；为 null 时清掉该图层。
   */
  outdoorPlan?: SitePlanData | null;
}

export function useSceneEffects({
  isReady,
  peopleModelReady = false,
  invalidate,
  requestShadowUpdate,
  threeModuleRef,
  sceneRef,
  rendererRef,
  cameraRef,
  controlsRef,
  canvas2DRef,
  layout,
  activeFloor,
  activeFloorIndex,
  personRouteBounds = null,
  referenceImage,
  view,
  selectedItemId,
  extraSelectedIds,
  highlightedIds,
  selectedWall,
  wallDraft,
  wallSnapResult,
  measurementPoints,
  showBasemap = true,
  outdoorPlan = null,
}: UseSceneEffectsParams): void {
  const showBasemapRef = useRef(showBasemap);
  showBasemapRef.current = showBasemap;

  // —— GeoGround（2026-11-12）：主舞台地理瓦片地面 ——
  // 退出户外规划后主 3D 只剩纸面平面（docs/42 主线缺口）。这里按户外计划的锚点把
  // 真实地图瓦片铺进主舞台：管线复用 three/plan-basemap-tiles（自 outdoor-plan-3d 抽出），
  // 用父组仿射把 ENU 瓦片变换到壳体世界系，与 buildPlanFootprint 的色块同一把
  // planShellFrame 尺——瓦片正好垫在色块下面。
  // 壳体层的激活判定（跳过纸面地板/地基）：有锚点 + 允许底图 + 边界可用。不看 view2D——
  // 这是结构开关，2D/3D 切换不该重建壳体。
  const geoGroundShellActive = !!(
    outdoorPlan?.anchor
    && showBasemap
    && (outdoorPlan.boundary.length >= 3)
    && layout.width >= 1
    && layout.height >= 1
    && planShellFrame(outdoorPlan.boundary, { width: layout.width, depth: layout.height }, { clampPoints: false })
  );
  const view2DRef = useRef(view.view2D);
  view2DRef.current = view.view2D;
  const outdoorPlanRef = useRef(outdoorPlan);
  outdoorPlanRef.current = outdoorPlan;
  // 边界顶点变化才重铺瓦片；编辑分区/设施不改边界，不该把瓦片层打掉重来。
  const geoBoundaryKey = useMemo(
    () => (outdoorPlan ? outdoorPlan.boundary.map((p) => `${Math.round(p.x * 100)}/${Math.round(p.y * 100)}`).join('|') : ''),
    [outdoorPlan],
  );
  // 图源与户外 2D 画布同一份模块级偏好（覆盖层切图源时 writePlanGroundSource 会通知）。
  const geoBasemapSource = useSyncExternalStore(subscribePlanGroundSource, readPlanGroundSource, () => 'osm' as const);
  const glbAssetsRevision = useGlbAssets(layout);
  const activeFloorY = floorElevation(layout.floors, activeFloorIndex);

  // Storey heights stack every floor's Y, the wall heights, and the roof
  // base (#202). The structural effects are keyed on narrow signatures, not
  // `layout.floors` identity, so they need this one too.
  const storeyHeightsKey = layout.floors.map((floor) => floor.height ?? '').join(',');
  // What the porch keep-out is fitted to (#285) — the effects key on this
  // rather than the whole layout.
  const entranceBuilding = useMemo<KeepOutBuilding>(
    () => ({ width: layout.width, height: layout.height, terrain: layout.terrain, entrance: layout.entrance, floors: layout.floors }),
    [layout.width, layout.height, layout.terrain, layout.entrance, layout.floors]
  );

  // Serialized signatures of exactly the item-derived inputs the structural
  // effects consume. `layout.floors` gets a new identity on every item action,
  // so keying the effects on it rebuilt walls, floors, procedural textures,
  // and lights each time a chair moved; these keys only change when something
  // the structure actually depends on changes.
  const wallOpeningsKey = useMemo(
    () =>
      JSON.stringify(
        layout.floors.map((floor) =>
          floor.items
            .filter((item) => item.type === 'door' || item.type === 'window' || item.type === 'stairs')
            .map((item) => [
              item.type,
              item.position?.x,
              item.position?.z,
              item.width,
              item.height,
              item.depth,
              item.rotation,
              // Stair shape + mirroring move the headroom hole above (#205);
              // a window's own sill moves its hole (#204).
              item.stairsShape,
              item.stairsLeadIn,
              item.mirrored,
              item.sillHeight,
            ])
        )
      ),
    [layout.floors]
  );

  const shellFinishesKey = useMemo(
    () =>
      JSON.stringify(
        layout.floors.map((floor) => [
          floor.floorColor,
          floor.floorPattern,
          floor.wallPattern,
          floor.wallColors,
          floor.hiddenWalls,
        ])
      ),
    [layout.floors]
  );

  const interiorWallsKey = useMemo(
    () => JSON.stringify(layout.floors.map((floor) => floor.interiorWalls ?? [])),
    [layout.floors]
  );

  const lampsKey = useMemo(
    () =>
      JSON.stringify(
        layout.floors.map((floor) =>
          floor.items
            .filter((item) => (item.type === 'lamp' || item.type === 'floor-lamp') && item.position)
            .map((item) => [item.position!.x, item.position!.z, item.height])
        )
      ),
    [layout.floors]
  );

  // Wall preview during draw mode
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    if (!view.drawWallMode || !wallDraft || !wallSnapResult) {
      clearWallPreview(scene);
      return;
    }
    renderInteriorWallPreview(
      THREE, scene, wallDraft, wallSnapResult.point, activeFloorY, interiorWallHeight(activeFloor)
    );
    // activeFloor is read for its storey height only; storeyHeightsKey covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.drawWallMode, wallDraft, wallSnapResult, activeFloorY, storeyHeightsKey]);

  // Build floor + walls
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.Floor, ROOM_OBJECT_TAGS.Wall);
    if (layout.backendSceneV2) {
      buildStructureShell(THREE, scene, layout, {
        onTextureLoaded: invalidate,
        activeFloorIndex,
        showAllFloors: view.showAllFloors,
      });
      const camera = cameraRef.current;
      if (camera) applyWallDisplay(scene, camera.position.x, camera.position.z, view.wallDisplay, layout.width, layout.height);
      requestShadowUpdate();
      return;
    }
    if (layout.scenePreset) {
      const structure = createPresetStructure(layout.scenePreset);
      if (structure) {
        structure.userData.type = ROOM_OBJECT_TAGS.Floor;
        scene.add(structure);
      }
      requestShadowUpdate();
      return;
    }

    // The building no longer has a floor plan: release the decoded multi-MB
    // image. (Only here — see clearFloorPlanImageCache for why buildRoom must
    // not drop it per image-less call.)
    if (!layout.floorPlanImage) clearFloorPlanImageCache();

    const floorsToRender = view.showAllFloors
      ? layout.floors.map((floor, index) => ({ floor, index }))
      : [{ floor: activeFloor, index: activeFloorIndex }];

    // The recessed entrance (#204) cuts the front wall of every storey it crosses.
    const entrance = layout.entrance
      ? entranceGeometry(layout.entrance, {
          width: layout.width,
          depth: layout.height,
          floors: layout.floors,
          ...(layout.terrain ? { terrain: layout.terrain } : {}),
        })
      : null;

    // 调研底图已在 3D 地面铺一张连续地图；旧的卫星贴地是另一套坐标，
    // 继续当地板贴图会盖住扫描场地，这里只停用它、不删用户数据。
    const legacyGroundMap = !!layout.researchArea && isMapReferenceImage(layout.floorPlanImage);
    // GeoGround 瓦片在场（户外计划有锚点）：0 层素色地板与地基让位给瓦片地面。
    const skipGroundFloor = geoGroundShellActive;
    for (const { floor, index } of floorsToRender) {
      const isActive = index === activeFloorIndex;
      const wallOpenings = computeWallOpenings(
        floor.items,
        layout.width,
        layout.height,
        storeyHeight(floor),
        floor.interiorWalls ?? []
      );
      const entranceCut = entrance ? entranceWallCut(entrance, layout.floors, index) : null;
      if (entranceCut) {
        wallOpenings.set('north', [...(wallOpenings.get('north') ?? []), { id: 'entrance', ...entranceCut }]);
      }
      // Stairs on the floor below create openings in this floor's plane.
      const floorBelow = index > 0 ? layout.floors[index - 1] : undefined;
      const floorOpenings = computeFloorOpenings(floorBelow);
      const ghostOpacity = otherFloorGhostOpacity(view.showAllFloors, view.wallDisplay, isActive);
      buildRoom(THREE, {
        scene,
        width: layout.width,
        depth: layout.height,
        floorColor: floor.floorColor,
        ...(floor.floorPattern ? { floorPattern: floor.floorPattern } : {}),
        ...(floor.wallPattern ? { wallPattern: floor.wallPattern } : {}),
        ...(floor.wallColors ? { wallColors: floor.wallColors } : {}),
        wallOpenings,
        ...(floor.hiddenWalls ? { hiddenWalls: floor.hiddenWalls } : {}),
        floorOpenings,
        ...(index === 0 && skipGroundFloor ? { skipFloor: true, skipWalls: true } : {}),
        floorPlanImage: index === 0 && !legacyGroundMap && !skipGroundFloor ? layout.floorPlanImage ?? null : null,
          satelliteGroundRef: index === 0 && !legacyGroundMap && !skipGroundFloor ? !!layout.satelliteGroundRef : false,
        floorPlanOpacity: view.referenceImageOpacity ?? layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY,
        floorPlanFitMode: layout.floorPlanFitMode ?? 'stretch',
        floorPlan3DEffect: view.floorPlan3DEffect,
        showFloorPlan: view.showReferenceImage !== false,
        yOffset: floorElevation(layout.floors, index),
        wallHeight: storeyHeight(floor),
        groundY: lowestGround(layout.terrain),
        ...(ghostOpacity !== undefined ? { ghostOpacity } : {}),
        onTextureLoaded: invalidate,
      });
      // The reveals and soffit are part of the north wall, so they are built
      // exactly when that wall is: not on the traced ground floor (buildRoom
      // builds no walls there) and not when the north wall is hidden — the
      // plan dashes the recess then, like the rest of the wall (#392).
      const tracedGround = index === 0 && !!layout.floorPlanImage && !legacyGroundMap;
      if (entrance && index === entrance.floorIndex && !tracedGround) {
        const northHidden = floor.hiddenWalls?.includes('north') ?? false;
        for (const group of buildEntrance(THREE, {
          geometry: entrance,
          wallColor: floor.wallColors?.north ?? '#e8dcc4',
          wallTag: ROOM_OBJECT_TAGS.Wall,
          floorTag: ROOM_OBJECT_TAGS.Floor,
          ...(ghostOpacity !== undefined ? { ghostOpacity } : {}),
        })) {
          if (northHidden && group.userData.wallId === 'north') disposeObject(group);
          else scene.add(group);
        }
      }
    }

    const camera = cameraRef.current;
    if (camera) {
      applyWallDisplay(scene, camera.position.x, camera.position.z, view.wallDisplay, layout.width, layout.height);
    }
    // Walls, floor and foundation are shadow casters/receivers — recompute the
    // static shadow map now that the shell geometry changed.
    requestShadowUpdate();
    // The shell reads layout.floors/activeFloor but depends on them only
    // through the finishes and openings keys — depending on their identity
    // would rebuild walls, floor meshes, and procedural textures on every
    // item edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, rendererRef, cameraRef,
    // interiorWallsKey: opening ownership is classified across exterior AND
    // interior walls (nearest wall wins), so the exterior hole set changes
    // when interior walls do — without this dep a door claimed by a new
    // interior wall stays double-cut into the exterior wall (#119).
    layout.backendSceneV2, layout.width, layout.height, layout.scenePreset, glbAssetsRevision, shellFinishesKey, wallOpeningsKey, interiorWallsKey, storeyHeightsKey, layout.terrain, layout.entrance,
    layout.floorPlanImage, layout.floorPlanOpacity, layout.floorPlanFitMode, layout.satelliteGroundRef, !!layout.researchArea, geoGroundShellActive,
    layout.mapGroundFrame?.lng0, layout.mapGroundFrame?.lat0, layout.mapGroundFrame?.latMid, layout.mapGroundFrame?.scale, layout.mapGroundFrame?.latSign,
    layout.mapGroundPolygon?.length,
    view.floorPlan3DEffect, view.showAllFloors, view.wallDisplay,
    view.showReferenceImage, view.referenceImageOpacity,
    activeFloorIndex,
  ]);

  // 户外 2D 规划 → 3D 地面（P2-g 数据打通）：整层打 PlanFootprint 标记，平面内容或
  // 场地尺寸一变就重建（数量在几十个 mesh 量级，比增量维护更不容易残留）。
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    removeTagged(scene, ROOM_OBJECT_TAGS.PlanFootprint);
    if (!outdoorPlan) return;
    if (buildPlanFootprint(THREE, scene, outdoorPlan, { width: layout.width, depth: layout.height })) {
      requestShadowUpdate();
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, outdoorPlan, layout.width, layout.height]);

  // GeoGround（2026-11-12）：主舞台的真实地图瓦片地面。计划有锚点时铺近场金字塔 →
  // 扩展金字塔 → 远景兜底（与 outdoor-plan-3d 初始铺地同款三阶段），相机移动挂
  // controls 'change' 补高清瓦片。瓦片 quad 在 ENU 空间落位（three.x=plan.x、
  // three.z=-plan.y），挂到按 planShellFrame 仿射变换的 geoRoot 组上，正好与
  // buildPlanFootprint 色块对齐（同一把边界→壳体映射）。图源用与户外 2D 同一份偏好。
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    const plan = outdoorPlanRef.current;
    const anchor = plan?.anchor ? { lng: plan.anchor.lng, lat: plan.anchor.lat } : null;
    if (!THREE || !scene || !anchor || !plan || !showBasemapRef.current || view2DRef.current) return;
    const siteFrame = ringFrame(plan.boundary);
    if (siteFrame.width < 4 || siteFrame.depth < 4) return;
    const source = geoBasemapSource;
    // ENU → 壳体世界仿射：world.x=(p.x-minX)*scaleX-width/2、world.z=(maxY-p.y)*scaleZ-depth/2。
    // 与 plan-footprint-builder 的 shapePoint 完全同一把尺（含边界 >100m 的整体压缩）。
    const minX = siteFrame.cx - siteFrame.width / 2;
    const maxY = siteFrame.cy + siteFrame.depth / 2;
    const scaleX = layout.width / siteFrame.width;
    const scaleZ = layout.height / siteFrame.depth;
    const geoRoot = new THREE.Group();
    geoRoot.name = 'geo-ground';
    geoRoot.userData.type = ROOM_OBJECT_TAGS.GeoGround;
    geoRoot.scale.set(scaleX, 1, scaleZ);
    geoRoot.position.set(-minX * scaleX - layout.width / 2, 0, maxY * scaleZ - layout.height / 2);
    scene.add(geoRoot);

    const disposables: { dispose: () => void }[] = [];
    const tileKeys = new Set<string>();
    const tileCache: TilePaintCache = {
      imageCache: new BasemapTileCache({ max: 1200 }),
      textures: new Map<string, ThreeNS.Texture>(),
      fallbackMeshes: new Map<string, ThreeNS.Mesh>(),
      readyKeys: new Set<string>(),
    };
    const focusEnu = { x: siteFrame.cx, y: siteFrame.cy };
    const preferredZoom = zoomFromSpan(siteFrame.span);
    const hiZoom = maxZoomForSource(source);
    const nearFrame = squareFrame(siteFrame.cx, siteFrame.cy, Math.max(siteFrame.span * 1.3, siteFrame.span + 240, 320));
    const closeFrame = squareFrame(siteFrame.cx, siteFrame.cy, Math.max(siteFrame.span * 2, 1600));
    const workFrame = squareFrame(siteFrame.cx, siteFrame.cy, Math.max(siteFrame.span * 6, 800));
    const groundFrame = squareFrame(siteFrame.cx, siteFrame.cy, Math.max(siteFrame.span * 12, 4000));
    let disposed = false;
    let shown = false;
    const showGround = (count: number): void => {
      if (disposed || shown || count <= 0) return;
      shown = true;
      invalidate();
    };
    void (async () => {
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
        parent: geoRoot,
        tag: ROOM_OBJECT_TAGS.GeoGround,
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
        parent: geoRoot,
        tag: ROOM_OBJECT_TAGS.GeoGround,
      });
      showGround(expandCount);
      if (disposed) return;
      await paintTiledGround({
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
        parent: geoRoot,
        tag: ROOM_OBJECT_TAGS.GeoGround,
      });
    })();

    // 相机 LOD（挂点仿 use-scene-effects cutaway effect；节流/单调阈值仿 outdoor-plan-3d loadCloserTiles）。
    // scale=1（边界 ≤100m 的现行策略下恒成立）时世界坐标就是米；scale<1 的压缩场地
    // 整体都被等比压了，LOD 用世界距离近似即可，与色块的畸变一致。
    let lodBusy = false;
    let lastLodZoom = preferredZoom;
    let lastLodAt = 0;
    let lastLodFocus = { x: focusEnu.x, y: focusEnu.y };
    const worldToEnu = (x: number, z: number): { x: number; y: number } => ({
      x: (x - geoRoot.position.x) / scaleX,
      y: -(z - geoRoot.position.z) / scaleZ,
    });
    // coverFrameFromFrustum 输出 cy=-z（北朝 y+）的世界框；翻回 plan ENU 框。
    const worldFrameToEnuFrame = (frame: SiteFrame): SiteFrame => {
      const west = (frame.cx - frame.width / 2 - geoRoot.position.x) / scaleX;
      const east = (frame.cx + frame.width / 2 - geoRoot.position.x) / scaleX;
      const zMin = -frame.cy - frame.depth / 2;
      const zMax = -frame.cy + frame.depth / 2;
      const yMin = -(zMax - geoRoot.position.z) / scaleZ;
      const yMax = -(zMin - geoRoot.position.z) / scaleZ;
      const width = Math.max(4, east - west);
      const depth = Math.max(4, yMax - yMin);
      return { cx: (west + east) / 2, cy: (yMin + yMax) / 2, width, depth, span: Math.max(width, depth) };
    };
    const loadCloserTiles = (): void => {
      if (disposed || lodBusy || view2DRef.current || !showBasemapRef.current) return;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const renderer = rendererRef.current;
      if (!camera || !controls || !renderer) return;
      const now = performance.now();
      if (now - lastLodAt < 80) return;
      const aim = controls.target;
      const canvasH = renderer.domElement.clientHeight || 600;
      const needed = neededMapZoom(camera, aim, canvasH, anchor.lat);
      const cap = maxZoomForSource(source);
      const zoom = needed >= 15 || needed >= preferredZoom + 0.3
        ? cap
        : Math.max(preferredZoom, Math.min(cap, Math.ceil(needed)));
      const aimEnu = worldToEnu(aim.x, aim.z);
      const moved = Math.hypot(aimEnu.x - lastLodFocus.x, aimEnu.y - lastLodFocus.y) > 100;
      if (zoom <= lastLodZoom && !moved && now - lastLodAt < 800) return;
      const aspect = Math.max(0.2, (renderer.domElement.clientWidth || 800) / Math.max(1, canvasH));
      const range = Math.min(80000, Math.max(aim.distanceTo(camera.position) * 4, zoom >= cap - 1 ? 1600 : 400));
      lastLodAt = now;
      lastLodZoom = Math.max(lastLodZoom, zoom);
      lastLodFocus = { x: aimEnu.x, y: aimEnu.y };
      lodBusy = true;
      const visible = worldFrameToEnuFrame(coverFrameFromFrustum(aim, camera.position, camera.fov, aspect, range, 1.2));
      const midVisible = worldFrameToEnuFrame(coverFrameFromFrustum(aim, camera.position, camera.fov, aspect, Math.min(80000, range * 2), 1.2));
      const farVisible = worldFrameToEnuFrame(coverFrameFromFrustum(aim, camera.position, camera.fov, aspect, Math.min(80000, range * 4), 1.2));
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
        focus: { x: aimEnu.x, y: aimEnu.y },
        closeMaxTiles: 160,
        parent: geoRoot,
        tag: ROOM_OBJECT_TAGS.GeoGround,
      }).finally(() => {
        lodBusy = false;
      });
      invalidate();
    };
    loadCloserTiles();
    const controls = controlsRef.current;
    controls?.addEventListener('change', loadCloserTiles);

    return () => {
      disposed = true;
      controls?.removeEventListener('change', loadCloserTiles);
      tileCache.textures.forEach((texture) => {
        try {
          texture.dispose();
        } catch {
          /* 共享纹理释放失败不影响卸载。 */
        }
      });
      tileCache.textures.clear();
      tileCache.fallbackMeshes.clear();
      // quad 已随 geoRoot 移除：清 readyKeys/loaded 让重跑时允许重建同一批瓦片
      // （imageCache 里的位图仍在，重建不回网络）。
      tileCache.readyKeys.clear();
      tileKeys.clear();
      disposables.forEach((item) => {
        try {
          item.dispose();
        } catch {
          /* 单个资源释放失败不影响卸载。 */
        }
      });
      if (geoRoot.parent === scene) scene.remove(geoRoot);
      invalidate();
    };
    // 锚点 / 图源 / 壳体尺寸 / 边界 / 2D·3D / 扫描隔离变化才重建；普通 plan 编辑不改边界，不重铺。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef,
    outdoorPlan?.anchor?.lng, outdoorPlan?.anchor?.lat, geoBoundaryKey, geoBasemapSource,
    layout.width, layout.height, view.view2D, showBasemap]);

  // —— 计划设施 GLB 模型层（2026-11-12，与户外 3D 共享 three/plan-model-layer.ts）——
  // 退出户外后主 3D 不再只有低模占位：同一批设施落地真模型。glb-assets 缓存是模块级
  // 单例，户外 3D 已载过的模型零下载。模型组不打 Furniture tag——Furniture effect
  // 每次 layout 变化 removeTagged 会连模型一起清；组放 (0,0,0)（壳体世界原点已居中，
  // 内层落位 planModelTransform 与占位体同式，正好垫在色块之上）。
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene || !outdoorPlan) return;
    const shapes = planFootprintShapes(outdoorPlan, { width: layout.width, depth: layout.height }, { clampPoints: false });
    if (!shapes || shapes.props.length === 0) return;
    const footprintGroup = scene.children.find(
      (child) => child instanceof THREE.Group && child.userData.type === ROOM_OBJECT_TAGS.PlanFootprint,
    );
    const modelLayer = createPlanModelLayer({
      parent: scene,
      props: shapes.props,
      metrics: { width: layout.width, depth: layout.height },
      placeholders: footprintGroup ? collectPlaceholdersByPropId(footprintGroup) : undefined,
      isDisposed: () => sceneRef.current !== scene || threeModuleRef.current !== THREE,
    });
    // 2026-11-12 用户反馈「物体没放在平面上」：模型底面垫到瓦片金字塔顶（z19=0.048）之上，
    // 与户外 3D 的 PLAN_LAYER_BASE_Y 同一口径；GeoGround 未激活（室内地板）时 5 cm 悬浮不可感知。
    modelLayer.group.position.set(0, 0.052, 0);
    invalidate();
    return () => {
      modelLayer.dispose();
      invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, threeModuleRef, sceneRef, outdoorPlan, layout.width, layout.height, glbAssetsRevision]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!isReady || !scene || !showBasemap || view.view2D || view.walkthroughMode) return;
    const points = mapVenueFootprint(layout);
    if (points.length < 3) return;
    const geometry = new LineGeometry();
    geometry.setPositions([...points, points[0]!].flatMap(point => [point.x, 0.05, point.z]));
    const material = new LineMaterial({ color: 0x2f6bff, linewidth: 3, depthTest: false, depthWrite: false });
    const boundary = new Line2(geometry, material);
    boundary.name = MAP_VENUE_BOUNDARY;
    boundary.renderOrder = 20;
    scene.add(boundary);
    invalidate();
    return () => {
      removeAndDispose(scene, boundary);
      invalidate();
    };
  // The boundary depends on the saved ring and its coordinate frame, not furniture edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, sceneRef, showBasemap, view.view2D, view.walkthroughMode, layout.mapGroundPolygon, layout.sceneAnchor,
    layout.mapGroundFrame, layout.mapLngLat, layout.width, layout.height, invalidate]);

  // 调研底图单独一层：壳体照旧按米建，底图是这一片区域的路网，铺在壳体下方。
  // 换范围只重铺这张图，不动壳体与物料。
  // GeoGround 瓦片在场时让位：两套地理地面语义互斥，瓦片优先（与 legacyGroundMap 同款写法）。
  const researchKey = layout.researchArea && !geoGroundShellActive
    ? [
      layout.researchArea.imageUrl,
      layout.researchArea.bounds.west, layout.researchArea.bounds.south,
      layout.researchArea.bounds.east, layout.researchArea.bounds.north,
      layout.width, layout.height,
      layout.mapGroundFrame?.lng0, layout.mapGroundFrame?.lat0,
      layout.mapGroundFrame?.latMid, layout.mapGroundFrame?.scale,
      layout.sceneAnchor?.lng, layout.sceneAnchor?.lat,
      layout.sceneAnchor?.orientationDeg, layout.sceneAnchor?.metersPerUnit,
      view.view2D,
    ].join('|')
    : '';
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    const fallback = buildResearchBasemap(THREE, scene, layout, { onTextureLoaded: invalidate });
    if (fallback) fallback.visible = showBasemapRef.current;
    // 候选坐标十字核对：?geocross=lng,lat,名字;lng,lat,名字（肉眼读图不可靠，用十字压点核对投影）
    const crosses = parseGeoCrossParam(window.location.search);
    if (crosses.length > 0) buildGeoCrosses(THREE, scene, layout, crosses);
    return () => {
      clearResearchBasemap(scene);
      clearGeoCrosses(scene);
    };
    // researchKey 已经盖住底图与定位要看的全部字段；layout 只是当期的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, threeModuleRef, sceneRef, researchKey]);

  // Separate from the shell: v2 walls/floors never depend on image visibility.
  const referenceImageKey = referenceImage
    ? JSON.stringify([referenceImage.url, referenceImage.pixelWidth, referenceImage.pixelHeight, ...referenceImage.imageToWorld]) : '';
  const referenceScene = isReady ? sceneRef.current : null;
  useEffect(() => {
    if (!isReady || !referenceImage || view.showReferenceImage === false ||
        (activeFloorIndex !== 0 && !view.showAllFloors)) return;
    const THREE = threeModuleRef.current;
    const scene = referenceScene;
    if (!THREE || !scene) return;
    return mountReferenceImage(THREE, scene, referenceImage, layout.width, layout.height,
      view.referenceImageOpacity ?? layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY, invalidate,
      () => sceneRef.current === scene && threeModuleRef.current === THREE);
    // The value signature covers every image field; equivalent resolver results
    // during furniture edits must not re-decode or re-upload the same texture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, referenceImageKey, referenceScene, layout.id, layout.width, layout.height, layout.floorPlanOpacity,
    view.showReferenceImage, view.referenceImageOpacity, view.showAllFloors, activeFloorIndex,
    threeModuleRef, sceneRef, invalidate]);

  // Cutaway on orbit
  useEffect(() => {
    invalidate();
    if (!isReady) return undefined;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return undefined;

    // Mark dirty instead of rendering here — the change listener fires every
    // interaction frame, and the RAF loop renders that same frame anyway, so a
    // direct render would draw the full scene twice per frame while orbiting.
    const apply = () => {
      const changed = applyWallDisplay(scene, camera.position.x, camera.position.z, view.wallDisplay, layout.width, layout.height);
      // 滚轮 dolly 不会走 preset/fit，也就不会刷新远裁剪面：距离超过取景基线 far 后
      // 底图和场景会被整幅裁掉。这里按「相机到焦点距离 × 2.5」动态抬高 far，
      // 回到近处时再收回到取景基线，避免白白损失深度精度。
      const distance = camera.position.distanceTo(controls.target);
      const baseFar = typeof camera.userData.baseFar === 'number' ? camera.userData.baseFar : camera.far;
      const neededFar = Math.max(baseFar, distance * 2.5);
      if (Math.abs(neededFar - camera.far) > 1e-3) {
        camera.far = neededFar;
        camera.updateProjectionMatrix();
      }
      // Walls cast shadows (#132) and the shadow map is static: refresh it
      // when a cutaway flip actually hid/showed a wall — which happens only
      // when the camera crosses a wall plane, not on every orbit frame.
      if (changed) requestShadowUpdate();
      invalidate();
    };
    apply();
    controls.addEventListener('change', apply);
    return () => controls.removeEventListener('change', apply);
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, view.wallDisplay, layout.width, layout.height]);

  // Furniture meshes
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.Furniture);

    const floorsToRender = view.showAllFloors
      ? layout.floors.map((floor, index) => ({ floor, index }))
      : [{ floor: activeFloor, index: activeFloorIndex }];

    for (const { floor, index } of floorsToRender) {
      const isActive = index === activeFloorIndex;
      const floorY = floorElevation(layout.floors, index);

      for (const item of floor.items) {
        if (!item.position) continue;

        const collision = structuralItemCollides(item, layout, index) || hasCollisions(item, floor.items, layout.width, layout.height, { keepOut: floorKeepOut(entranceBuilding, index), structureValidated: !!layout.backendSceneV2, interiorWalls: layout.backendSceneV2 ? [] : floor.interiorWalls });
        // Stairs climb to the floor above and openings are fitted into the
        // storey, so the mesh matches the hole cut for it (#202, #277).
        const group = createFurnitureModel(THREE, item.structuralOpeningId ? item : itemForStorey(item, floor), collision);
        group.position.set(item.position.x, floorY, item.position.z);
        group.rotation.y = item.rotation ?? 0;
        if (item.mirrored) group.scale.x *= -1;
        group.userData.type = ROOM_OBJECT_TAGS.Furniture;
        group.userData.id = item.id;
        group.userData.floorIndex = index;
        group.userData.locked = item.locked === true || !isActive;
        // Inactive-floor groups are excluded from pointer raycasts entirely
        // (see drag-handlers' furnitureList, #122).
        group.userData.ghostFloor = !isActive;

        if (otherFloorGhostOpacity(view.showAllFloors, view.wallDisplay, isActive) !== undefined) {
          ghostifyGroup(group);
        }

        scene.add(group);
      }
    }

    // The furniture set just changed — bump the revision so the drag/hover
    // raycast pre-filter cache rebuilds its list, and recompute the static
    // shadow map now that shadow casters were added/removed/moved.
    scene.userData[FURNITURE_REVISION_KEY] =
      ((scene.userData[FURNITURE_REVISION_KEY] as number | undefined) ?? 0) + 1;
    requestShadowUpdate();
  }, [
    isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef,
    layout, layout.floors, layout.width, layout.height, entranceBuilding,
    activeFloor, activeFloorIndex, view.showAllFloors, view.wallDisplay,
    // Not read in the body: createFurnitureModel picks the rigged person up
    // from the model cache, and this re-runs the build once it's filled.
    peopleModelReady, glbAssetsRevision,
  ]);

  // 行走上下文（PEOPLE-04）：本层有带路线的人物时，把碰撞盒与可走边界交给
  // three/people-anim 的注册表。坐标与场景一致（房间中心为原点）；真实景
  // （点云就绪）时边界换成点云实测四至，与第一人称漫游共用同一条围栏。
  useEffect(() => {
    const routed = activeFloor.items.some((item) => item.walkRoute && item.walkRoute.points.length >= 2);
    if (!routed) {
      setPersonWalkContext(null);
      return;
    }
    setPersonWalkContext({
      colliders: buildWalkColliders(activeFloor.items, activeFloor.interiorWalls ?? [], {
        roomWidth: layout.width,
        roomDepth: layout.height,
      }),
      bounds: personWalkBounds(personRouteBounds, { width: layout.width, depth: layout.height }),
    });
    return () => setPersonWalkContext(null);
  }, [activeFloor, activeFloor.interiorWalls, layout.width, layout.height, personRouteBounds]);

  // 行走中的人物是动态投影体：把静态阴影图的重算入口递给注册表（与 use-npcs 同款）。
  useEffect(() => {
    setPeopleShadowRefresher(requestShadowUpdate);
    return () => setPeopleShadowRefresher(null);
  }, [requestShadowUpdate]);

  // 路线可视化（PEOPLE-04）：折线（闭环含收尾段）+ 路点圆片，纯装饰、不参与拾取。
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.PersonRoute);
    const routed = activeFloor.items.filter((item) => item.walkRoute && item.walkRoute.points.length >= 2);
    if (routed.length === 0) return;

    const floorY = floorElevation(layout.floors, activeFloorIndex);
    const material = new THREE.MeshBasicMaterial({ color: 0x0f766e, transparent: true, opacity: 0.85 });
    const markerGeometry = new THREE.CircleGeometry(0.11, 20);
    for (const item of routed) {
      const route = item.walkRoute!;
      const pts = routeIsLoop(route) ? [...route.points, route.points[0]!] : route.points;
      const geometry = new THREE.BufferGeometry().setFromPoints(
        pts.map((p) => new THREE.Vector3(p.x, floorY + 0.02, p.z))
      );
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x0f766e, transparent: true, opacity: 0.9 }));
      line.raycast = () => {};
      line.userData.type = ROOM_OBJECT_TAGS.PersonRoute;
      scene.add(line);
      for (const point of route.points) {
        const marker = new THREE.Mesh(markerGeometry, material);
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(point.x, floorY + 0.012, point.z);
        marker.raycast = () => {};
        marker.userData.type = ROOM_OBJECT_TAGS.PersonRoute;
        scene.add(marker);
      }
    }
    return () => {
      removeTagged(scene, ROOM_OBJECT_TAGS.PersonRoute);
    };
  }, [isReady, invalidate, threeModuleRef, sceneRef, activeFloor, activeFloorIndex, layout.floors]);

  // Selection / highlight outlines. Kept out of the furniture effect above so
  // a selection click only swaps the outline LineSegments instead of
  // destroying and rebuilding every furniture mesh on the floor.
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    for (const group of scene.children) {
      if (group.userData.type !== ROOM_OBJECT_TAGS.Furniture) continue;
      for (const child of [...group.children]) {
        if (child.userData.type === 'selection-outline') {
          group.remove(child);
          disposeObject(child);
        }
      }
    }

    const outlineIds = new Set<string>([...extraSelectedIds, ...highlightedIds]);
    if (selectedItemId) outlineIds.add(selectedItemId);
    if (outlineIds.size === 0) return;

    const itemsById = new Map(activeFloor.items.map((item) => [item.id, item]));
    const keepOut = floorKeepOut(entranceBuilding, activeFloorIndex);
    for (const group of scene.children) {
      if (group.userData.type !== ROOM_OBJECT_TAGS.Furniture) continue;
      if (group.userData.floorIndex !== activeFloorIndex) continue;
      const id = group.userData.id as string;
      if (!outlineIds.has(id)) continue;
      const item = itemsById.get(id);
      if (!item) continue;

      const isSelected = selectedItemId === id || extraSelectedIds.has(id);
      const collision = structuralItemCollides(item, layout, activeFloorIndex) || hasCollisions(item, activeFloor.items, layout.width, layout.height, { keepOut, structureValidated: !!layout.backendSceneV2, interiorWalls: layout.backendSceneV2 ? [] : activeFloor.interiorWalls });
      // 与 2D 平面图的选中描边同色：主选 #2f7a4f、附加选中 #4a7c59、碰撞 #c0392b。
      const accent = isSelected
        ? selectedItemId === id
          ? collision
            ? 0xc0392b
            : 0x2f7a4f
          : 0x4a7c59
        : 0xfacc15;
      // Around the built mesh, not floor-to-height: a painting hangs at 0.8 m
      // and a window starts at its sill (#376).
      const band = mountBand(item.structuralOpeningId ? item : itemForStorey(item, activeFloor));
      const edges = footprintEdges(THREE, item, item.width, band.top - band.bottom, item.depth);
      const outline = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: accent, linewidth: 2 })
      );
      // Item dimensions are metres; a cached GLB root already carries its normalization scale.
      // Cancel that scale for this decoration while inheriting placement and rotation.
      outline.scale.set(1 / group.scale.x, 1 / group.scale.y, 1 / group.scale.z);
      outline.position.y = (band.bottom + band.top) / (2 * group.scale.y);
      outline.userData.type = 'selection-outline';
      // Decoration, not a pointer target: the furniture raycast is recursive
      // and a line's pick threshold would give the item a hit halo (#333).
      outline.raycast = () => {};
      group.add(outline);
    }
    // The furniture effect above destroys the outline children whenever it
    // rebuilds the groups, so this effect also carries every one of its keys
    // that it doesn't read itself — otherwise a selected item loses its
    // outline after a Show-All-Floors or wall-display toggle, or once the
    // rigged person model loads (#335).
  }, [
    isReady, invalidate, threeModuleRef, sceneRef,
    activeFloor, activeFloorIndex, layout, layout.width, layout.height, entranceBuilding,
    selectedItemId, extraSelectedIds, highlightedIds,
    layout.floors, view.showAllFloors, view.wallDisplay, peopleModelReady, glbAssetsRevision,
  ]);

  // Wi-Fi rings + camera vision cones. Independently tagged overlays, so
  // toggling them (or editing items) never touches the furniture meshes.
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.Signal, ROOM_OBJECT_TAGS.CameraVision);
    if (!view.showWiFiSignals && !view.showCameraVision) return;

    const floorsToRender = view.showAllFloors
      ? layout.floors.map((floor, index) => ({ floor, index }))
      : [{ floor: activeFloor, index: activeFloorIndex }];

    for (const { floor, index } of floorsToRender) {
      const floorY = floorElevation(layout.floors, index);
      if (view.showWiFiSignals) {
        addSignalOverlays(THREE, scene, floor.items, floorY);
      }
      if (view.showCameraVision) {
        addVisionCones(THREE, scene, floor.items, floorY, index, storeyHeight(floor));
      }
    }
  }, [
    isReady, invalidate, threeModuleRef, sceneRef,
    layout.floors, activeFloor, activeFloorIndex,
    view.showWiFiSignals, view.showCameraVision, view.showAllFloors,
  ]);

  // Lighting
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    const lampPositions = layout.floors.flatMap((floor, index) =>
      floor.items
        .filter((item) => (item.type === 'lamp' || item.type === 'floor-lamp') && item.position)
        .map((item) => ({
          x: item.position!.x,
          z: item.position!.z,
          // The 0.9 bulb factor belongs to the lamp's own height only —
          // applied after the floor offset it sank upper-floor glows 0.3 m
          // per storey, lighting the floor below (#146).
          height: item.height * 0.9 + floorElevation(layout.floors, index),
        }))
    );

    // The weather overcasts the same profile and tints the lot's ground (#189).
    applyTimeOfDay(THREE, scene, view.timeOfDay, lampPositions, view.weather);
    // The sun's angle/position changed, so the (static) shadow map must be
    // recomputed or shadows would stay frozen at the previous time of day.
    requestShadowUpdate();
    // layout.floors is read for lamp positions only; lampsKey covers exactly
    // that, so a non-lamp item edit doesn't rebuild the sky and lights.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, view.timeOfDay, view.weather, lampsKey, storeyHeightsKey]);

  // Outdoor
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    setOutdoorVisible(THREE, scene, view.showOutdoor, layout.width, layout.height, {
      ...(layout.terrain ? { terrain: layout.terrain } : {}),
      ...(layout.neighbours ? { neighbours: layout.neighbours } : {}),
      ...(layout.frontage ? { frontage: layout.frontage } : {}),
    });
    // Trees/shrubs are shadow casters; the shadow map is static (autoUpdate off)
    // so it must be told the caster set changed.
    requestShadowUpdate();
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, view.showOutdoor, layout.width, layout.height, layout.terrain, layout.neighbours, layout.frontage]);

  // The street of neighbours (#202, #310). Never touched by applyWallDisplay,
  // so they stay put in every wall-display mode (#201). Keyed on exactly what
  // the generator reads — the neighbour flags and seed, the roof's style and
  // colour, the two ground heights, the road line — not on the whole
  // `layout.roof` / `layout.terrain` objects, so a dormer drag or a colour
  // picker tick doesn't rebuild the street (#283).
  const neighboursKey = JSON.stringify(layout.neighbours ?? null);
  const roofStyle = layout.roof?.style;
  const roofColor = layout.roof?.color;
  const terrainFrontY = layout.terrain?.frontY;
  const terrainBackY = layout.terrain?.backY;
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (!hasNeighbours(layout.neighbours)) {
      removeNeighbours(scene);
    } else {
      const houses = generateStreet({
        width: layout.width,
        depth: layout.height,
        floorYs: layout.floors.map((_floor, index) => floorElevation(layout.floors, index)),
        eavesY: buildingHeight(layout.floors),
        ...(roofStyle ? { roof: { style: roofStyle, ...(roofColor ? { color: roofColor } : {}) } } : {}),
        ...(terrainFrontY !== undefined && terrainBackY !== undefined
          ? { terrain: { frontY: terrainFrontY, backY: terrainBackY } }
          : {}),
        ...(layout.frontage ? { frontage: layout.frontage } : {}),
        ...(layout.neighbours ? { neighbours: layout.neighbours } : {}),
      });
      buildNeighbours(THREE, scene, houses);
    }
    requestShadowUpdate();
    // layout.floors is read for storey heights only (storeyHeightsKey +
    // floor count), and layout.neighbours / roof / terrain through the
    // narrow keys above, so an item edit doesn't rebuild the neighbours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, layout.width, layout.height, layout.floors.length, storeyHeightsKey, neighboursKey, roofStyle, roofColor, terrainFrontY, terrainBackY, layout.frontage]);

  // Interior walls
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    clearInteriorWalls(scene);
    if (layout.backendSceneV2) return;
    const floorsToRender = view.showAllFloors
      ? layout.floors.map((floor, index) => ({ floor, index }))
      : [{ floor: activeFloor, index: activeFloorIndex }];

    // The porch back wall is an ordinary partition, but partitions stop 0.4 m
    // short of the ceiling while the porch soffit sits at `topY`: on any
    // storey under 2.8 m that left an open slot from the street into the
    // house (#275). It gets its own height — at least the soffit, never
    // above its storey (the reducer keeps the recess on the street storey).
    const entrance = layout.entrance
      ? entranceGeometry(layout.entrance, {
          width: layout.width,
          depth: layout.height,
          floors: layout.floors,
          ...(layout.terrain ? { terrain: layout.terrain } : {}),
        })
      : null;

    for (const { floor, index } of floorsToRender) {
      const walls = floor.interiorWalls ?? [];
      if (walls.length === 0) continue;
      const isActive = index === activeFloorIndex;
      const floorY = floorElevation(layout.floors, index);
      const wallHeight = interiorWallHeight(floor);
      const wallHeights =
        entrance && index === entrance.floorIndex
          ? new Map([[
              ENTRANCE_WALL_ID,
              Math.min(storeyHeight(floor) - 0.01, Math.max(wallHeight, entrance.topY - floorY)),
            ]])
          : undefined;
      renderInteriorWalls(
        THREE, scene, walls,
        floorY,
        otherFloorGhostOpacity(view.showAllFloors, view.wallDisplay, isActive),
        {
          openingCandidates: floor.items,
          roomWidth: layout.width,
          roomDepth: layout.height,
          wallHeight,
          ...(wallHeights ? { wallHeights } : {}),
          storeyHeight: storeyHeight(floor),
        }
      );
    }
    // Interior walls cast shadows — recompute the static shadow map after any
    // add/remove/re-extrude so their cast shadows don't go stale.
    requestShadowUpdate();
    // layout.floors/activeFloor are read for the wall segments and the
    // door/window opening candidates only; the two keys cover exactly that,
    // so a furniture edit doesn't re-extrude every interior wall.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, layout.backendSceneV2, interiorWallsKey, wallOpeningsKey, storeyHeightsKey, activeFloorIndex, view.showAllFloors, view.wallDisplay, layout.width, layout.height, layout.entrance, layout.terrain]);

  // Cyan outline on selected wall. Declared AFTER the shell + interior-wall
  // rebuild effects and keyed on the same rebuild keys, so it always snapshots
  // the CURRENT wall mesh. If it ran before the rebuilds (or without those
  // keys) a hidden/moved/re-extruded wall would leave a stale floating outline.
  useEffect(() => {
    invalidate();
    if (!isReady) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;

    for (const child of [...scene.children]) {
      if (child.userData.type === 'wall-selection') removeAndDispose(scene, child);
    }
    if (!selectedWall) return undefined;

    const tag = selectedWall.kind === 'interior' ? 'interior-wall' : 'wall';
    const wallMesh = scene.children.find(
      (obj) => obj.userData.type === tag && obj.userData.wallId === selectedWall.id
    ) as ThreeNS.Mesh | undefined;
    if (!wallMesh) return undefined;

    const edges = new THREE.EdgesGeometry(wallMesh.geometry);
    const material = new THREE.LineBasicMaterial({
      // 选中墙沿用 2D 的选中绿，不再用独立的青色，保证 2D/3D 同一套选中语言。
      color: 0x2f7a4f,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const outline = new THREE.LineSegments(edges, material);
    outline.position.copy(wallMesh.position);
    outline.rotation.copy(wallMesh.rotation);
    outline.scale.copy(wallMesh.scale);
    outline.renderOrder = 999;
    outline.userData.type = 'wall-selection';
    // Owner reference + initial visibility: applyWallDisplay keeps the
    // outline in lockstep with its wall on every orbit, and a wall already
    // hidden by cutaway must not spawn a visible ghost outline (#133).
    outline.userData.ownerTag = tag;
    outline.userData.wallId = selectedWall.id;
    outline.visible = wallMesh.visible;
    scene.add(outline);
    invalidate();

    return () => {
      scene.remove(outline);
      edges.dispose();
      material.dispose();
    };
    // Keyed on the shell + interior-wall rebuild keys (not layout.floors
    // identity) so the outline re-snapshots the fresh mesh after any wall
    // rebuild, hide, or move — without rebuilding on unrelated furniture edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, threeModuleRef, sceneRef, rendererRef, cameraRef,
    selectedWall, activeFloorIndex,
    shellFinishesKey, wallOpeningsKey, interiorWallsKey, storeyHeightsKey,
    layout.width, layout.height, view.showAllFloors, view.wallDisplay,
  ]);

  // Measurement markers
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (!view.measurementMode || measurementPoints.length === 0) {
      clearMeasurement(scene);
      return;
    }
    renderMeasurement(THREE, scene, measurementPoints, activeFloorY);
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.measurementMode, measurementPoints, activeFloorY]);

  // Room dimension labels — 与 2D 的 showMeasurements 同步开关
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (!view.showMeasurements) {
      clearRoomDimensions(scene);
      return;
    }
    renderRoomDimensions(THREE, scene, layout.width, layout.height, activeFloorY);
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.showMeasurements, layout.width, layout.height, activeFloorY]);

  // Item labels
  // 物件多时标签降级成圆点，只有选中/高亮的那几件继续显示名字。
  const emphasizedItemIds = useMemo(() => {
    if (!selectedItemId && extraSelectedIds.size === 0 && highlightedIds.size === 0) return null;
    const ids = new Set<string>(extraSelectedIds);
    if (selectedItemId) ids.add(selectedItemId);
    for (const id of highlightedIds) ids.add(id);
    return ids;
  }, [selectedItemId, extraSelectedIds, highlightedIds]);

  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (!view.showItemLabels) {
      clearItemLabels(scene);
      return;
    }
    renderItemLabels(THREE, scene, activeFloor.items, activeFloorY, { emphasis: emphasizedItemIds });
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.showItemLabels, activeFloor.items, activeFloorY, emphasizedItemIds]);

  // Roof
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    const topFloorIndex = layout.floors.length - 1;
    const showRoof =
      layout.roof &&
      layout.roof.style !== 'none' &&
      (view.showAllFloors || activeFloorIndex === topFloorIndex);

    if (!showRoof || !layout.roof) {
      removeRoof(scene);
      // The roof is a shadow caster; the static shadow map must be refreshed
      // whether the roof was just built or removed.
      requestShadowUpdate();
      return;
    }

    buildRoof(THREE, {
      scene,
      width: layout.width,
      depth: layout.height,
      baseY: buildingHeight(layout.floors),
      spec: layout.roof,
    });
    // buildRoof adds meshes visible; only applyWallDisplay hides the roof in
    // cutaway/walls-down mode, and it otherwise runs on orbit — so a roof
    // rebuilt while the walls are open would pop in until the camera moves (#119).
    const camera = cameraRef.current;
    if (camera) {
      applyWallDisplay(scene, camera.position.x, camera.position.z, view.wallDisplay, layout.width, layout.height);
    }
    requestShadowUpdate();
    // layout.floors is read for the eaves height only (floor count + storey
    // heights); keying on its identity would rebuild the roof on every item edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, cameraRef, layout.roof, layout.width, layout.height, layout.floors.length, storeyHeightsKey, activeFloorIndex, view.showAllFloors, view.wallDisplay]);

  // 2D top-down view. The backing store is sized to the container's
  // clientWidth/clientHeight × devicePixelRatio (via a ResizeObserver) so the
  // aspect ratio matches the on-screen element (circles stay circular) and the
  // render is crisp on retina; a resize re-paints. The floor-plan repaint
  // handler lets an async image decode trigger a full repaint in the correct
  // layer order.
  useEffect(() => {
    invalidate();
    if (!view.view2D) return undefined;
    const canvas = canvas2DRef.current;
    if (!canvas) return undefined;

    const keepOut = floorKeepOut(entranceBuilding, activeFloorIndex);
    const paint = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const backingWidth = Math.round(width * dpr);
      const backingHeight = Math.round(height * dpr);
      // Only resize the backing store when it actually changes — assigning
      // canvas.width/height clears the canvas even when the value is unchanged.
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;

      render2DTopDown({
        canvas,
        layout,
        floor: activeFloor,
        selectedItemId,
        extraSelectedIds,
        showMeasurements: view.showMeasurements,
        showWiFiSignals: view.showWiFiSignals,
        showHeatmap: view.showHeatmap,
        ...(referenceImage ? { referenceImage } : {}),
        showFloorPlan: view.showReferenceImage !== false,
        ...(view.referenceImageOpacity !== undefined ? { floorPlanOpacity: view.referenceImageOpacity } : {}),
        hasCollision: (item) => structuralItemCollides(item, layout, activeFloorIndex) || hasCollisions(item, activeFloor.items, layout.width, layout.height, { keepOut, structureValidated: !!layout.backendSceneV2, interiorWalls: layout.backendSceneV2 ? [] : activeFloor.interiorWalls }),
        // 行走人物（PEOPLE-04）：2D 标记吃注册表的实时位置（personFollowSample，
        // 由 3D tick 每帧推进——2D 模式下 tick 也照跑），路线画虚线折线。
        personSample: personFollowSample,
      });
    };

    const removeRepaintHandler = addFloorPlanRepaintHandler(paint);
    paint();

    // 行走人物在 2D 平面图上的实时位置：没有 per-frame 重绘链路，用 250ms
    // 低频重绘消费注册表（与 autoCycleLighting 的 250ms 心跳同款节拍）。
    // 动画人物清零（纯座位图布局）时不挂表，行为与开销都和从前一致。
    // 注册表生命周期事件（加/删路线人物、暂停切换）都伴随 layout 变化，
    // 会重跑本 effect 重新决定是否挂表，无需单独订阅。
    const walkTimer = personAnimIds().length > 0 ? window.setInterval(paint, 250) : null;

    const observer = new ResizeObserver(paint);
    observer.observe(canvas);

    // The ResizeObserver watches the content box, which doesn't change when
    // only devicePixelRatio does (window dragged between 1× and 2× monitors),
    // leaving a stale backing store (#226). A matchMedia query on the current
    // ratio fires exactly when the ratio leaves it; each fire repaints and
    // re-arms a fresh query for the new ratio.
    let dprQuery: MediaQueryList | null = null;
    const onDprChange = () => {
      paint();
      armDprListener();
    };
    const armDprListener = () => {
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener('change', onDprChange);
    };
    armDprListener();

    return () => {
      dprQuery?.removeEventListener('change', onDprChange);
      observer.disconnect();
      removeRepaintHandler();
      if (walkTimer !== null) window.clearInterval(walkTimer);
    };
  }, [invalidate, canvas2DRef, view.view2D, view.showMeasurements, view.showWiFiSignals, view.showHeatmap,
    view.showReferenceImage, view.referenceImageOpacity, referenceImage, layout, activeFloor, activeFloorIndex,
    entranceBuilding, selectedItemId, extraSelectedIds]);
}

export { measurementDistance } from '../three/measurement';
