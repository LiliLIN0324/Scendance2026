import { describe, expect, it } from 'vitest';
import {
  crowdGlbUrl,
  crowdModelSlugForType,
  crowdSpreadOffset,
  crowdTypeForRole,
  MAX_CROWD_INSTANCES_PER_WORKER,
  planCrowdPlacements,
} from './plan-crowd-placement';

describe('plan-crowd-placement（2D 岗位 → 3D 人群实例）', () => {
  it('岗位名映射到人群类型', () => {
    expect(crowdTypeForRole('消防')).toBe('fire');
    expect(crowdTypeForRole('医务人员')).toBe('medical');
    expect(crowdTypeForRole('警察')).toBe('police');
    expect(crowdTypeForRole('保安')).toBe('security');
    expect(crowdTypeForRole('志愿者')).toBe('volunteer');
    expect(crowdTypeForRole('主管')).toBe('manager');
    expect(crowdTypeForRole('管理员')).toBe('admin');
    expect(crowdTypeForRole('自定义点')).toBe('staff');
    expect(crowdTypeForRole('完全不认识的岗位')).toBe('staff');
    expect(crowdTypeForRole('')).toBe('staff');
  });

  it('人群类型映射到素材库 slug；没有模型的类型返回 null', () => {
    expect(crowdModelSlugForType('medical')).toBe('low-poly-character-figures-medic-standing-c9e96efa');
    expect(crowdModelSlugForType('fire')).toBe('low-poly-character-figures-firefighter-standing-8ded7b6f');
    expect(crowdModelSlugForType('security')).toBeNull();
    expect(crowdModelSlugForType('police')).toBeNull();
    expect(crowdModelSlugForType('volunteer')).toBeNull();
    expect(crowdModelSlugForType('manager')).toBeNull();
    expect(crowdModelSlugForType('admin')).toBeNull();
  });

  it('模型 URL 指向素材库公开路径', () => {
    expect(crowdGlbUrl('low-poly-character-figures-medic-standing-c9e96efa')).toBe(
      '/showcase/assets/library/model/low-poly-character-figures-medic-standing-c9e96efa.glb',
    );
  });

  it('散布偏移确定且不重叠', () => {
    const a = crowdSpreadOffset(0);
    const b = crowdSpreadOffset(0);
    expect(a).toEqual(b);
    expect(crowdSpreadOffset(1)).not.toEqual(crowdSpreadOffset(0));
    expect(Math.hypot(a.x, a.y)).toBeGreaterThan(0);
  });

  it('按 count 展开成 N 个实例，位置在点位附近', () => {
    const placements = planCrowdPlacements([
      { id: 'w1', role: '保安', count: 6, position: { x: 10, y: 20 } },
    ]);
    expect(placements).toHaveLength(6);
    for (const placement of placements) {
      expect(placement.workerId).toBe('w1');
      expect(placement.crowdType).toBe('security');
      expect(placement.slug).toBeNull();
      expect(placement.glbUrl).toBeNull();
      expect(Math.hypot(placement.at.x - 10, placement.at.y - 20)).toBeLessThan(3);
    }
  });

  it('没有模型的岗位也产出实例（3D 侧画人位标记）', () => {
    const placements = planCrowdPlacements([
      { id: 'w2', role: '消防', count: 2, position: { x: 0, y: 0 } },
    ]);
    expect(placements.map((item) => item.slug)).toEqual([
      'low-poly-character-figures-firefighter-standing-8ded7b6f',
      'low-poly-character-figures-firefighter-standing-8ded7b6f',
    ]);
    expect(placements[0]?.glbUrl).toContain('/showcase/assets/library/model/');
  });

  it('count 超上限时截断', () => {
    const placements = planCrowdPlacements([
      { id: 'w3', role: '观众', count: 9999, position: { x: 0, y: 0 } },
    ]);
    expect(placements).toHaveLength(MAX_CROWD_INSTANCES_PER_WORKER);
  });

  it('保留岗位颜色', () => {
    const placements = planCrowdPlacements([
      { id: 'w4', role: '工作人员', count: 1, position: { x: 0, y: 0 }, color: '#ff8800' },
    ]);
    expect(placements[0]?.color).toBe('#ff8800');
  });
});
