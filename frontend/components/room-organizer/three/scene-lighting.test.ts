import { describe, expect, it } from 'vitest';
import {
  LIGHTING_BOUNDS,
  NEUTRAL_SAMPLE,
  deriveSceneLighting,
  estimateKelvin,
  rememberSceneSample,
  resolveSceneLighting,
  sampleSplatColors,
  tintedLightHex,
  type SceneLighting,
  type SceneSample,
} from './scene-lighting';

/** 用现场亮度/色偏组一份样本；perceived 按线性亮度回算，和真实取样链路一致。 */
function makeSample(overrides: Partial<SceneSample> = {}): SceneSample {
  const merged = { ...NEUTRAL_SAMPLE, ...overrides };
  const luma = 'luma' in overrides ? merged.luma : 0.2126 * merged.r + 0.7152 * merged.g + 0.0722 * merged.b;
  return {
    ...merged,
    luma,
    perceived: 'perceived' in overrides ? merged.perceived : Math.pow(Math.max(0, luma), 1 / 2.2),
    kelvin: 'kelvin' in overrides ? merged.kelvin : estimateKelvin(merged.r, merged.b),
  };
}

/** 典型样本：夜景偏暖、阴天冷灰、晴天高亮、全黑、过曝、极端色偏。 */
const NIGHT_WARM = makeSample({ r: 0.11, g: 0.07, b: 0.04, saturation: 0.55, kelvin: 2900 });
const OVERCAST_COLD = makeSample({ r: 0.3, g: 0.33, b: 0.38, saturation: 0.2, kelvin: 7400 });
const SUNNY_BRIGHT = makeSample({ r: 0.8, g: 0.82, b: 0.76, saturation: 0.16, kelvin: 5900 });
const PITCH_BLACK = makeSample({ r: 0, g: 0, b: 0, luma: 0, perceived: 0, saturation: 0 });
const OVEREXPOSED = makeSample({ r: 1, g: 1, b: 1, luma: 1, perceived: 1, saturation: 0 });
const MAGENTA_CAST = makeSample({ r: 1, g: 0.08, b: 0.25, saturation: 0.92 });

function expectSane(lighting: SceneLighting): void {
  const numbers = [
    lighting.exposure,
    lighting.envIntensity,
    lighting.contrast,
    lighting.saturation,
    lighting.ambient.intensity,
    lighting.hemisphere.intensity,
    lighting.sun.intensity,
  ];
  for (const value of numbers) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
  for (const hex of [lighting.ambient.color, lighting.hemisphere.sky, lighting.hemisphere.ground, lighting.sun.color]) {
    expect(Number.isInteger(hex)).toBe(true);
    expect(hex).toBeGreaterThanOrEqual(0);
    expect(hex).toBeLessThanOrEqual(0xffffff);
  }
}

function channels(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

describe('sampleSplatColors', () => {
  const splat = (colors: Array<[number, number, number, number]>) => ({
    numSplats: colors.length,
    forEachSplat: (callback: (index: number, c: unknown, s: unknown, q: unknown, opacity: number, color: { r: number; g: number; b: number }) => void) => {
      colors.forEach(([r, g, b, alpha], index) => callback(index, null, null, null, alpha, { r, g, b }));
    },
  });

  it('空点云回落到中性样本，不产生 NaN', () => {
    const sample = sampleSplatColors(splat([]));
    expect(sample.samples).toBe(0);
    expect(sample.perceived).toBe(NEUTRAL_SAMPLE.perceived);
    expectSane(deriveSceneLighting(sample));
  });

  it('丢弃 NaN / 越界颜色，不让脏数据污染平均色', () => {
    const sample = sampleSplatColors({
      numSplats: 4,
      forEachSplat: (callback: (index: number, c: unknown, s: unknown, q: unknown, opacity: number, color: { r: number; g: number; b: number }) => void) => {
        callback(0, null, null, null, 0.9, { r: 0.5, g: 0.4, b: 0.4 });
        callback(1, null, null, null, 0.9, { r: Number.NaN, g: 0.2, b: 0.3 });
        callback(2, null, null, null, 0.9, { r: 1.8, g: 0.3, b: 0.2 });
        callback(3, null, null, null, 0.001, { r: 0, g: 0, b: 0 });
      },
    });
    expect(sample.samples).toBe(1);
    expect(sample.r).toBeCloseTo(0.5, 5);
    expect(Number.isFinite(sample.luma)).toBe(true);
  });

  it('近乎透明的薄雾点不参与加权', () => {
    const sample = sampleSplatColors({
      numSplats: 2,
      forEachSplat: (callback: (index: number, c: unknown, s: unknown, q: unknown, opacity: number, color: { r: number; g: number; b: number }) => void) => {
        callback(0, null, null, null, 1, { r: 0.4, g: 0.4, b: 0.4 });
        callback(1, null, null, null, 0.01, { r: 1, g: 1, b: 1 });
      },
    });
    expect(sample.r).toBeCloseTo(0.4, 5);
  });

  it('暖光源比冷光源估出更低色温', () => {
    expect(estimateKelvin(0.6, 0.3)).toBeLessThan(5000);
    expect(estimateKelvin(0.3, 0.6)).toBeGreaterThan(8000);
    expect(estimateKelvin(0, 0.5)).toBe(5500);
  });
});

describe('deriveSceneLighting', () => {
  it('夜景偏暖：曝光与补光被压暗，光色偏暖，全部落在边界内', () => {
    const lighting = deriveSceneLighting(NIGHT_WARM);
    expectSane(lighting);
    expect(lighting.exposure).toBeGreaterThanOrEqual(LIGHTING_BOUNDS.exposure[0]);
    expect(lighting.exposure).toBeLessThan(1.12);
    expect(lighting.ambient.intensity).toBeLessThan(0.4);
    const [r, , b] = channels(lighting.ambient.color);
    expect(r).toBeGreaterThan(b);
  });

  it('阴天冷灰：曝光居中，光色偏冷', () => {
    const lighting = deriveSceneLighting(OVERCAST_COLD);
    expectSane(lighting);
    expect(lighting.exposure).toBeGreaterThan(1);
    expect(lighting.exposure).toBeLessThan(LIGHTING_BOUNDS.exposure[1]);
    const [r, , b] = channels(lighting.ambient.color);
    expect(b).toBeGreaterThan(r);
  });

  it('晴天高亮：曝光抬到上限，主光更强', () => {
    const lighting = deriveSceneLighting(SUNNY_BRIGHT);
    expectSane(lighting);
    expect(lighting.exposure).toBeGreaterThan(deriveSceneLighting(OVERCAST_COLD).exposure);
    expect(lighting.sun.intensity).toBeGreaterThan(deriveSceneLighting(OVERCAST_COLD).sun.intensity);
    expect(lighting.exposure).toBeLessThanOrEqual(LIGHTING_BOUNDS.exposure[1]);
    expect(lighting.sun.intensity).toBeLessThanOrEqual(LIGHTING_BOUNDS.sun[1]);
  });

  it('全黑：不掉到负强度或 NaN，曝光托在下限', () => {
    const lighting = deriveSceneLighting(PITCH_BLACK);
    expectSane(lighting);
    expect(lighting.exposure).toBeGreaterThanOrEqual(LIGHTING_BOUNDS.exposure[0]);
    expect(lighting.ambient.intensity).toBeGreaterThanOrEqual(LIGHTING_BOUNDS.ambient[0]);
    expect(lighting.sun.intensity).toBeGreaterThanOrEqual(LIGHTING_BOUNDS.sun[0]);
  });

  it('过曝：所有参数封顶，不会越界', () => {
    const lighting = deriveSceneLighting(OVEREXPOSED);
    expectSane(lighting);
    expect(lighting.exposure).toBeLessThanOrEqual(LIGHTING_BOUNDS.exposure[1]);
    expect(lighting.ambient.intensity).toBeLessThanOrEqual(LIGHTING_BOUNDS.ambient[1]);
    expect(lighting.sun.intensity).toBeLessThanOrEqual(LIGHTING_BOUNDS.sun[1]);
    expect(lighting.envIntensity).toBeLessThanOrEqual(LIGHTING_BOUNDS.env[1]);
  });

  it('极端色偏：光色仍是合法 RGB，主色相保留', () => {
    const lighting = deriveSceneLighting(MAGENTA_CAST);
    expectSane(lighting);
    const [r, g, b] = channels(lighting.sun.color);
    expect(r).toBe(255);
    expect(g).toBeLessThan(r);
    expect(b).toBeLessThan(r);
  });

  it('样本越亮参数越亮，且单调', () => {
    const dim = deriveSceneLighting(makeSample({ r: 0.1, g: 0.1, b: 0.1 }));
    const mid = deriveSceneLighting(makeSample({ r: 0.45, g: 0.45, b: 0.45 }));
    const bright = deriveSceneLighting(makeSample({ r: 0.85, g: 0.85, b: 0.85 }));
    expect(dim.exposure).toBeLessThan(mid.exposure);
    expect(mid.exposure).toBeLessThan(bright.exposure);
    expect(dim.ambient.intensity).toBeLessThan(mid.ambient.intensity);
    expect(mid.ambient.intensity).toBeLessThan(bright.ambient.intensity);
  });

  it('脏样本（NaN / 负值）也能产出合法配置', () => {
    const dirty = makeSample({
      r: Number.NaN,
      g: -1,
      b: Number.POSITIVE_INFINITY,
      luma: Number.NaN,
      perceived: Number.NaN,
      saturation: Number.NaN,
    });
    const lighting = deriveSceneLighting(dirty);
    expectSane(lighting);
  });
});

describe('tintedLightHex', () => {
  it('中性样本返回近白', () => {
    expect(tintedLightHex(0.4, 0.4, 0.4, 0.5)).toBe(0xffffff);
  });

  it('强度越高色偏越明显，且不会溢出', () => {
    const soft = tintedLightHex(0.6, 0.3, 0.2, 0.3);
    const strong = tintedLightHex(0.6, 0.3, 0.2, 0.8);
    const [sr, , sb] = channels(soft);
    const [rr, , rb] = channels(strong);
    expect(sr).toBe(255);
    expect(rr).toBe(255);
    expect(rb).toBeLessThan(sb);
  });

  it('全零样本退化为白色而不是 NaN', () => {
    expect(tintedLightHex(0, 0, 0, 1)).toBe(0xffffff);
    expect(tintedLightHex(Number.NaN, Number.NaN, Number.NaN, 1)).toBe(0xffffff);
  });
});

describe('样本缓存', () => {
  it('同一资产号重新取样后推导结果随之变化', () => {
    rememberSceneSample('scene-a', NIGHT_WARM);
    const night = resolveSceneLighting('scene-a');
    expect(night?.lighting.exposure).toBeLessThan(1.12);
    rememberSceneSample('scene-a', SUNNY_BRIGHT);
    const sunny = resolveSceneLighting('scene-a');
    expect(sunny?.lighting.exposure).toBeGreaterThan(night!.lighting.exposure);
  });

  it('未取样过的场景返回 null，不用默认值假装已匹配', () => {
    expect(resolveSceneLighting('scene-unknown')).toBeNull();
  });
});
