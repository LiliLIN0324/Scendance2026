import { assetError } from '@/lib/assets-api';
import type { BackendSession, GenerationCapabilities, GenerationJob } from '@/lib/backend-session';

/**
 * 模型生成的提交规则（2026-11-15 从 generated-model-library 抽出来）。
 *
 * 为什么抽：生成的入口现在只剩统一面板，但「生成物件」那张历史卡还在。两边必须走**同一套**
 * 引擎能力判断、同一套提交调用、同一套说人话的失败文案，否则又会各错各的。
 * 这里只放规则与一次提交，不碰 React、不碰额度确认（额度确认是面板在提交前的闸门）。
 */

export type GenerationMode = 'text' | 'image';
export type GenerationEngine = 'hy3d' | 'aholo';

/** HY-3D 是服务端默认通道，所以它的选择发成「不带 provider」；Aholo 才显式声明。 */
export function providerFor(engine: GenerationEngine): { provider?: 'aholo' } {
  return engine === 'aholo' ? { provider: 'aholo' } : {};
}

export function engineLabel(engine: GenerationEngine): string {
  return engine === 'aholo' ? 'Aholo Lux3D' : 'HY-3D';
}

export function engineSupports(capabilities: GenerationCapabilities | null, engine: GenerationEngine, mode: GenerationMode): boolean {
  if (!capabilities) return false;
  return engine === 'aholo'
    ? (mode === 'image' ? capabilities.aholoImageToModel : capabilities.aholoTextToModel)
    : (mode === 'image' ? capabilities.imageToModel : capabilities.textToModel);
}

export function modeSupports(capabilities: GenerationCapabilities | null, mode: GenerationMode): boolean {
  return engineSupports(capabilities, 'hy3d', mode) || engineSupports(capabilities, 'aholo', mode);
}

/** 面板不给人挑引擎：优先 HY-3D，没开通就自动落到 Aholo。 */
export function pickEngine(capabilities: GenerationCapabilities | null, mode: GenerationMode): GenerationEngine {
  if (engineSupports(capabilities, 'hy3d', mode)) return 'hy3d';
  if (engineSupports(capabilities, 'aholo', mode)) return 'aholo';
  return 'hy3d';
}

/** 网络失败不把 “Failed to fetch” 原样甩给用户。 */
export function plainFailure(failure: unknown): string {
  const raw = failure instanceof Error ? failure.message : '';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) return '连不上云端，请检查网络后再试。';
  return assetError(failure);
}

export interface SubmitModelJobInput {
  mode: GenerationMode;
  prompt: string;
  engine: GenerationEngine;
  /** 图片生成必填：先 uploadModelReference 拿到的参考图资产 id。 */
  referenceImageAssetId?: string;
  /**
   * 幂等键。面板在发请求**之前**生成并写进提交回执，网络中断后才查得到这次请求；
   * 缺省时仍按一次性 UUID 生成（历史调用方行为不变）。
   */
  requestId?: string;
}

/** 真正扣额度的那一步：一次 createGenerationJob。调用方负责先过额度确认闸门。 */
export function submitModelJob(controller: BackendSession, input: SubmitModelJobInput): Promise<GenerationJob> {
  const provider = providerFor(input.engine);
  const prompt = input.prompt.trim();
  return controller.createGenerationJob(prompt, input.requestId ?? crypto.randomUUID(), input.mode === 'image' && input.referenceImageAssetId
    ? { kind: 'image', referenceImageAssetId: input.referenceImageAssetId, ...provider }
    : { kind: 'text', ...provider });
}

/** 参考图先上传成资产，提交时只带 id；返回原名给面板回显。 */
export async function uploadModelReference(controller: BackendSession, file: File): Promise<{ id: string; name: string }> {
  const uploaded = await controller.uploadGenerationReference(file);
  return { id: uploaded.id, name: file.name };
}

/**
 * 提交结果未知时的统一文案。断网/超时/5xx/响应读不懂都可能已经创建了收费任务，
 * 这时唯一的正确动作是去查任务记录与费用，而不是再点一次。
 */
export const UNKNOWN_SUBMISSION_NOTICE = '结果未知：可能已经创建任务并计费。先查任务记录与费用，不重试。';

export type GenerationFailureDisposition = 'unknown' | 'failed';

/**
 * 把提交异常分成两类：
 * - unknown：无法证明请求没到达服务端（断网、超时、5xx、响应解析失败），只能先查记录；
 * - failed ：服务端明确拒绝（4xx，如预算不足、未登录、幂等冲突），没有新建任务。
 * 本地 Zod 校验失败属于「请求没发出去」，同样归 failed。
 */
export function generationFailureDisposition(failure: unknown): GenerationFailureDisposition {
  const error = failure as { code?: unknown; status?: unknown; name?: unknown } | null;
  const code = error && typeof error.code === 'string' ? error.code : '';
  const status = error && typeof error.status === 'number' ? error.status : null;
  if (status !== null) {
    if (status === 0 || status === 408 || status >= 500) return 'unknown';
    if (status >= 400) return 'failed';
  }
  if (code === 'NETWORK_ERROR' || code === 'HTTP_ERROR' || code === 'INVALID_RESPONSE' || code === 'NON_JSON_RESPONSE') return 'unknown';
  if (error?.name === 'ZodError') return 'failed';
  const message = failure instanceof Error ? failure.message : '';
  if (/failed to fetch|networkerror|load failed|network request failed|timeout|timed out|aborted/i.test(message)) return 'unknown';
  // 没有状态码的异常无法证明请求没发出去：按未知处理，宁可按一次「先查记录」的流程走。
  return 'unknown';
}

/** 面板顶部那一句「为什么现在不能提交」，登录/能力/编辑权三种原因按优先级说。 */
export function generationBlockReason(input: {
  signedIn: boolean;
  capabilityState: 'idle' | 'loading' | 'ready' | 'failed';
  anyConfigured: boolean;
  disabled: boolean;
  writeBlocked: boolean;
}): string {
  if (!input.signedIn) return '登录云项目后即可生成模型。';
  if (input.capabilityState === 'loading' || input.capabilityState === 'idle') return '正在读取可用的生成模型…';
  if (input.capabilityState === 'failed') return '暂时连不上云端，没读到可用的生成模型。';
  if (!input.anyConfigured) return '生成能力尚未连接服务商。在设置里填入自定义服务商地址和密钥后即可开始。';
  if (input.disabled) return '当前有其他操作在进行，暂时不能提交生成。';
  if (input.writeBlocked) return '当前项目是只读状态，拿到编辑权后才能生成。';
  return '';
}
