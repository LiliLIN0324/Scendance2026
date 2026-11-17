/**
 * 场景套装（2026-11-17 v6）：观礼区 + 市集摊位带。
 *
 * 与「网格布置」的区别：
 * - 观礼区：座椅成排、统一面向舞台（前场），前排让出通道；
 * - 摊位带：沿一条中央通道两列排开，摊口朝通道，中间净宽可核。
 *
 * 纯函数，零 three / 零 React；返回可直接写 plan 的位置与朝向。
 */

export type SceneKind = 'audience' | 'stalls';

export interface SceneDemand {
  kind: SceneKind;
  count: number;
  aisleM: number | null;
  /** 摊位排布：两侧=沿中央通道；单侧=一排；背靠背=两列背对背、外侧通道。 */
  stallLayout?: 'two-sided' | 'single' | 'back-to-back';
}

const AUDIENCE_WORDS = /观礼|观众|看台|观众席|典礼|演出|毕业|年会/;
const STALL_WORDS = /摊位|市集|摆摊|义卖|集市/;

/**
 * 识别场景套装需求。
 * 只认带数量的明确说法；「6 组洽谈，4 人一桌」属于宴会套装，交给 `parseSuiteDemand`。
 */
export function parseSceneDemand(text: string): SceneDemand | null {
  const source = text.trim();
  if (!source) return null;
  const aisleMatch =
    /(?:通道|过道|疏散)[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(?:米|m|M)?/.exec(source)
    ?? /(\d+(?:\.\d+)?)\s*(?:米|m|M)[^，。;；]{0,4}(?:通道|过道|疏散)/.exec(source);
  const aisleM = aisleMatch ? Number.parseFloat(aisleMatch[1]!) : null;
  const audience = AUDIENCE_WORDS.test(source) && !STALL_WORDS.test(source);
  const stalls = STALL_WORDS.test(source);
  const stallLayout: 'two-sided' | 'single' | 'back-to-back' = /背靠背|背对背/.test(source)
    ? 'back-to-back'
    : /单侧|一侧|一排|单面/.test(source) ? 'single' : 'two-sided';
  if (audience) {
    const match = /(\d+)\s*(?:人|座|位|把|个)/.exec(source);
    if (!match) return null;
    const count = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    return { kind: 'audience', count, aisleM };
  }
  if (stalls) {
    const match = /(\d+)\s*(?:个|顶|摊|位|间)/.exec(source);
    if (!match) return null;
    const count = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    return { kind: 'stalls', count, aisleM, stallLayout };
  }
  return null;
}

export interface ScenePlacement {
  x: number;
  y: number;
  rotationDeg: number;
}

export interface SceneBoundaryPoint {
  x: number;
  y: number;
}

const boundsOf = (points: readonly SceneBoundaryPoint[]) => ({
  minX: Math.min(...points.map(point => point.x)),
  maxX: Math.max(...points.map(point => point.x)),
  minY: Math.min(...points.map(point => point.y)),
  maxY: Math.max(...points.map(point => point.y)),
});

export interface AudienceInput {
  boundary: readonly SceneBoundaryPoint[];
  count: number;
  seatWidth?: number;
  seatDepth?: number;
  gap?: number;
  /** 前排通道净宽（米）。 */
  aisleM?: number;
  margin?: number;
}

/**
 * 观礼区：从舞台侧（y 最小）向后成排，统一面向舞台（rotation 180）。
 * 前排先让出通道，排不下就返回空，不硬塞。
 */
export function layoutAudience(input: AudienceInput): ScenePlacement[] {
  const { boundary, count } = input;
  if (boundary.length < 3 || count <= 0) return [];
  const seatWidth = input.seatWidth ?? 0.55;
  const seatDepth = input.seatDepth ?? 0.53;
  const gap = input.gap ?? 0.45;
  const aisle = input.aisleM ?? 0;
  const margin = input.margin ?? 0.5;
  const box = boundsOf(boundary);
  const usableWidth = box.maxX - box.minX - margin * 2;
  const usableDepth = box.maxY - box.minY - margin * 2 - aisle;
  if (usableWidth < seatWidth || usableDepth < seatDepth) return [];
  const perRow = Math.max(1, Math.floor((usableWidth + gap) / (seatWidth + gap)));
  const rows = Math.ceil(count / perRow);
  if (rows * seatDepth + (rows - 1) * gap > usableDepth) return [];
  const rowWidth = perRow * seatWidth + (perRow - 1) * gap;
  const startX = box.minX + margin + (usableWidth - rowWidth) / 2 + seatWidth / 2;
  const frontY = box.minY + margin + aisle + seatDepth / 2;
  const out: ScenePlacement[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    out.push({
      x: startX + col * (seatWidth + gap),
      y: frontY + row * (seatDepth + gap),
      // 0° 朝 +y；观礼座椅面向舞台（y 最小侧），转 180°。
      rotationDeg: 180,
    });
  }
  return out;
}

export interface StageRect {
  x: number;
  y: number;
  width: number;
  depth: number;
}

export interface AudienceFacingInput extends AudienceInput {
  /** 舞台/主台的真实占地（中心 + 宽深）。 */
  stage: StageRect;
  /** 座椅与舞台边缘的最小净距（米），默认 1.2；通道更宽时取通道。 */
  stageClearance?: number;
}

/**
 * 带舞台锚点的观礼区：在舞台四周选空间最大的一侧成排，全部面向舞台。
 * 舞台在前场（y 小）→ 看席在后方朝 -y（180°）；舞台在顶部 → 朝 +y（0°）；
 * 舞台在左 → 看席在右侧朝 -x（270°）；舞台在右 → 朝 +x（90°）。
 */
export function layoutAudienceFacing(input: AudienceFacingInput): ScenePlacement[] {
  const { boundary, count, stage } = input;
  if (boundary.length < 3 || count <= 0) return [];
  const seatWidth = input.seatWidth ?? 0.55;
  const seatDepth = input.seatDepth ?? 0.53;
  const gap = input.gap ?? 0.45;
  const margin = input.margin ?? 0.5;
  const clearance = Math.max(input.stageClearance ?? 1.2, input.aisleM ?? 0);
  const box = boundsOf(boundary);
  const stageLeft = stage.x - stage.width / 2;
  const stageRight = stage.x + stage.width / 2;
  const stageTop = stage.y - stage.depth / 2;
  const stageBottom = stage.y + stage.depth / 2;
  const sides = [
    { side: 'down' as const, free: box.maxY - stageBottom },
    { side: 'up' as const, free: stageTop - box.minY },
    { side: 'right' as const, free: box.maxX - stageRight },
    { side: 'left' as const, free: stageLeft - box.minX },
  ].sort((a, b) => b.free - a.free);
  const best = sides[0]!;
  if (best.free < clearance + seatDepth + margin) return [];
  const vertical = best.side === 'down' || best.side === 'up';
  const spanMin = vertical ? box.minX + margin : box.minY + margin;
  const spanMax = vertical ? box.maxX - margin : box.maxY - margin;
  const span = spanMax - spanMin;
  if (span < seatWidth) return [];
  const perRow = Math.max(1, Math.floor((span + gap) / (seatWidth + gap)));
  const rows = Math.ceil(count / perRow);
  const depthAvailable = best.free - clearance - margin;
  if (rows * seatDepth + (rows - 1) * gap > depthAvailable) return [];
  const rowSpan = perRow * seatWidth + (perRow - 1) * gap;
  const start = spanMin + (span - rowSpan) / 2 + seatWidth / 2;
  const rotationDeg = best.side === 'down' ? 180 : best.side === 'up' ? 0 : best.side === 'left' ? 90 : 270;
  const out: ScenePlacement[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const along = start + col * (seatWidth + gap);
    const offset = clearance + seatDepth / 2 + row * (seatDepth + gap);
    if (vertical) {
      out.push({
        x: along,
        y: best.side === 'down' ? stageBottom + offset : stageTop - offset,
        rotationDeg,
      });
    } else {
      out.push({
        x: best.side === 'right' ? stageRight + offset : stageLeft - offset,
        y: along,
        rotationDeg,
      });
    }
  }
  return out;
}

export interface StallInput {
  boundary: readonly SceneBoundaryPoint[];
  count: number;
  stallWidth?: number;
  stallDepth?: number;
  gap?: number;
  /** 中央通道净宽（米），默认 2.4。 */
  aisleM?: number;
  margin?: number;
  /** 两侧（默认）、单侧一排或背靠背。 */
  layout?: 'two-sided' | 'single' | 'back-to-back';
  /** 需避让的建筑/障碍矩形（米）。 */
  blocked?: ReadonlyArray<{ x: number; y: number; width: number; depth: number }>;
}

/**
 * 摊位带：中央通道两列，左列朝右（rotation 90）、右列朝左（rotation 270）。
 * 摊位沿通道方向按宽度排列；放不下返回空。
 */
export function layoutStalls(input: StallInput): ScenePlacement[] {
  const { boundary, count } = input;
  if (boundary.length < 3 || count <= 0) return [];
  const stallWidth = input.stallWidth ?? 2;
  const stallDepth = input.stallDepth ?? 2;
  const gap = input.gap ?? 0.6;
  const aisle = input.aisleM ?? 2.4;
  const margin = input.margin ?? 0.5;
  const columns = input.layout === 'single' ? 1 : 2;
  const backToBack = input.layout === 'back-to-back';
  const box = boundsOf(boundary);
  const usableWidth = box.maxX - box.minX - margin * 2;
  const usableDepth = box.maxY - box.minY - margin * 2;
  const needWidth = columns === 1 ? stallDepth : backToBack ? stallDepth * 2 : aisle + stallDepth * 2;
  if (usableWidth < needWidth) return [];
  const capacity = Math.max(0, Math.floor((usableDepth + gap) / (stallWidth + gap)));
  if (capacity === 0) return [];
  const centerX = (box.minX + box.maxX) / 2;
  const leftX = backToBack ? centerX - stallDepth / 2 : centerX - aisle / 2 - stallDepth / 2;
  const rightX = backToBack ? centerX + stallDepth / 2 : centerX + aisle / 2 + stallDepth / 2;
  const columnDepth = capacity * stallWidth + (capacity - 1) * gap;
  const startY = box.minY + margin + (usableDepth - columnDepth) / 2 + stallWidth / 2;
  const blocked = input.blocked ?? [];
  const hits = (x: number, y: number) => blocked.some(rect =>
    Math.abs(x - rect.x) < (stallDepth + rect.width) / 2 + 0.3
    && Math.abs(y - rect.y) < (stallWidth + rect.depth) / 2 + 0.3);
  const out: ScenePlacement[] = [];
  const columnsOrder = columns === 1 ? [0] : [0, 1];
  // 先按均分目标铺（4/4），再回填两侧剩余容量（一侧被建筑占时用）。
  const target = Math.min(capacity, Math.ceil(count / columns));
  const place = (column: number, from: number, limit: number, until: number) => {
    const x = column === 0 ? leftX : rightX;
    for (let index = from; index < limit && out.length < until; index += 1) {
      const y = startY + index * (stallWidth + gap);
      if (hits(x, y)) continue;
      out.push({ x, y, rotationDeg: backToBack ? (column === 0 ? 270 : 90) : (column === 0 ? 90 : 270) });
    }
  };
  for (const column of columnsOrder) place(column, 0, target, count);
  for (const column of columnsOrder) place(column, target, capacity, count);
  if (out.length < count) return [];
  return out;
}
