import { describe, expect, it } from 'vitest';
import {
  countDistinctFrames,
  findNearDuplicateIndices,
  headingCoverage,
  headingSpanDeg,
  isValidScale,
  parseScaleMeters,
  scoreCapture,
  scoreScanImport,
  type CaptureEvidence,
  type CaptureLayer,
  type FrameSample,
  type GpsFix,
} from './scoring';

const CENTER = { latitude: 30.242, longitude: 120.148 };
const METERS_PER_DEGREE = 111_320;

function hashFor(index: number): string {
  let state = 0x9e3779b9 ^ (index + 1) * 0x85ebca6b;
  let output = '';
  for (let chunk = 0; chunk < 4; chunk += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    output += (state & 0xffff).toString(16).padStart(4, '0');
  }
  return output;
}

function gpsAt(index: number, accuracy = 5): GpsFix {
  const angle = (index / 72) * Math.PI * 2;
  const radius = 7;
  return {
    latitude: CENTER.latitude + (Math.sin(angle) * radius) / METERS_PER_DEGREE,
    longitude:
      CENTER.longitude + (Math.cos(angle) * radius) / (METERS_PER_DEGREE * Math.cos((CENTER.latitude * Math.PI) / 180)),
    accuracy,
    at: 1_700_000_000_000 + index * 10_000,
  };
}

function frame(overrides: Partial<FrameSample> = {}): FrameSample {
  return {
    id: overrides.id ?? 'frame',
    layer: overrides.layer ?? 'eye',
    width: overrides.width ?? 4032,
    height: overrides.height ?? 3024,
    meanLuma: overrides.meanLuma ?? 120,
    brightRatio: overrides.brightRatio ?? 0.02,
    darkRatio: overrides.darkRatio ?? 0.12,
    hash: overrides.hash ?? hashFor(0),
    heading: overrides.heading ?? 0,
    gps: overrides.gps === undefined ? gpsAt(0) : overrides.gps,
    at: overrides.at ?? 1_700_000_000_000,
  };
}

function wrapEvidence(frames: FrameSample[], scaleMeters: number | null = 1.2): CaptureEvidence {
  return { mode: 'photo', frames, scaleMeters, durationMinutes: 18 };
}

function threeLayerSet(perLayer = 60): FrameSample[] {
  const layers: CaptureLayer[] = ['low', 'eye', 'high'];
  const frames: FrameSample[] = [];
  for (let layerIndex = 0; layerIndex < 3; layerIndex += 1) {
    for (let index = 0; index < perLayer; index += 1) {
      const station = layerIndex * perLayer + index;
      frames.push(
        frame({
          id: `station-${station}`,
          layer: layers[layerIndex] as CaptureLayer,
          hash: hashFor(station),
          heading: (index / perLayer) * 360,
          gps: gpsAt(station),
          at: 1_700_000_000_000 + station * 10_000,
        }),
      );
    }
  }
  return frames;
}

describe('scoreCapture', () => {
  it('0 张直接判重采，并解释没有样本', () => {
    const result = scoreCapture({ mode: 'photo', frames: [], scaleMeters: 1, durationMinutes: null });
    expect(result.total).toBeLessThan(50);
    expect(result.verdict).toBe('redo');
    expect(result.blockers.join(' ')).toContain('没有任何可用图像样本');
  });

  it('原地旋转 24 张（GPS 同点、朝向 102°）判不合格', () => {
    const frames = Array.from({ length: 24 }, (_, index) =>
      frame({
        id: `spin-${index}`,
        layer: 'eye',
        hash: hashFor(index),
        heading: (index / 23) * 102,
        gps: { ...CENTER, accuracy: 4, at: 1_700_000_000_000 + index * 1000 },
      }),
    );
    const result = scoreCapture(wrapEvidence(frames));
    expect(result.verdict).toBe('redo');
    expect(result.total).toBeLessThanOrEqual(49);
    expect(result.blockers.join(' ')).toContain('原地旋转');
    expect(result.blockers.join(' ')).toContain('102°');
  });

  it('三层 180 张 + 尺度 + 有效 GPS 判可直接跑', () => {
    const result = scoreCapture(wrapEvidence(threeLayerSet()));
    expect(result.verdict).toBe('ready');
    expect(result.total).toBeGreaterThanOrEqual(75);
    expect(result.blockers).toEqual([]);
    expect(result.caps).toEqual([]);
    expect(result.items.find(item => item.key === 'angle')?.earned).toBe(10);
  });

  it('三层 × 24（72 张）只是闭环底线，仍判建议补拍', () => {
    const result = scoreCapture(wrapEvidence(threeLayerSet(24)));
    expect(result.verdict).toBe('supplement');
    expect(result.total).toBeLessThanOrEqual(69);
    expect(result.caps.join(' ')).toContain('120');
  });

  it('全重复帧判重采', () => {
    const frames = Array.from({ length: 72 }, (_, index) =>
      frame({
        id: `dup-${index}`,
        layer: (['low', 'eye', 'high'] as const)[index % 3] ?? 'eye',
        hash: '0000000000000000',
        heading: index * 5,
        gps: gpsAt(index),
      }),
    );
    const result = scoreCapture(wrapEvidence(frames));
    expect(result.verdict).toBe('redo');
    expect(result.blockers.join(' ')).toContain('重复');
    expect(result.metrics.duplicateRate).toBeGreaterThan(0.5);
  });

  it('全过暗帧判重采', () => {
    const frames = threeLayerSet().map(item => ({ ...item, meanLuma: 18, darkRatio: 0.94, brightRatio: 0.01 }));
    const result = scoreCapture(wrapEvidence(frames));
    expect(result.verdict).toBe('redo');
    expect(result.blockers.join(' ')).toContain('过暗');
  });

  it('缺尺度只压到建议补拍，不直接判重采', () => {
    const result = scoreCapture(wrapEvidence(threeLayerSet(), null));
    expect(result.verdict).toBe('supplement');
    expect(result.total).toBeLessThanOrEqual(69);
    expect(result.caps.join(' ')).toContain('尺度');
  });

  it('GPS 精度全部超过 10m 时压到建议补拍', () => {
    const frames = threeLayerSet().map((item, index) => ({ ...item, gps: { ...gpsAt(index), accuracy: 24 } }));
    const result = scoreCapture(wrapEvidence(frames));
    expect(result.verdict).toBe('supplement');
    expect(result.total).toBeLessThanOrEqual(69);
    expect(result.metrics.gpsGoodCoverage).toBe(0);
    expect(result.caps.join(' ')).toContain('GPS');
  });

  it('没有罗盘时角度只按机位推算，最多 5 分', () => {
    const frames = threeLayerSet().map(item => ({ ...item, heading: null }));
    const result = scoreCapture(wrapEvidence(frames));
    const angle = result.items.find(item => item.key === 'angle');
    expect(angle?.earned).toBeLessThanOrEqual(5);
    expect(angle?.detail).toContain('推算');
    expect(result.verdict).toBe('ready');
  });

  it('少于最低可交付 120 个机位时封顶 69 分', () => {
    const frames = threeLayerSet().slice(0, 18);
    const result = scoreCapture(wrapEvidence(frames));
    expect(result.total).toBeLessThanOrEqual(69);
    expect(result.caps.join(' ')).toContain('120');
  });
});

describe('尺度和朝向工具', () => {
  it('解析常见尺度写法', () => {
    expect(parseScaleMeters('20cm')).toBe(0.2);
    expect(parseScaleMeters('1.2m')).toBe(1.2);
    expect(parseScaleMeters('0.8 米')).toBe(0.8);
    expect(parseScaleMeters('1500mm')).toBe(1.5);
    expect(parseScaleMeters('一米')).toBe(1);
    expect(parseScaleMeters('两米')).toBe(2);
    expect(parseScaleMeters('abc')).toBeNull();
    expect(parseScaleMeters('')).toBeNull();
  });

  it('尺度范围 0.1–100m', () => {
    expect(isValidScale(0.1)).toBe(true);
    expect(isValidScale(100)).toBe(true);
    expect(isValidScale(0.09)).toBe(false);
    expect(isValidScale(120)).toBe(false);
    expect(isValidScale(null)).toBe(false);
    expect(parseScaleMeters('0米')).toBe(0);
    expect(isValidScale(parseScaleMeters('120米'))).toBe(false);
  });

  it('朝向跨度能跨 0° 计算', () => {
    expect(headingSpanDeg([350, 0, 10])).toBe(20);
    expect(headingSpanDeg([0, 90, 180, 270])).toBe(270);
    expect(headingSpanDeg([102, 0])).toBe(102);
  });

  it('10° 分桶统计覆盖角', () => {
    const coverage = headingCoverage([0, 9, 10, 350]);
    expect(coverage.bins).toBe(3);
    expect(coverage.coverageDeg).toBe(30);
    expect(coverage.samples).toBe(4);
  });

  it('近似重复只标记与更早样本过近的帧', () => {
    expect(findNearDuplicateIndices(['ffffffffffffffff', 'ffffffffffffffff', '0000000000000000'])).toEqual([1]);
    expect(countDistinctFrames([
      frame({ hash: 'ffffffffffffffff' }),
      frame({ hash: 'ffffffffffffffff' }),
      frame({ hash: '0000000000000000' }),
    ])).toBe(2);
  });
});

describe('scoreScanImport', () => {
  it('文件 + 尺度 + 完整闭环判可直接用', () => {
    const result = scoreScanImport({ fileCount: 1, scaleMeters: 1.2, completeness: 'complete' });
    expect(result.total).toBe(100);
    expect(result.verdict).toBe('ready');
  });

  it('完整性未知时最多建议补拍', () => {
    const result = scoreScanImport({ fileCount: 1, scaleMeters: 1.2, completeness: 'unknown' });
    expect(result.total).toBeLessThanOrEqual(69);
    expect(result.verdict).toBe('supplement');
  });

  it('缺文件或缺尺度判重采', () => {
    const noFile = scoreScanImport({ fileCount: 0, scaleMeters: 1, completeness: 'complete' });
    expect(noFile.verdict).toBe('redo');
    const noScale = scoreScanImport({ fileCount: 1, scaleMeters: null, completeness: 'complete' });
    expect(noScale.verdict).toBe('redo');
    expect(noScale.blockers.join(' ')).toContain('尺度');
  });
});
