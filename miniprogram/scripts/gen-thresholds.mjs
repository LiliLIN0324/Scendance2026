/**
 * 阈值单一真源同步脚本（只读上游，不改写 frontend/）。
 *
 * 真源仍是：
 *   frontend/lib/capture-guide/scoring.ts
 *   frontend/lib/capture-guide/image-analysis.ts
 *   frontend/lib/capture-guide/shot-rules.ts（逐张判定：模糊/暗/过曝/重复/走太快）
 *
 * 用法：
 *   node miniprogram/scripts/gen-thresholds.mjs         生成 lib/thresholds.js
 *   node miniprogram/scripts/gen-thresholds.mjs --check 只校验漂移，不写文件
 *
 * 为什么用生成而不是手抄：小程序的 WebView 与网页端的评分口径必须完全一致，
 * 手抄两份数字迟早漂移；生成脚本每次从 TS 源码抽取，抽取失败会直接报错，
 * 避免“新加了一条上限，小程序没跟上”这种静默偏差。
 * 约束：不做 TS 转译，只用锚定正则抽取阈值；上游改动命名或结构时脚本会失败，
 * 这是有意为之——让漂移变成显式错误，而不是悄悄错。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const scoringPath = resolve(root, 'frontend/lib/capture-guide/scoring.ts');
const analysisPath = resolve(root, 'frontend/lib/capture-guide/image-analysis.ts');
const shotRulesPath = resolve(root, 'frontend/lib/capture-guide/shot-rules.ts');
const outPath = resolve(here, '..', 'lib', 'thresholds.js');

function read(path) {
  if (!existsSync(path)) throw new Error(`缺少上游文件：${path}`);
  return readFileSync(path, 'utf8');
}

const scoring = read(scoringPath);
const analysis = read(analysisPath);
const shotRules = read(shotRulesPath);

function must(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`阈值抽取失败：${label}（上游可能改了写法规，请更新脚本锚点）`);
  return match[1];
}

function num(source, pattern, label) {
  return Number(must(source, pattern, label));
}

function constNumber(name) {
  return num(scoring, new RegExp(`export const ${name} = (\\d+(?:\\.\\d+)?);`), `scoring.ts ${name}`);
}

// —— 目标量与会话门槛 ——
const targets = {
  stations: constNumber('TARGET_STATIONS'),
  minDeliverable: constNumber('MIN_DELIVERABLE_STATIONS'),
  stable: constNumber('STABLE_STATIONS'),
  perLayer: constNumber('TARGET_PER_LAYER'),
};

const verdict = {
  ready: constNumber('READY_SCORE'),
  supplement: constNumber('SUPPLEMENT_SCORE'),
};

const gpsGoodAccuracyMeters = constNumber('GOOD_GPS_ACCURACY');

// —— 八项权重：取 scoreCapture 内每个 item 的 max ——
const scoreBody = scoring.slice(
  scoring.indexOf('export function scoreCapture'),
  scoring.indexOf('export function scoreScanImport'),
);
const maxValues = [...scoreBody.matchAll(/max:\s*(\d+)/g)].map(match => Number(match[1]));
if (maxValues.length !== 8) {
  throw new Error(`阈值抽取失败：scoreCapture 内应有 8 个 max，实际 ${maxValues.length} 个`);
}
const weightSum = maxValues.reduce((sum, value) => sum + value, 0);
if (weightSum !== 100) throw new Error(`阈值口径异常：八项权重合计应为 100，实际 ${weightSum}`);

const weights = {
  count: maxValues[0],
  layers: maxValues[1],
  distinct: maxValues[2],
  exposure: maxValues[3],
  gps: maxValues[4],
  scale: maxValues[5],
  angle: maxValues[6],
  duration: maxValues[7],
};

const layersTwoPoints = num(scoring, /metrics\.layers === 2 \? (\d+)/, '两层高度得分');
const angleEstimatedMax = num(scoring, /Math\.min\((\d+), Math\.round\(5 \* clamp01/, '无罗盘时角度上限');

// —— 曝光判定 ——
const exposure = {
  meanLumaMin: num(scoring, /frame\.meanLuma >= (\d+)/, 'isWellExposed 亮度下限'),
  meanLumaMax: num(scoring, /frame\.meanLuma <= (\d+)/, 'isWellExposed 亮度上限'),
  brightRatioMax: num(scoring, /frame\.brightRatio <= (\d+(?:\.\d+)?)/, 'isWellExposed 高光比例上限'),
  darkRatioMax: num(scoring, /frame\.darkRatio <= (\d+(?:\.\d+)?)/, 'isWellExposed 暗部比例上限'),
  brightPixel: num(analysis, /luma >= (\d+)/, 'image-analysis 高光像素阈值'),
  darkPixel: num(analysis, /luma <= (\d+)/, 'image-analysis 暗部像素阈值'),
};

const ratioHealthyMin = num(scoring, /exposureRatio >= (\d+(?:\.\d+)?)/, '曝光健康比例');
const distinctRatioMin = num(scoring, /distinctRatio >= (\d+(?:\.\d+)?)/, '去重比例');
const gpsGoodRatioMin = num(scoring, /gpsGoodCoverage >= (\d+(?:\.\d+)?)/, 'GPS 有效覆盖比例');

// —— 逐张判定（shot-rules） ——
// 模糊度统一在 sharpGray 的画布边长上算拉普拉斯方差，两边必须同尺度。
const blur = {
  size: num(analysis, /const sharpGray = drawSource\(source, (\d+)\)/, 'image-analysis 清晰度采样边长'),
  varianceMin: num(shotRules, /blurVariance:\s*(\d+)/, 'shot-rules 模糊方差下限'),
};

// —— 重复帧 ——
const hammingThreshold = num(scoring, /threshold = (\d+)/, 'findNearDuplicateIndices 汉明距离阈值');

// —— 硬门槛 ——
const minFrames = num(scoring, /else if \(total < (\d+)\) blockers\.push/, '最少张数门槛');
const duplicateRateMax = num(scoring, /metrics\.duplicateRate > (\d+(?:\.\d+)?)/, '重复率上限');
const exposureRatioMin = num(scoring, /exposureRatio < (\d+(?:\.\d+)?)/, '曝光健康率下限');

const caps = [...scoring
  .slice(scoring.indexOf('let finalTotal = raw'), scoring.indexOf('export function scoreScanImport'))
  .matchAll(/Math\.min\(finalTotal, (\d+)\)/g)]
  .map(match => Number(match[1]));
if (caps.length !== 2) throw new Error(`阈值抽取失败：应有两处分数上限，实际 ${caps.length} 处`);
const scoreCaps = { blocker: caps[0], supplement: caps[1] };

const inPlaceFrames = num(scoring, /inPlaceFrameCount >= (\d+) && inPlaceSpan < (\d+(?:\.\d+)?)/, '原地旋转机位数');
const inPlaceSpanMeters = num(scoring, /inPlaceFrameCount >= \d+ && inPlaceSpan < (\d+(?:\.\d+)?)/, '原地位移上限');
const inPlaceHeadingSpanDeg = num(scoring, /inPlaceHeadingSpan >= (\d+)/, '原地朝向跨度');

const minShortEdge = num(scoring, /Math\.min\(frame\.width, frame\.height\) < (\d+)/, '低分辨率短边阈值');

const coverageBins = num(scoring, /new Array<boolean>\((\d+)\)/, '朝向分桶数');
const coverageDegPerBin = num(scoring, /Math\.floor\(normalised \/ (\d+)\)/, '朝向每桶度数');
const coverageEstimatedDegPerFrame = num(scoring, /Math\.min\(360, distinctFrames \* (\d+)\)/, '无罗盘时每帧估算度数');

const durationMatch = scoring.match(/duration <= (\d+) \? (\d+) : duration <= (\d+) \? (\d+)/);
if (!durationMatch) throw new Error('阈值抽取失败：拍摄时长档位');
const duration = {
  fastMinutes: Number(durationMatch[1]),
  fastPoints: Number(durationMatch[2]),
  slowMinutes: Number(durationMatch[3]),
  slowPoints: Number(durationMatch[4]),
};

const payload = {
  source: [
    'frontend/lib/capture-guide/scoring.ts',
    'frontend/lib/capture-guide/image-analysis.ts',
    'frontend/lib/capture-guide/shot-rules.ts',
  ],
  targets,
  verdict,
  gps: { goodAccuracyMeters: gpsGoodAccuracyMeters, goodRatioMin: gpsGoodRatioMin },
  weights,
  exposure: { ...exposure, healthyRatioMin: ratioHealthyMin },
  blur,
  distinct: { ratioMin: distinctRatioMin, hammingThreshold },
  blockers: { minFrames, duplicateRateMax, exposureRatioMin },
  scoreCaps,
  inPlace: { frames: inPlaceFrames, spanMeters: inPlaceSpanMeters, headingSpanDeg: inPlaceHeadingSpanDeg },
  resolution: { minShortEdge },
  coverage: { bins: coverageBins, degPerBin: coverageDegPerBin, estimatedDegPerFrame: coverageEstimatedDegPerFrame },
  partial: { layersTwoPoints, angleEstimatedMax },
  duration,
};

const banner = `/**
 * 自动生成，请勿手改。
 * 由 miniprogram/scripts/gen-thresholds.mjs 从下列上游文件抽取：
 *   - frontend/lib/capture-guide/scoring.ts
 *   - frontend/lib/capture-guide/image-analysis.ts
 *   - frontend/lib/capture-guide/shot-rules.ts
 * 上游改动后执行：node miniprogram/scripts/gen-thresholds.mjs
 * 校验漂移：node miniprogram/scripts/gen-thresholds.mjs --check
 */
const thresholds = ${JSON.stringify(payload, null, 2)};

module.exports = thresholds;
`;

const checkMode = process.argv.includes('--check');
if (checkMode) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  if (current !== banner) {
    console.error('[capture] 阈值已漂移：请运行 node miniprogram/scripts/gen-thresholds.mjs');
    process.exit(1);
  }
  console.log('[capture] 阈值与网页端一致');
} else {
  mkdirSync(resolve(here, '..', 'lib'), { recursive: true });
  writeFileSync(outPath, banner, 'utf8');
  console.log(`[capture] 已写入 ${outPath}`);
}
