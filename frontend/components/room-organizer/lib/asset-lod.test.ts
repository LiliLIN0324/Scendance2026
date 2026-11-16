import { describe, expect, it } from 'vitest';
import { LOD_SCREEN_FRACTION_THRESHOLDS, pickAssetLodLevel, shouldRejectAsset } from './asset-lod';

const MB = 1024 * 1024;

describe('pickAssetLodLevel（按屏幕占比选档）', () => {
  const allLevels = [{ level: 0 }, { level: 1 }, { level: 2 }];

  it('阈值边界：≥18% 用 LOD0，≥6% 用 LOD1，其余 LOD2', () => {
    expect(pickAssetLodLevel({ screenFraction: 0.5, levels: allLevels })).toBe(0);
    expect(pickAssetLodLevel({ screenFraction: LOD_SCREEN_FRACTION_THRESHOLDS[0]!, levels: allLevels })).toBe(0);
    expect(pickAssetLodLevel({ screenFraction: 0.1, levels: allLevels })).toBe(1);
    expect(pickAssetLodLevel({ screenFraction: LOD_SCREEN_FRACTION_THRESHOLDS[1]!, levels: allLevels })).toBe(1);
    expect(pickAssetLodLevel({ screenFraction: 0.02, levels: allLevels })).toBe(2);
  });

  it('缺中间档时退到实际存在的最近档，不返回不存在的 LOD', () => {
    expect(pickAssetLodLevel({ screenFraction: 0.1, levels: [{ level: 0 }, { level: 2 }] })).toBe(2);
    expect(pickAssetLodLevel({ screenFraction: 0.5, levels: [{ level: 1 }, { level: 2 }] })).toBe(1);
  });

  it('只有一档时任何占比都选它', () => {
    expect(pickAssetLodLevel({ screenFraction: 1, levels: [{ level: 1 }] })).toBe(1);
  });

  it('没有声明 LOD 时返回 0（沿用主资产，不额外降级）', () => {
    expect(pickAssetLodLevel({ screenFraction: 0.01, levels: [] })).toBe(0);
  });

  it('非法占比不崩：NaN / 负数 / 0 按「看不见」取最粗档', () => {
    expect(pickAssetLodLevel({ screenFraction: Number.NaN, levels: allLevels })).toBe(2);
    expect(pickAssetLodLevel({ screenFraction: -1, levels: allLevels })).toBe(2);
    expect(pickAssetLodLevel({ screenFraction: 0, levels: allLevels })).toBe(2);
  });
});

describe('shouldRejectAsset（体积守卫）', () => {
  const limit = 48 * MB;

  it('老资产 41 MB 在上限内：放行（换资产前不能把现有文件挡掉）', () => {
    expect(shouldRejectAsset({ kind: 'walk', bytes: 41.87 * MB, limitBytes: limit }))
      .toEqual({ reject: false });
  });

  it('压缩后 2.5 MB：放行', () => {
    expect(shouldRejectAsset({ kind: 'walk', bytes: 2.5 * MB, limitBytes: limit }).reject).toBe(false);
  });

  it('超限拒绝，reason 同时含实际体积与上限（可直接贴进工单）', () => {
    const result = shouldRejectAsset({ kind: 'walk', bytes: 60 * MB, limitBytes: limit });
    expect(result.reject).toBe(true);
    expect(result.reason).toContain('60.0 MB');
    expect(result.reason).toContain('48.0 MB');
    expect(result.reason).toContain('人物');
  });

  it('收阈值后同一文件被拒（证明「换资产再收阈值」可用同一逻辑）', () => {
    const bytes = 9 * MB;
    expect(shouldRejectAsset({ kind: 'walk', bytes, limitBytes: 48 * MB }).reject).toBe(false);
    const tightened = shouldRejectAsset({ kind: 'walk', bytes, limitBytes: 8 * MB });
    expect(tightened.reject).toBe(true);
    expect(tightened.reason).toContain('8.0 MB');
  });

  it('0 / 负数 / NaN 字节：拒绝（不把空文件当合法资产）', () => {
    for (const bytes of [0, -1, Number.NaN]) {
      const result = shouldRejectAsset({ kind: 'vehicle', bytes, limitBytes: limit });
      expect(result.reject).toBe(true);
      expect(result.reason).toContain('车辆');
    }
  });

  it('上限配置非法（0 / 负数）：拒绝并说明是配置问题，不误判成资产问题', () => {
    const result = shouldRejectAsset({ kind: 'facility', bytes: 1 * MB, limitBytes: 0 });
    expect(result.reject).toBe(true);
    expect(result.reason).toContain('上限配置');
    expect(result.reason).toContain('设施');
  });
});
