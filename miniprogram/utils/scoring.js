/**
 * 采集评分 · 小程序侧实现。
 *
 * 这是 frontend/lib/capture-guide/scoring.ts 的 JS 移植：
 * 公式结构一一对应，所有数字从 lib/thresholds.js 读取（该文件由脚本从上游 TS 抽取）。
 * 改评分口径请改上游 TS，然后跑 node miniprogram/scripts/gen-thresholds.mjs。
 */
const T = require('../lib/thresholds.js');

const CAPTURE_LAYERS = ['low', 'eye', 'high'];
const LAYER_LABELS = {
  low: '低层 · 60cm 仰拍',
  eye: '视线层 · 170cm 平视',
  high: '高层 · 190cm 俯拍',
};
const CHINESE_DIGITS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function normaliseHeading(value) {
  const heading = value % 360;
  return heading < 0 ? heading + 360 : heading;
}

function hammingDistanceHex(a, b) {
  if (a.length !== b.length) return 99;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = Number.parseInt(a[i] || '0', 16);
    const right = Number.parseInt(b[i] || '0', 16);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 99;
    let xor = left ^ right;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

function findNearDuplicateIndices(hashes, threshold = T.distinct.hammingThreshold) {
  const result = [];
  for (let index = 0; index < hashes.length; index += 1) {
    const hash = hashes[index] || '';
    for (let earlier = Math.max(0, index - 10); earlier < index; earlier += 1) {
      if (hammingDistanceHex(hashes[earlier] || '', hash) <= threshold) {
        result.push(index);
        break;
      }
    }
  }
  return result;
}

function countDistinctFrames(frames, threshold = T.distinct.hammingThreshold) {
  const seen = [];
  let distinct = 0;
  frames.forEach(frame => {
    const near = seen.some(hash => hammingDistanceHex(hash, frame.hash) <= threshold);
    if (!near) {
      seen.push(frame.hash);
      distinct += 1;
    }
  });
  return distinct;
}

function isWellExposed(frame) {
  return (
    frame.meanLuma >= T.exposure.meanLumaMin &&
    frame.meanLuma <= T.exposure.meanLumaMax &&
    frame.brightRatio <= T.exposure.brightRatioMax &&
    frame.darkRatio <= T.exposure.darkRatioMax
  );
}

function headingCoverage(headings) {
  const occupied = new Array(T.coverage.bins).fill(false);
  let samples = 0;
  headings.forEach(heading => {
    if (heading === null || !Number.isFinite(heading)) return;
    const normalised = normaliseHeading(heading);
    const bin = Math.min(T.coverage.bins - 1, Math.floor(normalised / T.coverage.degPerBin));
    occupied[bin] = true;
    samples += 1;
  });
  const bins = occupied.filter(Boolean).length;
  return { bins, coverageDeg: bins * T.coverage.degPerBin, samples, occupied };
}

function headingSpanDeg(headings) {
  const values = headings
    .filter(heading => heading !== null && Number.isFinite(heading))
    .map(normaliseHeading)
    .sort((left, right) => left - right);
  if (values.length < 2) return 0;
  let largestGap = 360 - (values[values.length - 1] - values[0]);
  for (let index = 1; index < values.length; index += 1) {
    largestGap = Math.max(largestGap, values[index] - values[index - 1]);
  }
  return Math.round(360 - largestGap);
}

function haversineMeters(a, b) {
  const earthRadius = 6371000;
  const toRad = degree => (degree * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}

function gpsSpanMeters(frames) {
  const fixes = frames
    .map(frame => frame.gps)
    .filter(fix => fix && fix.accuracy > 0 && fix.accuracy <= T.gps.goodAccuracyMeters);
  if (fixes.length < 2) return 0;
  let span = 0;
  for (let index = 0; index < fixes.length; index += 1) {
    for (let later = index + 1; later < fixes.length; later += 1) {
      span = Math.max(span, haversineMeters(fixes[index], fixes[later]));
    }
  }
  return Math.round(span * 10) / 10;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return round((sorted[middle - 1] + sorted[middle]) / 2);
}

function isValidScale(meters) {
  return meters !== null && Number.isFinite(meters) && meters >= 0.1 && meters <= 100;
}

/** 「20cm」「1.2m」「一米」→ 米；范围是否可用交给 isValidScale。 */
function parseScaleMeters(raw) {
  const text = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/，/g, '.')
    .replace(/。/g, '.')
    .replace(/\s+/g, '');
  if (!text) return null;

  const chinese = text.match(/^([一二两三四五六七八九十])(米|m|公尺)$/);
  if (chinese) {
    const digit = CHINESE_DIGITS[chinese[1]];
    return digit === undefined ? null : digit;
  }

  const match = text.match(/^(\d+(?:\.\d+)?)(毫米|mm|厘米|cm|米|m|公尺)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] || '';
  if (unit === '毫米' || unit === 'mm') return round(value / 1000);
  if (unit === '厘米' || unit === 'cm') return round(value / 100);
  return round(value);
}

function formatMeters(meters) {
  if (meters < 1) return `${Math.round(meters * 1000)} mm`;
  return `${meters.toFixed(meters >= 10 ? 1 : 2)} m`;
}

function buildMetrics(evidence) {
  const frames = evidence.frames;
  const total = frames.length;
  const distinctFrames = countDistinctFrames(frames);
  const duplicateFrames = total - distinctFrames;
  const layerCounts = { low: 0, eye: 0, high: 0 };
  frames.forEach(frame => {
    layerCounts[frame.layer] += 1;
  });
  const layers = CAPTURE_LAYERS.filter(layer => layerCounts[layer] > 0).length;
  const exposureOk = frames.filter(isWellExposed).length;
  const gpsFixes = frames.map(frame => frame.gps).filter(fix => fix !== null && fix !== undefined);
  const goodFixes = gpsFixes.filter(fix => fix.accuracy > 0 && fix.accuracy <= T.gps.goodAccuracyMeters);
  const headings = frames.map(frame => frame.heading);
  const coverage = headingCoverage(headings);
  const hasCompass = coverage.samples >= Math.min(12, total) && coverage.samples > 0;
  const estimatedCoverage = Math.min(360, distinctFrames * T.coverage.estimatedDegPerFrame);
  const headingSpan = headingSpanDeg(headings);
  const coverageDeg = hasCompass ? Math.max(headingSpan, coverage.coverageDeg) : estimatedCoverage;
  const lowResolution = frames.filter(frame => Math.min(frame.width, frame.height) < T.resolution.minShortEdge).length;
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

function scoreCapture(evidence) {
  const metrics = buildMetrics(evidence);
  const frames = evidence.frames;
  const total = frames.length;
  const W = T.weights;

  const items = [
    {
      key: 'count',
      label: '机位数量',
      earned: Math.round(W.count * clamp01(total / T.targets.stations)),
      max: W.count,
      detail: `${total} 个机位 / 目标 ${T.targets.stations}（最低可交付 ${T.targets.minDeliverable}，稳定 ${T.targets.stable}+）`,
    },
    {
      key: 'layers',
      label: '三层高度',
      earned: metrics.layers === 3 ? W.layers : metrics.layers === 2 ? T.partial.layersTwoPoints : 0,
      max: W.layers,
      detail: metrics.layers === 3 ? '低 / 视线 / 高 三层齐全' : `只记录了 ${metrics.layers} 层`,
    },
    {
      key: 'distinct',
      label: '去重 / 重叠',
      earned:
        (total > 0 ? metrics.distinctFrames / total : 0) >= T.distinct.ratioMin
          ? W.distinct
          : Math.round(W.distinct * clamp01((total > 0 ? metrics.distinctFrames / total : 0) - 0.5) / 0.4),
      max: W.distinct,
      detail: `${metrics.distinctFrames} 张互不相似，${metrics.duplicateFrames} 张与前一机位重复`,
    },
    {
      key: 'exposure',
      label: '曝光健康',
      earned:
        (total > 0 ? metrics.exposureOk / total : 0) >= T.exposure.healthyRatioMin
          ? W.exposure
          : Math.round(W.exposure * clamp01(((total > 0 ? metrics.exposureOk / total : 0) - 0.5) / 0.4)),
      max: W.exposure,
      detail: `${metrics.exposureOk} / ${total} 张在正常亮度区间`,
    },
    {
      key: 'gps',
      label: '定位覆盖',
      earned:
        metrics.gpsGoodCoverage >= T.gps.goodRatioMin
          ? W.gps
          : Math.round(W.gps * clamp01((metrics.gpsGoodCoverage - 0.5) / 0.4)),
      max: W.gps,
      detail:
        metrics.gpsMedianAccuracy === null
          ? '没有任何机位记录到 GPS'
          : `${Math.round(metrics.gpsGoodCoverage * 100)}% 机位精度 ≤ ${T.gps.goodAccuracyMeters}m，中位 ${metrics.gpsMedianAccuracy}m`,
    },
    {
      key: 'scale',
      label: '尺度基准',
      earned: isValidScale(evidence.scaleMeters) ? W.scale : 0,
      max: W.scale,
      detail: isValidScale(evidence.scaleMeters) ? `已录入 ${formatMeters(evidence.scaleMeters)}` : '没有录入已知长度',
    },
    {
      key: 'angle',
      label: '角度覆盖',
      earned: metrics.coverageEstimated
        ? Math.min(T.partial.angleEstimatedMax, Math.round(5 * clamp01(metrics.distinctFrames / T.targets.stations)))
        : Math.round(W.angle * clamp01(metrics.coverageDeg / 360 / 0.85)),
      max: W.angle,
      detail: metrics.coverageEstimated
        ? `无罗盘，按 ${metrics.distinctFrames} 个不重复机位推算 ≈ ${metrics.coverageDeg}°`
        : `罗盘记录覆盖 ≈ ${metrics.coverageDeg}°`,
    },
    {
      key: 'duration',
      label: '拍摄时长',
      earned:
        evidence.durationMinutes === null
          ? 0
          : evidence.durationMinutes <= T.duration.fastMinutes
            ? T.duration.fastPoints
            : evidence.durationMinutes <= T.duration.slowMinutes
              ? T.duration.slowPoints
              : 0,
      max: W.duration,
      detail: evidence.durationMinutes === null ? '没有记录拍摄时长' : `${Math.round(evidence.durationMinutes)} 分钟`,
    },
  ];

  const blockers = [];
  const caps = [];
  const deductions = [];

  if (total === 0) blockers.push('没有任何可用图像样本，无法判断可重建性');
  else if (total < T.blockers.minFrames) blockers.push(`样本只有 ${total} 张，低于最低 ${T.blockers.minFrames} 张门槛`);
  if (total > 0 && metrics.duplicateRate > T.blockers.duplicateRateMax) {
    blockers.push(`重复 / 过近帧占 ${Math.round(metrics.duplicateRate * 100)}%，超过一半`);
  }
  if (total > 0 && (total > 0 ? metrics.exposureOk / total : 0) < T.blockers.exposureRatioMin) {
    blockers.push('过暗或过曝帧占多数');
  }

  const inPlaceFrames = frames.filter(
    frame => frame.gps && frame.gps.accuracy > 0 && frame.gps.accuracy <= T.gps.goodAccuracyMeters,
  ).length;
  const inPlaceSpan = metrics.gpsSpanMeters;
  if (inPlaceFrames >= T.inPlace.frames && inPlaceSpan < T.inPlace.spanMeters) {
    const headingSpan = headingSpanDeg(frames.map(frame => frame.heading));
    if (headingSpan >= T.inPlace.headingSpanDeg) {
      blockers.push(`原地旋转：${inPlaceFrames} 个机位 GPS 位移只有 ${inPlaceSpan}m，朝向却转了 ${headingSpan}°`);
    } else {
      caps.push(`GPS 显示 ${inPlaceFrames} 个机位都停在同一点（位移 ${inPlaceSpan}m）`);
    }
  }

  if (total > 0 && total < T.targets.minDeliverable) {
    caps.push(`机位只有 ${total} 个，少于编辑级最低可交付 ${T.targets.minDeliverable} 个`);
  }
  if (metrics.layers < 3) caps.push(`三层只完成 ${metrics.layers} 层，漫游会出现高度断层`);
  if (!isValidScale(evidence.scaleMeters)) caps.push('缺少尺度基准，重建结果没有真实尺寸');
  if (total > 0 && metrics.gpsGoodCoverage < 0.5) {
    caps.push(`有效 GPS 覆盖只有 ${Math.round(metrics.gpsGoodCoverage * 100)}%，低于 50%`);
  }
  if (metrics.lowResolution > 0) {
    deductions.push({ severity: 'warn', label: '分辨率偏低', detail: `${metrics.lowResolution} 张短边小于 1080px`, points: 0 });
  }
  items.forEach(item => {
    if (item.earned < item.max) {
      deductions.push({ severity: 'warn', label: item.label, detail: item.detail, points: item.max - item.earned });
    }
  });

  let finalTotal = items.reduce((sum, item) => sum + item.earned, 0);
  if (blockers.length > 0) finalTotal = Math.min(finalTotal, T.scoreCaps.blocker);
  else if (caps.length > 0) finalTotal = Math.min(finalTotal, T.scoreCaps.supplement);

  const verdict =
    blockers.length > 0
      ? 'redo'
      : finalTotal >= T.verdict.ready
        ? 'ready'
        : finalTotal >= T.verdict.supplement
          ? 'supplement'
          : 'redo';

  return { total: finalTotal, verdict, items, deductions, blockers, caps, metrics };
}

module.exports = {
  CAPTURE_LAYERS,
  LAYER_LABELS,
  normaliseHeading,
  hammingDistanceHex,
  findNearDuplicateIndices,
  countDistinctFrames,
  isWellExposed,
  headingCoverage,
  headingSpanDeg,
  haversineMeters,
  gpsSpanMeters,
  median,
  isValidScale,
  parseScaleMeters,
  formatMeters,
  scoreCapture,
};
