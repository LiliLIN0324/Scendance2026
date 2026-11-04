/**
 * 自动生成，请勿手改。
 * 由 miniprogram/scripts/gen-thresholds.mjs 从下列上游文件抽取：
 *   - frontend/lib/capture-guide/scoring.ts
 *   - frontend/lib/capture-guide/image-analysis.ts
 *   - frontend/lib/capture-guide/shot-rules.ts
 * 上游改动后执行：node miniprogram/scripts/gen-thresholds.mjs
 * 校验漂移：node miniprogram/scripts/gen-thresholds.mjs --check
 */
const thresholds = {
  "source": [
    "frontend/lib/capture-guide/scoring.ts",
    "frontend/lib/capture-guide/image-analysis.ts",
    "frontend/lib/capture-guide/shot-rules.ts"
  ],
  "targets": {
    "stations": 180,
    "minDeliverable": 120,
    "stable": 200,
    "perLayer": 24
  },
  "verdict": {
    "ready": 75,
    "supplement": 50
  },
  "gps": {
    "goodAccuracyMeters": 10,
    "goodRatioMin": 0.9
  },
  "weights": {
    "count": 15,
    "layers": 15,
    "distinct": 15,
    "exposure": 10,
    "gps": 15,
    "scale": 15,
    "angle": 10,
    "duration": 5
  },
  "exposure": {
    "meanLumaMin": 45,
    "meanLumaMax": 210,
    "brightRatioMax": 0.12,
    "darkRatioMax": 0.5,
    "brightPixel": 245,
    "darkPixel": 25,
    "healthyRatioMin": 0.9
  },
  "blur": {
    "size": 256,
    "varianceMin": 60
  },
  "distinct": {
    "ratioMin": 0.9,
    "hammingThreshold": 6
  },
  "blockers": {
    "minFrames": 8,
    "duplicateRateMax": 0.5,
    "exposureRatioMin": 0.5
  },
  "scoreCaps": {
    "blocker": 49,
    "supplement": 69
  },
  "inPlace": {
    "frames": 12,
    "spanMeters": 1.5,
    "headingSpanDeg": 90
  },
  "resolution": {
    "minShortEdge": 1080
  },
  "coverage": {
    "bins": 36,
    "degPerBin": 10,
    "estimatedDegPerFrame": 5
  },
  "partial": {
    "layersTwoPoints": 6,
    "angleEstimatedMax": 5
  },
  "duration": {
    "fastMinutes": 30,
    "fastPoints": 5,
    "slowMinutes": 120,
    "slowPoints": 3
  }
};

module.exports = thresholds;
