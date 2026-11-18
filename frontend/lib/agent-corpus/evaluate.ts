/**
 * 判据执行器（2026-11-18）。
 *
 * 只算「用现有几何模型就能算」的判据；算不了的一律进 `unsupported`，带原因码，
 * **不计为通过**。这是本轮最重要的一条纪律：宁可报缺，不许假装算过。
 *
 * 输入是结构类型（见 types.ts），可以直接喂 `SitePlanData` 的 facilities / zones / nodes。
 * 规则常量来自 `data/agent-corpus/layout-assertions.json`，这里只按 id 实现算法。
 */

import {
  facilityRect,
  overlapY,
  rectArea,
  rectGap,
  ringArea,
  ringRect,
  round1,
} from './geometry';
import type { CorpusRule, Evaluation, Layout, LayoutFacility, Receipt } from './types';

/** 已实现的判据 id（11 条）。其余 69 条进 unsupported，带原因。 */
export const IMPLEMENTED_RULE_IDS = [
  'GEN-04', // 出口数量（节点计数）
  'GEN-07', // 临时设施距建筑 ≥3 m
  'MKT-02', // 摊位纵/横间距
  'MKT-06', // 明火摊与其他摊位 ≥6 m
  'MKT-07', // 灭火器数量
  'MKT-10', // 摊位占地率 ≤35%
  'MKT-11', // 摊位距建筑 ≥3 m
  'STG-01', // 观众密度 ≥1.0 ㎡/人
  'STG-02', // 首排距舞台 ≥5+4×(H−1.5)
  'CMP-02', // 营位间距 ≥2 m
  'CMP-03', // 帐篷防火 ≥4 m；明火距帐篷 ≥10 m
] as const;

const stallPattern = /booth|market-stall|food-trader|merchandise-stall|stall/i;
const flamePattern = /food-truck|food-trailer|food-trader|kitchen|bbq|grill/i;
const tentPattern = /tent|yurt|chalet/i;
const stagePattern = /stage/i;
const extinguisherPattern = /fire-extinguisher/i;

export function isStall(facility: LayoutFacility): boolean {
  return stallPattern.test(facility.templateId);
}

export function isFlame(facility: LayoutFacility): boolean {
  return flamePattern.test(facility.templateId);
}

export function isTent(facility: LayoutFacility): boolean {
  return tentPattern.test(facility.templateId);
}

export function isStage(facility: LayoutFacility): boolean {
  return stagePattern.test(facility.templateId);
}

function threshold(rule: CorpusRule, matcher: (item: { label: string }) => boolean): number | undefined {
  return rule.thresholds.find(matcher)?.m;
}

function receipt(
  rule: CorpusRule,
  status: Receipt['status'],
  fields: { actual: string; expected: string; detail: string; objectIds?: string[]; reason?: string },
): Receipt {
  return {
    ruleId: rule.id,
    severity: rule.severity,
    status,
    actual: fields.actual,
    expected: fields.expected,
    detail: fields.detail,
    objectIds: fields.objectIds ?? [],
    ...(fields.reason ? { reason: fields.reason } : {}),
  };
}

function skipped(rule: CorpusRule, reason: string, detail: string): Receipt {
  return receipt(rule, 'skipped', { actual: '未计算', expected: rule.check, detail, reason });
}

/**
 * 未实现判据的原因码。按判据需要的前置信息分类，而不是笼统写「暂不支持」：
 * 这样 Agent 回执能直接告诉用户差什么数据。
 */
export function unsupportedReason(rule: CorpusRule): string {
  const check = `${rule.check} ${rule.spec ?? ''}`;
  if (/free_width|clear_height|free_square|overlap\(free_space/.test(check)) return 'needs-raster';
  if (/water_depth/.test(check)) return 'needs-water-depth';
  if (/slope|height\(|level_diff|rise/.test(check)) return 'needs-elevation';
  if (/cover_ratio|shade/.test(check)) return 'needs-canopy';
  if (/wind_speed|LAeq/.test(check)) return 'needs-runtime-sensor';
  if (/sun_hours/.test(check)) return 'needs-season-simulation';
  if (/critical_fall_height|surfacing|sharp_kerb/.test(check)) return 'needs-surface-data';
  if (/wheelchair_space|hydrant/.test(check)) return 'needs-fixture-typing';
  if (/both_sides|aisle_envelope|row_length|interval\(bay\)/.test(check)) return 'needs-aisle-semantics';
  if (/reachable|backtrack|route|interval\(shelter\)/.test(check)) return 'needs-route-topology';
  if (/angle\(seat_front/.test(check)) return 'needs-orientation-semantics';
  if (/count\(shower|count\(bin|count\(accessible_pitch|count\(pitch/.test(check)) return 'needs-fixture-typing';
  return 'needs-metadata';
}

function evaluateGen04(rule: CorpusRule, layout: Layout): Receipt {
  if (!layout.nodes) return skipped(rule, 'no-entrance-nodes', '没有入口/出口节点，无法数出口；请先在地图上标出入口。');
  const exits = layout.nodes.filter((node) => node.kind === 'exit' || node.kind === 'both');
  const people = layout.people;
  // 基础下限读判据表；万人以上的 4 个来自 formula 文字，暂仍写死（台账标 partial）。
  const baseRequired = rule.thresholds.find((item) => item.label.includes('出口数'))?.count ?? 2;
  const required = people !== undefined && people >= 10000 ? Math.max(baseRequired, 4) : baseRequired;
  const ok = exits.length >= required;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `${exits.length} 个出口${people !== undefined ? `（${people} 人）` : ''}`,
    expected: `≥${required} 个出口`,
    detail: ok ? '出口数量满足。' : `出口不足：${exits.length} < ${required}。`,
    objectIds: exits.map((node) => node.id),
  });
}

function evaluateGen07(rule: CorpusRule, layout: Layout): Receipt {
  const buildings = (layout.obstacles ?? []).filter((obstacle) => obstacle.kind === 'building');
  if (buildings.length === 0) return skipped(rule, 'no-building-evidence', '没有建筑足迹证据，无法算退距。');
  const limit = threshold(rule, (item) => item.label.includes('建筑')) ?? 3;
  let worst = Number.POSITIVE_INFINITY;
  let pair: string[] = [];
  for (const facility of layout.facilities) {
    const facilityBox = facilityRect(facility);
    for (const building of buildings) {
      const gap = rectGap(facilityBox, ringRect(building.polygon));
      if (gap < worst) { worst = gap; pair = [facility.id, building.id]; }
    }
  }
  const ok = worst >= limit;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `最小退距 ${round1(worst)} m`,
    expected: `≥${limit} m`,
    detail: ok ? '临时设施与建筑退距满足。' : `「${pair[0]}」距建筑仅 ${round1(worst)} m，需外移。`,
    objectIds: pair,
  });
}

function evaluateMkt02(rule: CorpusRule, layout: Layout): Receipt {
  const stalls = layout.facilities.filter(isStall);
  if (stalls.length < 2) return skipped(rule, 'not-enough-stalls', `只有 ${stalls.length} 个摊位，间距判据不适用。`);
  const lateral = rule.thresholds.find((item) => item.label.includes('横向'))?.m ?? 1.5;
  const longitudinal = rule.thresholds.find((item) => item.label.includes('纵向'))?.m ?? 2;
  let worst = Number.POSITIVE_INFINITY;
  let worstPair: [LayoutFacility, LayoutFacility] | null = null;
  let worstLimit = 0;
  for (let i = 0; i < stalls.length; i += 1) {
    for (let j = i + 1; j < stalls.length; j += 1) {
      const a = stalls[i];
      const b = stalls[j];
      const rectA = facilityRect(a);
      const rectB = facilityRect(b);
      // 左右相邻看横向，上下相邻看纵向；斜向按严的纵向。
      const limit = overlapY(rectA, rectB) ? lateral : longitudinal;
      const gap = rectGap(rectA, rectB);
      if (gap < worst) { worst = gap; worstPair = [a, b]; worstLimit = limit; }
    }
  }
  const ok = worst >= worstLimit;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `最小间距 ${round1(worst)} m`,
    expected: `纵向 ≥${longitudinal} m / 横向 ≥${lateral} m`,
    detail: ok ? '摊位间距满足。' : `「${worstPair?.[0].name}」与「${worstPair?.[1].name}」仅 ${round1(worst)} m，低于 ${worstLimit} m。`,
    objectIds: worstPair ? [worstPair[0].id, worstPair[1].id] : [],
  });
}

function evaluateMkt06(rule: CorpusRule, layout: Layout): Receipt {
  const flames = layout.facilities.filter(isFlame);
  const others = layout.facilities.filter((facility) => isStall(facility) && !isFlame(facility));
  if (flames.length === 0) return skipped(rule, 'no-flame-stall', '没有明火/餐饮摊，判据不适用。');
  if (others.length === 0) return skipped(rule, 'no-other-stall', '没有其他摊位可对照。');
  const limit = threshold(rule, (item) => item.label.includes('其他')) ?? 6;
  let worst = Number.POSITIVE_INFINITY;
  let pair: string[] = [];
  for (const flame of flames) {
    const flameBox = facilityRect(flame);
    for (const other of others) {
      const gap = rectGap(flameBox, facilityRect(other));
      if (gap < worst) { worst = gap; pair = [flame.id, other.id]; }
    }
  }
  const ok = worst >= limit;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `明火摊最近间距 ${round1(worst)} m`,
    expected: `≥${limit} m`,
    detail: ok ? '明火分区距离满足。' : `明火摊与其他摊位仅 ${round1(worst)} m，需分区并置于下风向。`,
    objectIds: pair,
  });
}

function evaluateMkt07(rule: CorpusRule, layout: Layout): Receipt {
  const stalls = layout.facilities.filter(isStall).length;
  if (stalls === 0) return skipped(rule, 'not-enough-stalls', '没有摊位，灭火器配比不适用。');
  const extinguishers = layout.facilities.filter((facility) => extinguisherPattern.test(facility.templateId));
  const perTen = rule.thresholds.find((item) => item.label.includes('每 10 摊'))?.count ?? 2;
  const required = perTen * Math.ceil(stalls / 10);
  const ok = extinguishers.length >= required;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `${extinguishers.length} 具灭火器 / ${stalls} 摊`,
    expected: `≥${required} 具（每 10 摊 ${perTen} 具）`,
    detail: ok ? '灭火器数量满足。' : `灭火器不足：需 ${required} 具，现 ${extinguishers.length} 具。`,
    objectIds: extinguishers.map((facility) => facility.id),
  });
}

function evaluateMkt10(rule: CorpusRule, layout: Layout): Receipt {
  if (!layout.boundary) return skipped(rule, 'no-boundary', '没有场地边界，无法算占地率。');
  const siteArea = ringArea(layout.boundary);
  if (siteArea <= 0) return skipped(rule, 'no-boundary', '场地边界面积为 0。');
  const stallArea = layout.facilities.filter(isStall).reduce((sum, facility) => {
    const rect = facilityRect(facility);
    return sum + rectArea(rect);
  }, 0);
  const ratio = stallArea / siteArea;
  const limit = rule.thresholds.find((item) => item.unit === 'ratio')?.value ?? 0.35;
  const ok = ratio <= limit;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `摊位占地率 ${round1(ratio * 100)}%`,
    expected: `≤${round1(limit * 100)}%`,
    detail: ok ? '摊位占地率满足。' : `摊位占 ${round1(ratio * 100)}%，超过 ${round1(limit * 100)}%，需留出疏散与停留面积。`,
    objectIds: [],
  });
}

function evaluateMkt11(rule: CorpusRule, layout: Layout): Receipt {
  const stalls = layout.facilities.filter(isStall);
  const buildings = (layout.obstacles ?? []).filter((obstacle) => obstacle.kind === 'building');
  if (stalls.length === 0) return skipped(rule, 'not-enough-stalls', '没有摊位。');
  if (buildings.length === 0) return skipped(rule, 'no-building-evidence', '没有建筑足迹证据。');
  const limit = threshold(rule, (item) => item.label.includes('建筑')) ?? 3;
  let worst = Number.POSITIVE_INFINITY;
  let pair: string[] = [];
  for (const stall of stalls) {
    const box = facilityRect(stall);
    for (const building of buildings) {
      const gap = rectGap(box, ringRect(building.polygon));
      if (gap < worst) { worst = gap; pair = [stall.id, building.id]; }
    }
  }
  const ok = worst >= limit;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `摊位距建筑 ${round1(worst)} m`,
    expected: `≥${limit} m`,
    detail: ok ? '摊位与建筑退距满足。' : `摊位距建筑仅 ${round1(worst)} m。`,
    objectIds: pair,
  });
}

function evaluateStg01(rule: CorpusRule, layout: Layout): Receipt {
  const audience = (layout.zones ?? []).find((zone) => zone.semantic === 'audience');
  if (!audience) return skipped(rule, 'no-audience-zone', '没有观众区，密度判据不适用。');
  if (!layout.people) return skipped(rule, 'no-people-count', '没有人数字段，无法算密度；请给预计人数。');
  const area = ringArea(audience.polygon);
  const perPerson = area / layout.people;
  const limit = rule.thresholds.find((item) => item.unit === 'm2_per_person')?.value ?? 1.0;
  const ok = perPerson >= limit;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `${round1(perPerson)} ㎡/人（${round1(area)} ㎡ / ${layout.people} 人）`,
    expected: `≥${limit} ㎡/人`,
    detail: ok ? '观众密度满足。' : `人均仅 ${round1(perPerson)} ㎡，低于 ${limit} ㎡/人，需扩区或降容量。`,
    objectIds: [audience.id],
  });
}

function evaluateStg02(rule: CorpusRule, layout: Layout): Receipt {
  const audience = (layout.zones ?? []).find((zone) => zone.semantic === 'audience');
  const stageZone = (layout.zones ?? []).find((zone) => zone.semantic === 'stage');
  const stageFacility = layout.facilities.find(isStage);
  const stagePolygon = stageZone?.polygon;
  if (!audience) return skipped(rule, 'no-audience-zone', '没有观众区。');
  if (!stagePolygon && !stageFacility) return skipped(rule, 'no-stage', '没有舞台区或舞台设施。');
  const stageRect = stagePolygon ? ringRect(stagePolygon) : facilityRect(stageFacility as LayoutFacility);
  const gap = rectGap(stageRect, ringRect(audience.polygon));
  const height = layout.stageHeightM ?? 0;
  // 基础 5 m 读判据表；1.5 m 分界与 4 m/米 来自 formula 文字，暂仍写死（台账标 partial）。
  const baseGap = rule.thresholds.find((item) => item.label.includes('台高'))?.m ?? 5;
  const limit = baseGap + 4 * Math.max(0, height - 1.5);
  const ok = gap >= limit;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `首排退距 ${round1(gap)} m（台高 ${round1(height)} m）`,
    expected: `≥${round1(limit)} m`,
    detail: ok
      ? '首排退距满足。'
      : `首排距舞台仅 ${round1(gap)} m，按台高 ${round1(height)} m 需 ≥${round1(limit)} m。`,
    objectIds: [audience.id, ...(stageZone ? [stageZone.id] : stageFacility ? [stageFacility.id] : [])],
  });
}

function evaluateCmp02(rule: CorpusRule, layout: Layout): Receipt {
  const tents = layout.facilities.filter(isTent);
  if (tents.length < 2) return skipped(rule, 'not-enough-tents', `只有 ${tents.length} 个帐篷。`);
  const limit = threshold(rule, () => true) ?? 2;
  let worst = Number.POSITIVE_INFINITY;
  let pair: string[] = [];
  for (let i = 0; i < tents.length; i += 1) {
    for (let j = i + 1; j < tents.length; j += 1) {
      const gap = rectGap(facilityRect(tents[i]), facilityRect(tents[j]));
      if (gap < worst) { worst = gap; pair = [tents[i].id, tents[j].id]; }
    }
  }
  const ok = worst >= limit;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `营位最小间距 ${round1(worst)} m`,
    expected: `≥${limit} m`,
    detail: ok ? '营位间距满足。' : `两个帐篷仅相距 ${round1(worst)} m。`,
    objectIds: pair,
  });
}

function evaluateCmp03(rule: CorpusRule, layout: Layout): Receipt {
  const tents = layout.facilities.filter(isTent);
  const flames = layout.facilities.filter(isFlame);
  if (tents.length < 2 && flames.length === 0) return skipped(rule, 'not-enough-tents', '帐篷不足两个且无明火点。');
  const tentLimit = threshold(rule, (item) => item.label.includes('帐篷')) ?? 4;
  const flameLimit = threshold(rule, (item) => item.label.includes('明火')) ?? 10;
  let worstTent = Number.POSITIVE_INFINITY;
  let worstFlame = Number.POSITIVE_INFINITY;
  let pair: string[] = [];
  for (let i = 0; i < tents.length; i += 1) {
    for (let j = i + 1; j < tents.length; j += 1) {
      const gap = rectGap(facilityRect(tents[i]), facilityRect(tents[j]));
      if (gap < worstTent) { worstTent = gap; pair = [tents[i].id, tents[j].id]; }
    }
  }
  for (const flame of flames) {
    for (const tent of tents) {
      const gap = rectGap(facilityRect(flame), facilityRect(tent));
      if (gap < worstFlame) { worstFlame = gap; pair = [flame.id, tent.id]; }
    }
  }
  const tentOk = tents.length < 2 || worstTent >= tentLimit;
  const flameOk = flames.length === 0 || tents.length === 0 || worstFlame >= flameLimit;
  const ok = tentOk && flameOk;
  return receipt(rule, ok ? 'pass' : 'violation', {
    actual: `帐篷间距 ${Number.isFinite(worstTent) ? round1(worstTent) + ' m' : '—'}；明火距帐篷 ${Number.isFinite(worstFlame) ? round1(worstFlame) + ' m' : '—'}`,
    expected: `帐篷 ≥${tentLimit} m；明火 ≥${flameLimit} m`,
    detail: ok ? '防火间距满足。' : '防火间距不足，需按消防口径取严。',
    objectIds: pair,
  });
}

const evaluators: Record<string, (rule: CorpusRule, layout: Layout) => Receipt> = {
  'GEN-04': evaluateGen04,
  'GEN-07': evaluateGen07,
  'MKT-02': evaluateMkt02,
  'MKT-06': evaluateMkt06,
  'MKT-07': evaluateMkt07,
  'MKT-10': evaluateMkt10,
  'MKT-11': evaluateMkt11,
  'STG-01': evaluateStg01,
  'STG-02': evaluateStg02,
  'CMP-02': evaluateCmp02,
  'CMP-03': evaluateCmp03,
};

/**
 * 跑一遍全量判据。
 * 顺序：实现集逐条算 → 其余进 unsupported。返回顺序与传入规则一致，便于 diff。
 */
export function evaluateLayout(layout: Layout, rules: CorpusRule[]): Evaluation {
  const receipts: Receipt[] = [];
  const unsupported: { ruleId: string; reason: string }[] = [];
  for (const rule of rules) {
    const evaluator = evaluators[rule.id];
    if (evaluator) {
      receipts.push(evaluator(rule, layout));
    } else {
      const reason = unsupportedReason(rule);
      unsupported.push({ ruleId: rule.id, reason });
      receipts.push({
        ruleId: rule.id,
        severity: rule.severity,
        status: 'unsupported',
        actual: '未计算',
        expected: rule.check,
        detail: `缺少该判据需要的数据：${reason}。`,
        objectIds: [],
        reason,
      });
    }
  }
  return { receipts, unsupported };
}

/** 只看硬性违规，给回执卡/门禁用。 */
export function hardViolations(evaluation: Evaluation): Receipt[] {
  return evaluation.receipts.filter((item) => item.status === 'violation' && item.severity === 'hard');
}
