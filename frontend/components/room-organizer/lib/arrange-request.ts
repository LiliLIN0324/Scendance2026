/**
 * 「一句话布置」内核（2026-11-17，目标 v0）。
 *
 * 目标：把一句需求（「30 人观礼，要能坐，前面留 2 米通道，椅子用深木」）
 * 变成可落库的设施列表——选什么、选几个、摆在哪、什么材质。
 *
 * 本模块只做确定性计算，零 three / 零 React：
 * 1. `parseArrangeDemand()`：抽数量、能力、材质、通道宽度；
 * 2. `selectArrangeCandidates()`：按能力表 + 真实宽深选物料，不靠名字猜；
 * 3. `layoutGrid()`：在边界内按行排布，预留通道，返回可直接写 plan 的设施。
 *
 * 所有产出都要过 `planFacilitySchema`（调用方负责），本模块只保证几何与能力正确。
 */

export interface ArrangeDemand {
  /** 需求人数 / 数量；没说就 null（调用方要求用户补充）。 */
  count: number | null;
  /** 能力：可坐 / 可交谈 / 可操作；没说就 null。 */
  capability: 'seat' | 'talk' | 'operate' | null;
  /** 材质预设 id（见 `material-presets.ts`）；没说就 null。 */
  material: string | null;
  /** 通道净宽（米）；说了才预留。 */
  aisleM: number | null;
  /** 风格/用途词，原样留给候选排序（如「婚礼」「市集」）。 */
  scene: string | null;
}

const CAPABILITY_WORDS: ReadonlyArray<[RegExp, ArrangeDemand['capability']]> = [
  [/观礼|座位|坐|椅|凳/, 'seat'],
  [/交谈|聊天|接待|咨询|签到/, 'talk'],
  [/操作|自助|取号|ATM|售票机/, 'operate'],
];

const MATERIAL_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/拉丝钢|不锈钢/, 'steel'],
  [/黑金属|金属|铁艺/, 'metal'],
  [/深木|胡桃|深色木/, 'walnut'],
  [/浅木|原木|橡木/, 'oak'],
  [/布艺|织物|绒/, 'fabric'],
  [/玻璃/, 'glass'],
];

const SCENE_WORDS = /婚礼|市集|发布会|音乐节|展览|庆典|开幕式/;

/** 从一句话里抽结构化约束。不猜没有的信息：没写就是 null。 */
export function parseArrangeDemand(text: string): ArrangeDemand {
  const source = text.trim();
  const countMatch = /(\d+)\s*(?:人|把|个|张|席|位)/.exec(source);
  const count = countMatch ? Number.parseInt(countMatch[1]!, 10) : null;
  const capability = CAPABILITY_WORDS.find(([pattern]) => pattern.test(source))?.[1] ?? null;
  const material = MATERIAL_WORDS.find(([pattern]) => pattern.test(source))?.[1] ?? null;
  const aisleMatch =
    /(?:通道|过道|疏散)[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(?:米|m|M)?/.exec(source)
    ?? /(\d+(?:\.\d+)?)\s*(?:米|m|M)[^，。;；]{0,4}(?:通道|过道|疏散)/.exec(source);
  const scene = SCENE_WORDS.exec(source)?.[0] ?? null;
  return {
    count: count !== null && Number.isFinite(count) && count > 0 ? count : null,
    capability,
    material,
    aisleM: aisleMatch ? Number.parseFloat(aisleMatch[1]!) : null,
    scene,
  };
}

export interface ArrangeItem {
  slug: string;
  name: string;
  width: number;
  depth: number;
  /** 能力表口径：seat / seat-set / table / stage / booth / operate / none / person。 */
  kind: string;
  actions?: readonly string[];
}

export interface RankedArrangeItem {
  item: ArrangeItem;
  /** 越小越优：先看尺寸合不合适，再按场景语义加减分。 */
  score: number;
  /** 给用户看的选型理由，不允许空着。 */
  reason: string;
}

/** 场景词 → 名称亲和词。「观礼」要的是礼堂椅/长凳，不是纹身凳。 */
const SCENE_AFFINITY: ReadonlyArray<{ scene: RegExp; keywords: RegExp; boost: number }> = [
  { scene: /观礼|观众|典礼|婚礼|演出|毕业|年会/, keywords: /礼堂|剧院|折叠|堆叠|stack|folding/i, boost: 4 },
  { scene: /观礼|观众|典礼|婚礼|演出|毕业|年会/, keywords: /椅|凳|bench|chair|stool|seat/i, boost: 2.5 },
  { scene: /市集|摊位|摆摊|义卖/, keywords: /摊|booth|stall|market|棚|伞|推车/i, boost: 3 },
  { scene: /接待|签到|咨询|登记/, keywords: /台|桌|desk|counter|reception|booth/i, boost: 2.5 },
  { scene: /用餐|餐桌|吃饭|宴会/, keywords: /桌|table|dining|banquet/i, boost: 2.5 },
  { scene: /休息|休闲|洽谈/, keywords: /沙发|sofa|bench|长凳|椅/i, boost: 1.5 },
];

/** 与场景明显不沾边的用途词：宁可排后，也不推给用户。 */
const OFF_SCENE = /纹身|tattoo|理发|barber|美甲|nail|医疗|medical|牙科|dental|办公|office|厨房|kitchen|马桶|toilet|浴缸|bathtub/i;

/** 需求能力 → 可接受的物料 kind。 */
const KIND_ACCEPTS: Record<NonNullable<ArrangeDemand['capability']>, readonly string[]> = {
  seat: ['seat', 'seat-set'],
  talk: ['seat', 'seat-set', 'table', 'booth', 'display', 'stage'],
  operate: ['operate'],
};

/**
 * 选物料：先按能力过滤，再按「与目标占地最接近」排序。
 * 目标占地：座椅取 0.55 m 见方，其余按 1.2 m；尺寸越接近越优先，同分按名称稳定排序。
 *
 * 这是无上下文的兼容入口；带一句话原文时用 `rankArrangeCandidates` 拿语义排序与理由。
 */
export function selectArrangeCandidates(
  items: readonly ArrangeItem[],
  demand: ArrangeDemand,
  limit = 3,
): ArrangeItem[] {
  return rankArrangeCandidates(items, demand, limit).map(entry => entry.item);
}

/**
 * 带语义的候选排序（2026-11-17 v1）。
 *
 * 成熟产品的共同点不是「生成得多」，而是「候选讲得清」：IKEA Kreativ、千问购物助手
 * 都是先给 3–5 个真实商品，再说为什么选它。这里把理由固定成可复核的规则：
 * 能力命中、尺寸接近、场景词匹配、避开不相关用途。
 *
 * @param sourceText 用户原话（用于场景词判断）；不传则退化为纯尺寸排序。
 */
export function rankArrangeCandidates(
  items: readonly ArrangeItem[],
  demand: ArrangeDemand,
  limit = 3,
  sourceText = '',
): RankedArrangeItem[] {
  if (!demand.capability) return [];
  const accepts = KIND_ACCEPTS[demand.capability];
  const target = demand.capability === 'seat' ? 0.55 : 1.2;
  const sceneText = `${sourceText} ${demand.scene ?? ''}`;
  return items
    .filter(item => accepts.includes(item.kind))
    .filter(item => item.width > 0 && item.depth > 0)
    .map(item => {
      const sizeGap = Math.abs(Math.max(item.width, item.depth) - target);
      let score = sizeGap;
      const reasons: string[] = ['能力命中'];
      if (sizeGap <= 0.2) reasons.push('尺寸接近');
      for (const rule of SCENE_AFFINITY) {
        if (rule.scene.test(sceneText) && rule.keywords.test(item.name)) {
          score -= rule.boost;
          reasons.push('场景匹配');
          break;
        }
      }
      if (OFF_SCENE.test(item.name)) {
        score += 2.5;
        reasons.push('用途不相关，排后');
      }
      return { item, score, reason: reasons.join(' · ') };
    })
    .sort((a, b) => (a.score === b.score ? a.item.slug.localeCompare(b.item.slug) : a.score - b.score))
    .slice(0, Math.max(0, limit));
}

export interface ArrangeBoundaryPoint {
  x: number;
  y: number;
}

export interface ArrangeGridInput {
  boundary: readonly ArrangeBoundaryPoint[];
  count: number;
  width: number;
  depth: number;
  /** 物件间距（米）。 */
  gap?: number;
  /** 预留通道净宽（米），放在最前面一行之上。 */
  aisleM?: number;
  /** 网格左右留边（米）。 */
  margin?: number;
}

export interface ArrangePlacement {
  x: number;
  y: number;
  rotationDeg: number;
}

function boundsOf(points: readonly ArrangeBoundaryPoint[]) {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * 行优先网格：从后往前排，每行放得下就放，行距 = 深度 + 间距；
 * 预留通道时整块内容上移，保证通道在最前方（y 最小侧）。
 * 返回的坐标是平面米坐标（ENU），可直接写进 facility.position。
 */
export function layoutGrid(input: ArrangeGridInput): ArrangePlacement[] {
  const { boundary, count, width, depth } = input;
  if (boundary.length < 3 || count <= 0) return [];
  const gap = input.gap ?? 0.6;
  const margin = input.margin ?? 0.5;
  const aisle = input.aisleM ?? 0;
  const box = boundsOf(boundary);
  const usableWidth = box.maxX - box.minX - margin * 2;
  const usableDepth = box.maxY - box.minY - margin * 2 - aisle;
  if (usableWidth < width || usableDepth < depth) return [];
  const perRow = Math.max(1, Math.floor((usableWidth + gap) / (width + gap)));
  const rows = Math.ceil(count / perRow);
  if (rows * depth + (rows - 1) * gap > usableDepth) return [];
  const out: ArrangePlacement[] = [];
  const rowWidth = perRow * width + (perRow - 1) * gap;
  const startX = box.minX + margin + (usableWidth - rowWidth) / 2 + width / 2;
  const frontY = box.minY + margin + aisle;
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    out.push({
      x: startX + col * (width + gap),
      y: frontY + depth / 2 + row * (depth + gap),
      rotationDeg: 0,
    });
  }
  return out;
}
