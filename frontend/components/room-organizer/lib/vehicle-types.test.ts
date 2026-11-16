import { describe, expect, it } from 'vitest';
import { VEHICLE_TYPES, vehicleModelSlug } from './vehicle-types';
import { builtinModelBySlug } from './plan-facility-models';

describe('vehicle-types（车清单与模型归一）', () => {
  it('每种车有唯一 id、合法 kind/carrier 口径', () => {
    const ids = VEHICLE_TYPES.map((type) => type.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const type of VEHICLE_TYPES) {
      expect(['pedestrian', 'vehicle', 'service']).toContain(type.kind);
      expect(['walk', 'trolley', 'vehicle', 'mixed']).toContain(type.carrier);
      // 机动车 carrier 必须落 vehicle；后勤服务车按 service。
      if (type.kind === 'vehicle') expect(type.carrier).toBe('vehicle');
    }
  });

  it('登记了模型的 slug 都能在内置模型目录命中（前缀归一，不留 404 裸 slug）', () => {
    for (const type of VEHICLE_TYPES) {
      const slug = vehicleModelSlug(type);
      if (!slug) continue;
      const candidate = builtinModelBySlug(slug);
      expect(candidate, `${type.name} 的模型 slug 未在内置目录命中: ${slug}`).not.toBeNull();
      expect(candidate!.glbUrl).toBe(`/showcase/assets/library/model/${slug}.glb`);
    }
  });
});
