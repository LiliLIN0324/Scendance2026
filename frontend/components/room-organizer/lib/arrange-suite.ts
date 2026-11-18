/**
 * 套装排布（2026-11-17 v2）。
 *
 * 「6 组洽谈，4 人一桌」不是「6 张桌子」或「24 把椅子」能表达的——要成套落位。
 * 本模块负责：
 * 1. `parseSuiteDemand()`：识别「N 组 + M 人一桌」的套装说法（先于单件需求解析）；
 * 2. `layoutBanquetSuites()`：桌子成网格，椅子绕桌均分、面向桌心；
 * 3. 返回桌/椅两组位置，调用方分别绑定 table / chair 模型。
 *
 * 纯函数，零 three / 零 React。
 */

export interface SuiteDemand {
  /** 组数（桌数）。 */
  groups: number;
  /** 每桌人数。 */
  perTable: number;
  /** 通道净宽（米），可空。 */
  aisleM: number | null;
}

/** 只认明确套装说法：必须同时出现「N 组」和「M 人一桌」。 */
export function parseSuiteDemand(text: string): SuiteDemand | null {
  const source = text.trim();
  const groupsMatch = /(\d+)\s*组/.exec(source);
  const perTableMatch = /(\d+)\s*(?:人|位)\s*(?:一桌|每桌|\/桌)/.exec(source);
  if (!groupsMatch || !perTableMatch) return null;
  const groups = Number.parseInt(groupsMatch[1]!, 10);
  const perTable = Number.parseInt(perTableMatch[1]!, 10);
  if (!Number.isFinite(groups) || groups <= 0) return null;
  if (!Number.isFinite(perTable) || perTable < 2 || perTable > 12) return null;
  const aisleMatch =
    /(?:通道|过道|疏散)[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(?:米|m|M)?/.exec(source)
    ?? /(\d+(?:\.\d+)?)\s*(?:米|m|M)[^，。;；]{0,4}(?:通道|过道|疏散)/.exec(source);
  return {
    groups,
    perTable,
    aisleM: aisleMatch ? Number.parseFloat(aisleMatch[1]!) : null,
  };
}

export interface SuiteBoundaryPoint {
  x: number;
  y: number;
}

export interface SuitePlacement {
  x: number;
  y: number;
  rotationDeg: number;
}

export interface SuiteLayoutInput {
  boundary: readonly SuiteBoundaryPoint[];
  groups: number;
  perTable: number;
  /** 桌子最大边（米），默认 1.0。 */
  tableSize?: number;
  /** 座椅进深（米），默认 0.5。 */
  seatSize?: number;
  /** 桌与桌之间的间距（米），默认 1.2；座椅外沿也算进占位。 */
  gap?: number;
  /** 通道净宽（米），默认 0。 */
  aisleM?: number;
  /** 场地四边留白（米），默认 0.5。 */
  margin?: number;
}

export interface SuiteLayout {
  tables: SuitePlacement[];
  seats: SuitePlacement[];
}

const boundsOf = (points: readonly SuiteBoundaryPoint[]) => ({
  minX: Math.min(...points.map(point => point.x)),
  maxX: Math.max(...points.map(point => point.x)),
  minY: Math.min(...points.map(point => point.y)),
  maxY: Math.max(...points.map(point => point.y)),
});

/**
 * 桌子按行优先铺网格；每桌椅子绕桌均分，面向桌心。
 * 桌子占位 = 桌面 + 2 ×（椅深 + 0.25 m 拉椅空间），保证椅子不压到邻桌。
 */
export function layoutBanquetSuites(input: SuiteLayoutInput): SuiteLayout {
  const { boundary, groups, perTable } = input;
  if (boundary.length < 3 || groups <= 0 || perTable < 2) return { tables: [], seats: [] };
  const tableSize = input.tableSize ?? 1.0;
  const seatSize = input.seatSize ?? 0.5;
  const gap = input.gap ?? 1.2;
  const aisle = input.aisleM ?? 0;
  const margin = input.margin ?? 0.5;
  const seatRing = tableSize / 2 + seatSize / 2 + 0.25;
  const cell = tableSize + (seatRing - tableSize / 2) * 2;
  const box = boundsOf(boundary);
  const usableWidth = box.maxX - box.minX - margin * 2;
  const usableDepth = box.maxY - box.minY - margin * 2 - aisle;
  if (usableWidth < cell || usableDepth < cell) return { tables: [], seats: [] };
  const perRow = Math.max(1, Math.floor((usableWidth + gap) / (cell + gap)));
  const rows = Math.ceil(groups / perRow);
  if (rows * cell + (rows - 1) * gap > usableDepth) return { tables: [], seats: [] };
  const rowWidth = perRow * cell + (perRow - 1) * gap;
  const startX = box.minX + margin + (usableWidth - rowWidth) / 2 + cell / 2;
  const frontY = box.minY + margin + aisle + cell / 2;
  const tables: SuitePlacement[] = [];
  const seats: SuitePlacement[] = [];
  for (let index = 0; index < groups; index += 1) {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const cx = startX + col * (cell + gap);
    const cy = frontY + row * (cell + gap);
    tables.push({ x: cx, y: cy, rotationDeg: 0 });
    for (let seatIndex = 0; seatIndex < perTable; seatIndex += 1) {
      const angle = (Math.PI * 2 * seatIndex) / perTable;
      seats.push({
        x: cx + Math.cos(angle) * seatRing,
        y: cy + Math.sin(angle) * seatRing,
        // 0° 朝 +y；座位面向桌心，转身 180° 后即朝向圆心方向的反向。
        rotationDeg: Math.round(((angle * 180) / Math.PI + 180) % 360),
      });
    }
  }
  return { tables, seats };
}

export interface SuiteFurnitureItem {
  name: string;
  kind: string;
  width: number;
  depth: number;
}

const TABLE_NAME = /桌|台面|吧台|柜台|table|desk|counter/i;
/** 能力表把冷柜、展示架也标成 table；套装选型必须按名字再筛一道。 */
const TABLE_EXCLUDE = /柜|冰箱|冷藏|冷冻|fridge|freezer|展示架|货架/i;

/** 套装选型：先看能力，再看名字，最后看尺寸；不相关用途宁可不选。 */
export function pickSuiteFurniture<T extends SuiteFurnitureItem>(
  items: readonly T[],
  options?: { tableTarget?: number; seatTarget?: number },
): { table: T | null; seat: T | null } {
  const tableTarget = options?.tableTarget ?? 1.2;
  const seatTarget = options?.seatTarget ?? 0.5;
  const bySize = (target: number) => (a: T, b: T) =>
    Math.abs(Math.max(a.width, a.depth) - target) - Math.abs(Math.max(b.width, b.depth) - target);
  const tables = items.filter(item =>
    (item.kind === 'table' || item.kind === 'talk')
    && TABLE_NAME.test(item.name)
    && !TABLE_EXCLUDE.test(item.name));
  const seats = items.filter(item => item.kind === 'seat' && /椅|凳|bench|chair|stool|seat/i.test(item.name));
  const table = [...tables].sort(bySize(tableTarget))[0]
    ?? [...items].filter(item => item.kind === 'table').sort(bySize(tableTarget))[0]
    ?? null;
  const seat = [...seats].sort(bySize(seatTarget))[0]
    ?? [...items].filter(item => item.kind === 'seat').sort(bySize(seatTarget))[0]
    ?? null;
  return { table: table ?? null, seat: seat ?? null };
}
