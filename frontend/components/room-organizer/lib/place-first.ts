/**
 * 地图优先的入口守卫。
 *
 * 用户口径（2026-11-16）：先知道在哪做设计，不接受无地点设计。
 * 地点还没定时，布置 / 动线 / 分区这类设计句在本地就退回选址，
 * 不再发起模型调用——否则会先等十几秒，最后拿一句登录提示把人挡在第一步。
 *
 * 这里只做「是不是设计句」的粗判：宁可放过一句（交给工作流继续问地点），
 * 也不要把「先找杭州 IN77」这种选址句误拦。
 */

/** 选址句的标记：出现这些词就按「地址/范围」意图放行，不由本守卫拦。 */
const PLACE_INTENT = /(?:找|搜|定位|导航|地址|地图|附近|在哪|哪里|圈(?:出|定|选|出)?|范围|场馆名|场地名|坐标|公里|地铁|路\d|街\d)/;

/** 设计动作：动词在前、对象在后，两个都在才当设计句。 */
const DESIGN_ACTION = /(?:摆|放|布置|加|添|增|删|去掉|移除|挪|移|换|改成|改到|调成|调整|围|排|生成|做一?|画|分|设|建)/;

/** 设计对象：物件、区域、动线都算；不含「场地/地点」这类选址词。 */
const DESIGN_OBJECT = /(?:桌|椅|台|板|柜|架|灯|屏|帐|舞台|沙发|地毯|花|绿植|物料|设施|模型|家具|分区|区域|区|流线|动线|路线|主线|支线|通道|入口|出口|座位|布置|布局|背景|签到|拱门|音响|围栏|指示|地毯)/;

export const PLACE_FIRST_BOUNCE = '还没定在哪。先在地图上定地点、圈出可用范围，或直接说出城市/场馆/地址；地点定了再谈布置、动线和分区。这句我先留着。';

/** 这句话看起来是在要「摆/改/排」，而不是在说「在哪」。 */
export function looksLikeDesignInstruction(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  if (!compact) return false;
  if (PLACE_INTENT.test(compact)) return false;
  return DESIGN_ACTION.test(compact) && DESIGN_OBJECT.test(compact);
}

/**
 * 既点了地名、又说了要摆什么：复合句。
 *
 * 浏览器实测（2026-11-16）：「在杭州植物园玉泉鱼跃周边做两日市集，六个摊位，签到集章…」
 * 被 matchVenueCommand 整句认成选址句，设计部分直接丢掉。复合句要保留整句：
 * 地名用来定位，设计部分存成待办，等范围确认后接回。
 */
export function isCompositeDesignBrief(text: string, venueName: string | null | undefined): boolean {
  if (!venueName || venueName === 'ask') return false;
  return looksLikeDesignInstruction(text);
}

/** 地点还没定：户外还没过 place 阶段，室内还没立起任何场地。 */
export function placeStillPending(input: { hasOutdoorPlan: boolean; stage?: string | undefined; venueUp: boolean; rangeConfirmed?: boolean }): boolean {
  // 2026-11-16 浏览器实测：空白活动的 stage 还没初始化，旧条件 `stage === 'place'`
  // 永远不成立，于是设计句被当成选址请求，最后卡在登录墙。
  // 户外只要范围没确认，就按“地点未定”处理（室内分支不受影响）。
  if (input.hasOutdoorPlan && input.rangeConfirmed !== undefined) return !input.rangeConfirmed;
  return input.hasOutdoorPlan ? input.stage === 'place' : !input.venueUp;
}

/**
 * 复合设计句但没有人数：先问人数，别的都不做。
 *
 * 用户口径（2026-11-22 幕景Agent Test A 行）：「默认先找场地，没问人数多少」——
 * 场地检索会把「找哪里」和「做多大规模」绑在一起，人数不明时先查出候选只是把问题往后推。
 * 返回 true 时调用方只问人数：不写 pending brief、不发起候选检索。
 */
export function needsHeadcountFirst(text: string, venueName: string | null | undefined, knownHeadcount: number | null | undefined): boolean {
  if (typeof knownHeadcount === 'number' && Number.isFinite(knownHeadcount) && knownHeadcount >= 1) return false;
  return isCompositeDesignBrief(text, venueName);
}

/** 地名词里已经带了城市/省份：不再补默认城市。 */
const CITY_IN_QUERY = /(?:北京|上海|天津|重庆|杭州|南京|苏州|宁波|绍兴|嘉兴|湖州|金华|温州|台州|丽水|衢州|舟山|广州|深圳|成都|武汉|西安|长沙|合肥|福州|厦门|青岛|济南|郑州|昆明|南昌|贵阳|太原|石家庄|沈阳|大连|长春|哈尔滨|兰州|西宁|银川|乌鲁木齐|呼和浩特|南宁|海口|拉萨|香港|澳门|台北)/;
const PROVINCE_IN_QUERY = /(?:省|自治区)/;
/** 检索兜底城市：还没信号说过别的城市时用它，与产品当前主场景一致。 */
export const DEFAULT_VENUE_CITY = '杭州';

/**
 * 没搜到候选时给回填的那句「在 X 做设计」用的城市。
 *
 * 2026-11-22 幕景Agent Test B-1：原来这里是写死的 `在杭州${query}做设计`，
 * 用户已经说了「杭州临安青山湖水上森林」还会再补一个杭州。现在只在地名里没有城市/省份时才补，
 * 且不改写 query 本身——「临安」是区不是市，仍然补「杭州」，但「青山」这些字一个都不能丢。
 */
export function outdoorQueryWithCity(query: string, city: string = DEFAULT_VENUE_CITY): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  if (CITY_IN_QUERY.test(trimmed) || PROVINCE_IN_QUERY.test(trimmed)) return trimmed;
  return `${city}${trimmed}`;
}
