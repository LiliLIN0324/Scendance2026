/**
 * 采集守门员 · 重建可行性（面向 SfM / Aholo web-scan）。
 *
 * 判定口径来自实测，不凭感觉：
 *   63 张茶室照片 → 24 张登记成功（38%）；20 张那次 <12 张，作业被拒。
 * 因此下限倒推：12 / 0.38 ≈ 32，留 25% 余量取 40 张可用帧；稳定目标 60 张。
 * 重叠只做相邻帧的粗略估计（感知哈希汉明距离），不做特征匹配——它只是提醒走太快，
 * 真实登记数由服务端作业给。
 */

import { hammingDistanceHex, type FrameSample } from './scoring';

export const RECON_RULES = {
  minRegistered: 12,
  /** 实测登记率 24/63；用保守值。 */
  registeredYield: 0.38,
  /** 建议张数下限：可用帧（清晰、曝光正常、非近似重复）。 */
  minUsableShots: 40,
  /** 稳定目标：茶室 / 展厅规模拍到 60 张可用帧。 */
  targetUsableShots: 60,
  blurVariance: 60,
  duplicateHamming: 6,
  /** 相邻帧汉明距离超过它，按重叠断档处理（走太快或漏拍）。 */
  gapHamming: 22,
  darkMean: 45,
  darkRatio: 0.5,
  brightMean: 210,
  brightRatio: 0.12,
} as const;

export type ReconVerdict = 'not-enough' | 'borderline' | 'enough';

export interface ReconReadiness {
  total: number;
  usable: number;
  sharp: number;
  blurry: number;
  exposureIssues: number;
  duplicates: number;
  pairs: number;
  goodOverlapPairs: number;
  gaps: number;
  estimatedRegistered: number;
  verdict: ReconVerdict;
  headline: string;
  detail: string;
  missingShots: number;
  minShots: number;
  targetShots: number;
}

export type ReadinessFrame = Pick<FrameSample, 'hash' | 'meanLuma' | 'brightRatio' | 'darkRatio'> & {
  sharpness: number;
};

const isSharp = (frame: ReadinessFrame): boolean => frame.sharpness >= RECON_RULES.blurVariance;
const isExposed = (frame: ReadinessFrame): boolean =>
  !(frame.meanLuma < RECON_RULES.darkMean || frame.darkRatio > RECON_RULES.darkRatio) &&
  !(frame.meanLuma > RECON_RULES.brightMean || frame.brightRatio > RECON_RULES.brightRatio);

/** 采集顺序下的相邻帧判定；frames 必须按拍摄顺序传入。 */
export function assessReconReadiness(
  frames: ReadinessFrame[],
  { minShots = RECON_RULES.minUsableShots, targetShots = RECON_RULES.targetUsableShots } = {},
): ReconReadiness {
  let sharp = 0;
  let exposureIssues = 0;
  let duplicates = 0;
  let usable = 0;

  frames.forEach((frame, index) => {
    const sharpHere = isSharp(frame);
    const exposed = isExposed(frame);
    if (sharpHere) sharp += 1;
    if (!exposed) exposureIssues += 1;
    const previous = index > 0 ? frames[index - 1] : null;
    const nearDuplicate =
      previous !== null && hammingDistanceHex(frame.hash, previous.hash) <= RECON_RULES.duplicateHamming;
    if (nearDuplicate) duplicates += 1;
    if (sharpHere && exposed && !nearDuplicate) usable += 1;
  });

  let goodOverlapPairs = 0;
  let gaps = 0;
  const pairs = Math.max(0, frames.length - 1);
  for (let index = 1; index < frames.length; index += 1) {
    const distance = hammingDistanceHex(frames[index].hash, frames[index - 1].hash);
    if (distance > RECON_RULES.gapHamming) gaps += 1;
    else if (distance > RECON_RULES.duplicateHamming) goodOverlapPairs += 1;
  }

  const estimatedRegistered = Math.min(usable, Math.floor(usable * RECON_RULES.registeredYield));
  const missingShots = Math.max(0, minShots - usable);

  let verdict: ReconVerdict = 'not-enough';
  if (estimatedRegistered >= RECON_RULES.minRegistered && usable >= minShots) verdict = 'enough';
  else if (estimatedRegistered >= RECON_RULES.minRegistered - 3 || usable >= Math.round(minShots * 0.6)) verdict = 'borderline';

  const headline =
    verdict === 'enough'
      ? `够建了 · 预计登记 ${estimatedRegistered} 张`
      : verdict === 'borderline'
        ? `接近下限 · 再补 ${Math.max(8, minShots - usable)} 张`
        : `还不够 · 至少再拍 ${missingShots} 张`;
  const detail =
    verdict === 'enough'
      ? `下限 ${minShots} 张、目标 ${targetShots} 张；断档方位优先补。`
      : `按约 ${Math.round(RECON_RULES.registeredYield * 100)}% 登记率估算，低于 ${RECON_RULES.minRegistered} 张会被服务端拒。`;

  return {
    total: frames.length,
    usable,
    sharp,
    blurry: frames.length - sharp,
    exposureIssues,
    duplicates,
    pairs,
    goodOverlapPairs,
    gaps,
    estimatedRegistered,
    verdict,
    headline,
    detail,
    missingShots,
    minShots,
    targetShots,
  };
}
