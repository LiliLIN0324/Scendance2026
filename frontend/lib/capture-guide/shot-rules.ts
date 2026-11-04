/**
 * 采集守门员 · 逐张判定。
 *
 * 目标不是“评分好看”，而是当场判断这一张能不能进重建：
 * 糊、暗、过曝、与上一张重复、走太快导致重叠断。
 * 阈值与 docs/recon-2026-11/01 §6 #3/#5 对齐；模糊度用拉普拉斯方差。
 */

import {
  CAPTURE_LAYERS,
  MIN_DELIVERABLE_STATIONS,
  TARGET_PER_LAYER,
  hammingDistanceHex,
  normaliseHeading,
  type CaptureLayer,
} from './scoring';

export const SHOT_THRESHOLDS = {
  /** 256×256 灰度拉普拉斯方差下限；低于它按糊片处理（实测分布见 README）。 */
  blurVariance: 60,
  darkMean: 45,
  darkRatio: 0.5,
  brightMean: 210,
  brightRatio: 0.12,
  /** 与上一张的感知哈希汉明距离 ≤ 6 视为重复。 */
  duplicateHamming: 6,
  /** 相邻两张的位移上限（米）；超过就说明走太快，重叠会断。 */
  maxStepMeters: 1.2,
  /** 相邻两张的朝向变化上限（度）；超过就不算连续覆盖。 */
  maxHeadingDelta: 20,
} as const;

export type ShotIssue = 'blur' | 'dark' | 'bright' | 'duplicate' | 'too-fast';

export interface ShotObservation {
  meanLuma: number;
  brightRatio: number;
  darkRatio: number;
  sharpness: number;
  hash: string;
  gps: { latitude: number; longitude: number } | null;
  heading: number | null;
}

export interface ShotVerdict {
  ok: boolean;
  issue: ShotIssue | null;
  title: string;
  action: string;
  /** 反例缩略图；null 表示这张合格，不给反例。 */
  sample: string | null;
  /** 过曝反例用同一张夜景图提高亮度来示意。 */
  sampleTone: 'normal' | 'bright';
}

const SAMPLE_SPIN = '/guide/capture/examples/spin.jpg';
const SAMPLE_NIGHT = '/guide/capture/examples/night.jpg';

/** 两个 GPS 点的球面距离（米）；用于判断有没有真的走起来。 */
export function gpsDistanceMeters(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
): number {
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const earth = 6371000;
  const dLat = toRad(right.latitude - left.latitude);
  const dLon = toRad(right.longitude - left.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(left.latitude)) * Math.cos(toRad(right.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 两个朝向之间的最小夹角（0–180°）。 */
export function headingDeltaDeg(left: number, right: number): number {
  const diff = Math.abs(left - right) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * 单张照片 / 视频帧的现场结论。
 * 只给一个动作，避免用户同时被五条建议淹没。
 */
export function judgeShot(current: ShotObservation, previous: ShotObservation | null): ShotVerdict {
  if (current.meanLuma < SHOT_THRESHOLDS.darkMean || current.darkRatio > SHOT_THRESHOLDS.darkRatio) {
    return {
      ok: false,
      issue: 'dark',
      title: '太暗，重建会缺纹理',
      action: '转 90° 朝亮处，别开闪光灯。',
      sample: SAMPLE_NIGHT,
      sampleTone: 'normal',
    };
  }
  if (current.meanLuma > SHOT_THRESHOLDS.brightMean || current.brightRatio > SHOT_THRESHOLDS.brightRatio) {
    return {
      ok: false,
      issue: 'bright',
      title: '过曝，高光已经死了',
      action: '让光在身后，避开直射窗口。',
      sample: SAMPLE_NIGHT,
      sampleTone: 'bright',
    };
  }
  if (current.sharpness < SHOT_THRESHOLDS.blurVariance) {
    return {
      ok: false,
      issue: 'blur',
      title: '这张糊了，重建会缺纹理',
      action: '停半秒，双手夹紧再拍一张。',
      sample: SAMPLE_SPIN,
      sampleTone: 'normal',
    };
  }
  if (previous && hammingDistanceHex(current.hash, previous.hash) <= SHOT_THRESHOLDS.duplicateHamming) {
    return {
      ok: false,
      issue: 'duplicate',
      title: '和上一张几乎一样',
      action: '沿边线走半步，换一个机位再拍。',
      sample: SAMPLE_SPIN,
      sampleTone: 'normal',
    };
  }
  if (previous) {
    const moved =
      current.gps && previous.gps ? gpsDistanceMeters(current.gps, previous.gps) : null;
    const turned =
      current.heading !== null && previous.heading !== null
        ? headingDeltaDeg(current.heading, previous.heading)
        : null;
    if (moved !== null && moved > SHOT_THRESHOLDS.maxStepMeters) {
      return {
        ok: false,
        issue: 'too-fast',
        title: '走太快，帧间重叠会断',
        action: '退半步，朝上一张的方向补拍一张。',
        sample: SAMPLE_SPIN,
        sampleTone: 'normal',
      };
    }
    if (turned !== null && turned > SHOT_THRESHOLDS.maxHeadingDelta) {
      return {
        ok: false,
        issue: 'too-fast',
        title: '转太快，中间漏了画面',
        action: '退半步，朝上一张的方向补拍一张。',
        sample: SAMPLE_SPIN,
        sampleTone: 'normal',
      };
    }
  }
  return {
    ok: true,
    issue: null,
    title: '这张能进重建',
    action: '继续沿边线走，保持上一张的三分之一重叠。',
    sample: null,
    sampleTone: 'normal',
  };
}

// ───────────────────────────────────────────────────────────
// 智能引导（docs/22 S1–S3）。
// judgeShot 回答「这张行不行」，这里回答「下一拍去哪」：
// 层缺口 → 环向缺口 → 密度 → 收工，永远只给一个动作。
// ───────────────────────────────────────────────────────────

const LAYER_SHORT: Record<CaptureLayer, string> = { low: '低层', eye: '视线层', high: '高层' };

export interface NextShotAdviceInput {
  layerCounts: Record<CaptureLayer, number>;
  currentLayer: CaptureLayer;
  totalFrames: number;
  coverageDeg: number;
  coverageEstimated: boolean;
  headings: ReadonlyArray<number | null>;
}

export interface NextShotAdvice {
  priority: 'layer' | 'coverage' | 'density' | 'done';
  headline: string;
  detail: string;
}

/** 罗盘朝向里最大的环形空档；样本 <4 或已铺满时返回 null。 */
export function largestHeadingGap(
  headings: ReadonlyArray<number | null>,
): { gapDeg: number; centerDeg: number } | null {
  const occupied = new Array<boolean>(36).fill(false);
  let samples = 0;
  for (const heading of headings) {
    if (heading === null || !Number.isFinite(heading)) continue;
    occupied[Math.min(35, Math.floor(normaliseHeading(heading) / 10))] = true;
    samples += 1;
  }
  if (samples < 4 || occupied.every(Boolean)) return null;
  let bestStart = 0;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let step = 0; step < 72; step += 1) {
    if (!occupied[step % 36]) {
      if (curLen === 0) curStart = step;
      curLen += 1;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }
  if (bestLen === 0) return null;
  const centerBin = (bestStart + (bestLen - 1) / 2) % 36;
  return { gapDeg: Math.min(360, bestLen * 10), centerDeg: Math.round(centerBin * 10 + 5) % 360 };
}

/** S1 · 下一拍去哪：按「层缺口 → 环向 → 密度 → 收工」给唯一指令。 */
export function nextShotAdvice(input: NextShotAdviceInput): NextShotAdvice {
  const { layerCounts, currentLayer, totalFrames, coverageDeg, coverageEstimated, headings } = input;
  if (totalFrames === 0) {
    return {
      priority: 'layer',
      headline: '从视线层开始绕第一圈',
      detail: `沿场地边线走，每 10–15° 一个机位；先在本层攒满 ${TARGET_PER_LAYER} 张再换层。`,
    };
  }
  const currentCount = layerCounts[currentLayer] ?? 0;
  if (currentCount < TARGET_PER_LAYER) {
    const remain = TARGET_PER_LAYER - currentCount;
    return {
      priority: 'layer',
      headline: `继续拍${LAYER_SHORT[currentLayer]} · 还差 ${remain} 张`,
      detail: '本层满 24 张再换层；中途换高度，整圈的重叠就对不上了。',
    };
  }
  const missing = CAPTURE_LAYERS.filter(layer => (layerCounts[layer] ?? 0) < TARGET_PER_LAYER);
  if (missing.length > 0) {
    // 缺口最大的层优先；同分按 low → eye → high 的固定顺序。
    const worst = missing.reduce((left, right) =>
      TARGET_PER_LAYER - (layerCounts[right] ?? 0) > TARGET_PER_LAYER - (layerCounts[left] ?? 0) ? right : left,
    );
    const remain = TARGET_PER_LAYER - (layerCounts[worst] ?? 0);
    return {
      priority: 'layer',
      headline: `切到${LAYER_SHORT[worst]}`,
      detail: `${LAYER_SHORT[worst]}还差 ${remain} 张；三层齐全才不会出现高度断层。`,
    };
  }
  if (coverageDeg < 300) {
    const gap = largestHeadingGap(headings);
    if (gap && !coverageEstimated) {
      return {
        priority: 'coverage',
        headline: `补环向缺口 · 约 ${gap.gapDeg}°`,
        detail: `最大空档在 ${gap.centerDeg}° 方向附近；走过去沿边线补 8–10 个机位。`,
      };
    }
    return {
      priority: 'coverage',
      headline: `补环向缺口 · 当前约 ${Math.round(coverageDeg)}°`,
      detail: coverageEstimated
        ? '罗盘没开，覆盖按机位数推算；开启罗盘后能精确指出缺口方向。'
        : '环向不足 300°，沿边线把空缺的扇区补齐。',
    };
  }
  if (totalFrames < MIN_DELIVERABLE_STATIONS) {
    return {
      priority: 'density',
      headline: `继续补密度 · 已有 ${totalFrames} 张`,
      detail: `三层与环向已闭环；编辑级最低 ${MIN_DELIVERABLE_STATIONS} 张，补到 180–200 更稳。`,
    };
  }
  return {
    priority: 'done',
    headline: `样本够了 · 共 ${totalFrames} 张`,
    detail: '去评分看结论；尺度没录的话先回「尺度基准」补录。',
  };
}

/**
 * S2 · 由设备俯仰角推断拍摄层（竖屏持机：beta≈90° 为平视）。
 * 仰起 ≥15° 判低层（仰拍），压低 ≥15° 判高层（俯拍）；给不出判断返回 null。
 */
export function inferLayerFromDeviceTilt(betaDeg: number): CaptureLayer | null {
  if (!Number.isFinite(betaDeg)) return null;
  const pitch = betaDeg - 90;
  if (pitch >= 15) return 'low';
  if (pitch <= -15) return 'high';
  return 'eye';
}

export type VenueSize = 'small' | 'medium' | 'large';

/** S3 · 按场地规模推荐采集模式：小/中型拍照最稳，大空间视频覆盖最快。 */
export function recommendCaptureMode(size: VenueSize): { mode: 'photo' | 'video'; reason: string } {
  if (size === 'large') {
    return { mode: 'video', reason: '大空间靠连续走位快速覆盖，视频效率最高；上三脚架更稳。' };
  }
  if (size === 'medium') {
    return { mode: 'photo', reason: '中型场地照片仍能逐张控曝光；嫌慢再切视频。' };
  }
  return { mode: 'photo', reason: '小场地照片最稳：逐张控制曝光与站位，重建质量最好。' };
}
