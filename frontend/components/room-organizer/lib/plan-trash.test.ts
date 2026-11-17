import { describe, expect, it } from 'vitest';
import type { PlanFacility, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { moveFacilityToTrash, restoreFacilityFromTrash } from './plan-trash';

const facility = (id: string, name: string): PlanFacility => ({
  id,
  templateId: 'chair',
  name,
  position: { x: 0, y: 0 },
  rotationDeg: 0,
  size: { width: 1, depth: 1 },
  notes: '',
});

const planWith = (facilities: PlanFacility[]): SitePlanData => ({
  boundary: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  facilities,
  workers: [],
  routes: [],
  zones: [],
} as unknown as SitePlanData);

describe('设施软删除', () => {
  it('删除进回收站，带 deletedAt，原 plan 不变', () => {
    const plan = planWith([facility('a', '样例车'), facility('b', '圆桌')]);
    const next = moveFacilityToTrash(plan, 'a', '2026-11-17T12:00:00.000Z');
    expect(next?.facilities.map(item => item.name)).toEqual(['圆桌']);
    expect(next?.trash).toHaveLength(1);
    expect(next?.trash?.[0]).toMatchObject({ id: 'a', deletedAt: '2026-11-17T12:00:00.000Z' });
    expect(plan.facilities).toHaveLength(2);
    expect(plan.trash).toBeUndefined();
  });

  it('恢复回到设施列表，回收站清空', () => {
    const plan = planWith([facility('a', '样例车')]);
    const deleted = moveFacilityToTrash(plan, 'a', '2026-11-17T12:00:00.000Z')!;
    const restored = restoreFacilityFromTrash(deleted, 'a')!;
    expect(restored.facilities.map(item => item.name)).toEqual(['样例车']);
    expect(restored.trash).toEqual([]);
  });

  it('设施不存在 / 条目不存在都返回 null，不静默造数据', () => {
    const plan = planWith([facility('a', '样例车')]);
    expect(moveFacilityToTrash(plan, 'missing')).toBeNull();
    expect(restoreFacilityFromTrash(plan, 'missing')).toBeNull();
  });

  it('回收站超过 200 条时裁掉最旧记录', () => {
    let plan = planWith([]);
    for (let index = 0; index < 205; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      plan = { ...plan, facilities: [facility(id, `物 ${index}`)] };
      plan = moveFacilityToTrash(plan, id)!;
    }
    expect(plan.trash).toHaveLength(200);
    expect(plan.trash?.[0]?.id).toBe('00000000-0000-4000-8000-000000000204');
  });
});
