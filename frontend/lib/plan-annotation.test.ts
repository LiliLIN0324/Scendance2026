import { describe, expect, it } from 'vitest';
import {
  addAnnotation,
  ANNOTATION_PRESET_LABELS,
  clearAllAnnotations,
  createEmptyPlanDraft,
  formatMeasureLabel,
  measureDistanceM,
  removeAnnotation,
  type PlanAnnotation,
} from './plan-annotation';

/** 造一条测试标注，geometry 可覆盖。 */
function makeAnnotation(partial: Partial<PlanAnnotation> = {}): PlanAnnotation {
  return {
    id: partial.id ?? 'ann-1',
    kind: partial.kind ?? 'zone',
    label: partial.label ?? '主舞台区',
    stageNo: partial.stageNo ?? 1,
    geometry: partial.geometry ?? {
      kind: 'rect',
      x: 0,
      z: 0,
      width: 4,
      depth: 3,
    },
  };
}

describe('createEmptyPlanDraft', () => {
  it('空 draft 无阶段无标注，带 id 与 createdAt', () => {
    const draft = createEmptyPlanDraft();
    expect(draft.id).toMatch(/^plan-/);
    expect(draft.stages).toEqual([]);
    expect(draft.annotations).toEqual([]);
    expect(typeof draft.createdAt).toBe('number');
  });

  it('两次创建的 id 不同', () => {
    expect(createEmptyPlanDraft().id).not.toBe(createEmptyPlanDraft().id);
  });
});

describe('addAnnotation / removeAnnotation 不可变性', () => {
  it('addAnnotation 返回新 draft，原 draft 不变', () => {
    const draft = createEmptyPlanDraft();
    const next = addAnnotation(draft, makeAnnotation({ id: 'a' }));
    expect(draft.annotations).toEqual([]);
    expect(next.annotations).toHaveLength(1);
    expect(next.annotations[0]?.id).toBe('a');
    // id 与 createdAt 保留。
    expect(next.id).toBe(draft.id);
    expect(next.createdAt).toBe(draft.createdAt);
  });

  it('removeAnnotation 删除指定 id，原 draft 不变', () => {
    const draft = addAnnotation(
      addAnnotation(createEmptyPlanDraft(), makeAnnotation({ id: 'a' })),
      makeAnnotation({ id: 'b' }),
    );
    const next = removeAnnotation(draft, 'a');
    expect(draft.annotations).toHaveLength(2);
    expect(next.annotations.map((a) => a.id)).toEqual(['b']);
  });

  it('removeAnnotation 删不存在的 id 时原样返回同引用', () => {
    const draft = addAnnotation(createEmptyPlanDraft(), makeAnnotation({ id: 'a' }));
    expect(removeAnnotation(draft, 'missing')).toBe(draft);
  });
});

describe('clearAllAnnotations', () => {
  it('清空 stages 与 annotations，但保留 id', () => {
    let draft = createEmptyPlanDraft();
    draft = {
      ...draft,
      stages: [{ stageNo: 1, title: '动线', rationale: '门口到舞台', annotationIds: ['a'] }],
      annotations: [makeAnnotation({ id: 'a' })],
    };
    const cleared = clearAllAnnotations(draft);
    expect(cleared.stages).toEqual([]);
    expect(cleared.annotations).toEqual([]);
    // id 与 createdAt 保留，便于「换一版」后指纹可断言同一份草稿槽位。
    expect(cleared.id).toBe(draft.id);
    expect(cleared.createdAt).toBe(draft.createdAt);
  });
});

describe('measureDistanceM', () => {
  it('measure 标注返回欧氏距离', () => {
    const ann: PlanAnnotation = {
      id: 'm',
      kind: 'measure',
      label: '桌间距',
      stageNo: 1,
      geometry: { kind: 'measure', from: { x: 0, z: 0 }, to: { x: 3, z: 4 } },
    };
    expect(measureDistanceM(ann)).toBe(5);
  });

  it('zone / route 标注返回 NaN', () => {
    expect(measureDistanceM(makeAnnotation({ kind: 'zone' }))).toBeNaN();
    expect(
      measureDistanceM({
        ...makeAnnotation({ kind: 'route' }),
        geometry: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] },
      }),
    ).toBeNaN();
  });
});

describe('formatMeasureLabel', () => {
  it('距离对齐 0.1 m 并带单位', () => {
    expect(formatMeasureLabel({ x: 0, z: 0 }, { x: 12.36, z: 0 })).toBe('12.4 m');
  });

  it('对角距离按欧氏长度算', () => {
    expect(formatMeasureLabel({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe('5.0 m');
  });

  it('不足 0.05 m 对齐到 0.1', () => {
    expect(formatMeasureLabel({ x: 0, z: 0 }, { x: 0.04, z: 0 })).toBe('0.0 m');
    expect(formatMeasureLabel({ x: 0, z: 0 }, { x: 0.06, z: 0 })).toBe('0.1 m');
  });
});

describe('ANNOTATION_PRESET_LABELS', () => {
  it('包含活动行业七个预设', () => {
    expect(ANNOTATION_PRESET_LABELS.stage).toBe('主舞台区');
    expect(ANNOTATION_PRESET_LABELS.roundtable).toBe('圆桌区');
    expect(ANNOTATION_PRESET_LABELS.checkin).toBe('签到区');
    expect(ANNOTATION_PRESET_LABELS.prep).toBe('备餐区');
    expect(ANNOTATION_PRESET_LABELS.guest_route).toBe('宾客动线');
    expect(ANNOTATION_PRESET_LABELS.fire_route).toBe('消防疏散');
    expect(ANNOTATION_PRESET_LABELS.reserved).toBe('预留区');
  });
});
