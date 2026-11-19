/** 可解释的户外活动 v1：十类活动走注册表几何模板（D2：相亲/社交市集、市集、发布会、讲座、婚礼、演出/音乐会、美食节、车展、运动会、展览）；沿岸类（钓鱼等）走参照排布；其他类型走通用需求路径。不是消防/容量安全认证。 */
import type { PlanFacility, PlanNode, PlanPoint, PlanRoute, PlanZone } from '../../../../supabase/functions/_shared/site-plan';
import { facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';
import { planPointInRing, planSegmentsCrossStrict } from './site-plan-editing';
import type { BuildZoneEventInput, ZoneEventProposal } from './zone-event-proposal';

type Side = 'N' | 'S' | 'E' | 'W';

/** 模板参数表产出的公共占地字段。mainHeight/aisleEndY 由同一个 depth 推导（depth-19/-10、depth-11/-1），保证与旧实现浮点路径逐位一致。 */
export interface OutdoorEventTemplateLayout {
  /** 模板总占地宽（m）。 */
  width: number;
  /** 模板总占地深（m）。 */
  depth: number;
  /** 主区（观众区/市集区）高度（m）。 */
  mainHeight: number;
  /** 中央人行通道末端 y（m）。 */
  aisleEndY: number;
}

/** 模板分区钩子上下文：zone 帮手把分区登记进提案（签到/医疗两个公共分区由脚手架先建好）。 */
export interface OutdoorEventTemplateZoneContext {
  width: number;
  depth: number;
  layout: OutdoorEventTemplateLayout;
  zone(semantic: PlanZone['semantic'], name: string, x: number, y: number, w: number, h: number): PlanZone;
}

/** 模板摆件钩子上下文：place 帮手做边界/父区/重叠守卫，全部通过才落件并返回 true。 */
export interface OutdoorEventTemplateFillContext {
  guests: number;
  width: number;
  depth: number;
  layout: OutdoorEventTemplateLayout;
  place(templateId: string, name: string, x: number, y: number, w: number, d: number, parent: PlanZone): boolean;
  /** 主区（观众区/市集区）。 */
  main: PlanZone;
  /** 舞台区；模板没有舞台时为 null。 */
  stage: PlanZone | null;
}

/**
 * 模板注册表条目：每类活动一个模块——识别正则、参数表（容量系数/设施清单/通道宽）与 propose 级钩子。
 * 朝向默认不逐类配：脚手架按已确认入口的贴边侧统一推导（南入朝北=0°、北入=180°、西入=90°、东入=270°），
 * 模板只管自己分区内的摆法。
 */
export interface OutdoorEventTemplate {
  /** 注册表 id；supportedOutdoorEvent 命中即返回本模块。 */
  readonly id: string;
  /** 面向用户的活动名：「目前支持：…」动态话术从这里生成。 */
  readonly label: string;
  /** 识别正则：活动说法命中即用本模块出几何提案。 */
  readonly match: RegExp;
  /** 「先说活动类型」话术里的示例说法。 */
  readonly example: string;
  /** 分区 notes 里的活动描述片段。 */
  readonly note: string;
  /** 通道宽（m）：中央人行通道、接驳路由与净空判定共用。 */
  readonly aisleWidth: number;
  /** 参数表：人数 → 公共占地字段；cols/rows/stalls 等容量系数由模板内部的同一推导函数给出，不进公共字段。 */
  measure(guests: number): OutdoorEventTemplateLayout;
  /** 模板自有分区（主区、舞台区…）。 */
  zones(ctx: OutdoorEventTemplateZoneContext): { main: PlanZone; stage: PlanZone | null };
  /** 设施清单与摆法；返回已摆件数，摆不下整版时返回 null（脚手架整版否决）。 */
  fill(ctx: OutdoorEventTemplateFillContext): number | null;
}

/** 市集参数表：约每 4 人一摊、两列成排、排距 4m；占地宽固定 19m。 */
function marketDerived(guests: number): { stalls: number; rows: number; width: number; depth: number } {
  const stalls = Math.ceil(guests / 4);
  const rows = Math.ceil(stalls / 2);
  return { stalls, rows, width: 19, depth: rows * 4 + 13 };
}

/** 市集模板：两列摊位沿中央通道成排，无舞台。 */
const marketOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'market',
  label: '市集',
  match: /市集|集市|展销/u,
  example: '80 人市集',
  note: '市集，约每摊4人',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = marketDerived(guests);
    return { width, depth, mainHeight: depth - 10, aisleEndY: depth - 1 };
  },
  zones(ctx) {
    return { main: ctx.zone('reserved', '市集区', 1, 7, ctx.width - 2, ctx.layout.mainHeight), stage: null };
  },
  fill(ctx) {
    const { stalls, rows } = marketDerived(ctx.guests);
    let count = 0;
    for (let row = 0; row < rows; row += 1) for (const x of [ctx.width / 2 - 4, ctx.width / 2 + 4]) {
      if (count < stalls && ctx.place('booth-2x2', `市集摊位 ${count + 1}`, x, 8.5 + row * 4, 2, 2, ctx.main)) count += 1;
    }
    if (count < stalls) return null;
    return count;
  },
};

/** 讲座/会议参数表：座椅约 √人数 列（4–16 夹取）、排距 1.2m；占地宽 max(22, 列×0.95+7)，舞台贴深端。 */
function lectureDerived(guests: number): { cols: number; rows: number; width: number; depth: number } {
  const cols = Math.max(4, Math.min(16, Math.ceil(Math.sqrt(guests))));
  const rows = Math.ceil(guests / cols);
  return { cols, rows, width: Math.max(22, cols * 0.95 + 7), depth: rows * 1.2 + 23 };
}

/** 讲座/会议模板：观众座椅矩阵面向舞台，讲台压舞台区深端。（发布会 2026-11-20 D2 拆为独立模板，正则不再收它。） */
const lectureOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'lecture',
  label: '讲座',
  match: /讲座|会议|论坛/u,
  example: '45 人讲座',
  note: '讲座/会议',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = lectureDerived(guests);
    return { width, depth, mainHeight: depth - 19, aisleEndY: depth - 11 };
  },
  zones(ctx) {
    const main = ctx.zone('audience', '观众区', 1, 7, ctx.width - 2, ctx.layout.mainHeight);
    const stage = ctx.zone('stage', '舞台区', ctx.width / 2 - 5, ctx.depth - 10, 10, 8);
    return { main, stage };
  },
  fill(ctx) {
    if (ctx.stage && !ctx.place('stage-platform-8x6', '讲台/舞台', ctx.width / 2, ctx.depth - 6, 8, 6, ctx.stage)) return null;
    const { cols, rows } = lectureDerived(ctx.guests);
    const leftCols = Math.ceil(cols / 2);
    let count = 0;
    for (let row = 0; row < rows && count < ctx.guests; row += 1) for (let col = 0; col < cols && count < ctx.guests; col += 1) {
      const offset = col < leftCols ? -(leftCols - col) * 0.95 - 1.5 : (col - leftCols + 1) * 0.95 + 1.5;
      if (ctx.place('oneplan:scale-fg:chair', `观众座椅 ${count + 1}`, ctx.width / 2 + offset, 8 + row * 1.2, 0.55, 0.6, ctx.main)) count += 1;
    }
    if (count < ctx.guests) return null;
    return count;
  },
};

/**
 * D2（2026-11-20）八类新模板共用的小件 id 均取物件库规范格式（`oneplan:scale:<slug>` /
 * `oneplan:icon:<slug>`，resolveFacilityTemplate 可解析）；观众座椅沿用讲座既有
 * `oneplan:scale-fg:chair`（存量兼容格式，plan 层与规范 id 等价）。
 */

/** 相亲/社交市集参数表：约每 4 人一桌、两列成排、排距 4m；占地与市集同构（19m 宽），联谊长桌替摊位。 */
function socialDerived(guests: number): { tables: number; rows: number; width: number; depth: number } {
  const tables = Math.ceil(guests / 4);
  const rows = Math.ceil(tables / 2);
  return { tables, rows, width: 19, depth: rows * 4 + 13 };
}

/** 相亲/社交市集模板：联谊桌沿中央通道成排。注册在市集之前——「相亲市集」落联谊桌，不落摊位网格。 */
const socialOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'social',
  label: '相亲/社交市集',
  match: /相亲|联谊|交友|社交/u,
  example: '40 人相亲会',
  note: '相亲/社交联谊',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = socialDerived(guests);
    return { width, depth, mainHeight: depth - 10, aisleEndY: depth - 1 };
  },
  zones(ctx) {
    return { main: ctx.zone('reserved', '联谊区', 1, 7, ctx.width - 2, ctx.layout.mainHeight), stage: null };
  },
  fill(ctx) {
    const { tables, rows } = socialDerived(ctx.guests);
    let count = 0;
    for (let row = 0; row < rows; row += 1) for (const x of [ctx.width / 2 - 4, ctx.width / 2 + 4]) {
      if (count < tables && ctx.place('oneplan:scale:round-table-and-chairs', `相亲桌 ${count + 1}`, x, 8.5 + row * 4, 2, 2, ctx.main)) count += 1;
    }
    if (count < tables) return null;
    return count;
  },
};

/** 发布会模板：观众参数复用讲座推导（卡面口径），舞台扩为 16m 发布区——大屏压台后沿、演讲台在台侧。 */
const launchOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'launch',
  label: '发布会',
  match: /发布会|新品发布|产品发布|品牌发布/u,
  example: '80 人发布会',
  note: '发布会',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = lectureDerived(guests);
    return { width, depth, mainHeight: depth - 19, aisleEndY: depth - 11 };
  },
  zones(ctx) {
    const main = ctx.zone('audience', '观众区', 1, 7, ctx.width - 2, ctx.layout.mainHeight);
    const stage = ctx.zone('stage', '发布区', ctx.width / 2 - 8, ctx.depth - 11, 16, 9);
    return { main, stage };
  },
  fill(ctx) {
    if (!ctx.stage || !ctx.place('stage-platform-8x6', '发布舞台', ctx.width / 2, ctx.depth - 6.5, 8, 6, ctx.stage)) return null;
    if (!ctx.place('oneplan:scale:large-screen', '主视觉大屏', ctx.width / 2, ctx.depth - 2.85, 6, 0.5, ctx.stage)) return null;
    if (!ctx.place('oneplan:icon:podium', '演讲台', ctx.width / 2 - 5.5, ctx.depth - 6.5, 0.6, 0.6, ctx.stage)) return null;
    const { cols, rows } = lectureDerived(ctx.guests);
    const leftCols = Math.ceil(cols / 2);
    let count = 0;
    for (let row = 0; row < rows && count < ctx.guests; row += 1) for (let col = 0; col < cols && count < ctx.guests; col += 1) {
      const offset = col < leftCols ? -(leftCols - col) * 0.95 - 1.5 : (col - leftCols + 1) * 0.95 + 1.5;
      if (ctx.place('oneplan:scale:chair', `观众座椅 ${count + 1}`, ctx.width / 2 + offset, 8 + row * 1.2, 0.55, 0.6, ctx.main)) count += 1;
    }
    if (count < ctx.guests) return null;
    return count;
  },
};

/** 婚礼参数表：宾客座椅约 √人数 列（4–16 夹取）、排距 1.2m；占地宽 max(20, 列×0.95+8)，仪式区 14m 宽贴深端。 */
function weddingDerived(guests: number): { cols: number; rows: number; width: number; depth: number } {
  const cols = Math.max(4, Math.min(16, Math.ceil(Math.sqrt(guests))));
  const rows = Math.ceil(guests / cols);
  return { cols, rows, width: Math.max(20, cols * 0.95 + 8), depth: rows * 1.2 + 21 };
}

/** 婚礼模板：宾客座椅分左右两块留出中央红毯通道，仪式台+拱门压深端仪式区，两只音响夹台。 */
const weddingOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'wedding',
  label: '婚礼',
  match: /婚礼|婚宴|结婚/u,
  example: '30 人婚礼',
  note: '婚礼',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = weddingDerived(guests);
    return { width, depth, mainHeight: depth - 19, aisleEndY: depth - 13 };
  },
  zones(ctx) {
    const main = ctx.zone('audience', '观礼区', 1, 7, ctx.width - 2, ctx.layout.mainHeight);
    // 仪式区与观礼区相邻（婚礼拱门恰在交界线上，是仪式动线的门槛），通道止于区界之前。
    const stage = ctx.zone('stage', '仪式区', ctx.width / 2 - 7, ctx.depth - 12, 14, 10);
    return { main, stage };
  },
  fill(ctx) {
    if (!ctx.stage || !ctx.place('stage-platform-8x6', '仪式台', ctx.width / 2, ctx.depth - 6.5, 8, 6, ctx.stage)) return null;
    if (!ctx.place('oneplan:scale:inflatable-arch', '婚礼拱门', ctx.width / 2, ctx.depth - 10.8, 3, 1.2, ctx.stage)) return null;
    if (!ctx.place('oneplan:icon:pa-speakers', '音响（左）', ctx.width / 2 - 6.5, ctx.depth - 6.5, 0.5, 0.5, ctx.stage)) return null;
    if (!ctx.place('oneplan:icon:pa-speakers', '音响（右）', ctx.width / 2 + 6.5, ctx.depth - 6.5, 0.5, 0.5, ctx.stage)) return null;
    const { cols, rows } = weddingDerived(ctx.guests);
    const leftCols = Math.ceil(cols / 2);
    let count = 0;
    for (let row = 0; row < rows && count < ctx.guests; row += 1) for (let col = 0; col < cols && count < ctx.guests; col += 1) {
      const offset = col < leftCols ? -(leftCols - col) * 0.95 - 1.5 : (col - leftCols + 1) * 0.95 + 1.5;
      if (ctx.place('oneplan:scale:chair', `宾客座椅 ${count + 1}`, ctx.width / 2 + offset, 8 + row * 1.2, 0.55, 0.6, ctx.main)) count += 1;
    }
    if (count < ctx.guests) return null;
    return count;
  },
};

/** 演出/音乐会参数表：观众约 √人数 列（6–20 夹取）、排距 1.2m；占地宽 max(26, 列×0.95+10)，舞台区 16m 宽贴深端。 */
function concertDerived(guests: number): { cols: number; rows: number; width: number; depth: number } {
  const cols = Math.max(6, Math.min(20, Math.ceil(Math.sqrt(guests))));
  const rows = Math.ceil(guests / cols);
  return { cols, rows, width: Math.max(26, cols * 0.95 + 10), depth: rows * 1.2 + 25 };
}

/** 演出/音乐会模板：观众座椅矩阵面向演出舞台，两块侧屏夹台（舞台区同发布会变体加深加宽）。 */
const concertOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'concert',
  label: '演出/音乐会',
  match: /演出|音乐会|演唱会|音乐节|歌舞|汇演|乐队/u,
  example: '120 人音乐会',
  note: '演出/音乐会',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = concertDerived(guests);
    return { width, depth, mainHeight: depth - 19, aisleEndY: depth - 11 };
  },
  zones(ctx) {
    const main = ctx.zone('audience', '观众区', 1, 7, ctx.width - 2, ctx.layout.mainHeight);
    const stage = ctx.zone('stage', '演出区', ctx.width / 2 - 8, ctx.depth - 11, 16, 9);
    return { main, stage };
  },
  fill(ctx) {
    if (!ctx.stage || !ctx.place('stage-platform-8x6', '演出舞台', ctx.width / 2, ctx.depth - 6.5, 8, 6, ctx.stage)) return null;
    if (!ctx.place('oneplan:scale:large-screen', '侧屏（左）', ctx.width / 2 - 6.25, ctx.depth - 6.5, 3, 0.5, ctx.stage)) return null;
    if (!ctx.place('oneplan:scale:large-screen', '侧屏（右）', ctx.width / 2 + 6.25, ctx.depth - 6.5, 3, 0.5, ctx.stage)) return null;
    const { cols, rows } = concertDerived(ctx.guests);
    const leftCols = Math.ceil(cols / 2);
    let count = 0;
    for (let row = 0; row < rows && count < ctx.guests; row += 1) for (let col = 0; col < cols && count < ctx.guests; col += 1) {
      const offset = col < leftCols ? -(leftCols - col) * 0.95 - 1.5 : (col - leftCols + 1) * 0.95 + 1.5;
      if (ctx.place('oneplan:scale:chair', `观众座椅 ${count + 1}`, ctx.width / 2 + offset, 8 + row * 1.2, 0.55, 0.6, ctx.main)) count += 1;
    }
    if (count < ctx.guests) return null;
    return count;
  },
};

/** 美食节参数表：约每 30 人一辆餐车（至少 2 辆）、每 8 人一张就餐长桌；餐车列贴西半场、长桌在东半场成排，占地宽 20m。 */
function foodFestivalDerived(guests: number): { trucks: number; tables: number; tableRows: number; width: number; depth: number } {
  const trucks = Math.max(2, Math.ceil(guests / 30));
  const tables = Math.ceil(guests / 8);
  const tableRows = Math.ceil(tables / 2);
  return { trucks, tables, tableRows, width: 20, depth: Math.max(trucks * 4, tableRows * 2.5) + 13 };
}

/** 美食节模板：餐车单列在西、就餐长桌两列成排在东，中央通道留给取餐人流。 */
const foodFestivalOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'food-festival',
  label: '美食节',
  match: /美食|小吃|餐饮/u,
  example: '80 人美食节',
  note: '美食节，餐车+就餐长桌',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = foodFestivalDerived(guests);
    return { width, depth, mainHeight: depth - 10, aisleEndY: depth - 1 };
  },
  zones(ctx) {
    return { main: ctx.zone('reserved', '美食区', 1, 7, ctx.width - 2, ctx.layout.mainHeight), stage: null };
  },
  fill(ctx) {
    const { trucks, tables, tableRows } = foodFestivalDerived(ctx.guests);
    let count = 0;
    for (let i = 0; i < trucks; i += 1) {
      if (!ctx.place('food-truck-6x2.5', `美食餐车 ${i + 1}`, ctx.width / 2 - 5.75, 8.5 + i * 4, 6, 2.5, ctx.main)) return null;
    }
    for (let j = 0; j < tableRows * 2 && count < tables; j += 1) {
      const x = j % 2 === 0 ? ctx.width / 2 + 3.5 : ctx.width / 2 + 6.5;
      if (ctx.place('oneplan:scale:picnic-table', `就餐长桌 ${count + 1}`, x, 8.5 + Math.floor(j / 2) * 2.5, 1.8, 0.8, ctx.main)) count += 1;
    }
    if (count < tables) return null;
    return trucks + count;
  },
};

/** 车展参数表：约每 20 位观众一辆展车（4–24 辆夹取），四辆一排、排距 6m 观展通道；占地宽 30m。 */
function carShowDerived(guests: number): { cars: number; carRows: number; width: number; depth: number } {
  const cars = Math.max(4, Math.min(24, Math.ceil(guests / 20)));
  const carRows = Math.ceil(cars / 4);
  return { cars, carRows, width: 30, depth: carRows * 6 + 13 };
}

/** 车展模板：展车四列成网、列间即观展通道，咨询帐篷在展尾一角。注册在展览之前——整串「汽车展览会」按展车网格排。 */
const carShowOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'car-show',
  label: '车展',
  match: /车展|汽车展|新车展示/u,
  example: '100 人车展',
  note: '车展，展车按观展通道成网',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = carShowDerived(guests);
    return { width, depth, mainHeight: depth - 10, aisleEndY: depth - 1 };
  },
  zones(ctx) {
    return { main: ctx.zone('reserved', '展车区', 1, 7, ctx.width - 2, ctx.layout.mainHeight), stage: null };
  },
  fill(ctx) {
    const { cars, carRows } = carShowDerived(ctx.guests);
    let count = 0;
    for (let row = 0; row < carRows && count < cars; row += 1) for (const cx of [-11, -4.5, 4.5, 11]) {
      if (count < cars && ctx.place('oneplan:scale:car', `展车 ${count + 1}`, ctx.width / 2 + cx, 8.5 + row * 6, 4.5, 2, ctx.main)) count += 1;
    }
    if (count < cars) return null;
    if (!ctx.place('tent-3x3', '咨询帐篷', ctx.width / 2 + 8, ctx.depth - 5, 3, 3, ctx.main)) return null;
    return count + 1;
  },
};

/** 运动会参数表：约每 30 人一队（2–8 队），每队给 5m 赛道纵深；占地宽 32m。 */
function sportsDerived(guests: number): { squads: number; width: number; depth: number } {
  const squads = Math.max(2, Math.min(8, Math.ceil(guests / 30)));
  return { squads, width: 32, depth: 14 + squads * 5 };
}

/** 运动会/趣味运动会模板：中央留空赛场（锥桶围出赛道边线），终点龙门架压深端、检录帐篷靠前、休息长凳沿西缘。 */
const sportsOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'sports',
  label: '运动会',
  match: /运动会|趣味运动|体育比赛|体育赛事|体育节/u,
  example: '90 人运动会',
  note: '运动会/趣味运动会',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = sportsDerived(guests);
    return { width, depth, mainHeight: depth - 10, aisleEndY: 9 };
  },
  zones(ctx) {
    return { main: ctx.zone('reserved', '赛场', 1, 7, ctx.width - 2, ctx.layout.mainHeight), stage: null };
  },
  fill(ctx) {
    const { squads } = sportsDerived(ctx.guests);
    if (!ctx.place('oneplan:scale:gantry', '终点龙门架', ctx.width / 2, ctx.depth - 4.5, 6, 1, ctx.main)) return null;
    if (!ctx.place('oneplan:scale:pop-up-tent', '检录帐篷', ctx.width / 2 - 8.75, 8.5, 3, 3, ctx.main)) return null;
    // 赛道边线：两条纵列锥桶 + 南缘两枚（中央留给入口通道，不放锥桶）。
    const coneTop = ctx.depth - 6;
    let cones = 0;
    for (const cx of [-11, 11]) for (let y = 10; y <= coneTop; y += 4) {
      if (ctx.place('oneplan:icon:cone', `赛道界标 ${cones + 1}`, ctx.width / 2 + cx, y, 0.4, 0.4, ctx.main)) cones += 1;
    }
    for (const cx of [-5.5, 5.5]) {
      if (ctx.place('oneplan:icon:cone', `赛道界标 ${cones + 1}`, ctx.width / 2 + cx, 10, 0.4, 0.4, ctx.main)) cones += 1;
    }
    for (let i = 0; i < squads; i += 1) {
      if (!ctx.place('oneplan:scale:bench', `休息长凳 ${i + 1}`, ctx.width / 2 - 13.5, 10 + i * 2.5, 1.8, 0.5, ctx.main)) return null;
    }
    return 2 + cones + squads;
  },
};

/** 展览参数表：复用市集推导（约每 4 人一展位、两列成排），展位放大为 3×3、排距 5m，占地宽 21m。 */
function exhibitionDerived(guests: number): { booths: number; rows: number; width: number; depth: number } {
  const booths = Math.ceil(guests / 4);
  const rows = Math.ceil(booths / 2);
  return { booths, rows, width: 21, depth: rows * 5 + 13 };
}

/** 展览模板：3×3 展位两列成排，中央通道即观展动线。 */
const exhibitionOutdoorEventTemplate: OutdoorEventTemplate = {
  id: 'exhibition',
  label: '展览',
  match: /展览|展会|博览/u,
  example: '60 人展览',
  note: '展览，展位成排',
  aisleWidth: 3,
  measure(guests) {
    const { width, depth } = exhibitionDerived(guests);
    return { width, depth, mainHeight: depth - 10, aisleEndY: depth - 1 };
  },
  zones(ctx) {
    return { main: ctx.zone('reserved', '展区', 1, 7, ctx.width - 2, ctx.layout.mainHeight), stage: null };
  },
  fill(ctx) {
    const { booths, rows } = exhibitionDerived(ctx.guests);
    let count = 0;
    for (let row = 0; row < rows; row += 1) for (const x of [ctx.width / 2 - 4.5, ctx.width / 2 + 4.5]) {
      if (count < booths && ctx.place('booth-2x2', `展位 ${count + 1}`, x, 8.5 + row * 5, 3, 3, ctx.main)) count += 1;
    }
    if (count < booths) return null;
    return count;
  },
};

/**
 * 模板注册表：只回答「有没有几何模板」（D2 起十类：相亲/社交市集、市集、发布会、讲座、婚礼、
 * 演出/音乐会、美食节、车展、运动会、展览），不是活动准入闸门。
 * 2026-11-17 用户拍板「活动类型限制太死板」：类型只决定排布策略——
 * 沿岸类（钓鱼/垂钓）由参照驱动（沿真实水岸线，见 outdoor-shoreline-layout.ts），
 * 其余类型一律走「需求→分区→物料」通用路径；两者都不在这里硬套模板。
 * D1 起识别正则/参数表/摆法以注册表条目为唯一来源：新增活动类型只注册条目，不再改 if/正则。
 * 数组顺序即匹配优先级。存在整串同时命中两族词的说法（模型分类的 brief.event 可能是
 * 「相亲市集」「汽车展览会」「新品发布会」），故相亲先于市集、发布会先于讲座、车展先于展览；
 * 其余条目正则互不相交，顺序只影响可读性。
 */
export const outdoorEventTemplates: OutdoorEventTemplate[] = [
  socialOutdoorEventTemplate,
  marketOutdoorEventTemplate,
  launchOutdoorEventTemplate,
  lectureOutdoorEventTemplate,
  weddingOutdoorEventTemplate,
  concertOutdoorEventTemplate,
  foodFestivalOutdoorEventTemplate,
  carShowOutdoorEventTemplate,
  sportsOutdoorEventTemplate,
  exhibitionOutdoorEventTemplate,
];

/** 模板注册表查找：活动说法命中哪个模块就用哪个；未命中返回 null（≠ 不能做，走通用需求路径）。 */
export function supportedOutdoorEvent(event: string | null): OutdoorEventTemplate | null {
  if (!event) return null;
  return outdoorEventTemplates.find(t => t.match.test(event)) ?? null;
}

/** 「目前支持：…」——从注册表动态生成，注册新模板后话术自动跟上；空注册表返回统一话术，不虚构类型。 */
export function outdoorEventTemplatesSummary(): string {
  const labels = outdoorEventTemplates.map(t => t.label);
  return labels.length ? `目前支持：${labels.join('、')}` : '目前支持：暂无现成模板，活动都能按需求直接排';
}

/** 沿岸类活动（钓鱼/垂钓）：排布沿真实水岸线，人数可空；由 outdoor-shoreline-layout.ts 承接。 */
export function isShorelineEvent(event: string | null | undefined): boolean {
  if (!event) return false;
  return /钓鱼|垂钓|钓位/u.test(event);
}

/** 返回模板路径缺失的前置信息；未知类型与沿岸类不再拦死（2026-11-17 用户拍板）。 */
export function outdoorEventIssue(event: string | null, guests: number | null): string | null {
  if (!event) {
    // 示例说法从注册表动态生成（D1）：注册表空跑时不列出编造示例。
    const examples = outdoorEventTemplates.map(t => `「${t.example}」`).join('');
    return examples ? `先说活动类型，例如${examples}，或沿岸类的「钓鱼比赛」。` : '先说活动类型，或沿岸类的「钓鱼比赛」。';
  }
  if (isShorelineEvent(event)) return null; // 沿岸按真实岸线几何定钓位，人数可空；水岸/界外由沿岸引擎如实给下一步。
  if (!supportedOutdoorEvent(event)) return null; // 没有现成模板 ≠ 不能做：走「需求→分区→物料」通用路径，不套假模板。
  if (!guests || !Number.isFinite(guests) || !Number.isInteger(guests) || guests < 1) return '还缺预计人数；说一句「45 人讲座」或「80 人市集」即可继续。';
  if (guests > 200) return '这版只支持 1–200 人的小型活动；更大活动需要人工核对容量、疏散和交通组织。';
  return null;
}

function box(ring: readonly PlanPoint[]) {
  return { w: Math.min(...ring.map(p => p.x)), e: Math.max(...ring.map(p => p.x)), s: Math.min(...ring.map(p => p.y)), n: Math.max(...ring.map(p => p.y)) };
}
function overlaps(a: PlanFacility, b: PlanFacility): boolean {
  const x = box(facilityFootprintRing(a)); const y = box(facilityFootprintRing(b));
  return x.w < y.e + 0.3 && x.e > y.w - 0.3 && x.s < y.n + 0.3 && x.n > y.s - 0.3;
}
function pathCrossesRing(points: PlanPoint[], ring: PlanPoint[]): boolean {
  if (points.some(p => planPointInRing(p, ring))) return true;
  for (let i = 1; i < points.length; i += 1) for (let j = 0; j < ring.length; j += 1) {
    if (planSegmentsCrossStrict(points[i - 1]!, points[i]!, ring[j]!, ring[(j + 1) % ring.length]!)) return true;
  }
  return false;
}

/** Width-aware swept strips. End caps stay at the confirmed portal, not outside the site. */
export function outdoorCorridorStrips(points: PlanPoint[], width: number): PlanPoint[][] {
  const rings: PlanPoint[][] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!; const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y); if (length < 0.01) continue;
    const nx = -(b.y - a.y) / length * width / 2; const ny = (b.x - a.x) / length * width / 2;
    rings.push([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }]);
  }
  return rings;
}
export function outdoorRingsOverlap(a: PlanPoint[], b: PlanPoint[]): boolean {
  return pathCrossesRing([...a, a[0]!], b) || pathCrossesRing([...b, b[0]!], a);
}

/** 点是否在环的严格内部（贴边不算）。OSM 道路与建筑常共享墙角顶点，贴边不是「穿楼」。 */
function strictlyInsideRing(pt: PlanPoint, ring: PlanPoint[]): boolean {
  if (!planPointInRing(pt, ring)) return false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!,
      dx = b.x - a.x,
      dy = b.y - a.y,
      len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) continue;
    const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
    if (t < 0 || t > 1) continue;
    if (Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)) <= 1e-6)
      return false;
  }
  return true;
}

/**
 * 路线中心线真正走进足迹内部的段长（米）。
 *
 * 判据是「中心线进入足迹内部」，不是「离墙多近」：
 * OSM 的道路中心线与建筑轮廓常在墙角共享顶点、互相「贴」着走，
 * 拿中心线距离当冲突判据会把这种贴墙路线整轮否掉；
 * 反过来，中心线从楼里穿过去（离墙远）才是真问题。
 * 只碰边界不算进入——碰边是共顶点，不是占用。
 * 用 1m 采样量长度：长线段只要有一截进楼，量到的就是那一截，不按整段算。
 */
export function outdoorRouteInsideRingLength(
  points: PlanPoint[],
  ring: PlanPoint[],
): number {
  if (ring.length < 3 || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.01) continue;
    const steps = Math.max(1, Math.ceil(length));
    let inside = 0;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      if (
        strictlyInsideRing(
          { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
          ring,
        )
      )
        inside += 1;
    }
    total += (inside / steps) * length;
  }
  return total;
}

function distanceToRoute(point: PlanPoint, route: PlanRoute): number {
  let best = Infinity;
  for (let i = 1; i < route.points.length; i += 1) {
    const a = route.points[i - 1]!; const b = route.points[i]!; const dx = b.x - a.x; const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return best;
}
/** Real portals only; an outside node or an activity sub-portal is not a confirmed site entrance. */
export function confirmedOutdoorEntrances(nodes: readonly PlanNode[], boundary: readonly PlanPoint[]): PlanNode[] {
  return nodes.filter(node => node.verification!=='unverified' && node.kind !== 'exit' && !/子口|子出入口/u.test(node.name + node.notes) && planPointInRing(node.position, boundary));
}
export function outdoorEventSiteSummary(input: Pick<BuildZoneEventInput, 'boundary' | 'nodes' | 'existingRoutes' | 'existingFacilities'>): string {
  const b = box(input.boundary);
  const area = Math.abs(input.boundary.reduce((sum,p,i)=>{const q=input.boundary[(i+1)%input.boundary.length]!;return sum+p.x*q.y-q.x*p.y;},0))/2;
  return `当前边界包围盒约 ${(b.e-b.w).toFixed(1)}×${(b.n-b.s).toFixed(1)}m、面积约 ${Math.round(area)}㎡（不等于可用活动面积），边界内有效入口 ${confirmedOutdoorEntrances(input.nodes,input.boundary).length} 个；现有设施 ${input.existingFacilities?.length ?? 0} 件、人行线 ${(input.existingRoutes??[]).filter(r=>r.kind==='pedestrian').length} 条、车行/后勤线 ${(input.existingRoutes??[]).filter(r=>r.kind!=='pedestrian').length} 条。`;
}
/** At a boundary portal first travel perpendicular into the site. A diagonal sweep at the
 * portal spills outside even when its centreline fits; never waive the full-width guard. */
function connectionPaths(from: PlanPoint, to: PlanPoint, boundary: PlanPoint[]): PlanPoint[][] {
  const inward = (point: PlanPoint): PlanPoint[] => {
    let edge: {a:PlanPoint;b:PlanPoint;distance:number}|null=null;
    for(let i=0;i<boundary.length;i+=1){
      const a=boundary[i]!,b=boundary[(i+1)%boundary.length]!,dx=b.x-a.x,dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
      const distance=Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
      if(!edge||distance<edge.distance)edge={a,b,distance};
    }
    if(!edge||edge.distance>3)return [];
    const dx=edge.b.x-edge.a.x,dy=edge.b.y-edge.a.y,length=Math.hypot(dx,dy);
    if(length<0.01)return [];
    return [1,-1].map(sign=>({x:point.x-sign*dy/length*3,y:point.y+sign*dx/length*3})).filter(p=>planPointInRing(p,boundary));
  };
  const paths:PlanPoint[][]=[];
  for(const start of [null,...inward(from)])for(const end of [null,...inward(to)]){
    const a=start??from,b=end??to;
    for(const middle of [[],[{x:a.x,y:b.y}],[{x:b.x,y:a.y}]]){
      const points=[from,...(start?[start]:[]),...middle,...(end?[end]:[]),to];
      paths.push(points.filter((p,i)=>i===0||Math.hypot(p.x-points[i-1]!.x,p.y-points[i-1]!.y)>0.01));
    }
  }
  return paths;
}

export function buildLogicalOutdoorEvent(input: BuildZoneEventInput, id: () => string): ZoneEventProposal | null {
  // 注册表派发（D1/D2）：命中哪个模板模块就用它出几何提案。注册表外的类型不走模板：
  // 沿岸类走 outdoor-shoreline-layout.ts，其他类型走通用需求路径——未知/沿岸返回 null，绝不硬套市集网格。
  const template = supportedOutdoorEvent(input.brief.event);
  const guests = input.brief.guests;
  if (!template || outdoorEventIssue(input.brief.event, guests) || !guests) return null;
  const { boundary } = input;
  if (boundary.length < 3) return null;
  const bb = box(boundary);
  const entranceScore = (node: PlanNode) => (input.existingRoutes ?? []).reduce((score, route) => {
    if (distanceToRoute(node.position, route) > (route.widthM ?? 3) / 2 + 1) return score;
    return score + (route.kind === 'pedestrian' ? -10 : 100);
  }, 0);
  const entrance = confirmedOutdoorEntrances(input.nodes, boundary).sort((a, b) => entranceScore(a) - entranceScore(b))[0];
  if (!entrance) return null;
  const side: Side = !entrance ? 'S' : ([
    ['S', Math.abs(entrance.position.y - bb.s)], ['N', Math.abs(entrance.position.y - bb.n)],
    ['W', Math.abs(entrance.position.x - bb.w)], ['E', Math.abs(entrance.position.x - bb.e)],
  ] as [Side, number][]).sort((a, b) => a[1] - b[1])[0]![0];
  const layout = template.measure(guests);
  const { width, depth } = layout;
  const alongY = side === 'S' || side === 'N';
  const rectW = alongY ? width : depth; const rectH = alongY ? depth : width;
  if (bb.e - bb.w < rectW + 2 || bb.n - bb.s < rectH + 2) return null;
  const local = (x: number, y: number): PlanPoint => {
    if (side === 'S') return { x, y };
    if (side === 'N') return { x: width - x, y: depth - y };
    if (side === 'W') return { x: y, y: width - x };
    return { x: depth - y, y: x };
  };
  const candidates: PlanPoint[] = [];
  for (let ix = 0; ix <= 8; ix += 1) for (let iy = 0; iy <= 8; iy += 1) candidates.push({
    x: bb.w + 1 + (bb.e - bb.w - rectW - 2) * ix / 8,
    y: bb.s + 1 + (bb.n - bb.s - rectH - 2) * iy / 8,
  });
  const priority = entrance?.position ?? { x: (bb.w + bb.e) / 2, y: bb.s };
  candidates.sort((a, b) => Math.hypot(a.x + rectW / 2 - priority.x, a.y + rectH / 2 - priority.y) - Math.hypot(b.x + rectW / 2 - priority.x, b.y + rectH / 2 - priority.y));
  const tryCandidate = (origin: PlanPoint): ZoneEventProposal | null => {
    const point = (x: number, y: number): PlanPoint => {
      const p = local(x, y);
      return { x: Math.round((origin.x + p.x) * 10) / 10, y: Math.round((origin.y + p.y) * 10) / 10 };
    };
    const zones: PlanZone[] = [];
    const facilities: PlanFacility[] = [];
    const zone = (semantic: PlanZone['semantic'], name: string, x: number, y: number, w: number, h: number): PlanZone => {
      const result: PlanZone = { id: id(), semantic, name, event: `${input.brief.event}·${name}`.slice(0, 120),
        polygon: [point(x, y), point(x + w, y), point(x + w, y + h), point(x, y + h)],
        notes: `${guests} 人${template.note}；通道与外侧留白不计入设施占地。` };
      zones.push(result); return result;
    };
    const checkin = zone('checkin', '签到区', width / 2 - 5, 0, 10, 4);
    const medical = zone('medical', '医疗点', 0, 0, 4, 4);
    const { main, stage } = template.zones({ width, depth, layout, zone });
    const facing = side === 'S' ? 0 : side === 'N' ? 180 : side === 'W' ? 90 : 270;
    const place = (templateId: string, name: string, x: number, y: number, w: number, d: number, parent: PlanZone): boolean => {
      const item: PlanFacility = { id: id(), templateId, name, position: point(x, y), rotationDeg: facing,
        size: { width: w, depth: d }, zoneId: parent.id, notes: '活动逻辑提案：面向舞台/通道；非安全认证。' };
      const ring = facilityFootprintRing(item);
      if (facilityPlacementIssues(ring, boundary).length || facilityPlacementIssues(ring, parent.polygon).length) return false;
      if ([...facilities, ...(input.existingFacilities ?? [])].some(other => overlaps(item, other))) return false;
      facilities.push(item); return true;
    };
    if (!place('booth-2x2', '签到台', width / 2 - 3, 2, 2, 2, checkin)
      || !place('medical-tent-4x3', '医疗帐篷', 2, 2, 4, 3, medical)) return null;
    // 模板自有设施（讲台/摊位等）由注册表条目摆；摆不下整版就否决，不产出「看起来能容纳」的提案。
    if (template.fill({ guests, width, depth, layout, place, main, stage }) === null) return null;
    if (zones.some(z => facilityPlacementIssues(z.polygon, boundary).length)) return null;
    const aisle = [point(width / 2, 0), point(width / 2, layout.aisleEndY)];
    const routes: PlanRoute[] = [{ id: id(), kind: 'pedestrian', name: '活动中央人行通道', points: aisle, widthM: template.aisleWidth, oneWay: false, notes: `预留${template.aisleWidth}m示意通道，需现场核对；非疏散安全认证。` }];
    const nodes: PlanNode[] = [];
    const clearCorridor = (points: PlanPoint[]): boolean => outdoorCorridorStrips(points, template.aisleWidth).every(strip =>
      !facilityPlacementIssues(strip, boundary).length
      && ![...facilities, ...(input.existingFacilities ?? [])].some(f => outdoorRingsOverlap(strip, facilityFootprintRing(f)))
      && !(input.existingRoutes ?? []).some(r => r.kind !== 'pedestrian' && outdoorCorridorStrips(r.points, (r.widthM ?? 4) + 2).some(road => outdoorRingsOverlap(strip, road))));
    if (!clearCorridor(aisle)) return null;
    // Preserve existing pedestrian aisles as real occupied corridors, not just harmless centerlines.
    if ((input.existingRoutes ?? []).some(r => r.kind === 'pedestrian' && outdoorCorridorStrips(r.points, r.widthM ?? 3).some(strip => facilities.some(f => outdoorRingsOverlap(strip, facilityFootprintRing(f)))))) return null;
    const warnings = ['按面积和用途排的几何初稿。', '厕所、停车、后勤、无障碍的位置等你指定。'];
    if (entrance) {
      const end = aisle[0]!;
      const paths = connectionPaths(entrance.position, end, boundary);
      const path = paths.find(clearCorridor);
      if (!path) return null;
      if (Math.hypot(entrance.position.x - end.x, entrance.position.y - end.y) > 0.5) routes.push({ id: id(), kind: 'pedestrian', name: '入口至签到接驳', points: path, widthM: template.aisleWidth, oneWay: false, notes: '入口→签到→观众/市集；需现场复核。' });
    } else warnings.push('尚未确认场地入口：请先完成流线/出入口并重新生成。');
    const otherExits = input.nodes.filter(node => node.id !== entrance?.id && node.kind !== 'entry');
    let connectedExits = 0;
    for (const exit of otherExits.slice(0, 2)) {
      const from = aisle[aisle.length - 1]!;
      const paths = connectionPaths(from, exit.position, boundary);
      const path = paths.find(clearCorridor);
      if (!path) continue;
      routes.push({ id: id(), kind: 'pedestrian', name: '活动区至既有出口接驳', points: path, widthM: template.aisleWidth, oneWay: false, notes: '只接已有出口，不新造场地疏散出口；需现场核对。' });
      connectedExits += 1;
    }
    if (!connectedExits) warnings.push('未连通独立的第二出口，不能据此认定疏散合格；请补充真实出口并重排。');
    // 子口在既有人行通道上，不把它冒充一个新的场地疏散出口。
    nodes.push({ id: id(), kind: 'both', name: '活动区子口', position: aisle[0]!, notes: '活动子口（不是场地疏散出口）。' });
    return { zones, facilities, routes, nodes, summary: { zones: zones.length, facilities: facilities.length, side, warnings } };
  };
  for (const candidate of candidates) {
    const ring = [{ x: candidate.x, y: candidate.y }, { x: candidate.x + rectW, y: candidate.y }, { x: candidate.x + rectW, y: candidate.y + rectH }, { x: candidate.x, y: candidate.y + rectH }];
    if (facilityPlacementIssues(ring, boundary).length) continue;
    if ((input.existingRoutes ?? []).some(route => {
      if (route.kind === 'pedestrian') return false;
      const b = box(ring); const pad = (route.widthM ?? 4) / 2 + 1;
      return pathCrossesRing(route.points, [{ x: b.w - pad, y: b.s - pad }, { x: b.e + pad, y: b.s - pad }, { x: b.e + pad, y: b.n + pad }, { x: b.w - pad, y: b.n + pad }]);
    })) continue;
    if ((input.existingFacilities ?? []).some(f => pathCrossesRing(facilityFootprintRing(f), ring) || planPointInRing(ring[0]!, facilityFootprintRing(f)))) continue;
    const proposal = tryCandidate(candidate);
    if (proposal) return proposal;
  }
  return null;
}
