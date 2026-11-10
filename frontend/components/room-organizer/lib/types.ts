import type { Handoff } from '../../../../supabase/functions/_shared/delivery-contract';
import type { Scene, SceneObject } from '../../../../supabase/functions/_shared/domain';
import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { Provenance } from '../../../lib/rng';
import type { ZoneSemanticType } from '../../../lib/plan-annotation';

export type Vec2 = Readonly<{ x: number; z: number }>;

export type FurnitureType =
  | 'backdrop'
  | 'partition'
  | 'glb-asset'
  | 'chair'
  | 'armchair'
  | 'dining-chair'
  | 'bench'
  | 'sofa'
  | 'table'
  | 'dining-table'
  | 'coffee-table'
  | 'side-table'
  | 'bed'
  | 'desk'
  | 'bookshelf'
  | 'wardrobe'
  | 'dresser'
  | 'cabinet'
  | 'wall-shelf'
  | 'lamp'
  | 'floor-lamp'
  | 'lamppost'
  | 'pendant-light'
  | 'plant'
  | 'tree'
  | 'pine-tree'
  | 'bush'
  | 'hedge'
  | 'rose-bush'
  | 'flowerpot'
  | 'flowerbed'
  | 'tulips'
  | 'sunflower'
  | 'tv'
  | 'computer'
  | 'nightstand'
  | 'wifi'
  | 'router'
  // Legacy electronics variant — see the note on `cctv` in the catalog.
  | 'cctv'
  | 'security-camera'
  | 'fridge'
  | 'stove'
  | 'dishwasher'
  | 'kitchen-sink'
  | 'counter'
  | 'bbq'
  | 'toilet'
  | 'bathtub'
  | 'shower'
  | 'bathroom-sink'
  | 'rug'
  | 'painting'
  | 'vase'
  | 'mirror'
  | 'books'
  | 'candles'
  | 'curtains'
  | 'wall-clock'
  | 'fence'
  | 'pool'
  | 'pond'
  | 'birdbath'
  | 'garden-bench'
  | 'picnic-table'
  | 'stepping-stone'
  | 'mailbox'
  | 'person'
  | 'pet'
  | 'stairs'
  | 'door'
  | 'window'
  // Keeps the escape hatch so unknown/legacy strings from old saved layouts
  // still type-check, while the named members above document the full catalog.
  | (string & {});

export type SofaShape = 'standard' | 'L-shape' | 'U-shape';

/** Round banquet top versus a rectangular slab. Absent means rectangular. */
export type TableShape = 'round' | 'rect';

/** 'winder': a half-turn dog-leg with a fan of winders (#205). */
export type StairsShape = 'straight' | 'winder';

export type FloorPlanFitMode = 'stretch' | 'cover' | 'contain';

export type FurnitureCategory =
  | 'stage'
  | 'checkin'
  | 'booth'
  | 'seating'
  | 'tables'
  | 'av'
  | 'decor'
  | 'signage'
  | 'people'
  | 'catering'
  | 'rest'
  | 'logistics'
  | 'structure'
  | 'site'
  // Legacy home-library keys still load. Display rolls them into the groups above.
  | 'bedroom'
  | 'storage'
  | 'kitchen'
  | 'bathroom'
  | 'electronics'
  | 'security'
  | 'outdoor';

export interface CategoryMeta {
  key: FurnitureCategory;
  label: string;
  icon: string;
}

/** 人物可切换的动作（people.glb 的三个 clip；见 three/people-model.ts）。 */
export type PersonAction = 'idle' | 'talk' | 'walk';

/**
 * 人物沿米制平面行走的路线（PEOPLE-04）。路点是场景坐标（SW 原点，米），
 * 与 `item.position` 无关——行走时人物的可视位置由路线驱动，锚点保持不动。
 * `loop` 省缺为闭环巡游（末点走回首点）；显式 false 时走折返（到终点后原路返回）。
 */
export interface WalkRoute {
  /** 途经点，至少 2 个；点距过近（<0.15 m）的相邻点在引擎里合并。 */
  points: Vec2[];
  /** 省缺 true：末点接回首点成环。false：折返巡游。 */
  loop?: boolean;
  /** 步速 m/s，省缺 PERSON_WALK_SPEED（≈1.05，与 Walk_Loop 1.333s 周期的自然步幅同步）。 */
  speed?: number;
  /** 每个途经点的停留时长 ms，省缺 900；0 表示不停留。 */
  pauseMs?: number;
}

export interface FurnitureItem {
  /** Local execution record for this instance; not part of the cloud Scene. */
  handoff?: Handoff | undefined;
  structuralOpeningId?: string;
  structuralColumnId?: string;
  wallId?: string;
  elevation?: number;
  /** Backend identifiers survive the upstream save/load whitelist. */
  materialId?: SceneObject['materialId'];
  assetId?: string;
  notes?: string;
  source?: 'builtin' | 'public_library' | 'generated' | 'local_sample';
  /** A frontend loading reference; the backend scene stores assetId only. */
  glbUrl?: string;
  /** Named editable fixture within an archived scene model. */
  glbNode?: string;
  /**
   * 等比缩放：按标称高度算一个统一倍率，不做三轴独立拉伸。
   * 默认关（程序化家具照旧按轴对表）；带骨骼/动画的资产会自动启用，
   * 否则骨骼会被非均匀缩放扯变形。
   */
  uniformScale?: boolean;
  /** Rendered structural marker; never exported as a material object. */
  venueEntranceId?: string;
  id: string;
  type: FurnitureType | string;
  name: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  icon: string;
  /** Price in §, kept on the item so layouts persist their value even if the catalog changes. */
  price?: number;
  category?: FurnitureCategory;
  position?: Vec2;
  rotation?: number;
  isWiFiAccessPoint?: boolean;
  isCCTV?: boolean;
  signalRange?: number;
  /** When true, this item projects a Desperados-style directional vision cone. */
  hasVisionCone?: boolean;
  /** How far the vision cone reaches into the room, in metres. */
  visionRange?: number;
  /** Horizontal field of view of the vision cone, in degrees. */
  visionFov?: number;
  /** Id of the real-world CCTV model this camera mimics (see lib/cctv-models). */
  cctvModelId?: string;
  /**
   * Yaw (radians) of the inward normal of the wall a camera is mounted on — its
   * in/out axis. A flush camera's rotation is locked to this or this + π.
   */
  wallRotation?: number;
  /**
   * When true, a security camera sits on a stand-off bracket arm and can pan
   * left/right freely; otherwise it is flush-mounted and locked to facing
   * straight into the room or straight out.
   */
  cameraBracket?: boolean;
  sofaShape?: SofaShape;
  /**
   * Round banquet tables use a circular top whose diameter is the square
   * footprint (width === depth). Collision stays the axis-aligned box.
   */
  tableShape?: TableShape;
  /** Cloth chosen by the selection tool. Absent keeps the existing linen banquet top. */
  tableFinish?: 'linen' | 'bare';
  locked?: boolean;
  mirrored?: boolean;
  /** Straight flight (default) or half-turn winder (#205). */
  stairsShape?: StairsShape;
  /** Winder only: extra steps on the up flight, taken from the return flight. */
  stairsLeadIn?: number;
  /** Window sill above its floor, overriding the shared datum (#204). */
  sillHeight?: number;
  /**
   * Persistent group (#154): items sharing a groupId on a floor select and
   * move together. Absent on ungrouped items so saves and share links stay
   * unchanged for layouts that never used groups.
   */
  groupId?: string;
  /**
   * M6 溯源标记：谁、用哪个 opId / seed / recipeId 把这张家具放进来的。
   * 纯可选字段，缺省时与既有布局完全兼容；不进必填面。
   */
  provenance?: Provenance;
  /**
   * 人物（type 'person'）的默认动作；缺省 'idle'。带 `walkRoute` 时被路线驱动
   * 覆盖（走时 walk、停时 idle），本字段只在无路线时生效。
   */
  personAction?: PersonAction;
  /** 人物动画暂停：mixer 停在当前帧，恢复后从原地继续。 */
  personPaused?: boolean;
  /** 人物行走路线（PEOPLE-04）；存在时人物每帧沿路线移动（可视层，锚点不动）。 */
  walkRoute?: WalkRoute;
}

export type CameraPreset = 'iso' | 'top' | 'front' | 'corner';

export type CatalogItem = Omit<FurnitureItem, 'id' | 'position' | 'rotation' | 'price' | 'category' | 'handoff'> & {
  price: number;
  category: FurnitureCategory;
};

export type WallId = 'north' | 'south' | 'east' | 'west';

export type FloorPattern = 'solid' | 'wood' | 'tile' | 'carpet' | 'concrete';

export type WallPattern = 'solid' | 'brick' | 'wallpaper' | 'panel' | 'plaster' | 'siding';

export type RoofStyle = 'none' | 'flat' | 'gable' | 'hipped';

export type DormerOpeningKind = 'casement' | 'french' | 'sidelight';

/** An opening across part of a dormer face; `from`/`to` are fractions of its width. */
export interface DormerOpening {
  kind: DormerOpeningKind;
  from: number;
  to: number;
}

/** A dormer standing on one roof slope (#203); see lib/dormers.ts. */
export interface DormerSpec {
  id: string;
  /** The slope it stands on, named by the way it faces. */
  side: WallId;
  width: number;
  /** Centre along the ridge's world axis (x for north/south, z for east/west). */
  offset?: number;
  /** Face height; trimmed to clear the ridge. */
  height?: number;
  /** How far the face stands behind the wall line. */
  setback?: number;
  openings?: DormerOpening[];
  /** Shorthand for a single ribbon casement; `openings` wins when both are set. */
  window?: boolean;
  /** A Juliet rail across the French doors (or the whole face). */
  balcony?: boolean;
  /** Render finish of the face and cheeks. */
  color?: string;
}

export interface RoofSpec {
  style: RoofStyle;
  color?: string;
  /** Dormers; built on gable and hipped roofs, ignored on flat or none. */
  dormers?: DormerSpec[];
}

/**
 * One level of a building. Shares the building's footprint (width × depth)
 * but has its own items, finishes, and wall colors.
 */
export interface InteriorWall {
  thickness?: number;
  height?: number;
  kind?: 'exterior' | 'interior';
  status?: 'detected' | 'inferred' | 'confirmed';
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color?: string;
}

/**
 * A named, coloured rectangle of a floor — "Bedroom", "Kitchen" — that the
 * plan, the blueprint and the statistics panel measure and cost per room
 * (#155); see lib/zones.ts. `x`/`z` is the north-west corner in world metres
 * (room-centred, like item positions); `w`/`d` extend along +x / +z.
 */
export interface RoomZone {
  id: string;
  name: string;
  color: string;
  /** Missing on older zones: the intended use is unknown, not inferred from the name. */
  zoneType?: ZoneSemanticType;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface FloorLayout {
  id: string;
  name: string;
  items: FurnitureItem[];
  floorColor: string;
  floorPattern?: FloorPattern;
  wallPattern?: WallPattern;
  wallColors?: Partial<Record<WallId, string>>;
  hiddenWalls?: WallId[];
  interiorWalls?: InteriorWall[];
  /** Room zones drawn on this floor (#155). */
  zones?: RoomZone[];
  /**
   * Floor-to-floor height in metres (#202) — a 2.5 m basement, a 1.1 m loft
   * knee wall. Absent means the classic `FLOOR_HEIGHT_METERS` storey; each
   * floor's elevation is the sum of the storeys below it (lib/storeys.ts).
   */
  height?: number;
}

/** Ground heights in metres relative to the ground floor (#202); see lib/site.ts. */
export interface TerrainSpec {
  /** At the street (north / front). */
  frontY: number;
  /** At the garden (south / back). */
  backY: number;
}

export type NeighbourSide = 'west' | 'east';

export type Frontage = 'garden' | 'pavement';

/** A porch recessed into the front (north) wall, opening onto the storey at street level. */
export interface EntranceSpec {
  width: number;
  /** How far the recess reaches back into the house. */
  depth: number;
  /** Centre along the front wall (world x). */
  offset?: number;
  /** Porch floor to soffit; may span more than one storey. */
  height?: number;
  /**
   * `false` once the user has deleted the porch door: the reducer then
   * stops re-creating it when it re-fits the recess (#273). Cleared with
   * the entrance.
   */
  door?: false;
}

/** The boolean switches of a `NeighbourSpec`: the two party walls plus the street rows (#310). */
export type NeighbourFlag = NeighbourSide | 'street' | 'across';

/**
 * Party-wall neighbour blocks either side, for terraces and semis (#202),
 * and the rest of the street (#310): `street` continues the row along both
 * sides for as far as the scenery goes, `across` adds a facing row over the
 * road. Every house is drawn from `seed`, so the same design always shows
 * the same street; all fields are optional and absent means the old pair.
 */
export interface NeighbourSpec {
  west?: boolean;
  east?: boolean;
  street?: boolean;
  across?: boolean;
  /** Integer PRNG seed for the street's variation; see lib/street-row.ts. */
  seed?: number;
}

export type ScenePresetKey = 'gym' | 'popup' | 'bar' | 'cafe' | 'conference' | 'lawn' | 'market' | 'museum' | 'office' | 'studio';

/**
 * 场景锚点（docs/19）：场景世界坐标 ↔ 地理坐标的唯一变换参数。
 * lng/lat 是世界原点 (0, 0) 对应的地理坐标；
 * orientationDeg 是世界 -Z 轴（平面图「上」）相对正北的顺时针偏航角，0 表示正北朝上；
 * metersPerUnit 是 1 个世界单位对应的米数——正常为 1；壳体被等比缩小时为 1/scale。
 */
/** 锚点定位来源（MAP-05 核对锚点可信度用）：圈画 / 底图定位 / 地名回退 / 资产拍摄位 / 预置整景区。 */
export type SceneAnchorSource = 'picker' | 'manual' | 'lookup' | 'asset-geo' | 'preset';

export interface SceneAnchor {
  lng: number;
  lat: number;
  orientationDeg: number;
  metersPerUnit: number;
  /** 定位来源；缺省视为旧存档（来源不明），不参与坐标数学。 */
  source?: SceneAnchorSource;
  /** 定位不确定度（米）；未知就不写，不编数字。 */
  accuracyM?: number;
}

/**
 * A multi-floor building. `floors[0]` is the ground floor; subsequent
 * entries stack upward. Footprint and floor-plan upload live on the
 * building because they're shared across levels.
 */
export interface RoomLayout {
  /** Internal local production planning; excluded from public sharing. */
  productionPlan?: ProductionPlan | undefined;
  /** Local activity execution metadata, saved and restored with the layout. */
  eventOperations?: EventOperations | undefined;
  /** Local editor metadata; cloud scenes contain only the active design. */
  itemLayers?: { id: string; name: string; itemIds: string[] }[];
  designBook?: { activeId: string; variants: { id: string; name: string; layout: Omit<RoomLayout, 'designBook'> }[] };
  /** Authoritative v2 provenance and design, retained through local save and undo. */
  backendSceneV2?: Extract<Scene, { schemaVersion: 2 }>;
  /** Local complete-scene preset; its architecture is separate from editable items. */
  scenePreset?: ScenePresetKey;
  /**
   * 当前场地对应的实景扫描。只为「撤销一次回上一套场地」与刷新后认回同一场；
   * 本地编辑元数据，不进云端场景、不进分享。
   */
  venueScan?: { assetId: string; name: string };
  /** Preserves backend fields until explicitly edited through supported controls. */
  backendVenue?: Scene['venue'];
  backendCamera?: Scene['camera'];
  backendLighting?: Scene['lighting'];
  id?: string;
  name: string;
  width: number;
  height: number;
  floors: FloorLayout[];
  roof?: RoofSpec;
  floorPlanImage?: string;
  floorPlanOpacity?: number;
  floorPlanFitMode?: FloorPlanFitMode;
  /**
   * 卫星/高德贴地参考底图开关：仅观感辅助，与 RECON_MATERIAL_BAN 一致，
   * 不得进入 Aholo 上传/重建素材列表。
   * `true` 打开；`false` 是人关掉的（不再自动补图）；缺省则规划区 / 户外简报 / 地图壳默认打开。
   */
  satelliteGroundRef?: boolean;
  /**
   * 地图圈画的经纬度，只为再拉卫星参考底图。本地编辑元数据，不进场景线、不进 Aholo 上传。
   */
  mapGroundPolygon?: { lng: number; lat: number }[];
  /**
   * 地图场地中心经纬度。旧项目可能只有这一点、没有圈画点列。同样只用于卫星参考，不进上传。
   */
  mapLngLat?: { lng: number; lat: number };
  /**
   * 圈画经纬度换到壳体米制时用的原点与缩放。卫星 UV 靠它对齐，不进场景线、不进上传。
   * lng0 是西缘，lat0 是壳体 z=0 的纬度。latSign 为 -1 时 z 向南（北在平面图上沿）。
   */
  mapGroundFrame?: { lng0: number; lat0: number; latMid: number; scale: number; latSign?: -1 | 1 };
  /**
   * 场景锚点：场景坐标 ↔ 地理坐标的唯一变换（docs/19 架构定案）。
   * 地图是 3D 场景里的一个渲染层，没有自己的定位，只能跟着它走。
   * 底图与场景点位一律按它投影；mapGroundFrame 是由它派生的旧字段，仅为壳体卫星 UV 保留。
   */
  sceneAnchor?: SceneAnchor;
  /**
   * 调研底图：这一片区域的路网，尺度到公里。朝向与米制跟随 sceneAnchor，
   * 场地壳体立在它上面，两者共用同一套地理换算。
   * 只是参考底图，与卫星贴地同一条禁令：不可作重建素材。本地编辑元数据，不进场景线。
   */
  researchArea?: {
    name: string;
    address: string;
    center: { lng: number; lat: number };
    radiusM: number;
    bounds: { west: number; south: number; east: number; north: number };
    widthM: number;
    depthM: number;
    imageUrl: string;
    /** 高德瓦片样式：6 卫星、7 路网、8 路网加注记。 */
    style: 6 | 7 | 8;
    /** 这张底图跟着哪套场地扫描走（docs/19）；没有就是用户手动标的，自动逻辑不动它。 */
    scanAssetId?: string;
    /** 静态预置整景区底图；有它时 bounds 即图片精确范围，不再按半径重算。 */
    presetId?: 'xihu-scenic';
  };
  /** Sloped site; absent is flat ground at the ground-floor level. */
  terrain?: TerrainSpec;
  neighbours?: NeighbourSpec;
  /** A recessed porch in the front wall (#204); see lib/street.ts. */
  entrance?: EntranceSpec;
  /** 'pavement': the pavement runs right up to the front wall, no front garden. */
  frontage?: Frontage;
}

/** Default floor-to-floor height of a storey in metres; see `FloorLayout.height`. */
export const FLOOR_HEIGHT_METERS = 3;

/** Outdoor weather over the lot (#189). View-only: never part of a RoomLayout. */
export type Weather = 'clear' | 'rain' | 'snow';

export interface ViewSettings {
  view2D: boolean;
  showMeasurements: boolean;
  showWiFiSignals: boolean;
  snapToGrid: boolean;
  snapToWall: boolean;
  floorPlan3DEffect: boolean;
  /** Pure main-canvas presentation; never deletes an image or changes its correspondence. */
  showReferenceImage?: boolean;
  referenceImageOpacity?: number;
  /** 整景区底图上叠景区范围线/水面；未设 = 开。 */
  showResearchOverlays?: boolean;
  /** Hour of the day in [0, 24); drives the continuous sun-arc lighting. */
  timeOfDay: number;
  /** Rain or snow falling over the lot, with matching overcast lighting (#189). */
  weather: Weather;
  walkthroughMode: boolean;
  showOutdoor: boolean;
  snapToItems: boolean;
  showMinimap: boolean;
  /** When true, all floors are rendered together (lower floors translucent). */
  showAllFloors: boolean;
  /**
   * Build-mode wall rendering mode.
   *  - 'up'      → every wall and the roof fully visible (orbit around the outside)
   *  - 'cutaway' → walls between the camera and the room hide automatically; roof off
   *  - 'down'    → all exterior walls + interior walls + roof hidden (top-down planning)
   */
  wallDisplay: 'up' | 'cutaway' | 'down';
  /** When true, clicking on the floor drops measurement points. */
  measurementMode: boolean;
  /** When true, the UI plays short Web Audio cues on key actions. */
  soundsEnabled: boolean;
  /** When true, clicking pairs of floor points draws an interior wall. */
  drawWallMode: boolean;
  /** When true, dragging a rectangle on the 2D plan creates a room zone (#155). */
  drawZoneMode: boolean;
  /**
   * 选择工具是否启用（默认 true）。关掉后画布只浏览：相机照常移动，但点击不再
   * 选中/双击打开属性。选择钮第二次点击就是关它。
   */
  selectMode: boolean;
  /** When true, the 2D view overlays a price-density heatmap. */
  showHeatmap: boolean;
  /** When true, every placed item has a name label hovering above it in 3D. */
  showItemLabels: boolean;
  /** When true, animated NPCs wander the active floor. */
  showNpcs: boolean;
  /** When true, security cameras project an animated vision cone on the floor. */
  showCameraVision: boolean;
}

export type ThemeKey = 'modern' | 'rustic' | 'minimalist' | 'cozy' | 'tropical';

export type GameMode = 'live' | 'build' | 'buy';

export interface SavedLayoutEntry {
  id: string;
  name: string;
  savedAt: number;
  itemCount: number;
  floorCount: number;
}
