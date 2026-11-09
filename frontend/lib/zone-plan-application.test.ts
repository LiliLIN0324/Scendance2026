import { describe, expect, it } from 'vitest';
import { initialBriefMemory, type BriefMemory } from '../components/room-organizer/lib/brief-agent';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import type { LayoutPlanDraft, PlanAnnotation } from './plan-annotation';
import { prepareZonePlan, zonePlanCandidates, type PrepareZonePlanInput } from './zone-plan-application';

const zone = (): PlanAnnotation => ({ id: 'checkin-zone', kind: 'zone', label: '签到区', stageNo: 1, zoneType: 'checkin',
  geometry: { kind: 'rect', x: -4, z: -3, width: 4, depth: 3 } });
const route = (): PlanAnnotation => ({ id: 'route', kind: 'route', label: '活动路线', stageNo: 1,
  geometry: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] } });
const draft = (): LayoutPlanDraft => ({ id: 'draft-1', createdAt: 1, annotations: [zone(), route()],
  stages: [{ stageNo: 1, title: '活动', rationale: '现场需求', annotationIds: ['checkin-zone', 'route'] }] });
const base = (): RoomLayout => makeLayout({ width: 12, height: 10, roof: { style: 'none' }, floors: [makeFloor({ items: [] })] });

function prepared(layout: RoomLayout, source: LayoutPlanDraft, brief: BriefMemory | null = null): PrepareZonePlanInput {
  const candidates = zonePlanCandidates(layout, 0, source, brief);
  const reviewedPlan = candidates.find(plan => plan.feasible && plan.placements.length > 0 && plan.skipped.length === 0);
  expect(reviewedPlan).toBeDefined();
  return { layout, reviewedLayout: structuredClone(layout), draft: source, reviewedDraft: structuredClone(source),
    floorIndex: 0, reviewedPlan: reviewedPlan!, brief, reviewedBrief: structuredClone(brief) };
}

describe('prepareZonePlan', () => {
  it('prepares the reviewed area and real furniture without mutating or deleting the original layout', () => {
    const existing = makeItem({ id: 'existing', name: '已有椅子', type: 'chair', position: { x: 4, z: 3 }, width: 0.5, depth: 0.5, locked: true });
    const layout = base();
    layout.floors[0]!.items.push(existing);
    const source = draft();
    const before = structuredClone(layout), beforeDraft = structuredClone(source);
    const brief = { ...initialBriefMemory(), zoneNeeds: { checkin: true, rest: null, stage: null } };
    const result = prepareZonePlan(prepared(layout, source, brief));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.floors[0]!.items.find(item => item.id === 'existing')).toEqual(existing);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every(item => result.layout.floors[0]!.items.some(actual => actual.id === item.id))).toBe(true);
    expect(result.addedZones[0]!.name).toBe('签到区');
    expect(result.remainingDraft?.annotations.map(item => item.id)).toEqual(['route']);
    expect(result.remainingDraft?.stages[0]!.annotationIds).toEqual(['route']);
    expect(result.layout.floors[0]!.items.some(item => item.type === 'door')).toBe(false);
    expect(result.warnings.join(' ')).toContain('待核验');
    expect(layout).toEqual(before);
    expect(source).toEqual(beforeDraft);
  });

  it('shows inventory as unknown for a candidate even with existing locked furniture on multiple floors', () => {
    const layout = base();
    layout.floors[0]!.items.push(makeItem({ id: 'locked', type: 'chair', locked: true, position: { x: 4, z: 3 } }));
    layout.floors.push(makeFloor({ id: 'upper', items: [makeItem({ id: 'upper-chair', type: 'chair' })] }));
    const plans = zonePlanCandidates(layout, 0, draft());
    const plan = plans.find(candidate => candidate.placements.length > 0)!;
    expect(plan.inventoryNotes?.join(' ')).toContain('既有家具及其他楼层未计入');
    expect(plan.inventoryNotes?.join(' ')).toContain('库存未知');
    expect(plan.inventoryNotes?.join(' ')).not.toContain('库存已确认');
    expect(layout.floors[0]!.items[0]!.id).toBe('locked');
    expect(layout.floors[1]!.items[0]!.id).toBe('upper-chair');
  });

  it('rejects a collision with an existing item instead of partially applying the plan', () => {
    const source = draft(), empty = base();
    const position = zonePlanCandidates(empty, 0, source).find(plan => plan.feasible && plan.placements.length > 0)!.placements[0]!;
    const layout = base();
    layout.floors[0]!.items.push(makeItem({ id: 'old', name: '原有物料', type: position.spec.type,
      width: position.spec.width, depth: position.spec.depth, height: position.spec.height,
      position: { x: position.x, z: position.z }, rotation: position.rotation }));
    const before = structuredClone(layout);
    const result = prepareZonePlan(prepared(layout, source));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('未应用');
    expect(layout).toEqual(before);
  });

  it('refuses insufficient seats and never reports the current search as an absolute capacity', () => {
    const layout = base(), source = draft();
    const brief = { ...initialBriefMemory(), headcount: 1000, headcountMode: 'must' as const, allGuestsSeated: true };
    const result = prepareZonePlan(prepared(layout, source, brief));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('1000');
      expect(result.reason).not.toContain('最多');
    }
    expect(layout.floors[0]!.items).toEqual([]);
  });

  it('refuses a semantic conflict and leaves the user-drawn area in the draft', () => {
    const layout = base(), source = draft(), before = structuredClone(source);
    const brief = { ...initialBriefMemory(), zoneNeeds: { checkin: false, rest: null, stage: null } };
    const result = prepareZonePlan(prepared(layout, source, brief));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('不会自动删除');
    expect(source).toEqual(before);
  });

  it('does not infer a requirement from an unspecified audience or insert a default zone', () => {
    const layout = base(), source = draft();
    const result = prepareZonePlan(prepared(layout, source, initialBriefMemory()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.addedZones).toHaveLength(1);
    expect(result.addedZones[0]!.name).toBe('签到区');
    expect(result.warnings.join(' ')).toContain('尚未确认是否需要签到');
    expect(result.warnings.join(' ')).toContain('尚未确认是否需要舞台');
    expect(result.layout.floors[0]!.zones?.some(item => item.name.includes('休息'))).toBe(false);
  });

  it('keeps unknown requirements visible even without a brief, and keeps a partially confirmed need distinct', () => {
    const layout=base(), source=draft();
    const none=prepareZonePlan(prepared(layout,source,null));
    expect(none.ok).toBe(true);
    if(none.ok) expect(none.warnings.join(' ')).toContain('尚未确认是否需要舞台');
    const brief={...initialBriefMemory(),zoneNeeds:{checkin:true,rest:null,stage:null}};
    const partial=prepareZonePlan(prepared(layout,source,brief));
    expect(partial.ok).toBe(true);
    if(partial.ok){expect(partial.warnings.join(' ')).toContain('尚未确认是否需要舞台');expect(partial.warnings.join(' ')).not.toContain('尚未确认是否需要签到');}
  });

  it('does not require every attendee to sit unless that need was confirmed', () => {
    const layout = base(), source = draft();
    const brief = { ...initialBriefMemory(), headcount: 1000 };
    expect(prepareZonePlan(prepared(layout, source, brief)).ok).toBe(true);
  });

  it('rejects a missing confirmed rest area', () => {
    const layout = base(), source = draft();
    const brief = { ...initialBriefMemory(), zoneNeeds: { checkin: null, rest: true, stage: null } };
    const result = prepareZonePlan(prepared(layout, source, brief));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('休息');
  });

  it('rejects an existing item ID collision without replacing it', () => {
    const layout = base(), source = draft();
    const first = prepareZonePlan(prepared(layout, source));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const id = first.items[0]!.id;
    layout.floors[0]!.items.push(makeItem({ id, name: '已有物料', position: { x: 4, z: 3 } }));
    const before = structuredClone(layout);
    const result = prepareZonePlan(prepared(layout, source));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('编号');
    expect(layout).toEqual(before);
  });

  it('can apply a new area after preserving a route from the same draft', () => {
    const layout = base(), source = draft();
    const first = prepareZonePlan(prepared(layout, source));
    expect(first.ok).toBe(true);
    if (!first.ok || !first.remainingDraft) return;
    const secondZone: PlanAnnotation = { ...zone(), id: 'second-zone', label: '另一签到区',
      geometry: { kind: 'rect', x: 2, z: 1, width: 3, depth: 3 } };
    const nextDraft = { ...first.remainingDraft, annotations: [...first.remainingDraft.annotations, secondZone],
      stages: first.remainingDraft.stages.map(stage => ({ ...stage, annotationIds: [...stage.annotationIds, secondZone.id] })) };
    const second = prepareZonePlan(prepared(first.layout, nextDraft));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.remainingDraft?.annotations.map(annotation => annotation.id)).toEqual(['route']);
    expect(second.layout.floors[0]!.items).toEqual(expect.arrayContaining(first.items));
    expect(second.items.every(item => !first.items.some(old => old.id === item.id))).toBe(true);
  });

  it('blocks unconfirmed model proposals rather than treating them as confirmed', () => {
    const layout = base(), source = draft();
    const brief = { ...initialBriefMemory(), pendingActivityNeeds: [{ kind: 'rest' as const, value: true, evidence: '休息区' }] };
    const result = prepareZonePlan(prepared(layout, source, brief));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('未确认');
  });

  it('rejects changed requirements even when candidate scores stay identical, but ignores the question UI flag', () => {
    const layout = base(), source = draft(), brief = initialBriefMemory();
    const input = prepared(layout, source, brief);
    const changed = { ...brief, headcount: 80 };
    expect(zonePlanCandidates(layout, 0, source, changed)).toEqual(zonePlanCandidates(layout, 0, source, brief));
    const result = prepareZonePlan({ ...input, brief: changed });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('需求已变化');
    expect(prepareZonePlan({ ...input, brief: { ...brief, askedScale: true } }).ok).toBe(true);
    expect(prepareZonePlan({ ...input, brief: { ...brief, zoneNeeds: { ...brief.zoneNeeds, rest: true } } }).ok).toBe(false);
    expect(prepareZonePlan({ ...input, brief: { ...brief, pendingActivityNeeds: [{ kind: 'rest', value: true, evidence: '休息' }] } }).ok).toBe(false);
  });

  it('rejects a stale layout, changed draft, or altered selected version', () => {
    const layout = base(), source = draft(), input = prepared(layout, source);
    const moved = { ...layout, width: 13 };
    expect(prepareZonePlan({ ...input, layout: moved }).ok).toBe(false);
    const edited = { ...source, annotations: source.annotations.map(item => item.id === 'checkin-zone' ? { ...item, label: '已修改' } : item) };
    expect(prepareZonePlan({ ...input, draft: edited }).ok).toBe(false);
    expect(prepareZonePlan({ ...input, reviewedPlan: { ...input.reviewedPlan, score: input.reviewedPlan.score + 1 } }).ok).toBe(false);
    expect(prepareZonePlan({ ...input, reviewedPlan: { ...input.reviewedPlan, variantId: 'missing' as typeof input.reviewedPlan.variantId } }).ok).toBe(false);
  });

  it('rejects an area without a confirmed type instead of silently furnishing it as round tables', () => {
    const layout = base(), source = draft();
    source.annotations = source.annotations.map(item => item.id === 'checkin-zone' ? { ...item, zoneType: undefined } as unknown as PlanAnnotation : item);
    const reviewedPlan = zonePlanCandidates(layout, 0, source)[0]!;
    const input: PrepareZonePlanInput = { layout, reviewedLayout: structuredClone(layout), draft: source, reviewedDraft: structuredClone(source), floorIndex: 0, reviewedPlan, reviewedBrief: null };
    const result = prepareZonePlan(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('尚未指定用途');
  });
});
