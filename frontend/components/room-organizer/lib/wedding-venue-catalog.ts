/**
 * 适合办婚礼的场地清单（20261119 手动入库）。
 *
 * 就一件事：用户问「适合婚礼的地点」，产品得有个地方可查，而不是让模型现编。
 * 所以这里只存地点本身，不放排序、不做推荐算法——筛选由调用方自己定。
 *
 * 入库口径：
 *   · 名称 / 区域 / 形态 / 有无室内退路 / 是否已重建：都能核实，可写。
 *   · 容量一律留空（capacity 全为 null）：我们没有任何场地的面积或桌数实测，
 *     写个「可容纳 80 人」就是编数字。
 *   · rebuiltAssetId 只认本机扫描库里真实存在的 id（见 local-scan-index.json）；
 *     没有就是还没重建，不能说「现在就能进 3D 看」。
 */

export type WeddingVenueSetting = "garden" | "lawn" | "courtyard" | "terrace" | "valley";

export interface WeddingVenue {
  id: string;
  /** 展示名。「西湖园林」是 Demo 展示名，不是某一座具体园子的正式名称。 */
  name: string;
  city: string;
  /** 区域线索，用于「西湖边」「南山路」这类模糊诉求的比对。 */
  area: string;
  setting: WeddingVenueSetting;
  /** 室内或廊下退路：户外婚礼下雨就靠这一条。 */
  indoorFallback: boolean;
  /** 本机扫描库里的实景资产 id；null = 还没重建。 */
  rebuiltAssetId: string | null;
  /** 一句话特点，不含容量承诺。 */
  highlight: string;
}

export const WEDDING_VENUES: readonly WeddingVenue[] = [
  {
    id: "xihu-garden-0233",
    name: "西湖园林",
    city: "杭州",
    area: "西湖景区内园地",
    setting: "garden",
    indoorFallback: true,
    // 2026-11-19 标准档（…000001）已从扫描库删除（见 data/local-scans.json 的 removed），
    // 重建资产改指同一场 0233 的极速档（同一 worldId 3FO4FMTUKCW4 的低档产物），
    // 「已重建，可当场进 3D」的能力不丢，加载还更快（7.8 MB vs 23 MB）。
    rebuiltAssetId: "c338f720-3f60-4adb-8f3b-023300000002",
    highlight: "已重建，可当场进 3D 看树冠遮挡与地面起伏（Demo 展示名）",
  },
  {
    id: "xizi-bingguan-lawn",
    name: "西子宾馆（草坪）",
    city: "杭州",
    area: "南山路、雷峰塔一侧",
    setting: "lawn",
    indoorFallback: true,
    rebuiltAssetId: null,
    highlight: "国宾馆草坪，婚宴与住宿同园区，宾客动线短",
  },
  {
    id: "liuyingli-courtyard",
    name: "柳莺里",
    city: "杭州",
    area: "西湖边庭院",
    setting: "courtyard",
    indoorFallback: true,
    rebuiltAssetId: null,
    highlight: "庭院古典草坪，小桌数婚礼的常见选择",
  },
  {
    id: "xishang-hupao-1934",
    name: "夕上·虎跑1934",
    city: "杭州",
    area: "虎跑路，山边谷地",
    setting: "valley",
    indoorFallback: true,
    rebuiltAssetId: null,
    highlight: "山野秘境型，风格强、出片好，可用平地偏紧",
  },
  {
    id: "jinxi-villa-lawn",
    name: "金溪山庄（草坪）",
    city: "杭州",
    area: "西湖景区西侧",
    setting: "lawn",
    indoorFallback: true,
    rebuiltAssetId: null,
    highlight: "草坪与宴会厅同在园区，下雨有现成退路",
  },
  {
    id: "huabei-hotel-terrace",
    name: "华北饭店（露台）",
    city: "杭州",
    area: "南山路，能看西湖",
    setting: "terrace",
    indoorFallback: true,
    rebuiltAssetId: null,
    highlight: "露台可远眺西湖，正餐需转室内厅",
  },
];

/** 关键词筛选：城市 / 区域 / 形态词。命中任意一个就算，不做打分排序。 */
export function findWeddingVenues(keyword: string): WeddingVenue[] {
  const text = keyword.trim();
  if (!text) return [...WEDDING_VENUES];
  return WEDDING_VENUES.filter((venue) =>
    [venue.name, venue.city, venue.area, venue.highlight].some((field) => field.includes(text)),
  );
}

/** 只给现在就能进 3D 看的（有重建资产）。 */
export function rebuiltWeddingVenues(): WeddingVenue[] {
  return WEDDING_VENUES.filter((venue) => venue.rebuiltAssetId);
}

/** 上报给 Edge 的重建实景条目：只放可核实字段，不放容量、不放承诺。 */
export interface RebuiltSceneRef {
  displayName: string;
  assetId: string;
  /** 展示名是否为 Demo 命名，而非场地正式名称。 */
  isDemo: boolean;
  /** 该资产与某个真实地点的对应关系是否已确认；没核过就一律 false。 */
  placeConfirmed: boolean;
}

export function rebuiltSceneRefs(): RebuiltSceneRef[] {
  return WEDDING_VENUES.filter((venue) => venue.rebuiltAssetId).map((venue) => ({
    displayName: venue.name,
    assetId: venue.rebuiltAssetId as string,
    isDemo: venue.id === "xihu-garden-0233",
    // 没有任何一条重建资产与真实场地的对应关系被确认过，不写 true。
    placeConfirmed: false,
  }));
}
