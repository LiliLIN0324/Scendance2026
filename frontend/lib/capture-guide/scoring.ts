/**
 * 采集守门员 · 纯评分逻辑。
 *
 * 这里不碰 DOM、不读文件，只接收已经抽取好的样本指标，方便在单测里
 * 构造「原地旋转 24 张」「三层 72 张 + GPS + 尺度」这类边界证据。
 */

export type CaptureLayer = 'low' | 'eye' | 'high';
export type CaptureMode = 'photo' | 'video' | 'scan';
export type CaptureVerdict = 'ready' | 'supplement' | 'redo';

export const CAPTURE_LAYERS: readonly CaptureLayer[] = ['low', 'eye', 'high'];

export const LAYER_LABELS: Record<CaptureLayer, string> = {
  low: '低层 · 60cm 仰拍',
  eye: '视线层 · 170cm 平视',
  high: '高层 · 190cm 俯拍',
};

/**
 * 阈值出处：docs/recon-2026-11/01-素材核查与采集缺口.md §6 / §10、
 * docs/recon-2026-11/04-结论与路线图.md §1。
 * 三层 × 24 = 72 只是「闭环底线」；编辑级最低可交付 120–180 张，稳定目标 200+。
 */
export const TARGET_STATIONS = 180;
export const MIN_DELIVERABLE_STATIONS = 120;
export const STABLE_STATIONS = 200;
export const TARGET_PER_LAYER = 24;
export const GOOD_GPS_ACCURACY = 10;
export const READY_SCORE = 75;
export const SUPPLEMENT_SCORE = 50;

/** 页面上「阈值与来源」直接用这张表渲染，避免文案和代码各写一套。 */
export const THRESHOLD_SOURCES: ReadonlyArray<{
  label: string;
  value: string;
  source: string;
}> = [
  {
    label: '机位与层数',
    value: '3 层环绕 + 俯视；稳定 200+ 张，编辑级最低 120–180 张；72 张只是三层闭环底线',
    source: '01 §6 #1–#2、§10；04 §1',
  },
  {
    label: '相邻重叠 / 基线',
    value: '重叠 70–80%，baseline/depth ≤ 0.3；必须靠平移产生视差',
    source: '01 §6 #3',
  },
  {
    label: '尺度基准',
    value: '2–3 个尺度基准或 GCP，至少一条已知长度；缺失则不可量尺寸',
    source: '01 §6 #4、#8；04 §1',
  },
  {
    label: '定位',
    value: '有效 GPS 精度 ≤ 10m；覆盖率 ≥ 90% 才拿满分，< 50% 压到补拍',
    source: '01 §6 #4（≥3 个 GCP 或已知长度）；本页把「现场可执行」量化为 10m',
  },
  {
    label: '光照',
    value: '白天 / 均匀光，相邻曝光差 < 1EV；本页要求 ≥ 90% 帧落在健康亮度区间',
    source: '01 §6 #5；《拍摄指南 2026》曝光要点',
  },
  {
    label: '水面与天空',
    value: '合计 ≤ 30% 画面；本页不做自动分割，只在取景提示里要求压低水面、避开死黑天空',
    source: '01 §6 #7',
  },
  {
    label: '拍摄时长',
    value: '强光 ≤ 30 分钟，阴天 ≤ 2 小时',
    source: '《拍摄指南 2026》要点转述',
  },
  {
    label: '原地旋转',
    value: 'GPS 位移 < 1.5m 且朝向跨度 ≥ 90° → 直接重采',
    source: '01 §4.3（yaw 仅 102.6°）、04 §0（0/32 GPS）',
  },
];

export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  at: number;
}

/** 由浏览器端缩略图/直方图抽出的单帧证据。 */
export interface FrameSample {
  id: string;
  layer: CaptureLayer;
  width: number;
  height: number;
  meanLuma: number;
  brightRatio: number;
  darkRatio: number;
  hash: string;
  heading: number | null;
  gps: GpsFix | null;
  at: number | null;
}

export interface CaptureEvidence {
  mode: CaptureMode;
  frames: FrameSample[];
  scaleMeters: number | null;
  durationMinutes: number | null;
}

export interface ScoreItem {
  key: string;
  label: string;
  earned: number;
  max: number;
  detail: string;
}

export interface ScoreDeduction {
  severity: 'blocker' | 'cap' | 'warn';
  label: string;
  detail: string;
  points: number;
}

export interface CaptureMetrics {
  frames: number;
  distinctFrames: number;
  duplicateFrames: number;
  duplicateRate: number;
  layers: number;
  layerCounts: Record<CaptureLayer, number>;
  coverageDeg: number;
  coverageEstimated: boolean;
  gpsCoverage: number;
  gpsGoodCoverage: number;
  gpsMedianAccuracy: number | null;
  gpsSpanMeters: number;
  exposureOk: number;
  lowResolution: number;
  durationMinutes: number | null;
}

export interface CaptureScore {
  total: number;
  rawTotal: number;
  verdict: CaptureVerdict;
  items: ScoreItem[];
  deductions: ScoreDeduction[];
  blockers: string[];
  caps: string[];
  metrics: CaptureMetrics;
}

export interface ScanImportInput {
  fileCount: number;
  scaleMeters: number | null;
  completeness: 'complete' | 'partial' | 'unknown';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function normaliseHeading(value: number): number {
  const heading = value % 360;
  return heading < 0 ? heading + 360 : heading;
}

/** 8×8 感知哈希的海明距离；非 16 位十六进制时按 0 处理，避免污染评分。 */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) return 99;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = Number.parseInt(a[i] ?? '0', 16);
    const right = Number.parseInt(b[i] ?? '0', 16);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 99;
    let xor = left ^ right;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/** 近似重复：与任意一个更早的样本距离 ≤ threshold。 */
export function findNearDuplicateIndices(hashes: string[], threshold = 6): number[] {
  const result: number[] = [];
  for (let index = 0; index < hashes.length; index += 1) {
    const hash = hashes[index] ?? '';
    for (let earlier = Math.max(0, index - 10); earlier < index; earlier += 1) {
      if (hammingDistanceHex(hashes[earlier] ?? '', hash) <= threshold) {
        result.push(index);
        break;
      }
    }
  }
  return result;
}

export function countDistinctFrames(frames: FrameSample[], threshold = 6): number {
  const seen: string[] = [];
  let distinct = 0;
  for (const frame of frames) {
    const near = seen.some(hash => hammingDistanceHex(hash, frame.hash) <= threshold);
    if (!near) {
      seen.push(frame.hash);
      distinct += 1;
    }
  }
  return distinct;
}

export function isWellExposed(frame: Pick<FrameSample, 'meanLuma' | 'brightRatio' | 'darkRatio'>): boolean {
  return (
    frame.meanLuma >= 45 &&
    frame.meanLuma <= 210 &&
    frame.brightRatio <= 0.12 &&
    frame.darkRatio <= 0.5
  );
}

export interface HeadingCoverage {
  bins: number;
  coverageDeg: number;
  samples: number;
}

export function headingCoverage(headings: Array<number | null>): HeadingCoverage {
  const occupied = new Array<boolean>(36).fill(false);
  let samples = 0;
  for (const heading of headings) {
    if (heading === null || !Number.isFinite(heading)) continue;
    const normalised = normaliseHeading(heading);
    const bin = Math.min(35, Math.floor(normalised / 10));
    occupied[bin] = true;
    samples += 1;
  }
  const bins = occupied.filter(Boolean).length;
  return { bins, coverageDeg: bins * 10, samples };
}

/** 朝向跨度（处理 350°→10° 这类跨零点情况）。 */
export function headingSpanDeg(headings: Array<number | null>): number {
  const values = headings
    .filter((heading): heading is number => heading !== null && Number.isFinite(heading))
    .map(normaliseHeading)
    .sort((left, right) => left - right);
  if (values.length < 2) return 0;
  let largestGap = 360 - ((values[values.length - 1] ?? 0) - (values[0] ?? 0));
  for (let index = 1; index < values.length; index += 1) {
    largestGap = Math.max(largestGap, (values[index] ?? 0) - (values[index - 1] ?? 0));
  }
  return Math.round(360 - largestGap);
}

export function haversineMeters(a: GpsFix, b: GpsFix): number {
  const earthRadius = 6_371_000;
  const toRad = (degree: number): number => (degree * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}

export function gpsSpanMeters(frames: FrameSample[]): number {
  const fixes = frames
    .map(frame => frame.gps)
    .filter((fix): fix is GpsFix => fix !== null && fix.accuracy > 0 && fix.accuracy <= GOOD_GPS_ACCURACY);
  if (fixes.length < 2) return 0;
  let span = 0;
  for (let index = 0; index < fixes.length; index += 1) {
    for (let later = index + 1; later < fixes.length; later += 1) {
      span = Math.max(span, haversineMeters(fixes[index] as GpsFix, fixes[later] as GpsFix));
    }
  }
  return Math.round(span * 10) / 10;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/** 至少 0.1m、至多 100m 才算可用尺度。 */
export function isValidScale(meters: number | null): meters is number {
  return meters !== null && Number.isFinite(meters) && meters >= 0.1 && meters <= 100;
}

const CHINESE_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/**
 * 把现场口述的尺度转成米：支持「20cm」「1.2m」「0.8 米」「一米」「1500mm」。
 * 这里只负责换算；范围是否可接受交给 isValidScale。
 */
export function parseScaleMeters(raw: string): number | null {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/，/g, '.')
    .replace(/。/g, '.')
    .replace(/\s+/g, '');
  if (!text) return null;

  const chinese = text.match(/^([一二两三四五六七八九十])(米|m|公尺)$/);
  if (chinese) {
    const digit = CHINESE_DIGITS[chinese[1] ?? ''];
    return digit === undefined ? null : digit;
  }

  const match = text.match(/^(\d+(?:\.\d+)?)(毫米|mm|厘米|cm|米|m|公尺)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ?? '';
  if (unit === '毫米' || unit === 'mm') return round(value / 1000);
  if (unit === '厘米' || unit === 'cm') return round(value / 100);
  return round(value);
}

export function formatMeters(meters: number): string {
  if (meters < 1) return `${Math.round(meters * 1000)} mm`;
  return `${meters.toFixed(meters >= 10 ? 1 : 2)} m`;
}

function buildMetrics(evidence: CaptureEvidence): CaptureMetrics {
  const frames = evidence.frames;
  const total = frames.length;
  const distinctFrames = countDistinctFrames(frames);
  const duplicateFrames = total - distinctFrames;
  const layerCounts: Record<CaptureLayer, number> = { low: 0, eye: 0, high: 0 };
  for (const frame of frames) layerCounts[frame.layer] += 1;
  const layers = CAPTURE_LAYERS.filter(layer => layerCounts[layer] > 0).length;
  const exposureOk = frames.filter(isWellExposed).length;
  const gpsFixes = frames.map(frame => frame.gps).filter((fix): fix is GpsFix => fix !== null);
  const goodFixes = gpsFixes.filter(fix => fix.accuracy > 0 && fix.accuracy <= GOOD_GPS_ACCURACY);
  const headings = frames.map(frame => frame.heading);
  const coverage = headingCoverage(headings);
  const hasCompass = coverage.samples >= Math.min(12, total) && coverage.samples > 0;
  const estimatedCoverage = Math.min(360, distinctFrames * 5);
  const headingSpan = headingSpanDeg(headings);
  const coverageDeg = hasCompass ? Math.max(headingSpan, coverage.coverageDeg) : estimatedCoverage;
  const lowResolution = frames.filter(frame => Math.min(frame.width, frame.height) < 1080).length;
  return {
    frames: total,
    distinctFrames,
    duplicateFrames,
    duplicateRate: total > 0 ? duplicateFrames / total : 1,
    layers,
    layerCounts,
    coverageDeg,
    coverageEstimated: !hasCompass,
    gpsCoverage: total > 0 ? gpsFixes.length / total : 0,
    gpsGoodCoverage: total > 0 ? goodFixes.length / total : 0,
    gpsMedianAccuracy: median(gpsFixes.map(fix => fix.accuracy)),
    gpsSpanMeters: gpsSpanMeters(frames),
    exposureOk,
    lowResolution,
    durationMinutes: evidence.durationMinutes,
  };
}

/**
 * 采集证据 → 0–100 可重建性评分。
 * 三档：≥75 可直接跑；50–74 建议补拍；<50 重采。
 * 硬门槛会直接把结论压成重采；缺尺度/缺层/缺 GPS 等只把上限压到 69。
 */
export function scoreCapture(evidence: CaptureEvidence): CaptureScore {
  const metrics = buildMetrics(evidence);
  const frames = evidence.frames;
  const total = frames.length;

  const countItem: ScoreItem = {
    key: 'count',
    label: '机位数量',
    earned: Math.round(15 * clamp01(total / TARGET_STATIONS)),
    max: 15,
    detail: `${total} 个机位 / 目标 ${TARGET_STATIONS}（最低可交付 ${MIN_DELIVERABLE_STATIONS}，稳定 ${STABLE_STATIONS}+）`,
  };
  const layerItem: ScoreItem = {
    key: 'layers',
    label: '三层高度',
    earned: metrics.layers === 3 ? 15 : metrics.layers === 2 ? 6 : 0,
    max: 15,
    detail:
      metrics.layers === 3
        ? '低 / 视线 / 高 三层齐全'
        : `只记录了 ${metrics.layers} 层${
            metrics.layers === 0 ? '' : `（${CAPTURE_LAYERS.filter(layer => metrics.layerCounts[layer] > 0).map(layer => LAYER_LABELS[layer].slice(0, 2)).join(' / ')}）`
          }`,
  };
  const distinctRatio = total > 0 ? metrics.distinctFrames / total : 0;
  const distinctItem: ScoreItem = {
    key: 'distinct',
    label: '去重 / 重叠',
    earned:
      distinctRatio >= 0.9
        ? 15
        : Math.round(15 * clamp01((distinctRatio - 0.5) / 0.4)),
    max: 15,
    detail: `${metrics.distinctFrames} 张互不相似，${metrics.duplicateFrames} 张与前一机位重复`,
  };
  const exposureRatio = total > 0 ? metrics.exposureOk / total : 0;
  const exposureItem: ScoreItem = {
    key: 'exposure',
    label: '曝光健康',
    earned:
      exposureRatio >= 0.9
        ? 10
        : Math.round(10 * clamp01((exposureRatio - 0.5) / 0.4)),
    max: 10,
    detail: `${metrics.exposureOk} / ${total} 张在正常亮度区间`,
  };
  const gpsItem: ScoreItem = {
    key: 'gps',
    label: '定位覆盖',
    earned:
      metrics.gpsGoodCoverage >= 0.9
        ? 15
        : Math.round(15 * clamp01((metrics.gpsGoodCoverage - 0.5) / 0.4)),
    max: 15,
    detail:
      metrics.gpsMedianAccuracy === null
        ? '没有任何机位记录到 GPS'
        : `${Math.round(metrics.gpsGoodCoverage * 100)}% 机位精度 ≤ ${GOOD_GPS_ACCURACY}m，中位 ${metrics.gpsMedianAccuracy}m`,
  };
  const scaleItem: ScoreItem = {
    key: 'scale',
    label: '尺度基准',
    earned: isValidScale(evidence.scaleMeters) ? 15 : 0,
    max: 15,
    detail: isValidScale(evidence.scaleMeters)
      ? `已录入 ${formatMeters(evidence.scaleMeters)}`
      : '没有录入已知长度或两点实测距离',
  };
  const coverageRatio = metrics.coverageDeg / 360;
  const angleItem: ScoreItem = {
    key: 'angle',
    label: '角度覆盖',
    earned: metrics.coverageEstimated
      ? Math.min(5, Math.round(5 * clamp01(metrics.distinctFrames / TARGET_STATIONS)))
      : Math.round(10 * clamp01(coverageRatio / 0.85)),
    max: 10,
    detail: metrics.coverageEstimated
      ? `无罗盘，按 ${metrics.distinctFrames} 个不重复机位推算 ≈ ${metrics.coverageDeg}°（最多 5 分）`
      : `罗盘记录覆盖 ≈ ${metrics.coverageDeg}°`,
  };
  const duration = evidence.durationMinutes;
  const durationItem: ScoreItem = {
    key: 'duration',
    label: '拍摄时长',
    earned: duration === null ? 0 : duration <= 30 ? 5 : duration <= 120 ? 3 : 0,
    max: 5,
    detail:
      duration === null
        ? '没有记录拍摄时长'
        : `${Math.round(duration)} 分钟${
            duration > 120
              ? '：超过 2 小时，光影已不可控'
              : duration > 30
                ? '：强光下建议控制在 30 分钟内'
                : ''
          }`,
  };

  const items = [
    countItem,
    layerItem,
    distinctItem,
    exposureItem,
    gpsItem,
    scaleItem,
    angleItem,
    durationItem,
  ];
  const rawTotal = items.reduce((sum, item) => sum + item.earned, 0);

  const blockers: string[] = [];
  const caps: string[] = [];
  const deductions: ScoreDeduction[] = [];

  if (total === 0) blockers.push('没有任何可用图像样本，无法判断可重建性');
  else if (total < 8) blockers.push(`样本只有 ${total} 张，低于最低 8 张门槛`);
  if (total > 0 && metrics.duplicateRate > 0.5) {
    blockers.push(`重复 / 过近帧占 ${Math.round(metrics.duplicateRate * 100)}%，超过一半`);
  }
  if (total > 0 && exposureRatio < 0.5) {
    blockers.push(`过暗或过曝帧占 ${Math.round((1 - exposureRatio) * 100)}%，超过一半`);
  }

  const gpsFrames = frames.filter(
    frame => frame.gps !== null && frame.gps.accuracy > 0 && frame.gps.accuracy <= GOOD_GPS_ACCURACY,
  );
  const inPlaceFrameCount = gpsFrames.length;
  const inPlaceSpan = metrics.gpsSpanMeters;
  const inPlaceHeadingSpan = headingSpanDeg(frames.map(frame => frame.heading));
  if (inPlaceFrameCount >= 12 && inPlaceSpan < 1.5) {
    if (inPlaceHeadingSpan >= 90) {
      blockers.push(
        `原地旋转：${inPlaceFrameCount} 个机位 GPS 位移只有 ${inPlaceSpan}m，朝向却转了 ${inPlaceHeadingSpan}°`,
      );
    } else {
      caps.push(`GPS 显示 ${inPlaceFrameCount} 个机位都停在同一点（位移 ${inPlaceSpan}m）`);
    }
  }

  if (total > 0 && total < MIN_DELIVERABLE_STATIONS) {
    caps.push(
      `机位只有 ${total} 个，少于编辑级最低可交付 ${MIN_DELIVERABLE_STATIONS} 个（三层 × 24 只是闭环底线）`,
    );
  }
  if (metrics.layers < 3) {
    caps.push(`三层只完成 ${metrics.layers} 层，漫游会出现高度断层`);
  }
  if (!isValidScale(evidence.scaleMeters)) {
    caps.push('缺少尺度基准，重建结果没有真实尺寸');
  }
  if (total > 0 && metrics.gpsGoodCoverage < 0.5) {
    caps.push(`有效 GPS 覆盖只有 ${Math.round(metrics.gpsGoodCoverage * 100)}%，低于 50%`);
  }
  if (metrics.lowResolution > 0) {
    deductions.push({
      severity: 'warn',
      label: '分辨率偏低',
      detail: `${metrics.lowResolution} 张短边小于 1080px，细节匹配会吃亏`,
      points: 0,
    });
  }

  for (const item of items) {
    if (item.earned < item.max) {
      deductions.push({
        severity: 'warn',
        label: item.label,
        detail: item.detail,
        points: item.max - item.earned,
      });
    }
  }

  const raw = rawTotal;
  let finalTotal = raw;
  if (blockers.length > 0) {
    finalTotal = Math.min(finalTotal, 49);
  } else if (caps.length > 0) {
    if (finalTotal > 69) {
      deductions.push({
        severity: 'cap',
        label: '分数上限',
        detail: '存在必须补做的项目，最高只能判到「建议补拍」',
        points: finalTotal - 69,
      });
    }
    finalTotal = Math.min(finalTotal, 69);
  }

  const verdict: CaptureVerdict =
    blockers.length > 0 ? 'redo' : finalTotal >= READY_SCORE ? 'ready' : finalTotal >= SUPPLEMENT_SCORE ? 'supplement' : 'redo';

  return {
    total: finalTotal,
    rawTotal: raw,
    verdict,
    items,
    deductions,
    blockers,
    caps,
    metrics,
  };
}

/** 已有扫描结果导入：不走环绕采集，只看文件、尺度与完整性。 */
export function scoreScanImport(input: ScanImportInput): CaptureScore {
  const fileItem: ScoreItem = {
    key: 'files',
    label: '扫描文件',
    earned: input.fileCount > 0 ? 35 : 0,
    max: 35,
    detail: input.fileCount > 0 ? `已选择 ${input.fileCount} 个扫描文件` : '还没有导入扫描结果',
  };
  const scaleItem: ScoreItem = {
    key: 'scale',
    label: '尺度基准',
    earned: isValidScale(input.scaleMeters) ? 35 : 0,
    max: 35,
    detail: isValidScale(input.scaleMeters)
      ? `已录入 ${formatMeters(input.scaleMeters)}`
      : '没有录入真实尺度，导入后仍无法量尺寸',
  };
  const completenessLabel =
    input.completeness === 'complete' ? '完整闭环' : input.completeness === 'partial' ? '局部缺失' : '未确认';
  const completenessItem: ScoreItem = {
    key: 'completeness',
    label: '完整性',
    earned: input.completeness === 'complete' ? 30 : input.completeness === 'partial' ? 15 : 0,
    max: 30,
    detail: `扫描完整性：${completenessLabel}`,
  };
  const items = [fileItem, scaleItem, completenessItem];
  const rawTotal = items.reduce((sum, item) => sum + item.earned, 0);
  const blockers: string[] = [];
  const caps: string[] = [];
  const deductions: ScoreDeduction[] = [];
  if (input.fileCount === 0) blockers.push('没有导入任何扫描文件');
  if (!isValidScale(input.scaleMeters)) blockers.push('缺少尺度基准，扫描结果无法用于真实尺寸');
  if (input.completeness === 'unknown') caps.push('尚未确认扫描是否闭环，只能按补拍处理');
  for (const item of items) {
    if (item.earned < item.max) {
      deductions.push({ severity: 'warn', label: item.label, detail: item.detail, points: item.max - item.earned });
    }
  }
  let finalTotal = rawTotal;
  if (blockers.length > 0) finalTotal = Math.min(finalTotal, 49);
  else if (caps.length > 0) finalTotal = Math.min(finalTotal, 69);
  const verdict: CaptureVerdict =
    blockers.length > 0 ? 'redo' : finalTotal >= READY_SCORE ? 'ready' : finalTotal >= SUPPLEMENT_SCORE ? 'supplement' : 'redo';
  const emptyLayers: Record<CaptureLayer, number> = { low: 0, eye: 0, high: 0 };
  return {
    total: finalTotal,
    rawTotal,
    verdict,
    items,
    deductions,
    blockers,
    caps,
    metrics: {
      frames: input.fileCount,
      distinctFrames: input.fileCount,
      duplicateFrames: 0,
      duplicateRate: 0,
      layers: 0,
      layerCounts: emptyLayers,
      coverageDeg: 0,
      coverageEstimated: true,
      gpsCoverage: 0,
      gpsGoodCoverage: 0,
      gpsMedianAccuracy: null,
      gpsSpanMeters: 0,
      exposureOk: 0,
      lowResolution: 0,
      durationMinutes: null,
    },
  };
}
