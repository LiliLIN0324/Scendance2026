import { eventLayoutPath } from './event-layout-path';
import { clearForObject, proposeInventoryObjects, proposeUseZones } from './outdoor-agent-planning';
import { outdoorCorridorStrips, outdoorRingsOverlap } from './outdoor-event-logic';
import { computePlaceableDomain, type PlaceableDomain } from './outdoor-placeable-domain';
import { checkBoundaryRing, planPointInRing } from './site-plan-editing';
import { facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';
import {
  axisDepth, axisToward, axisUnit, axisWidth, bandRect, banquetCenters, ceremonyFocus, ceremonySeats,
  directionOfAxis, estimateBanquetTables, estimateCeremonySeats, pointInRectAt, rectArea, rectCenter,
  rectDepth, rectFromRing, rectRing, rectWidth, snapAxis, splitAcross, WEDDING_DEFAULTS,
  type PlanRect, type WeddingAxis, type WeddingDirection,
} from './wedding-spatial';
import type { OutdoorBrief, OutdoorLibraryItem } from './outdoor-agent-contract';
import type { PlanFacility, PlanPoint, PlanRoute, PlanZone, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

type Role = 'arch' | 'ceremony-chair' | 'banquet-table' | 'banquet-chair' | 'welcome-table' | 'sign' | 'photo' | 'rest-chair' | 'service-table';
type ZoneRole = 'ceremony' | 'banquet' | 'welcome' | 'photo' | 'rest' | 'service';
export const WEDDING_LIBRARY_QUERIES = ['拱门','背景','椅','桌','指示牌','花'];

export type WeddingStrategy = 'ceremony-first' | 'banquet-first';

/** 景观方向依据：只有调用方明确给出时才用；未给出就不以「观景」作理由。 */
export interface WeddingLandscapeEvidence {
  direction: WeddingDirection;
  evidence: 'user-confirmed' | 'map-evidenced';
}

export interface WeddingLayoutInput {
  plan: SitePlanData;
  brief: OutdoorBrief;
  library: OutdoorLibraryItem[];
  strategy?: WeddingStrategy;
  hardBlocks?: PlanPoint[][];
  signal: AbortSignal;
  onPhase?: (text: string) => void;
  /** Explicit request to re-evaluate existing wedding zones; original remains untouched. */
  optimize?: boolean;
  /** 已确认/有地图依据的景观朝向。缺省 = 未知，保留假设。 */
  landscape?: WeddingLandscapeEvidence;
  /** 编辑器里的锁定件 id。锁定件所在分区整块保留，不在重排中移动。 */
  lockedFacilityIds?: readonly string[];
  /** 可布置域网格步长（米），默认 0.5；测试或大场地可调粗。 */
  resolutionM?: number;
}

export interface WeddingHardConflicts {
  boundary: number;
  obstacles: number;
  collisions: number;
  corridors: number;
  total: number;
}

export interface WeddingCandidateMetrics {
  ceremonySeats: number;
  banquetSeats: number;
  banquetTables: number;
  target: number;
  ceremonyZoneM2: number;
  banquetZoneM2: number;
  /** 入口到仪式区通道的实际折线长度（米）；无通道时为 0。 */
  entryWalkM: number;
  serviceRouteM: number;
  /** 宾客通道与后勤通道的交叉次数（按折线段实算）。 */
  routeCrossings: number;
  /** 桌子有座位的比例（0–1）；不足 1 说明有落单桌椅。 */
  tableGroupIntegrity: number;
  landscapeApplied: boolean;
}

export interface WeddingCandidate {
  id: WeddingStrategy;
  label: string;
  status: 'ready' | 'needs-adjustment';
  plan: SitePlanData;
  metrics: WeddingCandidateMetrics;
  hardConflicts: WeddingHardConflicts;
  /** 可核对的空间取舍（全部是实际算出的数，不是审美分）。 */
  tradeoffs: string[];
}

export interface WeddingSiteSummary {
  placeableAreaM2: number;
  boundaryAreaM2: number;
  usableRects: number;
  entrance: {
    confirmed: boolean;
    source: 'node' | 'assumption';
    name: string;
    position: PlanPoint;
    verification: string;
  };
  landscape: {
    applied: boolean;
    direction: WeddingDirection | null;
    evidence: WeddingLandscapeEvidence['evidence'] | null;
    note: string;
  };
  focusDirection: WeddingDirection;
  approachDirection: WeddingDirection;
}

export interface WeddingPlanDiff {
  facilities: { added: number; removed: number; changed: number; kept: number };
  zones: { added: number; removed: number; changed: number; kept: number };
  routes: { added: number; removed: number; changed: number; kept: number };
  unchanged: boolean;
}

export interface WeddingLayoutReport {
  plan: SitePlanData;
  notes: string[];
  quantities: Array<{ role: string; zone: string; requested: number; placed: number; placeholder: boolean }>;
  checks: {
    collisions: number;
    boundary: number;
    obstacles: number;
    corridors: number;
    ceremonySeats: number;
    banquetSeats: number;
    target: number;
    hardConflicts: number;
    status: 'ready' | 'needs-adjustment';
    access: 'pending';
    safety: 'unverified';
  };
  originalPlan: SitePlanData;
  site: WeddingSiteSummary;
  candidates: WeddingCandidate[];
  recommendedId: WeddingStrategy;
  recommendation: { candidateId: WeddingStrategy; reasons: string[] };
  diff: WeddingPlanDiff;
}

const roles: Record<ZoneRole, { name: string; purpose: NonNullable<PlanZone['purpose']>; semantic: PlanZone['semantic'] }> = {
  ceremony: { name: '仪式观礼区', purpose: 'audience', semantic: 'audience' },
  banquet: { name: '宴席区', purpose: 'audience', semantic: 'audience' },
  welcome: { name: '迎宾签到区', purpose: 'service', semantic: 'checkin' },
  photo: { name: '合影区', purpose: 'exhibition', semantic: 'reserved' },
  rest: { name: '休息区', purpose: 'service', semantic: 'vip' },
  service: { name: '后勤备物区', purpose: 'service', semantic: 'loading' },
};

const strategyLabels: Record<WeddingStrategy, string> = {
  'ceremony-first': '仪式与观景优先',
  'banquet-first': '宴席与服务效率优先',
};

const roleOf = (zone: PlanZone): ZoneRole | null => /宴|餐饮|餐区|用餐/.test(zone.name) ? 'banquet'
  : /仪式|观礼|舞台|证婚|宾客.*[席座]/.test(zone.name) ? 'ceremony'
    : /签到|迎宾|接待/.test(zone.name) ? 'welcome'
      : /合影|拍照|摄影/.test(zone.name) ? 'photo'
        : /休息|长辈|贵宾/.test(zone.name) ? 'rest'
          : /后勤|备物|备餐|服务/.test(zone.name) ? 'service' : null;

const specs: Record<Role, { label: string; match: RegExp; width: number; depth: number }> = {
  arch: { label: '仪式背景', match: /婚礼拱门|花艺拱门|拱门|背景/, width: 4, depth: 1 },
  'ceremony-chair': { label: '观礼椅', match: /椅子|折叠椅|单椅|餐椅/, width: 0.5, depth: 0.55 },
  'banquet-table': { label: '宴席圆桌', match: /圆桌(?!与椅)/, width: WEDDING_DEFAULTS.tableDiameterM, depth: WEDDING_DEFAULTS.tableDiameterM },
  'banquet-chair': { label: '宴席座椅', match: /椅子|折叠椅|单椅|餐椅/, width: 0.5, depth: 0.55 },
  'welcome-table': { label: '签到桌', match: /签到台|接待台|长桌|桌子|餐桌/, width: 2, depth: 0.8 },
  sign: { label: '迎宾指示牌', match: /指示牌|导向牌|迎宾牌/, width: 0.6, depth: 0.4 },
  photo: { label: '合影背景', match: /合影|背景墙|背景板/, width: 3, depth: 0.6 },
  'rest-chair': { label: '休息椅', match: /椅子|折叠椅|单椅|餐椅/, width: 0.5, depth: 0.55 },
  'service-table': { label: '后勤备物桌', match: /长桌|桌子|餐桌/, width: 1.8, depth: 0.8 },
};

const materialFor = (role: Role, library: OutdoorLibraryItem[]): OutdoorLibraryItem | undefined =>
  library.filter(item => item.available && !item.id.startsWith('icon:') && specs[role].match.test(item.name)
    && (!role.includes('chair') || !/与|组合|套装|连排|排椅|长椅|双人|沙发/.test(item.name))
    && item.width > 0 && item.depth > 0 && item.width <= 100 && item.depth <= 100)
    .sort((a, z) => (a.source === 'personal' ? 0 : 1) - (z.source === 'personal' ? 0 : 1) || a.width * a.depth - z.width * z.depth)[0];

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const directionText = (direction: WeddingDirection | null): string =>
  direction === 'north' ? '北' : direction === 'south' ? '南' : direction === 'east' ? '东' : direction === 'west' ? '西' : '未定';

// ---------------------------------------------------------------- site reading

interface WeddingSite {
  domain: PlaceableDomain;
  /** 可布置域的连续矩形，按面积从大到小；已剔除短边 <2 m 的碎块。 */
  rects: PlanRect[];
  entrance: WeddingSiteSummary['entrance'] & { nodeId?: string };
  approach: WeddingAxis;
  focusAxis: WeddingAxis;
  landscape: WeddingSiteSummary['landscape'];
  warnings: string[];
}

/**
 * 场地依据：可布置域（边界 − 建筑 − 禁放 − 保留分区）+ 已确认入口 + 景观方向。
 * 只读现有数据；不把未核验的节点当已知入口，也不猜景观。
 */
function readWeddingSite(input: WeddingLayoutInput, preservedRings: PlanPoint[][]): WeddingSite {
  const buildings = (input.plan.buildings ?? []).map(building => building.points);
  const hardBlocks = [...(input.hardBlocks ?? []), ...preservedRings];
  const resolutions = [...new Set([input.resolutionM ?? WEDDING_DEFAULTS.resolutionM, 1, 2].filter(value => value > 0))];
  let domain: PlaceableDomain | null = null;
  let failure: unknown = null;
  for (const resolutionM of resolutions) {
    try {
      domain = computePlaceableDomain({ boundary: input.plan.boundary, buildings, hardBlocks, resolutionM });
      break;
    } catch (error) { failure = error; }
  }
  if (!domain) throw failure instanceof Error ? failure : new Error('可布置域计算失败，未生成婚礼分区。');

  const rects = domain.rects
    .map(rect => rectFromRing(rect.polygon))
    .filter(rect => rectArea(rect) >= WEDDING_DEFAULTS.minZoneAreaM2
      && Math.min(rectWidth(rect), rectDepth(rect)) >= WEDDING_DEFAULTS.minZoneSideM)
    .sort((a, b) => rectArea(b) - rectArea(a));

  const nodes = input.plan.nodes ?? [];
  // 只有明确「用户确认」或「地图证据」的节点才算已知入口；缺 verification 视为未核验。
  const confirmed = nodes
    .filter(node => node.kind !== 'exit' && (node.verification === 'user-confirmed' || node.verification === 'map-evidenced'))
    .sort((a, b) => (a.verification === 'user-confirmed' ? 0 : 1) - (b.verification === 'user-confirmed' ? 0 : 1) || a.name.localeCompare(b.name))[0];
  const boundary = rectFromRing(input.plan.boundary);
  const assumed = { x: (boundary.w + boundary.e) / 2, y: boundary.s + Math.min(2, Math.max(0.5, rectDepth(boundary) * 0.03)) };
  const warnings: string[] = [];
  const entrance: WeddingSite['entrance'] = confirmed
    ? { confirmed: true, source: 'node', name: confirmed.name, position: confirmed.position, verification: confirmed.verification!, nodeId: confirmed.id }
    : { confirmed: false, source: 'assumption', name: '南侧建议接驳点（假设）', position: assumed, verification: 'unverified' };
  if (!confirmed) {
    const unverified = nodes.filter(node => node.kind !== 'exit' && !node.verification);
    warnings.push(unverified.length
      ? `画布上有 ${unverified.length} 个未核验出入口节点，本版没有把它们当成已确认真实入口；入场方向暂按南侧起稿。`
      : '尚未识别或确认真实入口，入场方向暂按南侧起稿；后续可用聊天指定入口。');
    warnings.push('入场侧暂按南侧起稿，未新增或确认真实出入口；不会把它登记成已核验的门。');
  }

  const primary = rects[0];
  const target = primary ? rectCenter(primary) : rectCenter(boundary);
  const approach = snapAxis(target.x - entrance.position.x, target.y - entrance.position.y);

  let focusAxis = approach;
  let applied = false;
  let landscapeNote = '未收到已确认或地图证据支持的景观方向，本版不以「观景更好」作为推荐理由，景观朝向保留为假设。';
  if (input.landscape) {
    const wanted = axisToward(input.landscape.direction);
    const opposite = wanted.axis === approach.axis && wanted.sign === -approach.sign;
    if (opposite) {
      landscapeNote = '景观方向与入口方向相反：把仪式焦点转到入口侧会让宾客动线穿过仪式区，本版保留朝内的仪式焦点，需用户确认优先关系；未按观景理由改向。';
    } else {
      focusAxis = wanted;
      applied = true;
      landscapeNote = `仪式焦点朝${directionText(input.landscape.direction)}，依据为${input.landscape.evidence === 'user-confirmed' ? '用户确认' : '地图证据'}；背景高度与视线遮挡仍需按实际模型在 3D 核对。`;
    }
  }
  if (!rects.length) warnings.push('已知边界、建筑与禁放区之外没有形成可用连续区域，不能生成婚礼分区。');

  return {
    domain, rects, entrance, approach, focusAxis, warnings,
    landscape: {
      applied,
      direction: applied ? directionOfAxis(focusAxis) : null,
      evidence: applied ? input.landscape!.evidence : null,
      note: landscapeNote,
    },
  };
}

// ------------------------------------------------------------ zone organization

interface WeddingZones {
  zones: PlanZone[];
  notes: string[];
}

const zoneOf = (role: ZoneRole, rect: PlanRect): PlanZone => ({
  id: crypto.randomUUID(),
  name: roles[role].name,
  semantic: roles[role].semantic,
  purpose: roles[role].purpose,
  environment: 'outdoor',
  event: '婚礼',
  polygon: rectRing(rect),
  notes: 'Agent 婚礼布局假设：分区取自已计算的可布置域连续矩形，不代表场地方已确认可用。',
});

/** 环上离目标最近的点：连线接到分区边缘，而不是穿进桌椅中间。 */
function closestPointOnRing(ring: PlanPoint[], target: PlanPoint): PlanPoint {
  let best: PlanPoint = ring[0] ?? target;
  let bestDistance = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / length2)) : 0;
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

/** 某一轴向上刚好放下目标人数的仪式纵深（米）。只用于分区取舍，不是容量结论。 */
function ceremonyDemandDepth(rect: PlanRect, axis: WeddingAxis, guests: number, seat: { width: number; depth: number }): number {
  const width = axisWidth(rect, axis);
  const diagonal = Math.hypot(seat.width, seat.depth);
  const half = width / 2 - WEDDING_DEFAULTS.aisleM / 2 - 0.6 - diagonal / 2;
  const columns = clamp(Math.floor(half / (diagonal + WEDDING_DEFAULTS.chairGapM)) + 1, 1, WEDDING_DEFAULTS.maxColumns);
  const rows = Math.ceil(guests / (columns * 2));
  return WEDDING_DEFAULTS.focusInsetM + WEDDING_DEFAULTS.photographerM + 1 + rows * (seat.depth + WEDDING_DEFAULTS.rowClearanceM) + seat.depth / 2;
}

/**
 * 默认分区：沿「入口 → 场地纵深」和景观朝向分区，基底是计算出的可布置域矩形，
 * 不再是包围盒等分条带。两版候选的差别是面积归属：仪式优先把纵深留给仪式，
 * 宴席优先只给仪式刚够的纵深，把连续面积让给宴席与后勤。
 */
function organizeWeddingZones(
  site: WeddingSite,
  strategy: WeddingStrategy,
  demand: { guests: number; seat: { width: number; depth: number }; envelope: number },
): WeddingZones {
  const notes: string[] = [];
  const primary = site.rects[0];
  if (!primary) {
    throw new Error('已确认边界、建筑与禁放区之外没有可布置的连续区域；未生成婚礼分区，也没有把包围盒当成可用场地。');
  }
  const used = new Set<PlanRect>([primary]);
  const nextUnused = () => site.rects.find(rect => !used.has(rect));

  const tables = Math.ceil(demand.guests / WEDDING_DEFAULTS.seatsPerTable);
  const focusSpan = axisDepth(primary, site.focusAxis);
  const needC = ceremonyDemandDepth(primary, site.focusAxis, demand.guests, demand.seat);
  const demandFrac = focusSpan > 0 ? needC / focusSpan : 0.5;
  // 仪式优先多留纵深（通道、花艺与摄影活动空间）；宴席优先只留刚好坐满的纵深。
  let cFrac = strategy === 'ceremony-first' ? clamp(demandFrac * 1.6 + 0.04, 0.14, 0.55) : clamp(demandFrac * 1.15, 0.12, 0.45);

  const buildCeremony = (fraction: number): { rect: PlanRect; seats: number } => {
    const gapFrac = focusSpan > 0 ? WEDDING_DEFAULTS.zoneGapM / focusSpan : 0;
    const rect = bandRect(primary, site.focusAxis, 1 - fraction + gapFrac, 1);
    return { rect, seats: estimateCeremonySeats(rect, site.focusAxis, demand.seat) };
  };

  let ceremony = buildCeremony(cFrac);
  while (ceremony.seats < demand.guests && cFrac < 0.8) {
    cFrac = Math.min(0.8, cFrac + 0.06);
    ceremony = buildCeremony(cFrac);
  }

  /** 接入口的那条边在主轴上的坐标：用来决定哪一块连续区域离入口更近。 */
  const nearEdge = (rect: PlanRect): number => site.approach.axis === 'y'
    ? site.approach.sign > 0 ? rect.s : rect.n
    : site.approach.sign > 0 ? rect.w : rect.e;
  let ceremonyZone: PlanZone;
  let banquetBase: PlanRect;
  // 多块连续区域（凹形/L 形）：仪式区放到离入口最远的一块，宴席留在入口侧，
  // 否则宴席会排在仪式背景背后，宾客要穿过仪式区才能吃饭。
  const spread = site.rects.length > 1
    ? [...site.rects].sort((a, b) => nearEdge(a) - nearEdge(b))
    : [];
  const farRect = spread[spread.length - 1];
  if (spread.length > 1 && farRect && farRect !== spread[0]
    && estimateCeremonySeats(farRect, site.focusAxis, demand.seat) >= demand.guests) {
    used.add(farRect);
    ceremonyZone = zoneOf('ceremony', farRect);
    banquetBase = spread[0]!;
    notes.push(`场地有 ${site.rects.length} 块连续区域：仪式区放到离入口最远的一块（${Math.round(rectArea(farRect))} ㎡），宴席留在入口侧，不让宾客穿过仪式背景去吃饭。`);
  } else if (ceremony.seats >= demand.guests * 0.6) {
    ceremonyZone = zoneOf('ceremony', ceremony.rect);
    banquetBase = bandRect(primary, site.focusAxis, 0, Math.min(0.76, 1 - cFrac));
  } else {
    // 主线纵深不够：换到另一块可布置域（凹形场地的另一臂），而不是缩小座椅或人数。
    const alternative = site.rects.slice(1).find(rect => estimateCeremonySeats(rect, site.focusAxis, demand.seat) > ceremony.seats);
    if (alternative) {
      used.add(alternative);
      ceremonyZone = zoneOf('ceremony', alternative);
      notes.push(`主线纵深放不下 ${demand.guests} 席观礼，仪式区改放到场地另一块连续区域（${Math.round(rectArea(alternative))} ㎡）；没有压缩座椅或人数，座位数按实际落位列出。`);
    } else {
      ceremonyZone = zoneOf('ceremony', ceremony.rect);
      notes.push('已知可布置域内没有更深的一块连续区域可换，仪式区保留当前纵深；观礼席不足会按实际数量列出。');
    }
    banquetBase = primary;
  }

  const baseDepth = axisDepth(banquetBase, site.approach);
  const frontDepth = Math.min(
    Math.max(baseDepth * 0.18, WEDDING_DEFAULTS.frontDepthM),
    WEDDING_DEFAULTS.frontDepthMaxM,
    Math.max(1.6, baseDepth * 0.32),
  );
  const gapFrac = baseDepth > 0 ? WEDDING_DEFAULTS.zoneGapM / baseDepth : 0;
  const frontFrac = baseDepth > 0 ? clamp(frontDepth / baseDepth, 0.06, 0.34) : 0.2;
  const front = bandRect(banquetBase, site.approach, 0, frontFrac);
  let banquetRect = bandRect(banquetBase, site.approach, Math.min(0.9, frontFrac + gapFrac), 1);

  const tablesInBanquet = estimateBanquetTables(banquetRect, site.approach, demand.envelope);
  if (tablesInBanquet < tables) {
    const alternative = nextUnused();
    if (alternative && estimateBanquetTables(alternative, site.approach, demand.envelope) > tablesInBanquet) {
      used.add(alternative);
      notes.push(`主区内宴席连续面积不足 ${tables} 桌（估算 ${tablesInBanquet} 桌），宴席改放到场地另一块连续区域（${Math.round(rectArea(alternative))} ㎡）；桌数与差额按实际落位列出。`);
      banquetRect = alternative;
    }
  }
  const banquetZone = zoneOf('banquet', banquetRect);

  const zones: PlanZone[] = [ceremonyZone, banquetZone];

  // 迎宾、合影、休息、后勤：优先用入口侧迎宾带；不够就换未使用的连续区域，绝不与主区重叠。
  const supportRoles: ZoneRole[] = ['welcome', 'photo', 'rest', 'service'];
  const frontWidth = axisWidth(front, site.approach);
  const slices = frontWidth >= 6.4 && axisDepth(front, site.approach) >= 2.2
    ? splitAcross(front, site.approach, [0.28, 0.24, 0.26, 0.22])
    : [];
  const lateral = site.approach.axis === 'y' ? site.entrance.position.x : site.entrance.position.y;
  const ordered = slices
    .map(rect => ({ rect, distance: Math.abs((site.approach.axis === 'y' ? (rect.w + rect.e) / 2 : (rect.s + rect.n) / 2) - lateral) }))
    .sort((a, b) => a.distance - b.distance)
    .map(entry => entry.rect);
  const assignments: Array<{ role: ZoneRole; rect: PlanRect }> = [];
  if (ordered.length >= 4) {
    // 迎宾离入口最近，后勤放到最外侧，减少宾客与货运的交叉。
    assignments.push({ role: 'welcome', rect: ordered[0]! }, { role: 'photo', rect: ordered[1]! },
      { role: 'rest', rect: ordered[2]! }, { role: 'service', rect: ordered[ordered.length - 1]! });
  } else if (ordered.length) {
    assignments.push({ role: 'welcome', rect: ordered[0]! }, { role: 'service', rect: ordered[ordered.length - 1]! });
    if (ordered.length > 1) assignments.push({ role: 'photo', rect: ordered[1]! });
  } else {
    notes.push('入口侧迎宾带不足 2 m 深或不够分成四块，迎宾/合影/休息/后勤改用其他连续区域或按需省略。');
    const spare = site.rects.filter(rect => !used.has(rect))
      .sort((a, b) => Math.hypot(rectCenter(a).x - site.entrance.position.x, rectCenter(a).y - site.entrance.position.y)
        - Math.hypot(rectCenter(b).x - site.entrance.position.x, rectCenter(b).y - site.entrance.position.y));
    for (const role of supportRoles) {
      const next = spare.shift();
      if (!next) break;
      used.add(next);
      const depth = axisDepth(next, site.approach);
      assignments.push({ role, rect: bandRect(next, site.approach, 0, Math.min(1, Math.max(0.35, 6 / Math.max(1, depth)))) });
    }
  }
  for (const assignment of assignments) zones.push(zoneOf(assignment.role, assignment.rect));

  const ceremonyArea = Math.round(rectArea(rectFromRing(ceremonyZone.polygon)));
  notes.push(`分区依据 ${site.rects.length} 块可布置域连续矩形、${site.entrance.confirmed ? `已核验入口「${site.entrance.name}」` : '未核验的入场假设'}与${site.landscape.applied ? `已给出的景观方向（朝${directionText(site.landscape.direction)}）` : '未给出的景观方向'}组织；入口侧迎宾带 ${Math.round(axisDepth(front, site.approach) * 10) / 10} m，仪式区 ${ceremonyArea} ㎡。`);
  return { zones, notes };
}

// --------------------------------------------------------------- plan assembly

interface CandidateContext {
  input: WeddingLayoutInput;
  site: WeddingSite;
  strategy: WeddingStrategy;
  base: SitePlanData;
  zones: PlanZone[];
  /** 已有分区模式（用户/既有方案）：不再新划分区，只按用途补充物件。 */
  existingZones: boolean;
  /** 本轮不动、也不往里补物件的分区（锁定/被引用/室内）。 */
  frozenZoneIds: ReadonlySet<string>;
}

interface BuiltCandidate {
  candidate: WeddingCandidate;
  plan: SitePlanData;
  notes: string[];
  quantities: WeddingLayoutReport['quantities'];
}

const polylineLength = (points: readonly PlanPoint[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
};

const orientation = (a: PlanPoint, b: PlanPoint, c: PlanPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function segmentsCross(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const d1 = orientation(c, d, a), d2 = orientation(c, d, b), d3 = orientation(a, b, c), d4 = orientation(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function polylineCrossings(a: readonly PlanPoint[], b: readonly PlanPoint[]): number {
  let count = 0;
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++)
      if (segmentsCross(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) count++;
  return count;
}

/** 碰撞计数用网格分桶，避免 1900 件时退化成全量两两比较。 */
function countCollisions(facilities: readonly PlanFacility[]): number {
  const rings = facilities.map(facility => facilityFootprintRing(facility));
  const boxes = rings.map(ring => rectFromRing(ring));
  const cell = 6;
  const buckets = new Map<string, number[]>();
  let collisions = 0;
  for (let i = 0; i < facilities.length; i++) {
    const box = boxes[i]!;
    const x0 = Math.floor(box.w / cell), x1 = Math.floor(box.e / cell);
    const y0 = Math.floor(box.s / cell), y1 = Math.floor(box.n / cell);
    const seen = new Set<number>();
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      for (const j of buckets.get(`${gx}:${gy}`) ?? []) {
        if (seen.has(j)) continue;
        seen.add(j);
        if (outdoorRingsOverlap(rings[i]!, rings[j]!)) collisions++;
      }
    }
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      const key = `${gx}:${gy}`;
      const list = buckets.get(key);
      if (list) list.push(i); else buckets.set(key, [i]);
    }
  }
  return collisions;
}

function tableGroupIntegrity(
  facilities: readonly PlanFacility[],
  zone: PlanZone,
  target: number,
): { tables: number; integrity: number } {
  const tables = facilities.filter(f => f.zoneId === zone.id && f.allocationKey?.startsWith(`wedding:${zone.id}:banquet-table:`));
  if (!tables.length) return { tables: 0, integrity: target > 0 ? 0 : 1 };
  const chairsByTable = new Map<number, number>();
  const pattern = new RegExp(`^wedding:${zone.id}:banquet-chair:(\\d+):`);
  for (const facility of facilities) {
    const match = facility.allocationKey?.match(pattern);
    if (match) chairsByTable.set(Number(match[1]), (chairsByTable.get(Number(match[1])) ?? 0) + 1);
  }
  let complete = 0;
  let remaining = target;
  for (const table of tables) {
    const tableNo = Number(table.allocationKey!.split(':').at(-1));
    const expected = Math.min(WEDDING_DEFAULTS.seatsPerTable, Math.max(0, remaining));
    remaining -= expected;
    if ((chairsByTable.get(tableNo) ?? 0) === expected) complete++;
  }
  return { tables: tables.length, integrity: complete / tables.length };
}

async function buildWeddingCandidate(context: CandidateContext): Promise<BuiltCandidate> {
  const { input, site, strategy, base, zones, existingZones, frozenZoneIds } = context;
  const notes: string[] = [];
  const quantities: WeddingLayoutReport['quantities'] = [];
  const plan: SitePlanData = {
    ...base,
    zones: [...zones],
    facilities: [...base.facilities],
    routes: [...base.routes],
    nodes: [...base.nodes],
  };
  const guests = input.brief.guests ?? WEDDING_DEFAULTS.guests;
  const roleZones = plan.zones.filter(zone => zone.environment !== 'indoor' && !frozenZoneIds.has(zone.id));
  const zoneFor = (role: ZoneRole) => roleZones.find(zone => roleOf(zone) === role);
  const ceremony = zoneFor('ceremony'), banquet = zoneFor('banquet');

  notes.push('初步规划参数：每桌10人，缺尺寸时圆桌直径1.8m、座椅0.5×0.55m；中央通道2.5m、服务净距1.5m、观礼排间净距0.65m、仪式摄影空间2m。均为可修改的设计假设，不是安全规范验收。');
  if (!input.brief.guests) notes.push('人数未给定：暂按 60 人做桌椅需求草案，不写成已确认人数；实际摆下的数量会分别列出。');
  notes.push(...site.warnings, site.landscape.note);
  if (existingZones) notes.push('保留既有分区几何和物件，只补充可识别用途的婚礼布置；没有覆盖用户已画的分区。');
  if (frozenZoneIds.size) notes.push(`保留 ${frozenZoneIds.size} 个锁定/被引用/室内的分区几何，没有移动其中的物件。`);

  // 已知障碍：调用方给的禁放区、建筑、室内分区；锁定件按占地避让，但仍保持原位。
  const blocked: PlanPoint[][] = [
    ...(input.hardBlocks ?? []),
    ...(plan.buildings ?? []).map(building => building.points),
    ...plan.zones.filter(zone => zone.environment === 'indoor').map(zone => zone.polygon),
  ];
  const lockedIds = new Set(input.lockedFacilityIds ?? []);
  for (const facility of base.facilities) if (lockedIds.has(facility.id)) blocked.push(facilityFootprintRing(facility));

  const focusAxis = site.focusAxis;
  const facing = axisUnit(focusAxis);
  const ceremonyRect = ceremony ? rectFromRing(ceremony.polygon) : null;
  // 焦点固定在仪式区朝景观/纵深一侧的边缘内侧；座椅反向排开，共同朝向这个点。
  const archDepth = materialFor('arch', input.library)?.depth ?? specs.arch.depth;
  const focus = ceremonyRect
    ? ceremonyFocus(ceremonyRect, focusAxis, Math.max(1.5, archDepth / 2 + 0.6))
    : rectCenter(site.rects[0] ?? rectFromRing(plan.boundary));

  const routeWidth = WEDDING_DEFAULTS.aisleM;
  const start = site.entrance.position;
  const pushRoute = (name: string, points: PlanPoint[], service = false): PlanRoute => {
    const route: PlanRoute = {
      id: crypto.randomUUID(), kind: service ? 'service' : 'pedestrian', carrier: service ? 'mixed' : 'walk',
      audiences: service ? ['service', 'staff'] : ['visitors'], name, points, oneWay: false,
      widthM: service ? WEDDING_DEFAULTS.serviceAisleM : routeWidth,
      notes: service
        ? '婚礼联合草案：后勤从离备物区最近的边界侧接入，宽度为假设；不证明真实货运门。'
        : '婚礼联合草案：设计通道，宽度为假设；不证明现场出入口或疏散条件。',
    };
    if (site.entrance.nodeId && Math.hypot(points[0]!.x - start.x, points[0]!.y - start.y) < 0.1) route.startNodeId = site.entrance.nodeId;
    plan.routes.push(route);
    return route;
  };
  const addRoute = (name: string, from: PlanPoint, to: PlanPoint, service = false): PlanRoute | null => {
    const existing = plan.routes.find(route => route.name === name);
    if (existing) return existing;
    const path = eventLayoutPath({
      boundary: plan.boundary,
      blocked: [...blocked, ...plan.facilities.map(facilityFootprintRing)],
      start: from, end: to, widthM: service ? WEDDING_DEFAULTS.serviceAisleM : routeWidth,
    });
    if (!path) {
      notes.push(`${name}未找到可容纳完整线宽的连续路径，未画穿障碍；需要调整分区或已放物件。`);
      return null;
    }
    return pushRoute(name, path, service);
  };

  // 仪式区靠宾客来向的边缘中点：主通道先到这里，再沿中轴笔直进入坐席，末段不斜切椅子。
  const ceremonyEdge = ceremonyRect
    ? focusAxis.axis === 'y'
      ? { x: focus.x, y: focusAxis.sign > 0 ? ceremonyRect.s : ceremonyRect.n }
      : { x: focusAxis.sign > 0 ? ceremonyRect.w : ceremonyRect.e, y: focus.y }
    : null;
  input.onPhase?.('先预留宾客主通道与服务通路');
  const ceremonyEntry = ceremonyRect
    ? { x: focus.x - facing.x * (WEDDING_DEFAULTS.photographerM + 0.4), y: focus.y - facing.y * (WEDDING_DEFAULTS.photographerM + 0.4) }
    : rectCenter(site.rects[0] ?? rectFromRing(plan.boundary));
  const main = (() => {
    const existing = plan.routes.find(route => route.name === '婚礼·宾客主通道');
    if (existing) return existing;
    if (!ceremonyEdge || (Math.hypot(ceremonyEdge.x - start.x, ceremonyEdge.y - start.y) < 1
      && Math.hypot(ceremonyEdge.x - ceremonyEntry.x, ceremonyEdge.y - ceremonyEntry.y) < 1)) {
      return addRoute('婚礼·宾客主通道', start, ceremonyEntry);
    }
    // 路口不能正好落在巳有建筑/障碍的边上：沿中轴往区内退半条通道宽，路径才能整宽通过。
    const dock = {
      x: ceremonyEdge.x + facing.x * (routeWidth / 2 + 0.25),
      y: ceremonyEdge.y + facing.y * (routeWidth / 2 + 0.25),
    };
    const head = eventLayoutPath({
      boundary: plan.boundary,
      blocked: [...blocked, ...plan.facilities.map(facilityFootprintRing)],
      start, end: dock, widthM: routeWidth,
    });
    if (!head) return addRoute('婚礼·宾客主通道', start, ceremonyEntry);
    return pushRoute('婚礼·宾客主通道', [...head, ceremonyEntry].filter((point, index, all) =>
      index === 0 || Math.hypot(point.x - all[index - 1]!.x, point.y - all[index - 1]!.y) > 0.05));
  })();
  // 入口与仪式焦点不在一条轴上时，首段会斜穿前场/宴席区：写清楚这是故意的中央通道，不是落位失误。
  if (main && main.points.length > 1) {
    const leg = { x: main.points[1]!.x - main.points[0]!.x, y: main.points[1]!.y - main.points[0]!.y };
    const length = Math.hypot(leg.x, leg.y);
    const toward = axisUnit(site.approach);
    const cosine = length > 0.5 ? (leg.x * toward.x + leg.y * toward.y) / length : 1;
    if (Math.acos(Math.max(-1, Math.min(1, cosine))) > (25 * Math.PI) / 180) {
      notes.push('入口方向与仪式焦点不在一条轴上：主通道先斜向接近仪式中轴再直入坐席，斜穿的那一段就是中央通道，两侧桌位都按这条走廊让开。');
    }
  }
  const nearest = (target: PlanPoint): PlanPoint => {
    if (!main) return start;
    let best = main.points[0]!, distance = Infinity;
    for (let i = 1; i < main.points.length; i++) {
      const a = main.points[i - 1]!, b = main.points[i]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const p = { x: a.x + t * dx, y: a.y + t * dy };
      const d = Math.hypot(p.x - target.x, p.y - target.y);
      if (d < distance) { distance = d; best = p; }
    }
    return best;
  };
  // 小分区（迎宾/合影/休息/后勤）家具密度高，一条 2.5 m 走廊穿过去就把它们废了：不画穿区连线。
  const crossingSupport = (from: PlanPoint, to: PlanPoint, own: PlanZone): PlanZone | undefined => {
    for (const other of roleZones) {
      if (other.id === own.id) continue;
      const role = roleOf(other);
      if (role === 'ceremony' || role === 'banquet') continue;
      for (let step = 1; step < 10; step++) {
        const t = step / 10;
        if (planPointInRing({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, other.polygon)) return other;
      }
    }
    return undefined;
  };
  for (const role of ['welcome', 'banquet', 'photo', 'rest'] as ZoneRole[]) {
    const zone = zoneFor(role);
    if (!zone || !main) continue;
    // 主线已经穿进这个分区时不再单开连线：多一条连线就多一道穿过桌椅的走廊。
    if (main.points.some(point => planPointInRing(point, zone.polygon))) continue;
    const center = rectCenter(rectFromRing(zone.polygon));
    const from = nearest(center);
    const to = closestPointOnRing(zone.polygon, from);
    if (Math.hypot(to.x - from.x, to.y - from.y) <= 1) continue;
    const crossing = crossingSupport(from, to, zone);
    if (crossing) {
      notes.push(`「${zone.name}」与主通道之间隔着「${crossing.name}」，未开穿区走廊；这段动线按现场引导，席前需再确认。`);
      continue;
    }
    addRoute(`婚礼·${roles[role].name}连接`, from, to);
  }
  const service = zoneFor('service');
  if (service) {
    // 后勤从离服务区最近的边界侧接入，并绕开已定的宾客主通道（已有路线已进 blocked 池）。
    const serviceRect = rectFromRing(service.polygon);
    const center = rectCenter(serviceRect);
    const boundaryRect = rectFromRing(plan.boundary);
    const gates: PlanPoint[] = [
      { x: boundaryRect.w + 0.5, y: clamp(center.y, boundaryRect.s + 0.5, boundaryRect.n - 0.5) },
      { x: boundaryRect.e - 0.5, y: clamp(center.y, boundaryRect.s + 0.5, boundaryRect.n - 0.5) },
      { x: clamp(center.x, boundaryRect.w + 0.5, boundaryRect.e - 0.5), y: boundaryRect.s + 0.5 },
      { x: clamp(center.x, boundaryRect.w + 0.5, boundaryRect.e - 0.5), y: boundaryRect.n - 0.5 },
    ];
    const gate = gates.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))[0]!;
    // 后勤只接到备物区的边缘：接到中心会在区内留一条穿走桌台的走廊，小场地直接摆不下备物桌。
    // 备物区本身就贴着边界时，边界入口直接算入场，不再在区内画一条多余的线。
    const gateInside = planPointInRing(gate, service.polygon);
    const serviceDock = gateInside ? gate : closestPointOnRing(service.polygon, gate);
    const guestCorridors = plan.routes
      .filter(route => route.name.startsWith('婚礼·') && route.kind !== 'service')
      .flatMap(route => outdoorCorridorStrips(route.points, (route.widthM ?? routeWidth) + 0.5));
    const servicePath = gateInside ? null : eventLayoutPath({
      boundary: plan.boundary,
      blocked: [...blocked, ...plan.facilities.map(facilityFootprintRing), ...guestCorridors],
      start: gate, end: serviceDock, widthM: WEDDING_DEFAULTS.serviceAisleM,
    });
    if (gateInside || servicePath) {
      if (servicePath) pushRoute('婚礼·后勤服务通路', servicePath, true);
      else notes.push('备物区紧贴场地边界，后勤按边界侧直接入场，未在区内单画服务通路。');
      if (banquet) {
        // 备餐接到宴席区靠近后勤的那条边；不直接从中间穿过去，隔得太远就不画少了一条跨场走廊。
        const from = closestPointOnRing(service.polygon, closestPointOnRing(banquet.polygon, center));
        const dock = closestPointOnRing(banquet.polygon, from);
        if (Math.hypot(dock.x - from.x, dock.y - from.y) <= 6) {
          addRoute('婚礼·备餐至婚宴服务连接', from, dock, true);
        } else {
          notes.push(`备餐区与宴席区不直接相邻（${Math.round(Math.hypot(dock.x - from.x, dock.y - from.y))} m），未画穿越仪式区或坐席的备餐走廊；上菜动线需现场确认。`);
        }
      }
    } else {
      notes.push('后勤服务通路在现有障碍与宾客通道之间没有完整线宽，未画穿通道；备餐动线需要现场确认。');
    }
  }
  notes.push('通道先于物件预留；宾客与后勤路线是布局提案，交叉位置仍需按实际流程协调。');

  const handledNeeds = new Set<OutdoorBrief['items'][number]>();
  const globalCounts = new Map<OutdoorBrief['items'][number], number>();
  const wantedCount = (role: Role, zone: PlanZone, defaultCount: number): number => {
    const need = input.brief.items.find(item => (!item.zone || item.zone === zone.id || item.zone === zone.name)
      && (specs[role].match.test(item.query) || item.query === specs[role].label));
    if (!need) return defaultCount;
    handledNeeds.add(need);
    if (!need.zone) {
      const remaining = Math.max(0, need.count - (globalCounts.get(need) ?? 0));
      const count = role.includes('chair') ? Math.min(defaultCount, remaining) : remaining;
      globalCounts.set(need, (globalCounts.get(need) ?? 0) + count);
      return count;
    }
    return need.count;
  };
  const make = (role: Role, zone: PlanZone, index: number, position: PlanPoint, rotationDeg = 0): PlanFacility => {
    const material = materialFor(role, input.library), spec = specs[role];
    return {
      id: crypto.randomUUID(), templateId: material ? `oneplan:${material.id}`.slice(0, 64) : `wedding-placeholder:${role}`,
      name: `${spec.label} ${index}`, zoneId: zone.id, position, rotationDeg,
      size: { width: material?.width ?? spec.width, depth: material?.depth ?? spec.depth },
      allocationKey: `wedding:${zone.id}:${role}:${index}`,
      ...(material ? { sourceAssetId: material.id, modelOverride: material.modelSlug } : {}),
      notes: material
        ? `婚礼联合草案；复用真实库物件「${material.name}」及其标称尺寸，实物库存未确认。`
        : `婚礼联合草案；缺少已匹配模型的尺寸占位件（${spec.width}×${spec.depth}米假设），待选型，不是已生成资产。`,
    };
  };

  const archMaterial = materialFor('arch', input.library);
  const cameraSpace = ceremonyRect
    ? (() => {
      // 摄影区夹在背景与第一排之间：从背景外缘退 0.4 m 起，留 2 m 进深，不压背景也不压首排。
      const near = archDepth / 2 + 0.4;
      const halfD = 1.0;
      const halfW = 2.6;
      const offset = near + halfD;
      const cx = focus.x - facing.x * offset, cy = focus.y - facing.y * offset;
      const lx = -facing.y, ly = facing.x;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({
        x: cx + lx * u! * halfW + facing.x * v! * halfD,
        y: cy + ly * u! * halfW + facing.y * v! * halfD,
      }));
      return rectRing(rectFromRing(corners));
    })()
    : [];
  const canPlace = (facility: PlanFacility, zone: PlanZone, current: SitePlanData = plan) => clearForObject(facility, current, zone)
    && !blocked.some(ring => outdoorRingsOverlap(facilityFootprintRing(facility), ring))
    && (!cameraSpace.length || !outdoorRingsOverlap(facilityFootprintRing(facility), cameraSpace));

  input.onPhase?.('布置仪式背景、观礼座椅和迎宾设施');
  if (ceremony && ceremonyRect) {
    const arch = make('arch', ceremony, 1, focus, (Math.atan2(facing.x, -facing.y) * 180) / Math.PI);
    const oldArches = plan.facilities.filter(f => f.zoneId === ceremony.id && f.allocationKey?.includes(':arch:'));
    if (!oldArches.length && canPlace(arch, ceremony)) plan.facilities.push(arch);
    const wanted = wantedCount('ceremony-chair', ceremony, guests);
    const chair = materialFor('ceremony-chair', input.library);
    const existing = plan.facilities.filter(f => f.zoneId === ceremony.id && f.allocationKey?.includes(':ceremony-chair:'));
    const baseFacilities = [...plan.facilities];
    let best: PlanFacility[] = [];
    // 同一焦点下比较不同组团宽度：优先能坐满且不越界的列数，而不是全区网格填满。
    for (let columns = WEDDING_DEFAULTS.maxColumns; columns >= 1; columns -= 1) {
      const probe: SitePlanData = { ...plan, facilities: [...baseFacilities] };
      const group: PlanFacility[] = [];
      for (const pose of ceremonySeats({
        focus, facing, count: wanted,
        width: chair?.width ?? specs['ceremony-chair'].width,
        depth: chair?.depth ?? specs['ceremony-chair'].depth,
        columns,
      })) {
        input.signal.throwIfAborted();
        if (group.length + existing.length >= wanted) break;
        const seat = make('ceremony-chair', ceremony, existing.length + group.length + 1, pose.position, pose.rotationDeg);
        if (canPlace(seat, ceremony, probe)) { probe.facilities.push(seat); group.push(seat); }
      }
      if (group.length > best.length) best = group;
    }
    plan.facilities.push(...best);
    quantities.push(
      { role: '仪式背景', zone: ceremony.name, requested: 1, placed: oldArches.length + (plan.facilities.includes(arch) ? 1 : 0), placeholder: !archMaterial },
      { role: '观礼椅', zone: ceremony.name, requested: wanted, placed: existing.length + best.length, placeholder: !chair },
    );
    notes.push('观礼席围绕中央通道左右成对成列，逐席朝向同一个仪式焦点；已比较不同组团宽度，没有用全区网格填充。');
  } else {
    notes.push('没有识别到仪式观礼区的适用区域，未擅自另划区域。');
  }

  const fill = async (role: Role, zone: PlanZone | undefined, wanted: number, fromFarSide = false) => {
    if (!zone) { notes.push(`没有识别到${specs[role].label}的适用区域，未擅自另划区域。`); return; }
    wanted = wantedCount(role, zone, wanted);
    const existing = plan.facilities.filter(item => item.zoneId === zone.id && item.allocationKey?.startsWith(`wedding:${zone.id}:${role}:`));
    const material = materialFor(role, input.library), spec = specs[role];
    const rect = rectFromRing(zone.polygon);
    const axis = site.approach;
    const stepAlong = (material?.depth ?? spec.depth) + 0.6;
    const stepAcross = (material?.width ?? spec.width) + 0.4;
    const rows = Math.min(60, Math.max(1, Math.floor(axisDepth(rect, axis) / stepAlong)));
    const columns = Math.min(30, Math.max(1, Math.floor(axisWidth(rect, axis) / stepAcross)));
    let placed = existing.length;
    for (let row = 0; row < rows && placed < wanted && plan.facilities.length < 1900; row++) {
      const t = fromFarSide ? 1 - (row + 0.5) / rows : (row + 0.5) / rows;
      for (let column = 0; column < columns && placed < wanted && plan.facilities.length < 1900; column++) {
        input.signal.throwIfAborted();
        const point = pointInRectAt(rect, axis, t, (column + 0.5) / columns);
        const facility = make(role, zone, placed + 1, point);
        if (canPlace(facility, zone)) { plan.facilities.push(facility); placed++; }
      }
    }
    quantities.push({ role: spec.label, zone: zone.name, requested: wanted, placed, placeholder: !material });
    await new Promise(resolve => setTimeout(resolve, 0));
    input.signal.throwIfAborted();
  };

  await fill('welcome-table', zoneFor('welcome'), 1);
  await fill('sign', zoneFor('welcome'), 2);
  await fill('photo', zoneFor('photo'), 1, true);
  await fill('rest-chair', zoneFor('rest'), 4);
  await fill('service-table', service, 2);

  input.onPhase?.('按桌组成宴席桌椅，保留座椅到具体桌号的关联');
  if (banquet) {
    const table = materialFor('banquet-table', input.library), chair = materialFor('banquet-chair', input.library);
    const tableWidth = table?.width ?? WEDDING_DEFAULTS.tableDiameterM, tableDepth = table?.depth ?? WEDDING_DEFAULTS.tableDiameterM;
    const chairWidth = chair?.width ?? 0.5, chairDepth = chair?.depth ?? 0.55;
    const chairDiagonal = Math.hypot(chairWidth, chairDepth);
    const radius = Math.hypot(tableWidth, tableDepth) / 2 + chairDiagonal / 2 + 0.2;
    const envelope = radius + chairDiagonal / 2;
    let tables = plan.facilities.filter(item => item.zoneId === banquet.id && item.allocationKey?.startsWith(`wedding:${banquet.id}:banquet-table:`)).length;
    let seats = plan.facilities.filter(item => item.zoneId === banquet.id && item.allocationKey?.startsWith(`wedding:${banquet.id}:banquet-chair:`)).length;
    const wantedSeats = wantedCount('banquet-chair', banquet, guests);
    const wantedTables = wantedCount('banquet-table', banquet, Math.ceil(wantedSeats / WEDDING_DEFAULTS.seatsPerTable));
    const acceptedCenters = plan.facilities.filter(f => f.zoneId === banquet.id && f.allocationKey?.includes(':banquet-table:')).map(f => f.position);
    for (const point of banquetCenters(rectFromRing(banquet.polygon), envelope, site.approach, {
      aisleM: WEDDING_DEFAULTS.aisleM + 2 * WEDDING_DEFAULTS.routeClearanceM,
    })) {
      if (tables >= wantedTables || plan.facilities.length + WEDDING_DEFAULTS.seatsPerTable + 1 > 1900) break;
      input.signal.throwIfAborted();
      if (acceptedCenters.some(other => Math.hypot(other.x - point.x, other.y - point.y) < 2 * envelope + WEDDING_DEFAULTS.serviceAisleM)) continue;
      const tableNo = tables + 1;
      const group: PlanFacility[] = [make('banquet-table', banquet, tableNo, point)];
      const seatsForTable = Math.min(WEDDING_DEFAULTS.seatsPerTable, wantedSeats - seats);
      for (let seat = 0; seat < seatsForTable; seat++) {
        const angle = (seat * 2 * Math.PI) / WEDDING_DEFAULTS.seatsPerTable;
        const facility = make('banquet-chair', banquet, seat + 1, { x: point.x + radius * Math.cos(angle), y: point.y + radius * Math.sin(angle) }, ((angle * 180 / Math.PI + 90 + 180) % 360) - 180);
        facility.name = `宴席 ${tableNo} 桌 ${seat + 1} 座`;
        facility.allocationKey = `wedding:${banquet.id}:banquet-chair:${tableNo}:${seat + 1}`;
        facility.notes += `；所属桌号 ${tableNo}，未分配具体宾客。`;
        group.push(facility);
      }
      const probe: SitePlanData = { ...plan, facilities: [...plan.facilities] };
      let fits = true;
      for (const facility of group) {
        if (!canPlace(facility, banquet, probe)) { fits = false; break; }
        probe.facilities.push(facility);
      }
      // 整组一起落位：桌与全部座椅都放得下才接受，不留半张桌或落单椅子。
      if (fits) {
        plan.facilities.push(...group);
        acceptedCenters.push(point);
        tables++;
        seats += group.length - 1;
      }
    }
    quantities.push(
      { role: '宴席圆桌', zone: banquet.name, requested: wantedTables, placed: tables, placeholder: !table },
      { role: '宴席座椅', zone: banquet.name, requested: wantedSeats, placed: seats, placeholder: !chair },
    );
    notes.push('宴席按「1 桌 + 整组座椅」一起落位，中央通道两侧成组排布；放不下整组的桌位不落地，差额如实列出。');
  } else {
    notes.push('没有识别到宴席区的适用区域，未擅自另划区域。');
  }

  for (const need of input.brief.items.filter(item => !handledNeeds.has(item))) {
    input.signal.throwIfAborted();
    const material = input.library.filter(item => item.available && !item.id.startsWith('icon:') && (item.id === need.query || item.name.includes(need.query)))
      .sort((a, z) => (a.name === need.query ? 0 : 1) - (z.name === need.query ? 0 : 1))[0];
    if (!material) { notes.push(`另需 ${need.zone || '活动范围'} ${need.query}×${need.count}：库中没有匹配物料，未冒充已放置或已生成。`); continue; }
    try {
      const result = await proposeInventoryObjects(plan, { ...input.brief, items: [{ ...need, query: material.id }] }, [material], undefined,
        { hardBlocks: blocked, signal: input.signal, packed: true, softDemand: true });
      plan.facilities = result.plan.facilities;
      const targetZone = plan.zones.find(zone => zone.id === need.zone || zone.name === need.zone);
      const placed = result.mismatched.length ? 0
        : plan.facilities.filter(item => item.allocationKey?.endsWith(`:${material.id}`) && (!targetZone || item.zoneId === targetZone.id)).length;
      quantities.push({ role: need.query, zone: need.zone || '活动范围', requested: need.count, placed, placeholder: false });
      if (result.mismatched.length) notes.push(`${need.zone} 尚未对应到实际分区，${need.query} 保留为待落实需求。`);
    } catch (error) {
      input.signal.throwIfAborted();
      notes.push(error instanceof Error ? error.message : `${need.query} 暂未落位，原物料保留。`);
    }
  }

  for (const quantity of quantities) {
    if (quantity.placed < quantity.requested) notes.push(`${quantity.zone}：${quantity.role}需要 ${quantity.requested} 件，实际放入 ${quantity.placed} 件，差 ${quantity.requested - quantity.placed} 件；未降低人数或硬塞。`);
    if (quantity.placed > quantity.requested) notes.push(`${quantity.zone}已有 ${quantity.placed} 件${quantity.role}，多于本轮 ${quantity.requested} 件需求；未擅自删除已有布置。`);
  }
  for (const role of ['观礼椅', '宴席座椅']) {
    const count = quantities.find(quantity => quantity.role === role)?.placed ?? 0;
    if (count < guests) notes.push(`${role}实际 ${count} 席，低于本版 ${guests} 人的安排目标；保留人数目标，需调整范围、物料或活动时段。`);
  }
  notes.push('观礼与宴席座椅分别计数，尚未假定两个环节之间搬运复用；此处只有物理座位，具体宾客分配留到名册安排。');
  const placeholders = plan.facilities.filter(item => item.templateId.startsWith('wedding-placeholder:')).length;
  if (placeholders) notes.push(`${placeholders} 件为明确标注的尺寸占位件，缺少模型的品类需选型；没有提交生成或采购任务。`);
  if (!existingZones) notes.push('草案尚未采用时，可直接说“换成宴席优先”或“换成仪式优先”比较两种分区配比。');
  if (input.brief.items.length) notes.push('明确物料数量优先于默认清单；未落实条目保留并逐项列明，不改写原需求。');
  if (!plan.facilities.length) throw new Error(notes.join(' ') || '当前范围没有可落位的婚礼物件，请用聊天调整尺寸或分区。');

  const annotations = (plan.annotations ?? []).filter(annotation => !['wedding-layout:assumptions', 'wedding-layout:camera-space'].includes(annotation.notes));
  if (cameraSpace.length && annotations.length < 498 && !facilityPlacementIssues(cameraSpace, plan.boundary).length) {
    annotations.push({
      id: crypto.randomUUID(), kind: 'rect', name: '摄影与工作人员预留区（假设）', points: [cameraSpace[0]!, cameraSpace[2]!],
      text: '摄影与工作人员活动空间', color: '#bca783', notes: 'wedding-layout:camera-space',
    });
  }
  if (annotations.length < 500) {
    plan.annotations = [...annotations, {
      id: crypto.randomUUID(), kind: 'note', name: '婚礼起稿假设',
      points: [site.entrance.position],
      text: `${strategyLabels[strategy]}；${input.brief.guests ? '人数按已提供需求' : '人数未提供，暂按60人起稿'}；${site.entrance.confirmed ? `入口按已核验的「${site.entrance.name}」` : '入场方向为南侧假设'}；${site.landscape.applied ? `焦点朝${directionText(site.landscape.direction)}（有依据）` : '景观方向未知，保留假设'}。占位件尺寸是估计，路线与真实门的关系需要核对。`,
      notes: 'wedding-layout:assumptions',
    }];
  }

  // ---- 硬冲突前置审计：先报冲突，再谈容量与取舍。
  const conflicts: WeddingHardConflicts = { boundary: 0, obstacles: 0, collisions: 0, corridors: 0, total: 0 };
  for (const facility of plan.facilities) {
    const ring = facilityFootprintRing(facility);
    const zone = plan.zones.find(item => item.id === facility.zoneId);
    if (facilityPlacementIssues(ring, plan.boundary).length || (zone && facilityPlacementIssues(ring, zone.polygon).length)) conflicts.boundary++;
    if (blocked.some(block => outdoorRingsOverlap(ring, block))) conflicts.obstacles++;
    if (plan.routes.some(route => outdoorCorridorStrips(route.points, route.widthM ?? 3).some(strip => outdoorRingsOverlap(ring, strip)))) conflicts.corridors++;
  }
  conflicts.collisions = countCollisions(plan.facilities);
  conflicts.total = conflicts.boundary + conflicts.obstacles + conflicts.collisions + conflicts.corridors;

  const ceremonySeatsPlaced = quantities.find(q => q.role === '观礼椅')?.placed ?? 0;
  const banquetSeatsPlaced = quantities.find(q => q.role === '宴席座椅')?.placed ?? 0;
  const banquetTablesPlaced = quantities.find(q => q.role === '宴席圆桌')?.placed ?? 0;
  // 一桌未落时整组率记 0：不能把「没摆桌」报成「桌桌完整」。
  const group = banquet
    ? tableGroupIntegrity(plan.facilities, banquet, banquetSeatsPlaced > 0 ? banquetSeatsPlaced : guests)
    : { tables: 0, integrity: 0 };
  const pedestrian = plan.routes.filter(route => route.kind !== 'service' && route.name.startsWith('婚礼·'));
  const serviceRoutes = plan.routes.filter(route => route.kind === 'service' && route.name.startsWith('婚礼·'));
  const routeCrossings = pedestrian.reduce((sum, a) => sum + serviceRoutes.reduce((inner, b) => inner + polylineCrossings(a.points, b.points), 0), 0);
  const metrics: WeddingCandidateMetrics = {
    ceremonySeats: ceremonySeatsPlaced,
    banquetSeats: banquetSeatsPlaced,
    banquetTables: banquetTablesPlaced,
    target: guests,
    ceremonyZoneM2: ceremony ? Math.round(rectArea(rectFromRing(ceremony.polygon))) : 0,
    banquetZoneM2: banquet ? Math.round(rectArea(rectFromRing(banquet.polygon))) : 0,
    entryWalkM: main ? Math.round(polylineLength(main.points) * 10) / 10 : 0,
    serviceRouteM: Math.round(serviceRoutes.reduce((sum, route) => sum + polylineLength(route.points), 0) * 10) / 10,
    routeCrossings,
    tableGroupIntegrity: Math.round(group.integrity * 100) / 100,
    landscapeApplied: site.landscape.applied,
  };
  notes.push(`几何校验：物件碰撞${conflicts.collisions}处，越界${conflicts.boundary}件，已知障碍冲突${conflicts.obstacles}件，通道占用${conflicts.corridors}件；观礼${metrics.ceremonySeats}/${guests}席，宴席${metrics.banquetSeats}/${guests}席（${metrics.banquetTables}桌，整组率${Math.round(metrics.tableGroupIntegrity * 100)}%）。真实边界、出入口可达性及现场安全仍待核对。`);

  const tradeoffs: string[] = [
    `仪式区 ${metrics.ceremonyZoneM2} ㎡、宴席区 ${metrics.banquetZoneM2} ㎡；观礼 ${metrics.ceremonySeats}/${guests} 席、宴席 ${metrics.banquetSeats}/${guests} 席（${metrics.banquetTables} 桌）。`,
    `入口到仪式区通道 ${metrics.entryWalkM} m，后勤通道 ${metrics.serviceRouteM} m，宾客/后勤路线交叉 ${metrics.routeCrossings} 处。`,
    site.landscape.applied
      ? `仪式焦点朝${directionText(site.landscape.direction)}，依据为${site.landscape.evidence === 'user-confirmed' ? '用户确认' : '地图证据'}。`
      : '景观方向未确认，本版未把观景作为取舍理由。',
  ];
  if (conflicts.total) tradeoffs.push(`存在 ${conflicts.total} 处硬冲突（边界 ${conflicts.boundary} / 障碍 ${conflicts.obstacles} / 碰撞 ${conflicts.collisions} / 通道 ${conflicts.corridors}），不能直接采用。`);

  return {
    plan, notes, quantities,
    candidate: {
      id: strategy, label: strategyLabels[strategy],
      status: conflicts.total ? 'needs-adjustment' : 'ready',
      plan, metrics, hardConflicts: conflicts, tradeoffs,
    },
  };
}

// ------------------------------------------------------------------ diff + pick

function diffPlans(original: SitePlanData, next: SitePlanData): WeddingPlanDiff {
  const compare = <T extends { id: string }>(before: readonly T[], after: readonly T[]) => {
    const beforeById = new Map(before.map(item => [item.id, item]));
    const afterById = new Map(after.map(item => [item.id, item]));
    let changed = 0, kept = 0;
    for (const [id, item] of afterById) {
      const old = beforeById.get(id);
      if (!old) continue;
      if (JSON.stringify(old) === JSON.stringify(item)) kept++; else changed++;
    }
    return {
      added: [...afterById.keys()].filter(id => !beforeById.has(id)).length,
      removed: [...beforeById.keys()].filter(id => !afterById.has(id)).length,
      changed, kept,
    };
  };
  const facilities = compare(original.facilities ?? [], next.facilities ?? []);
  const zones = compare(original.zones ?? [], next.zones ?? []);
  const routes = compare(original.routes ?? [], next.routes ?? []);
  return {
    facilities, zones, routes,
    unchanged: facilities.added + facilities.removed + facilities.changed + zones.added + zones.removed + zones.changed
      + routes.added + routes.removed + routes.changed === 0,
  };
}

/**
 * 选择题：硬冲突是门，不参与打分；过了门才比「两个环节都能坐下的人数」，
 * 再比路线交叉与入口步行距离；同分时才回到调用方给的首选。
 */
function recommend(
  candidates: WeddingCandidate[],
  preferred: WeddingStrategy,
  compareBoth: boolean,
  focusDirection: WeddingDirection,
): { chosen: WeddingCandidate; reasons: string[] } {
  const ready = candidates.filter(candidate => candidate.hardConflicts.total === 0);
  const pool = ready.length ? ready : candidates;
  const capacity = (candidate: WeddingCandidate) => Math.min(candidate.metrics.ceremonySeats, candidate.metrics.banquetSeats) * 1000
    + candidate.metrics.ceremonySeats + candidate.metrics.banquetSeats;
  const ranked = [...pool].sort((a, b) =>
    capacity(b) - capacity(a)
    || (a.metrics.routeCrossings - b.metrics.routeCrossings)
    || (a.metrics.entryWalkM - b.metrics.entryWalkM)
    || (a.id === preferred ? -1 : 1));
  if (!compareBoth) {
    const wanted = candidates.find(candidate => candidate.id === preferred);
    if (wanted && (ready.length === 0 || wanted.status === 'ready')) return { chosen: wanted, reasons: [] };
  }
  const chosen = ranked[0]!;
  const other = candidates.find(candidate => candidate.id !== chosen.id);
  const reasons: string[] = [];
  reasons.push(`硬冲突 ${chosen.hardConflicts.total} 处（边界 ${chosen.hardConflicts.boundary} / 障碍 ${chosen.hardConflicts.obstacles} / 碰撞 ${chosen.hardConflicts.collisions} / 通道 ${chosen.hardConflicts.corridors}）${chosen.status === 'ready' ? '，先满足边界、障碍与通道再谈取舍' : '，本版不能直接采用'}`);
  reasons.push(`观礼 ${chosen.metrics.ceremonySeats}/${chosen.metrics.target} 席、宴席 ${chosen.metrics.banquetSeats}/${chosen.metrics.target} 席（${chosen.metrics.banquetTables} 桌，整组率 ${Math.round(chosen.metrics.tableGroupIntegrity * 100)}%）`);
  if (other) {
    reasons.push(`另一版「${other.label}」：观礼 ${other.metrics.ceremonySeats} 席、宴席 ${other.metrics.banquetSeats} 席、仪式区 ${other.metrics.ceremonyZoneM2} ㎡、入口步行 ${other.metrics.entryWalkM} m`);
    const sameArea = chosen.metrics.ceremonyZoneM2 === other.metrics.ceremonyZoneM2
      && chosen.metrics.banquetZoneM2 === other.metrics.banquetZoneM2;
    reasons.push(sameArea
      ? `两版面积归属相同（场地只能这么分），差别只在通道走向与落位结果：仪式区 ${chosen.metrics.ceremonyZoneM2} ㎡，入口步行 ${chosen.metrics.entryWalkM} m 对 ${other.metrics.entryWalkM} m`
      : `两版差在面积归属：仪式区 ${chosen.metrics.ceremonyZoneM2} ㎡ 对 ${other.metrics.ceremonyZoneM2} ㎡，入口步行 ${chosen.metrics.entryWalkM} m 对 ${other.metrics.entryWalkM} m`);
  }
  reasons.push(chosen.metrics.landscapeApplied
    ? `焦点朝${directionText(focusDirection)}，有已给出的景观依据；遮挡仍需 3D 核对`
    : '景观方向没有依据，两版都没有把「观景」写成推荐理由');
  return { chosen, reasons };
}

// ---------------------------------------------------------------------- public

export async function proposeWeddingLayout(input: WeddingLayoutInput): Promise<WeddingLayoutReport> {
  input.signal.throwIfAborted();
  if (!checkBoundaryRing(input.plan.boundary).ok) throw new Error('还没有可用的活动范围；先用聊天确认或调整 Agent 提出的范围。');

  const original = structuredClone(input.plan);
  const lockedIds = new Set(input.lockedFacilityIds ?? []);
  // 保留规则：非婚礼用途、室内、有人/岗位引用、含锁定件的分区整块保留；其余婚礼分区才可重排。
  const preserved = input.optimize
    ? input.plan.zones.filter(zone => !roleOf(zone)
      || zone.environment === 'indoor'
      || input.plan.workers.some(worker => worker.zoneId === zone.id)
      || input.plan.facilities.some(facility => lockedIds.has(facility.id) && facility.zoneId === zone.id))
    : [];
  const preservedIds = new Set(preserved.map(zone => zone.id));
  const replacedIds = new Set(input.plan.zones.filter(zone => !preservedIds.has(zone.id)).map(zone => zone.id));
  const preservedFacilities = input.plan.facilities.filter(facility => !replacedIds.has(facility.zoneId ?? ''));
  const base: SitePlanData = input.optimize
    ? {
      ...input.plan,
      zones: preserved,
      facilities: preservedFacilities,
      routes: input.plan.routes.filter(route => !route.name.startsWith('婚礼·')
        || input.plan.workers.some(worker => worker.routeIds?.includes(route.id))),
    }
    : input.plan;

  const site = readWeddingSite(input, preserved.map(zone => zone.polygon));
  const existingZones = base.zones.length > 0;
  const frozenZoneIds = new Set(preservedIds);
  const guests = input.brief.guests ?? WEDDING_DEFAULTS.guests;
  const seat = materialFor('ceremony-chair', input.library) ?? { width: specs['ceremony-chair'].width, depth: specs['ceremony-chair'].depth };
  const chair = materialFor('banquet-chair', input.library) ?? { width: specs['banquet-chair'].width, depth: specs['banquet-chair'].depth };
  const table = materialFor('banquet-table', input.library) ?? { width: specs['banquet-table'].width, depth: specs['banquet-table'].depth };
  const envelope = Math.hypot(table.width, table.depth) / 2 + Math.hypot(chair.width, chair.depth) + 0.2;

  const buildZones = (strategy: WeddingStrategy): { zones: PlanZone[]; notes: string[] } => {
    const declared = input.brief.zones;
    if (declared.length && !existingZones) {
      const notes: string[] = [];
      const zones = proposeUseZones({ ...base, zones: [] }, {
        ...input.brief,
        zones: declared.map(zone => ({ ...zone, environment: zone.environment === 'unknown' ? 'outdoor' : zone.environment })),
      }).zones;
      for (const zone of zones) {
        if (declared.find(need => need.name === zone.name)?.environment === 'unknown') {
          zone.environment = 'unknown';
          zone.notes += '；室内外属性未知，本版只作概念布置，不代表真实室内边界。';
          notes.push(`${zone.name}的室内外属性未确认，保留未知状态并先画概念占位。`);
        }
      }
      notes.push('本轮分区来自已提供的名称、用途和方位；没有照搬默认婚礼分区覆盖它们。');
      return { zones, notes };
    }
    if (existingZones) return { zones: [...base.zones], notes: [] };
    const organized = organizeWeddingZones(site, strategy, { guests, seat: { width: seat.width, depth: seat.depth }, envelope });
    // 被保留的同用途分区不再另划一份；锁定区内不补新物件。
    const zones = organized.zones.filter(zone => !preserved.some(other => roleOf(other) === roleOf(zone)));
    return { zones: [...base.zones, ...zones], notes: organized.notes };
  };

  const strategies: WeddingStrategy[] = ['ceremony-first', 'banquet-first'];
  const built: BuiltCandidate[] = [];
  const failures: string[] = [];
  for (const strategy of strategies) {
    input.signal.throwIfAborted();
    if (existingZones && built.length) break;
    let organization: { zones: PlanZone[]; notes: string[] };
    try {
      organization = buildZones(strategy);
    } catch (error) {
      input.signal.throwIfAborted();
      failures.push(error instanceof Error ? error.message : `「${strategyLabels[strategy]}」分区未生成。`);
      continue;
    }
    try {
      input.onPhase?.(`判断可布置区域（${strategyLabels[strategy]}）`);
      const result = await buildWeddingCandidate({
        input, site, strategy, base, zones: organization.zones, existingZones, frozenZoneIds,
      });
      result.notes.unshift(...organization.notes);
      built.push(result);
    } catch (error) {
      input.signal.throwIfAborted();
      failures.push(error instanceof Error ? error.message : `「${strategyLabels[strategy]}」未生成。`);
    }
  }
  if (!built.length) {
    throw new Error(failures.join(' ') || '已知边界与保留区域内没有可落位的婚礼组团；原方案保留。建议扩大可用范围或分时使用仪式与宴席区。');
  }

  const compareBoth = !existingZones && built.length > 1;
  const preferred: WeddingStrategy = input.strategy ?? 'ceremony-first';
  const candidates = built.map(item => item.candidate);
  const { chosen, reasons } = recommend(candidates, preferred, compareBoth, directionOfAxis(site.focusAxis));
  const winner = built.find(item => item.candidate === chosen)!;

  const notes = [...winner.notes];
  if (input.optimize) {
    notes.unshift(`已评估原有 ${replacedIds.size} 个婚礼分区，重新组织签到→仪式→婚宴；原方案未修改，新版采用后可整批撤销。`);
    if (compareBoth) notes.push(`自动比较 ${built.length} 版空间组织，先剔除有硬冲突的候选，再比容量、路线交叉与入口步行距离；未降低目标人数。`);
  }
  if (compareBoth) {
    notes.push(`本轮给出 ${built.length} 版候选：${built.map(item => `「${item.candidate.label}」`).join('、')}；推荐「${chosen.label}」。`);
    for (const reason of reasons) notes.push(`推荐理由：${reason}`);
  }
  if (failures.length) notes.push(`另一版未能生成：${failures.join(' ')}`);

  const counterpart = built.find(item => item.candidate !== chosen);
  if (counterpart) {
    notes.push(`未采用的「${counterpart.candidate.label}」：仪式区 ${counterpart.candidate.metrics.ceremonyZoneM2} ㎡、宴席区 ${counterpart.candidate.metrics.banquetZoneM2} ㎡，观礼 ${counterpart.candidate.metrics.ceremonySeats} 席、宴席 ${counterpart.candidate.metrics.banquetSeats} 席；可整版对照后再决定。`);
  }

  const checks: WeddingLayoutReport['checks'] = {
    collisions: chosen.hardConflicts.collisions,
    boundary: chosen.hardConflicts.boundary,
    obstacles: chosen.hardConflicts.obstacles,
    corridors: chosen.hardConflicts.corridors,
    ceremonySeats: chosen.metrics.ceremonySeats,
    banquetSeats: chosen.metrics.banquetSeats,
    target: guests,
    hardConflicts: chosen.hardConflicts.total,
    status: chosen.status,
    access: 'pending',
    safety: 'unverified',
  };
  if (chosen.status !== 'ready') notes.unshift('本版存在硬冲突，标为待调整，不能直接采用；冲突不会被容量或得分抵消。');

  return {
    plan: winner.plan,
    notes,
    quantities: winner.quantities,
    checks,
    originalPlan: original,
    site: {
      placeableAreaM2: Math.round(site.domain.areaM2),
      boundaryAreaM2: Math.round(site.domain.boundaryAreaM2),
      usableRects: site.rects.length,
      entrance: {
        confirmed: site.entrance.confirmed,
        source: site.entrance.source,
        name: site.entrance.name,
        position: site.entrance.position,
        verification: site.entrance.verification,
      },
      landscape: site.landscape,
      focusDirection: directionOfAxis(site.focusAxis),
      approachDirection: directionOfAxis(site.approach),
    },
    candidates,
    recommendedId: chosen.id,
    recommendation: { candidateId: chosen.id, reasons },
    diff: diffPlans(original, winner.plan),
  };
}
