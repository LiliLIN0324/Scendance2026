import { describe, expect, it } from 'vitest';
import {
  addAnnotation,
  createEmptyPlanDraft,
  type LayoutPlanDraft,
  type PlanAnnotation,
} from './plan-annotation';
import { planDraftsEqual, planDraftFingerprint } from './plan-fingerprint';

function zone(id: string, x = 0, z = 0): PlanAnnotation {
  return {
    id,
    kind: 'zone',
    label: '主舞台区',
    stageNo: 1,
    geometry: { kind: 'rect', x, z, width: 4, depth: 3 },
  };
}

function route(id: string): PlanAnnotation {
  return {
    id,
    kind: 'route',
    label: '宾客动线',
    stageNo: 2,
    geometry: { kind: 'polyline', points: [{ x: -5, z: -4 }, { x: 0, z: 0 }] },
  };
}

/** 在空 draft 上挂一组标注与阶段。 */
function withContent(draft: LayoutPlanDraft): LayoutPlanDraft {
  let next = addAnnotation(draft, zone('a'));
  next = addAnnotation(next, route('b'));
  return {
    ...next,
    stages: [
      { stageNo: 2, title: '动线', rationale: '门口到舞台', annotationIds: ['b'] },
      { stageNo: 1, title: '分区', rationale: '前广场留空', annotationIds: ['a'] },
    ],
  };
}

describe('planDraftFingerprint', () => {
  it('同一草案两次生成指纹相同，且为 8 位 hex', () => {
    const draft = withContent(createEmptyPlanDraft());
    const h = planDraftFingerprint(draft);
    expect(h).toBe(planDraftFingerprint(draft));
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it('annotations 数组顺序互换，指纹相同', () => {
    const d1 = withContent(createEmptyPlanDraft());
    let d2 = addAnnotation(createEmptyPlanDraft(), route('b'));
    d2 = addAnnotation(d2, zone('a'));
    d2 = {
      ...d2,
      stages: d1.stages,
    };
    expect(planDraftFingerprint(d1)).toBe(planDraftFingerprint(d2));
  });

  it('stages 在数组里顺序互换，指纹相同', () => {
    const d1 = withContent(createEmptyPlanDraft());
    const d2: LayoutPlanDraft = {
      ...d1,
      stages: [...d1.stages].reverse(),
    };
    expect(planDraftFingerprint(d1)).toBe(planDraftFingerprint(d2));
  });

  it('几何位置动 1cm 指纹变', () => {
    const d1 = withContent(createEmptyPlanDraft());
    const d2 = withContent(createEmptyPlanDraft());
    d2.annotations[0] = zone('a', 0.01, 0);
    expect(planDraftFingerprint(d1)).not.toBe(planDraftFingerprint(d2));
  });

  it('标签文案改动指纹变', () => {
    const d1 = withContent(createEmptyPlanDraft());
    const d2 = withContent(createEmptyPlanDraft());
    d2.annotations[0] = { ...d2.annotations[0], label: '主舞台' };
    expect(planDraftFingerprint(d1)).not.toBe(planDraftFingerprint(d2));
  });

  it('浮点 1e-6 内抖动指纹不变', () => {
    const d1 = withContent(createEmptyPlanDraft());
    const d2 = withContent(createEmptyPlanDraft());
    d2.annotations[0] = zone('a', 0.0000004, 0);
    expect(planDraftFingerprint(d1)).toBe(planDraftFingerprint(d2));
  });

  it('空 draft 与挂了标注的 draft 指纹不同', () => {
    const empty = createEmptyPlanDraft();
    const filled = withContent(empty);
    expect(planDraftFingerprint(empty)).not.toBe(planDraftFingerprint(filled));
  });

  it('两份空 draft 指纹相同（id/createdAt 不进指纹）', () => {
    expect(planDraftFingerprint(createEmptyPlanDraft())).toBe(
      planDraftFingerprint(createEmptyPlanDraft()),
    );
  });
});

describe('planDraftsEqual', () => {
  it('内容相同的两份草案判等', () => {
    expect(planDraftsEqual(withContent(createEmptyPlanDraft()), withContent(createEmptyPlanDraft()))).toBe(true);
  });

  it('一份空一份满判不等', () => {
    expect(planDraftsEqual(createEmptyPlanDraft(), withContent(createEmptyPlanDraft()))).toBe(false);
  });
});
