import { afterEach, describe, expect, it } from 'vitest';
import { getBriefHeadcount, setBriefHeadcount } from './brief-headcount-store';

afterEach(() => {
  // 模块级单例，用例间清理，避免串味。
  setBriefHeadcount(null);
});

describe('brief-headcount-store（SC-19 targetCapacity 接线的镜像层）', () => {
  it('写入后读回同一个数', () => {
    setBriefHeadcount(250);
    expect(getBriefHeadcount()).toBe(250);
  });

  it('null / 非法值统一落 null，打分层就不传 targetCapacity', () => {
    setBriefHeadcount(null);
    expect(getBriefHeadcount()).toBeNull();
    setBriefHeadcount(Number.NaN);
    expect(getBriefHeadcount()).toBeNull();
    setBriefHeadcount(0);
    expect(getBriefHeadcount()).toBeNull();
    setBriefHeadcount(-5);
    expect(getBriefHeadcount()).toBeNull();
  });

  it('小数向下取整（人数语义是整数）', () => {
    setBriefHeadcount(120.9);
    expect(getBriefHeadcount()).toBe(120);
  });
});
