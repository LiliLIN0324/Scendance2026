import { findGeneratedFacilityModel } from './facility-generated-models';
import {
  isPackTemplateId,
  packEntryByTemplateId,
  parseLibraryTemplateId,
} from './oneplan-library';
import { iconModelSlugs, packagedIconModel, packModelSlugs } from './icon-model-links';
import { loadOnlineModels, loadShippedOnlineModels, type OnlineModel } from './online-models';
import { planPropKind, type PlanPropKind } from './plan-footprint-geometry';
import {
  SCENE_PRESETS,
  presetModelUrl,
  scenePresetKeyFromFacilityId,
} from './scene-presets';

/** 一个可用于 3D 落位的真实模型候选。 */
export interface FacilityModelCandidate {
  /** 物料库 slug（`assets/library/merged.json` 里的主键）。 */
  slug: string;
  /** 中文名（物料库里的 `name`）。 */
  name: string;
  /** 可直接给 GLTFLoader 用的地址（同源 `/showcase/...` 或 CDN）。 */
  glbUrl: string;
  /** 模型原始米制尺寸，用于按 2D 占地缩放。 */
  width: number;
  depth: number;
  height: number;
  /**
   * 游乐设施等「本身就是地标」的真比例模型：不吃 4m 高度上限。
   * 摩天轮 18m 高本来就是它该有的样子，高度压缩会把地标压成玩具。
   */
  trueScale?: boolean;
  /**
   * V-5a：物料库缩略图（CDN 绝对地址或仓库相对路径）——属性卡候选网格用。
   * 内置映射同步路径拿不到时缺省 undefined，UI 显示名称占位块不空崩。
   */
  thumb?: string;
}

/** 一个设施最多给出几个候选模型（V-5a：候选缩略图网格提到 5 格）。 */
export const MAX_FACILITY_MODEL_CANDIDATES = 5;
const MAX_CANDIDATES = MAX_FACILITY_MODEL_CANDIDATES;

/**
 * 场景预设落成设施时的模型候选：直接读打包好的整馆 GLB，不走在线物料库。
 *
 * 这里刻意不用 `catalogFacilityTemplateId(slug)` 的哈希短 id——`scene-preset:<key>`
 * 要同时承担「2D 识别场景预设」和「3D 找到 GLB」两件事，必须在两边都能反解。
 */
export function scenePresetFacilityCandidate(slug: string): FacilityModelCandidate | null {
  const key = scenePresetKeyFromFacilityId(slug);
  if (!key) return null;
  const preset = SCENE_PRESETS[key];
  return {
    slug,
    name: preset.name,
    glbUrl: presetModelUrl(key),
    width: preset.width,
    depth: preset.depth,
    height: preset.height,
    trueScale: true,
    thumb: `/scene-presets/${key}/preview.jpg`,
  };
}

/** 物料库模型的本地同源地址。 */
function localGlbUrl(slug: string): string {
  return `/showcase/assets/library/model/${slug}.glb`;
}

/**
 * 内置的稳定映射：人工核过的模型（尺寸取自 `assets/library/merged.json`）。
 * 只收「语义确定 + 尺寸合理」的模型，避免在线兜底时把舞台模型配给帐篷。
 */
interface BuiltinModel {
  name: string;
  width: number;
  depth: number;
  height: number;
  /** 游乐设施等真比例地标：fitFacilityModel 不再套 4m 高度上限。 */
  trueScale?: boolean;
}

const BUILTIN_MODELS: Readonly<Record<string, BuiltinModel>> = {
  // 帐篷 / 遮阳
  'mountaineering-and-summit-expedition-base-camp-dome-te-e93b01ea': { name: '大本营圆顶帐篷', width: 3.72, depth: 3.815, height: 1.579 },
  'wilderness-survival-camp-bivouac-hoop-shelter-1d5a0203': { name: '拱形露营庇护棚', width: 1.356, depth: 2, height: 1.063 },
  'greek-island-village-and-harbour-cafe-parasol-a99c4044': { name: '咖啡座遮阳伞', width: 2.8, depth: 2.8, height: 2.351 },
  // 舞台
  'live-music-venue-and-festival-stage-stage-deck-module-b23478f5': { name: '模块舞台地台', width: 2, depth: 1.00015, height: 1.025 },
  'village-hall-and-community-events-stage-platform-modul-208d60a2': { name: '社区会堂舞台模块', width: 2, depth: 2.04303, height: 0.60002 },
  'cruise-ship-deck-and-lounge-cruise-ship-deck-and-loung-73390ffd': { name: '甲板舞台与背景板', width: 6.06, depth: 4.57, height: 4.66 },
  // 摊位
  'harbor-and-tackle-fish-market-stall-d82006ea': { name: '鱼市摊位', width: 2.9, depth: 1.94894, height: 2.49283 },
  'trading-post-and-barter-market-canopy-market-booth-46c6c10f': { name: '遮棚展位', width: 2.6, depth: 2.1, height: 2.34 },
  'street-food-market-and-food-trucks-gazebo-stall-with-c-e8a7b705': { name: '凉亭式遮棚摊位', width: 3.2998, depth: 3.31233, height: 2.99431 },
  // 餐车 / 车辆
  'car-park-and-road-vehicle-fleet-box-truck-4574c765': { name: '卷帘门厢式货车', width: 2.652, depth: 7.542, height: 3.484 },
  'live-music-venue-and-festival-stage-generator-trailer-354a33e9': { name: '发电机拖车', width: 3.34, depth: 3.07987, height: 2.83997 },
  'long-haul-trucking-and-truck-stop-cabover-day-cab-2da6af6b': { name: '平头日间驾驶室牵引车', width: 3, depth: 4.81, height: 3.1 },
  // 值守 / 岗亭
  'travelling-circus-and-big-top-circus-ticket-booth-428cc272': { name: '马戏团售票亭', width: 2.3, depth: 2.16, height: 3.17 },
  'football-soccer-club-grounds-ticket-booth-e23acd9f': { name: '球场入口售票亭', width: 2.2, depth: 1.87507, height: 2.47007 },
  'car-park-and-road-vehicle-fleet-payment-kiosk-c5c914df': { name: '停车场缴费亭', width: 1.86, depth: 1.87997, height: 2.66004 },
  // 垃圾桶
  'dog-agility-and-training-field-field-litter-bin-eeefea95': { name: '户外垃圾桶', width: 0.504, depth: 0.487, height: 1.04 },
  'modern-rail-and-metro-network-waste-bin-57f44ea1': { name: '站台垃圾桶', width: 0.64, depth: 0.624, height: 1.44 },
  'live-music-venue-and-festival-stage-litter-bin-d65ec1dd': { name: '音乐节垃圾桶', width: 0.68, depth: 0.68, height: 1.02 },
  // 通用杂物
  'abandoned-puppet-theatre-and-prop-vault-property-stora-20930b33': { name: '道具储物箱', width: 0.89, depth: 0.601, height: 0.485 },
  'live-music-venue-and-festival-stage-power-distro-box-28b03233': { name: '电源配电箱', width: 0.66, depth: 0.425, height: 1.39 },
  'football-soccer-club-grounds-first-aid-cabinet-feff73ae': { name: '急救用品柜', width: 0.5, depth: 0.217, height: 0.6 },
  // 厕所 / 车辆 / 家具 / 交通设施
  'hot-air-balloon-festival-portable-toilet-block-82a4faf8': { name: '移动厕所（两格）', width: 2.38, depth: 1.32503, height: 2.43995 },
  'live-music-venue-and-festival-stage-portable-toilet-bl-309ed26a': { name: '移动厕所（三格）', width: 3.92, depth: 1.25009, height: 3.36005 },
  'bus-station-and-city-transit-city-bus-single-decker-ddf9a355': { name: '城市公交车', width: 2.58003, depth: 12.14006, height: 2.88993 },
  'long-haul-trucking-and-truck-stop-container-20ft-bc3beca3': { name: '20英尺集装箱', width: 2.56002, depth: 6.1595, height: 2.75022 },
  'car-park-and-road-vehicle-fleet-saloon-ad831b1f': { name: '四门轿车', width: 2, depth: 4.822, height: 1.403 },
  'car-park-and-road-vehicle-fleet-city-car-033e3215': { name: '城市小汽车', width: 1.828, depth: 3.592, height: 1.533 },
  'car-park-and-road-vehicle-fleet-sports-car-900de487': { name: '中置引擎跑车', width: 2.144, depth: 4.622, height: 1.33 },
  'car-park-and-road-vehicle-fleet-double-cab-pickup-cano-aa92dedb': { name: '带货斗罩双排皮卡', width: 2.077, depth: 5.392, height: 1.814 },
  'motorcycle-racing-and-street-bikes-road-sportbike-e1418015': { name: '公路运动摩托车', width: 0.76, depth: 2.135, height: 1.2 },
  'bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7': { name: '木质餐椅', width: 0.49, depth: 0.471, height: 1.003 },
  'office-lobby-and-facilities-canteen-stacking-chair-3440c7d8': { name: '可叠放座椅', width: 0.46002, depth: 0.5137, height: 0.88675 },
  'hot-air-balloon-festival-folding-camp-chair-ba5bb3d0': { name: '热气球营地折叠椅', width: 0.47504, depth: 0.49117, height: 0.91869 },
  'beach-surf-and-paddle-kit-folding-beach-chair-68794f97': { name: '沙滩折叠椅', width: 0.66, depth: 0.857, height: 0.911 },
  'bedroom-and-living-room-furniture-sofa-three-seat-6be9b44b': { name: '三人沙发', width: 2.5, depth: 0.92, height: 0.99 },
  'bedroom-and-living-room-furniture-sofa-two-seat-904fa140': { name: '双人沙发', width: 1.9, depth: 0.92, height: 0.99 },
  'hotel-and-resort-operations-lobby-sofa-79174bf1': { name: '酒店大堂沙发', width: 2.247, depth: 0.88, height: 0.857 },
  'public-aquarium-and-marine-centre-visitor-bench-teal-d3402427': { name: '青绿色游客长椅', width: 1.7, depth: 0.49999, height: 0.46499 },
  'football-soccer-club-grounds-changing-bench-912e20bc': { name: '无靠背更衣长凳', width: 2, depth: 0.44996, height: 0.48496 },
  'medieval-monastery-and-scriptorium-trestle-table-2a0801e0': { name: '木制支架长桌', width: 1.9, depth: 0.82, height: 0.862 },
  'hotel-and-resort-operations-conference-table-module-a6abb373': { name: '模块会议桌', width: 1.6, depth: 0.89993, height: 0.74202 },
  'art-gallery-and-exhibition-rooms-cafe-table-and-chairs-a767551a': { name: '绿色咖啡桌椅套装', width: 0.8, depth: 1.81, height: 0.9 },
  'casino-floor-and-back-rooms-cocktail-table-329ca6f8': { name: '鸡尾酒高脚桌', width: 0.72, depth: 0.709, height: 0.59 },
  'hot-air-balloon-festival-traffic-cone-799bc862': { name: '活动交通锥', width: 0.36003, depth: 0.36003, height: 0.765 },
  'car-park-and-road-vehicle-fleet-bollard-e7119d33': { name: '钢制防撞柱', width: 0.34, depth: 0.34, height: 1 },
  'bus-station-and-city-transit-street-bollard-7db606aa': { name: '街道隔离桩', width: 0.32, depth: 0.304, height: 0.97 },
  'cinema-multiplex-and-foyer-cinema-screen-and-masking-92b7d56f': { name: '影院银幕与遮幅框', width: 6.54, depth: 0.86, height: 3.3 },
  'abandoned-cinema-and-projection-booth-abandoned-cinema-765a1a5b': { name: '投影幕布', width: 6, depth: 0.55, height: 3.71 },
  'university-lecture-hall-and-campus-projection-screen-f41396d5': { name: '讲堂投影幕布', width: 3.57, depth: 0.15994, height: 2.14986 },
  'hot-air-balloon-festival-pa-speaker-on-stand-43f5125f': { name: '活动三脚架音箱', width: 0.75993, depth: 0.86206, height: 1.945 },
  'village-hall-and-community-events-pa-speaker-on-stand-7ffa787e': { name: '三脚架舞台音箱', width: 0.72424, depth: 0.69289, height: 1.80865 },
  'live-music-venue-and-festival-stage-line-array-speaker-7500d812': { name: '线阵列音箱', width: 1.05, depth: 0.44994, height: 0.43498 },
  'bus-station-and-city-transit-bus-stop-pole-with-flag-3071e762': { name: '公交站旗式站牌', width: 0.87, depth: 0.304, height: 3.09 },
  'golf-course-and-clubhouse-motorised-golf-cart-b754304d': { name: '电动高尔夫球车', width: 1.35601, depth: 2.265, height: 1.90995 },
  'fire-and-emergency-services-ambulance-f22ce1a5': { name: '救护车', width: 3.37061, depth: 6.00567, height: 2.76001 },
  'city-park-and-playground-bike-rack-c73abcbf': { name: '五环自行车架', width: 2.2, depth: 0.72008, height: 0.72416 },
  'tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-fac914d0': { name: '场地办公舱房', width: 6.08, depth: 3.42967, height: 2.89968 },
  'bus-station-and-city-transit-street-lamp-2c6420cf': { name: '路灯', width: 0.43992, depth: 2.03388, height: 7.08 },
  'bus-station-and-city-transit-traffic-light-4b8313ca': { name: '红绿灯', width: 0.35987, depth: 0.43103, height: 3.35 },
  'tool-hire-depot-and-plant-yard-tool-hire-depot-and-pla-b7d1c941': { name: '可拖行照明塔', width: 1.62005, depth: 2.83, height: 2.59373 },
  'arable-fields-and-farm-machinery-tracked-tractor-f59c2454': { name: '双履带拖拉机', width: 2.61974, depth: 5.39, height: 3.05259 },
  'christmas-storybook-market-chalet-f8bf72ba': { name: '节庆市集木屋', width: 3.29, depth: 2.08991, height: 2.90272 },
  'fire-and-emergency-services-fire-hydrant-09cb0c64': { name: '消防栓', width: 0.74, depth: 0.74, height: 0.471 },
  'street-food-market-and-food-trucks-fire-extinguisher-p-1bc646d7': { name: '灭火器站点', width: 0.6, depth: 0.4, height: 1.58 },
  'machine-shop-and-factory-hall-machine-shop-and-factory-d83014ca': { name: '支架灭火器', width: 0.24, depth: 0.44, height: 1.24 },
  'care-home-and-day-room-potted-plant-tall-e50d9742': { name: '高大盆栽', width: 0.442, depth: 0.42, height: 1.336 },
  'live-music-venue-and-festival-stage-festival-flag-pole-6d4f8842': { name: '节庆旗杆', width: 1, depth: 0.56, height: 4.76 },
  'hot-air-balloon-festival-event-flag-pole-f98bce99': { name: '活动旗杆', width: 1.76, depth: 0.68, height: 6.28 },
  'fps-survival-forest-outpost-floodlight-mast-98fcda0b': { name: '四头泛光照明灯杆', width: 2.2, depth: 1.135, height: 5.778 },
  'police-station-and-detective-office-camera-on-tripod-60d9e444': { name: '三脚架现场摄像机', width: 0.763, depth: 0.664, height: 1.391 },
  'robots-and-drones-kit-quadcopter-camera-16e693ab': { name: '四旋翼航拍无人机', width: 0.833, depth: 0.573, height: 0.46 },
  'animated-mechanisms-kit-security-camera-yoke-12d335bf': { name: '杆装云台监控摄像头', width: 0.5, depth: 0.74, height: 2.76 },
  'restaurant-kitchen-and-dining-upright-fridge-double-06328b60': { name: '双门立式冰箱', width: 1.41, depth: 0.905, height: 2.2 },
  'football-soccer-club-grounds-shower-column-2aeb12a4': { name: '独立淋浴柱', width: 0.25, depth: 0.44005, height: 2.05 },
  'nightclub-and-dj-booth-rope-barrier-post-with-rope-327c14d3': { name: '带绳礼宾隔离柱', width: 1.78, depth: 0.34, height: 0.98 },
  'laundrette-and-cleaning-caution-barrier-post-75cbf09d': { name: '伸缩带隔离柱', width: 0.635, depth: 0.374, height: 0.98 },
  'live-music-venue-and-festival-stage-cable-ramp-6576a82f': { name: '电缆过线板', width: 1.2, depth: 0.38003, height: 0.096 },
  'powerboat-racing-and-launch-ramp-cabin-cruiser-canopy-11c4fda1': { name: '带座舱顶棚游艇', width: 2.704, depth: 8.147, height: 2.723 },
  // 游乐设施（rides，2026-11-12 源自 3dassets.dev Theme Park Rides and Coasters，CC0-1.0）
  // 尺寸为 GLB 实测包围盒（.temp/rides/measure-glb.mjs，与 normalizeGlbRoot 同口径）。
  'theme-park-rides-and-coasters-theme-park-rides-and-coa-d18acb96': { name: '摩天轮', width: 16.88, depth: 19.657, height: 17.87, trueScale: true },
  'theme-park-rides-and-coasters-theme-park-rides-and-coa-b3ccf619': { name: '旋转木马', width: 12.7, depth: 14.57, height: 8.74, trueScale: true },
  'theme-park-rides-and-coasters-theme-park-rides-and-coa-8af0e6ab': { name: '旋转飞椅', width: 15.3, depth: 15.3, height: 11.4, trueScale: true },
};


/** 每个 3D 物件类型对应的内置模型（顺序即优先级）。 */
const BUILTIN_BY_KIND: Readonly<Record<PlanPropKind, readonly string[]>> = {
  tent: [
    'mountaineering-and-summit-expedition-base-camp-dome-te-e93b01ea',
    'wilderness-survival-camp-bivouac-hoop-shelter-1d5a0203',
    'greek-island-village-and-harbour-cafe-parasol-a99c4044',
  ],
  stage: [
    'live-music-venue-and-festival-stage-stage-deck-module-b23478f5',
    'village-hall-and-community-events-stage-platform-modul-208d60a2',
    'cruise-ship-deck-and-lounge-cruise-ship-deck-and-loung-73390ffd',
  ],
  kiosk: [
    'harbor-and-tackle-fish-market-stall-d82006ea',
    'trading-post-and-barter-market-canopy-market-booth-46c6c10f',
    'street-food-market-and-food-trucks-gazebo-stall-with-c-e8a7b705',
  ],
  foodTruck: [
    'car-park-and-road-vehicle-fleet-box-truck-4574c765',
    'live-music-venue-and-festival-stage-generator-trailer-354a33e9',
    'long-haul-trucking-and-truck-stop-cabover-day-cab-2da6af6b',
  ],
  toilet: [
    'hot-air-balloon-festival-portable-toilet-block-82a4faf8',
    'live-music-venue-and-festival-stage-portable-toilet-bl-309ed26a',
  ],
  post: [
    'travelling-circus-and-big-top-circus-ticket-booth-428cc272',
    'football-soccer-club-grounds-ticket-booth-e23acd9f',
    'car-park-and-road-vehicle-fleet-payment-kiosk-c5c914df',
  ],
  bin: [
    'dog-agility-and-training-field-field-litter-bin-eeefea95',
    'modern-rail-and-metro-network-waste-bin-57f44ea1',
    'live-music-venue-and-festival-stage-litter-bin-d65ec1dd',
  ],
  // 未精确映射的杂项不要再落到储物箱，避免「椅子变成箱子」。
  misc: [],
};

/** 在线兜底用的关键词表（按 3D 物件类型）。 */
interface KindTokens {
  include: readonly string[];
  exclude: readonly string[];
  buckets: readonly string[];
}

const KIND_TOKENS: Readonly<Record<PlanPropKind, KindTokens>> = {
  tent: {
    include: ['tent', 'canopy', 'marquee', 'gazebo', 'umbrella', 'parasol', 'shelter', 'dome', 'yurt', '帐篷', '遮阳', '庇护'],
    exclude: ['stage', 'platform', 'deck', 'module', 'truss', 'podium', '舞台', '摊位', 'stall', 'booth'],
    buckets: ['structure'],
  },
  stage: {
    include: ['stage', 'deck', 'platform', 'podium', 'truss', '舞台', '地台', '平台'],
    exclude: ['tent', 'canopy', 'stall', 'kiosk', 'truck', 'trailer', '帐篷', '摊位'],
    buckets: ['stage'],
  },
  kiosk: {
    include: ['stall', 'booth', 'kiosk', 'counter', 'concession', 'market', 'bar', '摊位', '展位', '柜台', '售卖'],
    exclude: ['sign', 'number', '编号', 'truck', 'trailer', 'van'],
    buckets: ['exhibition'],
  },
  foodTruck: {
    include: ['truck', 'trailer', 'van', 'pickup', 'lorry', 'caravan', '货车', '拖车', '皮卡', '厢式'],
    exclude: ['traffic', 'wheel', 'sign', 'headlight', 'mirror', 'chassis', 'engine', 'roof'],
    buckets: ['vehicles'],
  },
  toilet: {
    include: ['toilet', 'restroom', 'wc', 'urinal', 'lavatory', 'sanitary', '卫生间', '厕所', '盥洗', '便携厕所'],
    exclude: [],
    buckets: ['structure'],
  },
  post: {
    include: ['booth', 'kiosk', 'ticket', 'payment', 'checkpoint', 'guard', 'desk', '亭', '岗', '售票', '问询', '收费'],
    exclude: ['sign', 'banner', 'flag'],
    buckets: ['exhibition', 'logistics'],
  },
  bin: {
    include: ['bin', 'waste', 'trash', 'litter', 'garbage', 'rubbish', '垃圾桶', '垃圾', '废物', '回收'],
    exclude: ['parts', 'rack', 'storage', '零件', '货架'],
    buckets: ['logistics'],
  },
  misc: {
    include: ['crate', 'trunk', 'case', 'chest', 'generator', 'tank', 'first aid', 'extinguisher', 'barrier', 'fence', 'plant', 'bench', 'table', '箱', '柜'],
    exclude: ['stage', 'stall', 'bin', 'waste', 'trash'],
    buckets: ['storage', 'tools', 'logistics'],
  },
};

function hasCjk(token: string): boolean {
  return /[\u3400-\u9fff]/.test(token);
}

/**
 * 关键词命中判定：
 *  - 中文词直接子串匹配（物料库中文名没有空格）。
 *  - 英文词要求词边界，避免 `bar` 命中 `barrier`、`wc` 命中 `wcs`。
 */
function tokenMatches(haystack: string, token: string): boolean {
  if (!token) return false;
  if (hasCjk(token)) return haystack.includes(token);
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

interface ScoredModel {
  model: OnlineModel;
  score: number;
}

/** 在线模型按类型关键词打分排序。 */
function scoreModels(kind: PlanPropKind, models: readonly OnlineModel[]): ScoredModel[] {
  const tokens = KIND_TOKENS[kind];
  const scored: ScoredModel[] = [];
  for (const model of models) {
    const name = model.name ?? '';
    const original = model.originalName ?? '';
    const slug = model.slug ?? '';
    const subcategory = model.subcategory ?? '';
    const bucket = model.bucket ?? '';
    const combined = `${name} ${original} ${slug} ${subcategory} ${bucket}`.toLowerCase();

    let excluded = false;
    for (const token of tokens.exclude) {
      if (tokenMatches(combined, token)) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    let score = 0;
    for (const token of tokens.include) {
      if (tokenMatches(name, token)) score += 6;
      else if (tokenMatches(original, token)) score += 6;
      else if (tokenMatches(slug, token)) score += 3;
      else if (tokenMatches(subcategory, token)) score += 4;
      else if (tokenMatches(bucket, token)) score += 1;
    }
    if (score <= 0) continue;
    if (tokens.buckets.includes(bucket)) score += 3;
    // 太大的模型放不进一个设施占地，轻微降权。
    const footprint = Math.max(model.width, model.depth);
    if (footprint > 12) score -= 4;
    if (model.height > 6) score -= 2;
    // 同分时下载量高的更可能是「通用好认」的模型。
    score += Math.min(3, model.downloads / 100000);
    scored.push({ model, score });
  }
  scored.sort((a, b) => (b.score - a.score) || (b.model.downloads - a.model.downloads) || a.model.slug.localeCompare(b.model.slug));
  return scored;
}

/** 模型最高多高（米）：再高就压不住场地了。 */
const MAX_MODEL_HEIGHT = 4;
/** 模型高度相对占地长边的上限（倍数）。 */
const MAX_HEIGHT_RATIO = 1.2;
/** 放大上限：模型不放大到超过原尺寸的 2.5 倍，避免小模型被撑成庞然大物。 */
const MAX_SCALE = 2.5;
/** 候选排序权重：已废弃（2026-11-15 自动挑选改为取首位候选，与 2D 占地同源）。 */

/** 一个模型按占地缩放后的结果。 */
export interface FacilityModelFit {
  /** 统一缩放系数（模型原始米制尺寸 × scale）。 */
  scale: number;
  /** 缩放后的模型高度（米）。 */
  height: number;
  /** 模型是否需要转 90° 才塞得进占地（例如细长的餐车）。 */
  swap: boolean;
}

/**
 * 把一个候选模型按 2D 占地缩放：统一缩放（不变形），能塞下就塞满，
 * 塞不下就等比缩小；高度再兜一层上限。
 */
export function fitFacilityModel(
  propWidth: number,
  propDepth: number,
  candidate: FacilityModelCandidate,
): FacilityModelFit {
  const direct = Math.min(propWidth / candidate.width, propDepth / candidate.depth);
  const swapped = Math.min(propWidth / candidate.depth, propDepth / candidate.width);
  const swap = swapped > direct * 1.05;
  let scale = Math.min(swap ? swapped : direct, MAX_SCALE);
  // 游乐设施等真比例地标不吃 4m 上限（摩天轮 18m 本来就该立在那里），
  // 高度随占地等比走：2D 画多大，模型就多大。
  const heightCap = candidate.trueScale
    ? Number.POSITIVE_INFINITY
    : Math.min(MAX_MODEL_HEIGHT, Math.max(propWidth, propDepth) * MAX_HEIGHT_RATIO);
  let height = candidate.height * scale;
  if (height > heightCap && candidate.height > 0) {
    scale = Math.max(0.05, heightCap / candidate.height);
    height = candidate.height * scale;
  }
  return { scale, height, swap };
}

/**
 * 自动挑一个模型落位。
 *
 * 2026-11-15 口径变更：2D 占地现在由首位候选的真实尺寸推导（`facilityFootprintSpec` /
 * `facilitySizeFromModel`），所以自动挑选必须与 2D 同源——直接取首位（语义最优）候选，
 * 只把当前 2D 尺寸换算成缩放。先前「谁塞得满就选谁」会让 2D 框和 3D 模型形状对不上。
 * 返回 null 表示一个候选都没有（3D 侧继续画低模）。
 */
export function selectFacilityModel(
  candidates: readonly FacilityModelCandidate[],
  propWidth: number,
  propDepth: number,
): (FacilityModelCandidate & FacilityModelFit) | null {
  const first = candidates[0];
  if (!first) return null;
  return { ...first, ...fitFacilityModel(propWidth, propDepth, first) };
}

/**
 * 2026-11-15：按 slug 同步拿内置模型（不碰在线索引）。
 * 2D 外廓要在同步渲染路径里算「用户手选的这个模型」到底多大，不能 await 在线库，
 * 因此只认随代码发布的内置尺寸表；查不到返回 null，由调用方回落模板默认。
 */
export function builtinModelBySlug(slug: string): FacilityModelCandidate | null {
  return scenePresetFacilityCandidate(slug) ?? candidateFromBuiltin(slug);
}

function candidateFromBuiltin(slug: string): FacilityModelCandidate | null {
  const scene = scenePresetFacilityCandidate(slug);
  if (scene) return scene;
  const packaged = packagedIconModel(slug);
  if (packaged) return packaged;
  const entry = Object.hasOwn(BUILTIN_MODELS, slug) ? BUILTIN_MODELS[slug] : undefined;
  if (!entry) return null;
  return {
    slug,
    name: entry.name,
    glbUrl: localGlbUrl(slug),
    width: entry.width,
    depth: entry.depth,
    height: entry.height,
    ...(entry.trueScale ? { trueScale: true } : {}),
  };
}

function candidateFromOnline(model: OnlineModel): FacilityModelCandidate {
  return {
    slug: model.slug,
    name: model.name,
    glbUrl: model.glb,
    width: model.width,
    depth: model.depth,
    height: model.height,
    ...(model.thumb ? { thumb: model.thumb } : {}),
  };
}

/**
 * 模板 id → OnePlan 物件库 slug；不是物件库模板（内置 8 模板等）返回 null。
 */
export function facilityTemplateSlug(templateId: string): string | null {
  const parsed = parseLibraryTemplateId(templateId);
  return parsed ? parsed.slug : null;
}

/** Resolve the reviewed model for a library object. Legacy tools retain their preset candidates. */
export function resolveFacilityModels(templateId: string): FacilityModelCandidate[] {
  const scene = scenePresetFacilityCandidate(templateId);
  if (scene) return [scene];
  let slugs: readonly string[];
  if (isPackTemplateId(templateId)) {
    const entry = packEntryByTemplateId(templateId);
    if (entry?.placeKind && entry.placeKind !== 'facility') return [];
    slugs = entry ? iconModelSlugs(entry.slug, entry.kind) : packModelSlugs(templateId);
  } else {
    const icon = parseLibraryTemplateId(templateId);
    slugs = icon ? iconModelSlugs(icon.slug, icon.kind) : BUILTIN_BY_KIND[planPropKind(templateId)];
  }
  return slugs.slice(0, MAX_CANDIDATES)
    .map(candidateFromBuiltin)
    .filter((item): item is FacilityModelCandidate => item !== null);
}

/**
 * 异步解析一批模板的模型候选：内置映射优先，在线物料库兜底。
 *
 * 在线物料库是动态 import（`loadOnlineModels()`），所以这一步不会阻塞首帧渲染；
 * 拿不到在线目录时静默退回内置映射。
 */
export async function loadFacilityModelCandidates(
  templateIds: readonly string[],
  limit: number = MAX_CANDIDATES,
): Promise<Map<string, FacilityModelCandidate[]>> {
  const boundedLimit = Math.max(0, Math.min(limit, MAX_CANDIDATES));
  const unique = [...new Set(templateIds)];
  const result = new Map<string, FacilityModelCandidate[]>();
  let models: readonly OnlineModel[] = [];
  if (unique.some(id => !parseLibraryTemplateId(id) && !isPackTemplateId(id) && !scenePresetFacilityCandidate(id))) {
    try {
      models = (await loadOnlineModels()).models;
    } catch {
      // Legacy defaults are available without the catalogue.
    }
  }
  // V-5a：内置映射是同步手挑的，候选上没带缩略图；在线索引在手时按 slug 补齐，
  // 属性卡候选网格就能给绝大多数候选配图（拿不到的显示名称占位块）。
  const thumbBySlug = new Map<string, string>();
  for (const model of models) {
    if (model.thumb && !thumbBySlug.has(model.slug)) thumbBySlug.set(model.slug, model.thumb);
  }
  for (const templateId of unique) {
    const builtin = resolveFacilityModels(templateId).map((candidate) => {
      const thumb = thumbBySlug.get(candidate.slug);
      return thumb ? { ...candidate, thumb } : candidate;
    });
    const kind = planPropKind(templateId);
    const merged = [...builtin];
    if (!parseLibraryTemplateId(templateId) && !isPackTemplateId(templateId) && kind !== 'misc') {
      for (const entry of scoreModels(kind, models)) {
        if (merged.length >= boundedLimit) break;
        const candidate = candidateFromOnline(entry.model);
        if (merged.some(item => item.slug === candidate.slug)) continue;
        merged.push(candidate);
      }
    }
    result.set(templateId, merged.slice(0, boundedLimit));
  }
  return result;
}

/**
 * V-5a：设施的手动模型 override（契约 planFacilitySchema.modelOverride 存物料库 slug）→ 候选。
 *
 * 与 selectFacilityModel（自动挑选）并列的取值口径：候选列表里命中哪个 slug 就直接用哪个
 * （不再按占地重新挑位次），缩放照走 fitFacilityModel。候选列表没有该 slug 时返回 null——
 * 3D 侧先等在线库按 slug 直查（loadFacilityModelOverride），仍解析不到才回退自动挑选。
 */
export function selectFacilityModelOverride(
  candidates: readonly FacilityModelCandidate[],
  slug: string,
  propWidth: number,
  propDepth: number,
): (FacilityModelCandidate & FacilityModelFit) | null {
  const found = candidates.find(candidate => candidate.slug === slug);
  if (!found) return null;
  return { ...found, ...fitFacilityModel(propWidth, propDepth, found) };
}

/**
 * V-5a：按 slug 在整个物料库直查一个候选（内置映射优先，在线索引兜底）。
 * 供「override 不在 top-N 候选列表」时兜底解析（候选位次变动 / 生成回填场景）；
 * 返回 null 表示库里没有这个 slug，调用方回退自动挑选。
 */
export async function loadFacilityModelOverride(slug: string): Promise<FacilityModelCandidate | null> {
  // V-5b/c：生成/导入回填的候选第一优先——它们不在物料库里，库查永远 null。
  const generated = findGeneratedFacilityModel(slug);
  if (generated) return generated;
  const builtin = candidateFromBuiltin(slug);
  if (builtin) return builtin;
  try {
    const index = await loadShippedOnlineModels();
    const model = index.models.find(entry => entry.slug === slug);
    return model ? candidateFromOnline(model) : null;
  } catch {
    return null;
  }
}
