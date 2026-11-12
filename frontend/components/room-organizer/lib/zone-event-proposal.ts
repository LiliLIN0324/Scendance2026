/**
 * V-3b（2026-11-13）：区域→事件→物料提案（纯函数，预览不落盘）。
 *
 * 输入场地边界（ENU）+ 出入口节点 + 简报要点（活动名/人数），按「入场朝向分带」切分区：
 * 入口带=签到，中带=观众，远带=舞台（两侧配医疗/VIP），宽场再补停车/装卸侧带；
 * 物料按分区选型（舞台/签到台/医疗帐篷/厕所/垃圾点，模板 id 与内置目录同源），
 * 分区挂 `zone.event`（V-3a 契约）。只产「提案」——应用走用户确认（气泡 → commitPlan 可撤销）。
 * v1 配比是常识拍（audience 48% / stage 20% / checkin 12%，余量留白），用户可在画布继续拖改。
 */

import type { PlanFacility, PlanNode, PlanPoint, PlanZone } from '../../../../supabase/functions/_shared/site-plan';
import { planZoneSemanticLabels } from '../../../../supabase/functions/_shared/site-plan';

/** 提案分区默认色（画布可改；语义即用即识）。 */
const ZONE_COLORS: Record<PlanZone['semantic'], string> = {
  stage: '#6d5bd0',
  audience: '#1a9e5c',
  parking: '#5a6472',
  loading: '#b7791f',
  checkin: '#0668e5',
  queue: '#8a6d3b',
  medical: '#e0508c',
  vip: '#c98a2d',
  reserved: '#9aa1a9',
};

/** 物料选型表（templateId/尺寸与内置目录同源：见 plan-facility-catalog LEGACY_FACILITY_TEMPLATE_KINDS）。 */
const PROPOSAL_FACILITIES = {
  stage: { templateId: 'stage-platform-8x6', name: '舞台', width: 8, depth: 6 },
  checkinDesk: { templateId: 'booth-2x2', name: '签到台', width: 2, depth: 2 },
  medicalTent: { templateId: 'medical-tent-4x3', name: '医疗帐篷', width: 4, depth: 3 },
  toilet: { templateId: 'toilet-2.4x1.2', name: '移动厕所', width: 2.4, depth: 1.2 },
  trashPoint: { templateId: 'trash-point-1.2x1.2', name: '垃圾收集点', width: 1.2, depth: 1.2 },
} as const;

/** 「分区/排区域」类说法 → 生成指令；删除分区不劫持（含宾语前置「把分区删了」）。 */
export function matchZoneCommand(text: string): 'auto' | null {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 60) return null;
  if (/(?:删除|删了|删掉|清空|移除|去掉)/u.test(trimmed) && /分区|区域/u.test(trimmed)) return null;
  if (/分区|排(?:一下)?区域|自动分区|划分(?:一下)?区域|区域规划|布置区域/u.test(trimmed)) return 'auto';
  return null;
}

interface Rect { x: number; y: number; w: number; h: number }

function rectPoints(rect: Rect, round = (v: number) => Math.round(v * 10) / 10): PlanPoint[] {
  return [
    { x: round(rect.x), y: round(rect.y) },
    { x: round(rect.x + rect.w), y: round(rect.y) },
    { x: round(rect.x + rect.w), y: round(rect.y + rect.h) },
    { x: round(rect.x), y: round(rect.y + rect.h) },
  ];
}

type Side = 'N' | 'S' | 'E' | 'W';

/** 入口在哪条边：取第一个出入口节点到四条 bbox 边线的距离（绝对值，节点在界外也正确）；无节点默认南口。 */
function entranceSide(boundary: PlanPoint[], nodes: PlanNode[]): Side {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const point of boundary) {
    west = Math.min(west, point.x); east = Math.max(east, point.x);
    south = Math.min(south, point.y); north = Math.max(north, point.y);
  }
  const first = nodes[0]?.position;
  if (!first) return 'S';
  // 到边线的距离用绝对值：节点可能在边界外一点（提案出入口常落在环线上）。
  const d = [Math.abs(first.y - south), Math.abs(north - first.y), Math.abs(first.x - east), Math.abs(west - first.x)];
  const sides: Side[] = ['S', 'N', 'E', 'W'];
  let best: Side = 'S';
  let bestD = Infinity;
  sides.forEach((side, index) => {
    if (d[index]! < bestD) { bestD = d[index]!; best = side; }
  });
  return best;
}

/**
 * 沿「入口 → 对面」轴切带。axisSpan=入口方向总长，crossSpan=交叉方向总长：
 * S/N 入口时轴=y、交叉=x；E/W 入口时轴=x、交叉=y。
 */
interface BandSpec { semantic: PlanZone['semantic']; start: number; depth: number; cross?: { start: number; span: number } }

function bandsForLayout(axisSpan: number, crossSpan: number): BandSpec[] {
  const bands: BandSpec[] = [];
  // 入口带：签到（全宽 12%，夹在 8–30m）
  const checkinDepth = Math.min(Math.max(axisSpan * 0.12, 8), 30);
  bands.push({ semantic: 'checkin', start: 0, depth: checkinDepth });
  // 中带：观众（全宽 48%）
  const audienceDepth = axisSpan * 0.48;
  bands.push({ semantic: 'audience', start: checkinDepth, depth: audienceDepth });
  // 远带：舞台（居中 52% 宽 20% 深）；交叉向够宽才配两侧（医疗西/VIP 东）
  const stageDepth = Math.min(axisSpan * 0.2, 30);
  if (crossSpan >= 120) {
    const flankSpan = crossSpan * 0.24;
    bands.push({ semantic: 'stage', start: checkinDepth + audienceDepth, depth: stageDepth, cross: { start: flankSpan, span: crossSpan - flankSpan * 2 } });
    bands.push({ semantic: 'medical', start: checkinDepth + audienceDepth, depth: stageDepth, cross: { start: 0, span: flankSpan } });
    bands.push({ semantic: 'vip', start: checkinDepth + audienceDepth, depth: stageDepth, cross: { start: crossSpan - flankSpan, span: flankSpan } });
  } else {
    bands.push({ semantic: 'stage', start: checkinDepth + audienceDepth, depth: stageDepth });
  }
  // 深场（轴 ≥ 90m）补停车/装卸：观众带两侧的侧带
  if (axisSpan >= 90) {
    const sideSpan = Math.min(crossSpan * 0.2, 80);
    bands.push({ semantic: 'parking', start: checkinDepth + axisSpan * 0.08, depth: axisSpan * 0.4, cross: { start: crossSpan - sideSpan, span: sideSpan } });
    bands.push({ semantic: 'loading', start: checkinDepth + axisSpan * 0.08, depth: axisSpan * 0.3, cross: { start: 0, span: sideSpan } });
  }
  return bands;
}

/** 轴坐标 → ENU 矩形（side 决定轴方向与入口原点；轴/交叉的跨度按侧别换算）。 */
function bandRect(band: BandSpec, side: Side, box: { west: number; south: number; east: number; north: number }, usableInset: number): Rect {
  const alongY = side === 'S' || side === 'N';
  const crossTotal = alongY
    ? box.east - box.west - usableInset * 2
    : box.north - box.south - usableInset * 2;
  const crossStartBase = alongY ? box.west + usableInset : box.south + usableInset;
  const axisStartBase = side === 'S' ? box.south + usableInset
    : side === 'N' ? box.north - usableInset
    : side === 'W' ? box.west + usableInset
    : box.east - usableInset;
  const dir = side === 'S' || side === 'W' ? 1 : -1;
  const crossStart = crossStartBase + (band.cross ? band.cross.start : 0);
  const crossSpan = band.cross ? band.cross.span : crossTotal;
  const axisStart = axisStartBase + dir * band.start;
  const axisEnd = axisStartBase + dir * (band.start + band.depth);
  const axisLo = Math.min(axisStart, axisEnd);
  const axisHi = Math.max(axisStart, axisEnd);
  if (alongY) return { x: crossStart, y: axisLo, w: crossSpan, h: axisHi - axisLo };
  return { x: axisLo, y: crossStart, w: axisHi - axisLo, h: crossSpan };
}

function centerOf(rect: Rect): PlanPoint {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function fits(rect: Rect, size: { width: number; depth: number }, pad = 1.5): boolean {
  return rect.w >= size.width + pad * 2 && rect.h >= size.depth + pad * 2;
}

export interface ZoneEventProposal {
  zones: PlanZone[];
  facilities: PlanFacility[];
  summary: { zones: number; facilities: number; side: Side };
}

export interface BuildZoneEventInput {
  boundary: PlanPoint[];
  nodes: PlanNode[];
  brief: { event: string | null; guests: number | null };
}

/**
 * 区域→事件→物料提案。边界太碎（<3 点）或 usable 太小（<40×30m）回 null——
 * 太小的场分区没有意义，提示用户先扩边界。
 */
export function buildZoneEventProposal(
  input: BuildZoneEventInput,
  idFactory: () => string = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `z-${Math.random().toString(36).slice(2)}`),
): ZoneEventProposal | null {
  const { boundary, nodes, brief } = input;
  if (boundary.length < 3) return null;
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const point of boundary) {
    west = Math.min(west, point.x); east = Math.max(east, point.x);
    south = Math.min(south, point.y); north = Math.max(north, point.y);
  }
  const usableInset = Math.max(8, Math.min(east - west, north - south) * 0.06);
  const usableWidth = east - west - usableInset * 2;
  const usableDepth = north - south - usableInset * 2;
  if (usableWidth < 40 || usableDepth < 30) return null;
  const side = entranceSide(boundary, nodes);
  const eventName = brief.event?.trim() || null;
  // 轴/交叉跨度按入口侧别换算：S/N 轴=y；E/W 轴=x。
  const alongY = side === 'S' || side === 'N';
  const axisSpan = alongY ? usableDepth : usableWidth;
  const crossSpan = alongY ? usableWidth : usableDepth;
  const bands = bandsForLayout(axisSpan, crossSpan);
  const zones: PlanZone[] = [];
  const facilities: PlanFacility[] = [];
  const usedNames = new Set<string>();
  const pushZone = (semantic: PlanZone['semantic'], rect: Rect, withEvent: boolean): PlanZone | null => {
    if (rect.w < 10 || rect.h < 8) return null;
    const label = planZoneSemanticLabels[semantic];
    let name = label;
    let suffix = 2;
    while (usedNames.has(name)) { name = `${label}${suffix}`; suffix += 1; }
    usedNames.add(name);
    const zone: PlanZone = {
      id: idFactory(),
      semantic,
      name,
      polygon: rectPoints(rect),
      color: ZONE_COLORS[semantic],
      ...(withEvent && eventName ? { event: `${eventName}·${label}`.slice(0, 120) } : {}),
      notes: 'AI 区域提案：按入场朝向分带（V-3 v1 配比），可在画布拖改',
    };
    zones.push(zone);
    return zone;
  };
  const pushFacility = (
    template: { templateId: string; name: string; width: number; depth: number },
    position: PlanPoint,
    zone: PlanZone,
    index: number,
  ): void => {
    facilities.push({
      id: idFactory(),
      templateId: template.templateId,
      name: index > 0 ? `${template.name}${index + 1}` : template.name,
      position: { x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10 },
      rotationDeg: 0,
      size: { width: template.width, depth: template.depth },
      ...(zone ? { zoneId: zone.id } : {}),
      notes: 'AI 物料提案：按分区事件选型（V-3 v1）',
    });
  };

  const zoneBySemantic = new Map<PlanZone['semantic'], PlanZone>();
  for (const band of bands) {
    const rect = bandRect(band, side, { west, south, east, north }, usableInset);
    const zone = pushZone(band.semantic, rect, band.semantic === 'audience' || band.semantic === 'stage');
    if (zone) zoneBySemantic.set(band.semantic, zone);
  }

  // 物料选型：舞台居舞台区；签到台×2 并排在签到区；医疗帐篷居医疗区；
  // 厕所×2 贴观众区入场侧角落；垃圾点×2 分散（入场角 + 观众远角）。
  const stageZone = zoneBySemantic.get('stage');
  if (stageZone) {
    const rect = { x: stageZone.polygon[0]!.x, y: stageZone.polygon[0]!.y, w: stageZone.polygon[1]!.x - stageZone.polygon[0]!.x, h: stageZone.polygon[2]!.y - stageZone.polygon[0]!.y };
    if (fits(rect, PROPOSAL_FACILITIES.stage)) {
      const c = centerOf(rect);
      pushFacility(PROPOSAL_FACILITIES.stage, { x: c.x, y: c.y }, stageZone, 0);
    }
  }
  const checkinZone = zoneBySemantic.get('checkin');
  if (checkinZone) {
    const rect = { x: checkinZone.polygon[0]!.x, y: checkinZone.polygon[0]!.y, w: checkinZone.polygon[1]!.x - checkinZone.polygon[0]!.x, h: checkinZone.polygon[2]!.y - checkinZone.polygon[0]!.y };
    if (fits(rect, PROPOSAL_FACILITIES.checkinDesk)) {
      const c = centerOf(rect);
      const offset = Math.min(6, rect.w / 4);
      pushFacility(PROPOSAL_FACILITIES.checkinDesk, { x: c.x - offset, y: c.y }, checkinZone, 0);
      pushFacility(PROPOSAL_FACILITIES.checkinDesk, { x: c.x + offset, y: c.y }, checkinZone, 1);
    }
  }
  const medicalZone = zoneBySemantic.get('medical');
  if (medicalZone) {
    const rect = { x: medicalZone.polygon[0]!.x, y: medicalZone.polygon[0]!.y, w: medicalZone.polygon[1]!.x - medicalZone.polygon[0]!.x, h: medicalZone.polygon[2]!.y - medicalZone.polygon[0]!.y };
    if (fits(rect, PROPOSAL_FACILITIES.medicalTent)) pushFacility(PROPOSAL_FACILITIES.medicalTent, centerOf(rect), medicalZone, 0);
  }
  const audienceZone = zoneBySemantic.get('audience');
  if (audienceZone) {
    const rect = { x: audienceZone.polygon[0]!.x, y: audienceZone.polygon[0]!.y, w: audienceZone.polygon[1]!.x - audienceZone.polygon[0]!.x, h: audienceZone.polygon[2]!.y - audienceZone.polygon[0]!.y };
    const entranceY = side === 'S' ? rect.y + 3 : side === 'N' ? rect.y + rect.h - 3 : rect.y + rect.h / 2;
    const entranceX = side === 'W' ? rect.x + 3 : side === 'E' ? rect.x + rect.w - 3 : rect.x + rect.w / 2;
    if (side === 'S' || side === 'N') {
      pushFacility(PROPOSAL_FACILITIES.toilet, { x: rect.x + rect.w - 4, y: entranceY }, audienceZone, 0);
      pushFacility(PROPOSAL_FACILITIES.toilet, { x: rect.x + rect.w - 8, y: entranceY }, audienceZone, 1);
      pushFacility(PROPOSAL_FACILITIES.trashPoint, { x: rect.x + 4, y: entranceY }, audienceZone, 0);
      pushFacility(PROPOSAL_FACILITIES.trashPoint, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, audienceZone, 1);
    } else {
      pushFacility(PROPOSAL_FACILITIES.toilet, { x: entranceX, y: rect.y + rect.h - 4 }, audienceZone, 0);
      pushFacility(PROPOSAL_FACILITIES.toilet, { x: entranceX, y: rect.y + rect.h - 8 }, audienceZone, 1);
      pushFacility(PROPOSAL_FACILITIES.trashPoint, { x: entranceX, y: rect.y + 4 }, audienceZone, 0);
      pushFacility(PROPOSAL_FACILITIES.trashPoint, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, audienceZone, 1);
    }
  }

  if (zones.length === 0) return null;
  return {
    zones,
    facilities,
    summary: { zones: zones.length, facilities: facilities.length, side },
  };
}
