/**
 * 出 3D · 重建任务包。
 *
 * 采集页的资源只有照片和元数据，重建必须由后端完成。这里把「要交给后端的那一份」
 * 定成一个可序列化的合同：素材清单、验收要求、出口格式、还缺哪一环。
 * 纯函数，方便单测，也方便桌面端 / 后端按同一份字段对接。
 */

import {
  MIN_DELIVERABLE_STATIONS,
  TARGET_PER_LAYER,
  headingCoverage,
  isValidScale,
  type CaptureLayer,
  type CaptureMode,
  type CaptureScore,
  type GpsFix,
} from './scoring';

export const SCENE_JOB_SCHEMA = 'scendance.scene-job/v1';

/** 与现场校验的硬门槛同一组数字，不在出口另立一套。 */
export const SCENE_JOB_REQUIREMENTS = {
  minStations: MIN_DELIVERABLE_STATIONS,
  minPerLayer: TARGET_PER_LAYER,
  minCoverageDeg: 300,
  scaleRequired: true,
} as const;

/** 本轮纯前端做不了的四件事；出口卡要原样告诉用户。 */
export const SCENE_JOB_GAPS = [
  '后端 /recon-upload：把原片上传到重建服务',
  '后端 /world-recon：创建重建任务并轮询状态',
  '密钥 LUX3D_API_KEY：目前只配置在本机代理里',
  '工作台导入：还没有把归一化 GLB 放回可编辑场地的入口',
] as const;

export interface SceneJobFrame {
  name: string;
  layer: CaptureLayer;
  width: number;
  height: number;
  meanLuma: number;
  sharpness: number | null;
  heading: number | null;
  gps: GpsFix | null;
  at: number | null;
}

export interface SceneJob {
  schema: typeof SCENE_JOB_SCHEMA;
  createdAt: string;
  sceneName: string;
  mode: CaptureMode;
  status: 'ready' | 'blocked';
  blockers: string[];
  requirements: typeof SCENE_JOB_REQUIREMENTS;
  capture: {
    score: number | null;
    verdict: string | null;
    stations: number;
    layers: number;
    layerCounts: Record<CaptureLayer, number>;
    coverageDeg: number;
    gpsCoverage: number;
    scaleMeters: number | null;
  };
  frames: SceneJobFrame[];
  /** 后端合同：先上传素材换公网地址，再创建任务。桌面端按同一路径实现即可。 */
  upload: { endpoint: '/recon-upload'; resources: Array<{ name: string; type: 'image' }> };
  recon: { endpoint: '/world-recon'; scene: 'space'; taskQuality: 'normal' };
  outputs: {
    normalized: { format: 'glb'; unit: 'm'; upAxis: 'y'; pivot: 'bottom-center'; editable: true };
    raw: { formats: Array<'ply' | 'spz'>; note: string };
    manifest: typeof SCENE_JOB_SCHEMA;
  };
  gaps: readonly string[];
}

export interface SceneJobInput {
  sceneName?: string;
  mode: CaptureMode;
  frames: ReadonlyArray<SceneJobFrame>;
  scaleMeters: number | null;
  score: CaptureScore | null;
  createdAt: number;
}

function layerCountsOf(frames: ReadonlyArray<SceneJobFrame>): Record<CaptureLayer, number> {
  const counts: Record<CaptureLayer, number> = { low: 0, eye: 0, high: 0 };
  for (const frame of frames) counts[frame.layer] += 1;
  return counts;
}

export function buildSceneJob(input: SceneJobInput): SceneJob {
  const counts = layerCountsOf(input.frames);
  const metrics = input.score?.metrics ?? null;
  const stations = metrics?.frames ?? input.frames.length;
  const layers = metrics?.layers ?? (Object.values(counts).filter(count => count > 0).length);
  const coverageDeg = Math.round(
    metrics?.coverageDeg ?? headingCoverage(input.frames.map(frame => frame.heading)).coverageDeg,
  );
  const gpsCoverage = metrics?.gpsGoodCoverage ?? 0;

  const blockers: string[] = [];
  if (stations === 0) blockers.push('没有素材：先拍够三层机位');
  if (stations > 0 && stations < SCENE_JOB_REQUIREMENTS.minStations) {
    blockers.push(`机位 ${stations}，低于最低可交付 ${SCENE_JOB_REQUIREMENTS.minStations}`);
  }
  for (const layer of ['low', 'eye', 'high'] as const) {
    if (counts[layer] < SCENE_JOB_REQUIREMENTS.minPerLayer) {
      blockers.push(
        `${layer === 'low' ? '低层' : layer === 'eye' ? '视线层' : '高层'} ${counts[layer]} / ${SCENE_JOB_REQUIREMENTS.minPerLayer}`,
      );
    }
  }
  if (coverageDeg < SCENE_JOB_REQUIREMENTS.minCoverageDeg) {
    blockers.push(`环向覆盖 ${coverageDeg}° / ${SCENE_JOB_REQUIREMENTS.minCoverageDeg}°`);
  }
  if (!isValidScale(input.scaleMeters)) blockers.push('缺少真实尺度：重建出来的模型量不了尺寸');
  if (input.score) blockers.push(...input.score.blockers.filter(item => !blockers.some(known => known.includes(item))));

  return {
    schema: SCENE_JOB_SCHEMA,
    createdAt: new Date(input.createdAt).toISOString(),
    sceneName: input.sceneName?.trim() || '未命名场地',
    mode: input.mode,
    status: blockers.length === 0 ? 'ready' : 'blocked',
    blockers,
    requirements: SCENE_JOB_REQUIREMENTS,
    capture: {
      score: input.score?.total ?? null,
      verdict: input.score?.verdict ?? null,
      stations,
      layers,
      layerCounts: counts,
      coverageDeg,
      gpsCoverage,
      scaleMeters: input.scaleMeters,
    },
    frames: input.frames.map(frame => ({ ...frame })),
    upload: {
      endpoint: '/recon-upload',
      resources: input.frames.map(frame => ({ name: frame.name, type: 'image' as const })),
    },
    recon: { endpoint: '/world-recon', scene: 'space', taskQuality: 'normal' },
    outputs: {
      normalized: { format: 'glb', unit: 'm', upAxis: 'y', pivot: 'bottom-center', editable: true },
      raw: {
        formats: ['ply', 'spz'],
        note: '原样导出，不转坐标轴、不改单位；尺度与坐标系以源文件为准。',
      },
      manifest: SCENE_JOB_SCHEMA,
    },
    gaps: SCENE_JOB_GAPS,
  };
}

export function sceneJobJson(job: SceneJob): string {
  return JSON.stringify(job, null, 2);
}

export function sceneJobFileName(at: number): string {
  const stamp = new Date(at).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `scendance-scene-job-${stamp}.json`;
}
