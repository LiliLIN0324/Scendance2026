import { describe, expect, it } from 'vitest';
import type { LayoutPlanDraft } from '../../../lib/plan-annotation';
import { formatZoneRange, numberPlanZones, stageZoneNumbers } from './plan-zone-numbering';

/** 造一份「7 个阶段 / 13 个分区」的草案，用来对编号稳定性。 */
function draft(): LayoutPlanDraft {
  const zones = ['主入口', '支路一', '支路二', '支路三', '森林北', '森林南', '迎宾区', '仪式区', '婚宴区', '礼堂', '花园', '水景'];
  return {
    id: 'draft-zones',
    createdAt: 0,
    stages: [
      { stageNo: 2, title: '森林缓冲带', rationale: '挡风', annotationIds: ['z5', 'z6'] },
      { stageNo: 1, title: '主迎宾大道与三条支路', rationale: '先立骨架', annotationIds: ['z1', 'z2', 'z3', 'z4'] },
      { stageNo: 3, title: '迎宾区', rationale: '接人流', annotationIds: ['z7'] },
    ],
    annotations: zones.map((label, index) => ({
      id: `z${index + 1}`,
      kind: 'zone' as const,
      label,
      stageNo: 1,
      geometry: { kind: 'rect' as const, x: 0, z: 0, width: 4, depth: 4 },
    })),
  } as LayoutPlanDraft;
}

describe('分区编号', () => {
  it('按阶段号升序编号，阶段内按引用顺序——和计划卡对得上', () => {
    const numbered = numberPlanZones(draft());
    expect(numbered.get('z1')!.number).toBe(1);
    expect(numbered.get('z4')!.number).toBe(4);
    // 阶段 2 的两块地接在阶段 1 后面
    expect(numbered.get('z5')!.number).toBe(5);
    expect(numbered.get('z6')!.number).toBe(6);
    expect(numbered.get('z7')!.number).toBe(7);
  });

  it('没被阶段引用的分区补在最后，不占别人的号', () => {
    const numbered = numberPlanZones(draft());
    expect(numbered.get('z8')!.number).toBe(8);
    expect(numbered.get('z8')!.stageNo).toBe(0);
    expect(numbered.get('z1')!.number).toBe(1);
  });

  it('反复算结果一致（编号不许漂移）', () => {
    const first = [...numberPlanZones(draft()).values()].map((zone) => `${zone.zoneId}:${zone.number}`);
    const second = [...numberPlanZones(draft()).values()].map((zone) => `${zone.zoneId}:${zone.number}`);
    expect(second).toEqual(first);
  });

  it('非 zone 标注不占号', () => {
    const base = draft();
    const withRoute: LayoutPlanDraft = {
      ...base,
      annotations: [...base.annotations, {
        id: 'r1', kind: 'route', label: '入场动线', stageNo: 1,
        geometry: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] },
      }],
    };
    const numbered = numberPlanZones(withRoute);
    expect(numbered.has('r1')).toBe(false);
    expect(numbered.size).toBe(12);
  });

  it('空草案不抛错', () => {
    expect(numberPlanZones(null).size).toBe(0);
  });
});

describe('阶段 → 编号区间', () => {
  it('阶段号对应的编号是连续的，可直接写进计划标题', () => {
    const numbers = stageZoneNumbers(draft());
    expect(numbers.get(1)).toEqual([1, 2, 3, 4]);
    expect(numbers.get(2)).toEqual([5, 6]);
    expect(formatZoneRange(numbers.get(1)!)).toBe('#1-#4');
    expect(formatZoneRange(numbers.get(2)!)).toBe('#5-#6');
  });

  it('断号时另起一段，不假装连续', () => {
    expect(formatZoneRange([1, 2, 3, 4, 5, 8, 12, 13])).toBe('#1-#5、#8、#12-#13');
    expect(formatZoneRange([7])).toBe('#7');
    expect(formatZoneRange([])).toBe('');
  });
});
