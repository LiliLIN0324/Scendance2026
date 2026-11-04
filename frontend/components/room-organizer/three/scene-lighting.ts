/**
 * 场景光照取样：3DGS 点云里每一颗 splat 的颜色就是实拍那一刻的辐射亮度，
 * 加权平均之后得到「这个空间本身有多亮、偏暖还是偏冷」。它不需要再渲染一帧
 * 点云再读回像素，点云加载完成时顺手取一次即可，取样成本只与解码后那次遍历同阶。
 */
export type SceneSample = Readonly<{
  /** 加权平均线性 RGB（0..1）。 */
  r: number;
  g: number;
  b: number;
  /** 线性相对亮度（Rec.709 权重）。 */
  luma: number;
  /** 编码回 sRGB 后的感知亮度（0..1），曝光推导用它而不是线性亮度。 */
  perceived: number;
  /** 平均彩度（0..1）：越高说明现场光色越有个性。 */
  saturation: number;
  /** 参与取样的点平均不透明度（0..1），高说明样本多是实体表面而非薄雾。 */
  coverage: number;
  /** 由 R/B 比值估计的色温（K），只用于角标展示，不参与推导。 */
  kelvin: number;
  /** 有效样本点数。 */
  samples: number;
}>;

/** 没有可用样本时的中性底座：偏暖的室内光，和编辑器默认观感接近。 */
export const NEUTRAL_SAMPLE: SceneSample = Object.freeze({
  r: 0.42,
  g: 0.4,
  b: 0.36,
  luma: 0.402,
  perceived: 0.666,
  saturation: 0.22,
  coverage: 0.6,
  kelvin: 5400,
  samples: 0,
});

type SplatColorSource = Readonly<{
  numSplats?: number;
  forEachSplat(
    callback: (
      index: number,
      center: unknown,
      scales: unknown,
      quaternion: unknown,
      opacity: number,
      color: { r: number; g: number; b: number }
    ) => void
  ): void;
}>;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 非有限值一律视为脏样本丢弃，绝不让 NaN 流进推导。 */
function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * 遍历点云取平均颜色。按不透明度加权，近乎透明的薄雾点不参与；
 * `maxSamples` 只限制遍历抽样密度，超过就等步长跳采样，百万点场景也不会卡。
 */
export function sampleSplatColors(source: SplatColorSource, maxSamples = 12000): SceneSample {
  const total = Number.isFinite(source.numSplats) ? Math.max(0, Math.floor(source.numSplats ?? 0)) : 0;
  const step = total > maxSamples ? Math.max(1, Math.ceil(total / maxSamples)) : 1;

  let wr = 0;
  let wg = 0;
  let wb = 0;
  let weight = 0;
  let saturation = 0;
  let opacitySum = 0;
  let count = 0;

  try {
    source.forEachSplat((index, _center, _scales, _quaternion, opacity, color) => {
      if (index % step !== 0 || !color) return;
      const r = color.r;
      const g = color.g;
      const b = color.b;
      if (!isUnit(r) || !isUnit(g) || !isUnit(b)) return;
      const alpha = Number.isFinite(opacity) ? clamp01(opacity) : 1;
      if (alpha < 0.05) return;
      wr += r * alpha;
      wg += g * alpha;
      wb += b * alpha;
      const peak = Math.max(r, g, b);
      if (peak > 0.02) saturation += ((peak - Math.min(r, g, b)) / peak) * alpha;
      weight += alpha;
      opacitySum += alpha;
      count += 1;
    });
  } catch {
    return NEUTRAL_SAMPLE;
  }

  if (!count || weight <= 0) return NEUTRAL_SAMPLE;

  const r = wr / weight;
  const g = wg / weight;
  const b = wb / weight;
  const luma = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return Object.freeze({
    r,
    g,
    b,
    luma,
    perceived: clamp01(Math.pow(luma, 1 / 2.2)),
    saturation: clamp01(saturation / weight),
    coverage: clamp01(opacitySum / count),
    kelvin: estimateKelvin(r, b),
    samples: count,
  });
}

/**
 * R/B 比值 → 色温的粗估。不是物理测色，只用来在角标里给一个「偏暖/偏冷」的量级：
 * 比值越偏红，现场光越暖（K 越低）。白炽灯/黄昏约 3000–4500 K，正午室内约 5500–6500 K。
 */
export function estimateKelvin(r: number, b: number): number {
  if (!Number.isFinite(r) || !Number.isFinite(b) || r <= 0 || b <= 0) return 5500;
  const ratio = b / r; // >1 偏冷，<1 偏暖
  return clamp(Math.round(6500 * Math.pow(ratio, 0.55)), 2400, 10000);
}

/** 推导结果的硬边界：任何样本都不能把画布推到过曝或全黑。 */
export const LIGHTING_BOUNDS = Object.freeze({
  exposure: [0.5, 1.35] as const,
  ambient: [0.18, 0.58] as const,
  sun: [0.2, 1.3] as const,
  hemisphere: [0.18, 0.7] as const,
  env: [0.12, 0.62] as const,
});

export type SceneLighting = Readonly<{
  /** toneMappingExposure 绝对值（ACES 色调映射下）。 */
  exposure: number;
  ambient: Readonly<{ color: number; intensity: number }>;
  hemisphere: Readonly<{ sky: number; ground: number; intensity: number }>;
  sun: Readonly<{ color: number; intensity: number }>;
  /** scene.environmentIntensity：让 IBL 也落在同一曝光档位。 */
  envIntensity: number;
  /** 对比补偿系数（已并入主光强度，仅作可读字段保留）。 */
  contrast: number;
  /** 饱和度补偿系数（已并入光的色彩偏移量）。 */
  saturation: number;
  kelvin: number;
  perceived: number;
}>;

/**
 * 取样 → 光照配置。规则刻意线性、可解释：
 * - 曝光跟感知亮度走：暗场景压到 0.82，亮场景抬到 1.5；
 * - 环境光 / 半球光 / 主光按同一亮度档位分档，暗场保底不黑，亮场不糊；
 * - 光色取样的色相：把平均色的通道比值轻微映射成光色（最高通道归一到 255），
 *   偏暖的场地灯光变暖，冷灰阴天灯光变冷，偏移量随彩度加深但封顶；
 * - 对比：亮场景主光稍强、暗场景补光稍多，形成和实拍相近的明暗过渡。
 * 纯函数：同样的样本永远得到同样的参数，上下限写死，无 NaN / 负强度。
 */
export function deriveSceneLighting(sample: SceneSample): SceneLighting {
  const perceived = Number.isFinite(sample.perceived)
    ? clamp01(sample.perceived)
    : NEUTRAL_SAMPLE.perceived;
  const saturation = Number.isFinite(sample.saturation) ? clamp01(sample.saturation) : 0;

  const exposure = clamp(0.55 + perceived * 0.85, ...LIGHTING_BOUNDS.exposure);
  const ambientIntensity = clamp(0.12 + perceived * 0.42, ...LIGHTING_BOUNDS.ambient);
  const sunIntensity = clamp(0.2 + perceived * 1.15, ...LIGHTING_BOUNDS.sun);
  const hemisphereIntensity = clamp(0.15 + perceived * 0.55, ...LIGHTING_BOUNDS.hemisphere);
  const envIntensity = clamp(0.12 + perceived * 0.5, ...LIGHTING_BOUNDS.env);

  // 对比补偿：亮场景拉高主光，暗场景补更多环境光，避免装置比地面更亮一档。
  const contrast = clamp(1 + (perceived - 0.62) * 0.35, 0.9, 1.12);
  const saturationScale = clamp(1 + (saturation - 0.3) * 0.7, 0.92, 1.16);

  const tintStrength = clamp(0.32 + saturation * 0.5, 0.3, 0.62);

  return Object.freeze({
    exposure,
    ambient: Object.freeze({
      color: tintedLightHex(sample.r, sample.g, sample.b, tintStrength, 1),
      intensity: ambientIntensity,
    }),
    hemisphere: Object.freeze({
      // 天空侧取场景色相但更亮一点，地面侧压暗：站立面的反弹光本来就比天光暗。
      sky: tintedLightHex(sample.r, sample.g, sample.b, tintStrength, 1.04),
      ground: tintedLightHex(sample.r, sample.g, sample.b, tintStrength * 0.8, 0.82),
      intensity: hemisphereIntensity,
    }),
    sun: Object.freeze({
      color: tintedLightHex(sample.r, sample.g, sample.b, tintStrength * 0.75, 1),
      intensity: clamp(sunIntensity * contrast, ...LIGHTING_BOUNDS.sun),
    }),
    envIntensity,
    contrast,
    saturation: saturationScale,
    kelvin: Number.isFinite(sample.kelvin) ? sample.kelvin : NEUTRAL_SAMPLE.kelvin,
    perceived,
  });
}

/**
 * 把平均色轻微映射成光的颜色：最高通道归一为 255，其余通道按比值下沉，
 * 偏移强度由 `strength` 控制，再整体缩放 `scale` 让天空/地面有明暗差。
 * 结果永远落在 0..255。
 */
export function tintedLightHex(r: number, g: number, b: number, strength: number, scale = 1): number {
  const rr = Number.isFinite(r) && r > 0 ? r : 1;
  const gg = Number.isFinite(g) && g > 0 ? g : 1;
  const bb = Number.isFinite(b) && b > 0 ? b : 1;
  const mean = (rr + gg + bb) / 3;
  if (!(mean > 1e-6)) return 0xffffff;
  const spread = clamp(strength, 0, 1);
  const channels = [rr, gg, bb].map(channel => clamp(1 + (channel / mean - 1) * spread, 0.75, 1.3));
  const peak = Math.max(...channels) || 1;
  const [cr, cg, cb] = channels.map(channel => Math.round(clamp01((channel / peak) * scale) * 255));
  return (cr << 16) | (cg << 8) | cb;
}

/* ------------------------------------------------------------------ */
/* 内存样本缓存 + 按场景持久化                                          */
/* ------------------------------------------------------------------ */

/** 本轮会话内的样本，按资产号缓存；切换场景时直接命中，不重新遍历点云。 */
const liveSamples = new Map<string, SceneSample>();
const STORE_KEY = 'scendance:scene-lighting:v1';
const STORE_MAX = 40;

export type SceneLightingRecord = Readonly<{
  assetId: string;
  sample: SceneSample;
  lighting: SceneLighting;
  /** 人工曝光覆盖（1 = 完全信任自动匹配）。 */
  override: number;
  updatedAt: number;
}>;

/** 点云加载完成时写入；同一资产号重新加载会覆盖旧样本。 */
export function rememberSceneSample(assetId: string, sample: SceneSample): void {
  if (!assetId) return;
  liveSamples.set(assetId, sample);
}

export function readSceneSample(assetId: string): SceneSample | null {
  return liveSamples.get(assetId) ?? null;
}

export function forgetSceneSample(assetId: string): void {
  liveSamples.delete(assetId);
}

function currentStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function isSampleLike(value: unknown): value is SceneSample {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Record<string, unknown>;
  return ['r', 'g', 'b', 'luma', 'perceived', 'saturation', 'coverage', 'kelvin', 'samples']
    .every(key => typeof sample[key] === 'number' && Number.isFinite(sample[key]));
}

function isLightingLike(value: unknown): value is SceneLighting {
  if (!value || typeof value !== 'object') return false;
  const lighting = value as Record<string, unknown>;
  const ambient = lighting.ambient as Record<string, unknown> | undefined;
  const sun = lighting.sun as Record<string, unknown> | undefined;
  const hemisphere = lighting.hemisphere as Record<string, unknown> | undefined;
  return typeof lighting.exposure === 'number' && Number.isFinite(lighting.exposure) &&
    typeof lighting.envIntensity === 'number' && Number.isFinite(lighting.envIntensity) &&
    !!ambient && typeof ambient.color === 'number' && typeof ambient.intensity === 'number' &&
    !!sun && typeof sun.color === 'number' && typeof sun.intensity === 'number' &&
    !!hemisphere && typeof hemisphere.sky === 'number' && typeof hemisphere.ground === 'number' &&
    typeof hemisphere.intensity === 'number';
}

function isRecord(value: unknown): value is SceneLightingRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.assetId === 'string' && record.assetId.length > 0 && record.assetId.length <= 160 &&
    isSampleLike(record.sample) && isLightingLike(record.lighting) &&
    typeof record.override === 'number' && Number.isFinite(record.override) &&
    record.override >= 0.5 && record.override <= 2 &&
    typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt);
}

function readAll(): Record<string, SceneLightingRecord> {
  const storage = currentStorage();
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, SceneLightingRecord] => isRecord(entry[1])));
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, SceneLightingRecord>): void {
  const storage = currentStorage();
  if (!storage) return;
  try {
    storage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // 配额满了只是这次记不住，画布照常用自动匹配的那一套。
  }
}

export function readSceneLightingRecord(assetId: string): SceneLightingRecord | null {
  if (!assetId) return null;
  return readAll()[assetId] ?? null;
}

export function writeSceneLightingRecord(record: SceneLightingRecord): void {
  if (!isRecord(record)) return;
  const all = readAll();
  all[record.assetId] = record;
  const keys = Object.keys(all);
  if (keys.length > STORE_MAX) {
    keys.sort((a, b) => all[a]!.updatedAt - all[b]!.updatedAt);
    for (const stale of keys.slice(0, keys.length - STORE_MAX)) delete all[stale];
  }
  writeAll(all);
}

export function setSceneLightingOverride(assetId: string, override: number): SceneLightingRecord | null {
  const record = readSceneLightingRecord(assetId);
  if (!record || !Number.isFinite(override)) return null;
  const next: SceneLightingRecord = {
    ...record,
    override: clamp(override, 0.5, 2),
    updatedAt: Date.now(),
  };
  writeSceneLightingRecord(next);
  return next;
}

/**
 * 解析当前场景该用的配置：本轮样本优先（点云刚载入、或换了场景），
 * 否则回落到持久化记录。样本到手就顺手把推导结果落盘，刷新后无需重算。
 */
export function resolveSceneLighting(assetId: string): SceneLightingRecord | null {
  if (!assetId) return null;
  const stored = readSceneLightingRecord(assetId);
  const live = readSceneSample(assetId);
  if (!live) return stored;
  const lighting = deriveSceneLighting(live);
  const record: SceneLightingRecord = {
    assetId,
    sample: live,
    lighting,
    override: stored?.override ?? 1,
    updatedAt: Date.now(),
  };
  writeSceneLightingRecord(record);
  return record;
}
