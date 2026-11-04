import { describe, expect, it } from 'vitest';

import { SCENE_JOB_GAPS, SCENE_JOB_SCHEMA, buildSceneJob, sceneJobFileName, type SceneJobFrame } from './scene-job';
import type { CaptureLayer } from './scoring';

function frame(layer: CaptureLayer, index: number, heading: number): SceneJobFrame {
  return {
    name: `${layer}-${index}.jpg`,
    layer,
    width: 4032,
    height: 3024,
    meanLuma: 128,
    sharpness: 42,
    heading,
    gps: { latitude: 30.27, longitude: 120.15, accuracy: 4, at: 1 },
    at: 1 + index,
  };
}

/** 三层 × 40 个机位（共 120），环向铺满 360°。 */
function healthyFrames(): SceneJobFrame[] {
  const frames: SceneJobFrame[] = [];
  for (const layer of ['low', 'eye', 'high'] as const) {
    for (let index = 0; index < 40; index += 1) frames.push(frame(layer, index, index * 9));
  }
  return frames;
}

describe('buildSceneJob', () => {
  it('没素材直接 blocked，并指出缺什么', () => {
    const job = buildSceneJob({ mode: 'photo', frames: [], scaleMeters: null, score: null, createdAt: 1 });
    expect(job.status).toBe('blocked');
    expect(job.blockers[0]).toContain('没有素材');
    expect(job.blockers.some(item => item.includes('尺度'))).toBe(true);
    expect(job.frames).toHaveLength(0);
    expect(job.gaps).toEqual([...SCENE_JOB_GAPS]);
  });

  it('三层 120 张、覆盖 360°、有尺度时判 ready，但仍然标注后端缺口', () => {
    const job = buildSceneJob({ mode: 'photo', frames: healthyFrames(), scaleMeters: 1.2, score: null, createdAt: 2 });
    expect(job.status).toBe('ready');
    expect(job.blockers).toEqual([]);
    expect(job.capture.layerCounts).toEqual({ low: 40, eye: 40, high: 40 });
    expect(job.capture.stations).toBe(120);
    expect(job.upload.resources).toHaveLength(120);
    expect(job.upload.endpoint).toBe('/recon-upload');
    expect(job.recon.endpoint).toBe('/world-recon');
    expect(job.outputs.normalized).toMatchObject({ format: 'glb', unit: 'm', upAxis: 'y', pivot: 'bottom-center' });
    expect(job.outputs.raw.formats).toEqual(['ply', 'spz']);
    expect(job.gaps.some(item => item.includes('/world-recon'))).toBe(true);
  });

  it('缺一层就 blocked，并给出该层的数量', () => {
    const frames = healthyFrames().filter(item => item.layer !== 'high');
    const job = buildSceneJob({ mode: 'photo', frames, scaleMeters: 1.2, score: null, createdAt: 3 });
    expect(job.status).toBe('blocked');
    expect(job.blockers.some(item => item.startsWith('高层 0 / 24'))).toBe(true);
  });

  it('采用评分里的验收数字，不另立阈值', () => {
    const score = {
      total: 100,
      rawTotal: 100,
      verdict: 'ready' as const,
      items: [],
      deductions: [],
      blockers: [],
      caps: [],
      metrics: {
        frames: 300,
        distinctFrames: 300,
        duplicateFrames: 0,
        duplicateRate: 0,
        layers: 3,
        layerCounts: { low: 100, eye: 100, high: 100 },
        coverageDeg: 350,
        coverageEstimated: false,
        gpsCoverage: 1,
        gpsGoodCoverage: 1,
        gpsMedianAccuracy: 4,
        gpsSpanMeters: 30,
        exposureOk: 300,
        lowResolution: 0,
        durationMinutes: 20,
      },
    };
    const job = buildSceneJob({
      mode: 'photo',
      frames: healthyFrames(),
      scaleMeters: 20,
      score,
      createdAt: 4,
      sceneName: '  宴会厅  ',
    });
    expect(job.status).toBe('ready');
    expect(job.sceneName).toBe('宴会厅');
    expect(job.capture.stations).toBe(300);
    expect(job.capture.coverageDeg).toBe(350);
    expect(job.capture.score).toBe(100);
  });

  it('任务包文件名带时间，schema 固定', () => {
    expect(sceneJobFileName(Date.UTC(2026, 10, 5, 9, 30))).toBe('scendance-scene-job-202611050930.json');
    expect(SCENE_JOB_SCHEMA).toBe('scendance.scene-job/v1');
  });
});
