import { checkFunctionalRequirements } from '../components/room-organizer/lib/functional-requirements';
import { sameLayoutContent } from '../components/room-organizer/lib/persistence';
import { MAX_ID_LENGTH, parseStoredLayout } from '../components/room-organizer/lib/schema';
import { checkRequiredSeats, checkRestArea } from '../components/room-organizer/lib/seat-requirement';
import { canApplyLayoutGeometry } from '../components/room-organizer/lib/structural-layout';
import type { BriefMemory } from '../components/room-organizer/lib/brief-agent';
import type { FurnitureItem, RoomLayout, RoomZone } from '../components/room-organizer/lib/types';
import { applyLayoutCommand, applyLayoutCommandWithRefusals, completeLayoutError } from './build-command';
import type { LayoutPlanDraft } from './plan-annotation';
import { sceneDoorAnnotations } from './plan-scene-doors';
import { generateScoredPlans, type ScoredPlan } from './plan-scoring';
import { extractPlanSizeFacts } from './plan-size-facts';
import { appendPlanZones } from './plan-zone-persistence';

export interface PrepareZonePlanInput {
  /** 点击确认时的当前布局与草案。 */
  layout: RoomLayout;
  draft: LayoutPlanDraft;
  floorIndex: number;
  /** 卡片实际展示的布局、草案和被选择的版本；不能用新结果冒充旧预览。 */
  reviewedLayout: RoomLayout;
  reviewedDraft: LayoutPlanDraft;
  reviewedPlan: ScoredPlan;
  /** 仅用已确认需求；null 表示尚未明确。 */
  brief?: BriefMemory | null;
  /** 展示卡片时的需求快照；必须由调用方保留，不能在确认时重新采样。 */
  reviewedBrief: BriefMemory | null;
}

export type PreparedZonePlan =
  | { ok: true; layout: RoomLayout; items: FurnitureItem[]; addedZones: RoomZone[]; remainingDraft: LayoutPlanDraft | null; warnings: string[]; plan: ScoredPlan }
  | { ok: false; reason: string };

/** 与卡片共用相同输入；场景中的真实门记录只参与检查，不写入草案或布局。 */
export function zonePlanCandidates(layout: RoomLayout, floorIndex: number, draft: LayoutPlanDraft, brief?: BriefMemory | null): ScoredPlan[] {
  if (!draft.annotations.some(annotation => annotation.kind === 'zone')) return [];
  const ids = new Set(draft.annotations.map(annotation => annotation.id));
  const annotations = [...draft.annotations, ...sceneDoorAnnotations(layout, floorIndex).filter(door => !ids.has(door.id))];
  return generateScoredPlans(annotations, {
    roomSize: { width: layout.width, height: layout.height, facts: extractPlanSizeFacts(layout, floorIndex) },
    ...(brief?.allGuestsSeated === true && brief.headcount !== null ? { targetCapacity: brief.headcount } : {}),
  });
}

function canonical(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === 'number' && !Number.isFinite(item)) return { nonfinite: String(item) };
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map(key => [key, normalize(record[key])]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

/** 区域集合的稳定短摘要仅用于命名，真正的编号碰撞仍须拒绝。 */
function areaDigest(areas: LayoutPlanDraft['annotations']): string {
  const value = areas.map(canonical).sort().join('\n');
  let first = 2166136261, second = 2246822519;
  for (let i = 0; i < value.length; i++) {
    first = Math.imul(first ^ value.charCodeAt(i), 16777619);
    second = Math.imul(second ^ value.charCodeAt(i), 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function briefForReview(brief: BriefMemory | null | undefined): unknown {
  if (!brief) return null;
  const { event, headcount, headcountMode, allGuestsSeated, venueIO, lengthM, widthM,
    areaM2, layoutMode, layoutModeConfirmed, layoutModeUnresolved, mobilityRequirement, mobilityNeedsClarification, pendingBasicFacts, zoneNeeds, pendingActivityNeeds, unresolvedActivityNeeds } = brief;
  return { event, headcount, headcountMode, allGuestsSeated, venueIO, lengthM, widthM,
    areaM2, layoutMode, layoutModeConfirmed, layoutModeUnresolved, mobilityRequirement, mobilityNeedsClarification, pendingBasicFacts, zoneNeeds, pendingActivityNeeds, unresolvedActivityNeeds };
}

/** 只准备候选，不提交、不保存、不修改输入。 */
export function prepareZonePlan(input: PrepareZonePlanInput): PreparedZonePlan {
  const { layout, reviewedLayout, draft, reviewedDraft, reviewedPlan, floorIndex, brief, reviewedBrief } = input;
  try {
    if (layout.id !== reviewedLayout.id || !sameLayoutContent(layout, reviewedLayout) || canonical(draft) !== canonical(reviewedDraft)) {
      return { ok: false, reason: '场地或草案已变化，请重新核对方案。' };
    }
    if (canonical(briefForReview(brief)) !== canonical(briefForReview(reviewedBrief))) {
      return { ok: false, reason: '活动需求已变化，请重新核对方案。' };
    }
    if (brief && (brief.pendingActivityNeeds.length > 0 || brief.unresolvedActivityNeeds.length > 0 || brief.layoutModeUnresolved === true || brief.mobilityNeedsClarification === true || brief.mobilityRequirement?.decision === 'unknown' || (brief.pendingBasicFacts?.length ?? 0) > 0)) {
      return { ok: false, reason: '还有未确认的活动需求，请先回答或修正。' };
    }
    const zones = appendPlanZones(layout, floorIndex, draft);
    if (!zones.ok) return zones;
    const areaAnnotations = draft.annotations.filter(annotation => annotation.kind === 'zone');
    if (areaAnnotations.some(annotation => annotation.zoneType === undefined)) {
      return { ok: false, reason: '有区域尚未指定用途，不能自动按圆桌摆放；请先选择区域类型。' };
    }
    const currentPlan = zonePlanCandidates(layout, floorIndex, draft, brief).find(plan => plan.variantId === reviewedPlan.variantId);
    if (!currentPlan || canonical(currentPlan) !== canonical(reviewedPlan)) {
      return { ok: false, reason: '所选版本或检查结果已变化，请重新核对方案。' };
    }
    if (!currentPlan.feasible) return { ok: false, reason: currentPlan.violations
      .filter(v => v.severity === 'hard' && (v.status === undefined || v.status === 'violated')).map(v => v.message).join('；') || '这版存在需要处理的冲突。' };
    if (currentPlan.skipped.length) return { ok: false, reason: `这版有物料未能放入：${currentPlan.skipped.map(item => item.reason).join('；')}。请调整后再试。` };
    if (!currentPlan.placements.length) return { ok: false, reason: '这版没有生成物料；请调整区域后重新核对。' };

    const occupied = new Set(zones.layout.floors.flatMap(floor => [floor.id, ...floor.items.map(item => item.id),
      ...(floor.zones ?? []).map(zone => zone.id), ...(floor.interiorWalls ?? []).map(wall => wall.id)]));
    const opId = `zone-plan:${encodeURIComponent(draft.id)}:${currentPlan.variantId}:${areaDigest(areaAnnotations)}`;
    if (opId.length > MAX_ID_LENGTH) return { ok: false, reason: '方案编号过长，无法无损保存。' };
    const items: FurnitureItem[] = [];
    for (const [index, placement] of currentPlan.placements.entries()) {
      const id = `${opId}:${index}`;
      if (id.length > MAX_ID_LENGTH || occupied.has(id)) return { ok: false, reason: '物料编号与已有内容冲突，请重新核对。' };
      occupied.add(id);
      items.push({ id, type: placement.spec.type, name: placement.spec.name, width: placement.spec.width,
        depth: placement.spec.depth, height: placement.spec.height, color: placement.spec.color, icon: placement.spec.icon,
        category: placement.spec.category, position: { x: placement.x, z: placement.z }, rotation: placement.rotation,
        source: 'builtin' } as FurnitureItem);
    }
    const candidate: RoomLayout = { ...zones.layout, floors: zones.layout.floors.map((floor, index) => index === floorIndex
      ? { ...floor, items: [...floor.items, ...items] } : floor) };
    const applied = applyLayoutCommandWithRefusals(applyLayoutCommand({ layout: candidate }), { layout });
    const error = completeLayoutError(applied);
    if (error) return { ok: false, reason: error };
    if (!canApplyLayoutGeometry(layout, applied.nextLayout)) return { ok: false, reason: '候选物料与真实场地边界或结构冲突，请调整后重试。' };
    const savedForm = parseStoredLayout(JSON.parse(JSON.stringify(applied.nextLayout)));
    if (!savedForm || savedForm.id !== applied.nextLayout.id || !sameLayoutContent(savedForm, applied.nextLayout)) {
      return { ok: false, reason: '这版包含无法无损保存的布局数据，请先核对物料和区域。' };
    }
    if (brief?.allGuestsSeated === true && (!Number.isSafeInteger(brief.headcount) || !brief.headcount || brief.headcount < 1)) {
      return { ok: false, reason: '已要求所有人入座，请先确认人数。' };
    }
    const seatCheck = checkRequiredSeats(applied.nextLayout, floorIndex, brief?.headcount, brief?.allGuestsSeated === true);
    if (seatCheck.status === 'unknown') return { ok: false, reason: seatCheck.message ?? '座席要求尚未核对。' };
    const restCheck = checkRestArea(applied.nextLayout, floorIndex, brief?.zoneNeeds.rest === true);
    const functional = checkFunctionalRequirements(applied.nextLayout, floorIndex,
      { checkin: brief?.zoneNeeds.checkin ?? null, stage: brief?.zoneNeeds.stage ?? null });
    const candidateFloor = applied.nextLayout.floors[floorIndex];
    const restConflict = brief?.zoneNeeds.rest === false && (
      (candidateFloor?.zones ?? []).some(zone => zone.name.includes('休息') && !/(不设|不需要|取消|禁止)/.test(zone.name))
      || (candidateFloor?.items ?? []).some(item => item.name.includes('休息') && !/(不设|不需要|取消|禁止)/.test(item.name)));
    const issues = [restCheck.status === 'unknown' ? restCheck.message : null,
      restConflict ? '候选中仍有休息区，与不需要休息区的要求不一致；请核对后调整，系统不会自动删除。' : null,
      ...functional.filter(check => check.status === 'unknown' && brief?.zoneNeeds[check.kind] != null).map(check => check.message)].filter((message): message is string => !!message);
    if (issues.length) return { ok: false, reason: issues.join('；') };
    const warnings = [...new Set([...zones.warnings,
      ...currentPlan.violations.filter(v => v.status === 'unknown').map(v => v.message),
      ...functional.filter(check => brief?.zoneNeeds[check.kind] == null).map(check => check.message),
      ...(seatCheck.status === 'quantity_met' && seatCheck.message ? [seatCheck.message] : []),
      '这版是待核验草案；出入口、通行、消防、无障碍和物料库存仍需现场核对。',
      ...(brief?.allGuestsSeated && brief.headcountMode !== 'must' ? ['人数是估计值，请在活动前重新核对实际座席需求。'] : []),
    ])];
    return { ok: true, layout: applied.nextLayout, items, addedZones: zones.addedZones,
      remainingDraft: zones.remainingDraft, warnings, plan: currentPlan };
  } catch {
    return { ok: false, reason: '方案数据无法核对，原布局和草案没有改变。' };
  }
}
