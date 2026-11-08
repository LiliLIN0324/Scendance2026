import { describe, expect, it } from 'vitest';
import { SPLAT_LOD_ENTER_M, SPLAT_LOD_POI_M, formatSplatLodDistance, nextSplatLod, splatLodDistanceM } from './splat-lod';

describe('nextSplatLod（MAP-03 视距状态机）', () => {
  it('远景 → 近景：进 100 m 内才翻 splat', () => {
    expect(nextSplatLod('poi', SPLAT_LOD_ENTER_M - 1)).toBe('splat');
    expect(nextSplatLod('poi', SPLAT_LOD_ENTER_M)).toBe('poi'); // 恰好 100 m 还没进圈
  });

  it('近景 → 远景：出 200 m 外才翻 poi', () => {
    expect(nextSplatLod('splat', SPLAT_LOD_POI_M + 1)).toBe('poi');
    expect(nextSplatLod('splat', SPLAT_LOD_POI_M)).toBe('splat'); // 恰好 200 m 仍是近景
  });

  it('100–200 m 滞回区保持上一状态（防临界来回切）', () => {
    for (const distance of [SPLAT_LOD_ENTER_M, 120, 150, 199, SPLAT_LOD_POI_M]) {
      expect(nextSplatLod('splat', distance)).toBe('splat');
      expect(nextSplatLod('poi', distance)).toBe('poi');
    }
  });

  it('零距离（相机贴着锚点）永远是 splat', () => {
    expect(nextSplatLod('poi', 0)).toBe('splat');
    expect(nextSplatLod('splat', 0)).toBe('splat');
  });
});

describe('splatLodDistanceM（水平米距）', () => {
  it('按 metersPerUnit 折回真实米', () => {
    // 相机与锚点相距 10 个世界单位，壳体缩小 2 倍（metersPerUnit=2）= 20 m。
    expect(splatLodDistanceM({ x: 10, z: 0 }, { x: 0, z: 0 }, 2)).toBe(20);
  });

  it('只比水平距离，俯仰高度不参与阈值', () => {
    expect(splatLodDistanceM({ x: 3, z: 4 }, { x: 0, z: 0 }, 1)).toBe(5);
  });

  it('非有限输入按 0 处理（不把 NaN 当远距）', () => {
    expect(splatLodDistanceM({ x: Number.NaN, z: 0 }, { x: 0, z: 0 }, 1)).toBe(0);
  });
});

describe('formatSplatLodDistance', () => {
  it('近处取整米', () => {
    expect(formatSplatLodDistance(99.4)).toBe('99 m');
  });

  it('整景区视距用公里（一位小数）', () => {
    expect(formatSplatLodDistance(9100)).toBe('9.1 km');
  });
});
