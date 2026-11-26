import { describe, expect, it } from 'vitest';
import {
  MIRROR_WRITE_FROZEN,
  MIRROR_WRITE_POINTS,
  shellRetiredMirrorPoints,
} from './layout-plan-mirror';

describe('layout-plan 镜像写冻结登记（S3-3）', () => {
  it('冻结开关打开，禁止新增未登记双向镜像写点', () => {
    expect(MIRROR_WRITE_FROZEN).toBe(true);
  });

  it('登记键唯一、字段非空、方向与处置合法', () => {
    const ids = MIRROR_WRITE_POINTS.map(point => point.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const point of MIRROR_WRITE_POINTS) {
      expect(point.file).toBeTruthy();
      expect(point.location).toBeTruthy();
      expect(['plan-to-layout', 'layout-to-plan']).toContain(point.direction);
      expect(['retire-with-shell', 'positive-source-ground']).toContain(point.disposition);
      expect(point.fields.length).toBeGreaterThan(0);
      expect(point.note).toBeTruthy();
    }
  });

  it('随壳退役的回写点全部是 plan-to-layout，且恰好 5 处', () => {
    const retired = shellRetiredMirrorPoints();
    expect(retired).toHaveLength(5);
    for (const point of retired) {
      expect(point.direction).toBe('plan-to-layout');
      expect(point.disposition).toBe('retire-with-shell');
      expect(point.retireBatch).toBe('shell-whole-cut');
      // 每处都还列着当前壳读消费方；无消费者的点才允许在整刀前先删。
      expect(point.consumers.length).toBeGreaterThan(0);
    }
  });

  it('正源写入点不挂壳读消费方，保留在案', () => {
    const ground = MIRROR_WRITE_POINTS.filter(point => point.disposition === 'positive-source-ground');
    expect(ground).toHaveLength(3);
    for (const point of ground) {
      expect(point.direction).toBe('layout-to-plan');
      expect(point.fields).toEqual(['plan.ground']);
      expect(point.retireBatch).toBe('keep');
      expect(point.consumers).toEqual([]);
    }
  });
});
