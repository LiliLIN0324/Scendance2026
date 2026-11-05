import { describe, expect, it } from 'vitest';
import {
  gpsDistanceMeters,
  headingDeltaDeg,
  inferLayerFromDeviceTilt,
  judgeShot,
  largestHeadingGap,
  nextShotAdvice,
  recommendCaptureMode,
  SHOT_THRESHOLDS,
  type ShotObservation,
} from './shot-rules';

function shot(overrides: Partial<ShotObservation> = {}): ShotObservation {
  return {
    meanLuma: 128,
    brightRatio: 0,
    darkRatio: 0,
    sharpness: 80,
    hash: '0000000000000000',
    gps: { latitude: 30.25, longitude: 120.15 },
    heading: 90,
    ...overrides,
  };
}

describe('judgeShot', () => {
  it('正常照片判合格', () => {
    expect(judgeShot(shot(), null).ok).toBe(true);
  });

  it('过暗判重拍，并给一个动作', () => {
    const verdict = judgeShot(shot({ meanLuma: 30, darkRatio: 0.7 }), null);
    expect(verdict.issue).toBe('dark');
    expect(verdict.ok).toBe(false);
    expect(verdict.action).toContain('转 90°');
  });

  it('过曝判重拍', () => {
    const verdict = judgeShot(shot({ meanLuma: 220, brightRatio: 0.3 }), null);
    expect(verdict.issue).toBe('bright');
  });

  it('拉普拉斯方差低判糊片', () => {
    expect(judgeShot(shot({ sharpness: SHOT_THRESHOLDS.blurVariance - 1 }), null).issue).toBe('blur');
  });

  it('与上一张哈希过近判重复', () => {
    const verdict = judgeShot(shot(), shot({ hash: '0000000000000003' }));
    expect(verdict.issue).toBe('duplicate');
  });

  it('位移超过 1.2m 判走太快', () => {
    const previous = shot({ gps: { latitude: 30.25, longitude: 120.15 } });
    // 0.00002° 纬度约 2.2m；画面不同，才轮得到位移判定
    const current = shot({ gps: { latitude: 30.25002, longitude: 120.15 }, hash: 'ffffffffffffffff' });
    expect(judgeShot(current, previous).issue).toBe('too-fast');
  });

  it('朝向一次转 30° 判转太快', () => {
    expect(judgeShot(shot({ heading: 120, hash: 'ffffffffffffffff' }), shot({ heading: 90 })).issue).toBe('too-fast');
  });

  it('正常步进 15° / 0.6m 不误判', () => {
    const previous = shot();
    const current = shot({
      heading: 105,
      gps: { latitude: 30.250005, longitude: 120.15 },
      hash: 'ffffffffffffffff',
    });
    expect(judgeShot(current, previous).ok).toBe(true);
  });
});

describe('几何工具', () => {
  it('GPS 距离约等于纬度差', () => {
    const meters = gpsDistanceMeters(
      { latitude: 30.25, longitude: 120.15 },
      { latitude: 30.25001, longitude: 120.15 },
    );
    expect(meters).toBeGreaterThan(1);
    expect(meters).toBeLessThan(1.3);
  });

  it('朝向跨 0° 取最小夹角', () => {
    expect(headingDeltaDeg(350, 10)).toBe(20);
  });
});

describe('nextShotAdvice（S1 · 下一拍去哪）', () => {
  const fullLayers = { low: 24, eye: 24, high: 24 };

  it('空场从视线层起步', () => {
    const advice = nextShotAdvice({
      layerCounts: { low: 0, eye: 0, high: 0 },
      currentLayer: 'eye',
      totalFrames: 0,
      coverageDeg: 0,
      coverageEstimated: true,
      headings: [],
    });
    expect(advice.priority).toBe('layer');
    expect(advice.headline).toContain('视线层');
  });

  it('当前层不满时给出剩余张数', () => {
    const advice = nextShotAdvice({
      layerCounts: { low: 0, eye: 12, high: 0 },
      currentLayer: 'eye',
      totalFrames: 12,
      coverageDeg: 60,
      coverageEstimated: true,
      headings: [],
    });
    expect(advice.priority).toBe('layer');
    expect(advice.headline).toContain('视线层');
    expect(advice.headline).toContain('12');
  });

  it('当前层满后切到缺口最大的层', () => {
    const advice = nextShotAdvice({
      layerCounts: { low: 24, eye: 24, high: 5 },
      currentLayer: 'eye',
      totalFrames: 53,
      coverageDeg: 180,
      coverageEstimated: false,
      headings: [10, 50, 90, 130, 170],
    });
    expect(advice.priority).toBe('layer');
    expect(advice.headline).toBe('切到高层');
  });

  it('三层齐但环向不足时指出缺口方向', () => {
    const advice = nextShotAdvice({
      layerCounts: fullLayers,
      currentLayer: 'high',
      totalFrames: 72,
      coverageDeg: 200,
      coverageEstimated: false,
      // 只覆盖 0–179°：缺口在 180–359°，中心约 270°
      headings: [5, 45, 85, 125, 165],
    });
    expect(advice.priority).toBe('coverage');
    expect(advice.detail).toContain('265');
  });

  it('环向闭环但总量不足时提示补密度', () => {
    const advice = nextShotAdvice({
      layerCounts: fullLayers,
      currentLayer: 'eye',
      totalFrames: 80,
      coverageDeg: 330,
      coverageEstimated: false,
      headings: [10, 80, 170, 260, 350],
    });
    expect(advice.priority).toBe('density');
  });

  it('达标后判收工并提醒尺度', () => {
    const advice = nextShotAdvice({
      layerCounts: { low: 40, eye: 40, high: 40 },
      currentLayer: 'eye',
      totalFrames: 120,
      coverageDeg: 350,
      coverageEstimated: false,
      headings: [10, 80, 170, 260, 350],
    });
    expect(advice.priority).toBe('done');
    expect(advice.detail).toContain('尺度');
  });
});

describe('inferLayerFromDeviceTilt（S2 · 俯仰角判层）', () => {
  it('仰起 ≥15° 判低层', () => {
    expect(inferLayerFromDeviceTilt(115)).toBe('low');
  });

  it('压低 ≥15° 判高层', () => {
    expect(inferLayerFromDeviceTilt(65)).toBe('high');
  });

  it('平视附近判视线层', () => {
    expect(inferLayerFromDeviceTilt(95)).toBe('eye');
    expect(inferLayerFromDeviceTilt(88)).toBe('eye');
  });

  it('非数值返回 null', () => {
    expect(inferLayerFromDeviceTilt(Number.NaN)).toBeNull();
  });
});

describe('largestHeadingGap', () => {
  it('半环覆盖指出对面缺口（按 10° bin 计 190°）', () => {
    const gap = largestHeadingGap([5, 45, 85, 125, 165]);
    expect(gap).not.toBeNull();
    expect(gap?.gapDeg).toBe(190);
    expect(gap?.centerDeg).toBe(265);
  });

  it('样本不足返回 null', () => {
    expect(largestHeadingGap([10, 20])).toBeNull();
  });

  it('全环覆盖返回 null', () => {
    const headings: number[] = [];
    for (let i = 0; i < 36; i += 1) headings.push(i * 10);
    expect(largestHeadingGap(headings)).toBeNull();
  });
});

describe('recommendCaptureMode（S3 · 模式推荐）', () => {
  it('小/中型场地推荐拍照', () => {
    expect(recommendCaptureMode('small').mode).toBe('photo');
    expect(recommendCaptureMode('medium').mode).toBe('photo');
  });

  it('大场地推荐视频', () => {
    expect(recommendCaptureMode('large').mode).toBe('video');
    expect(recommendCaptureMode('large').reason.length).toBeGreaterThan(0);
  });
});
