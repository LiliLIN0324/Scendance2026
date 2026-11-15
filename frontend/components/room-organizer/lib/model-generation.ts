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
}

/** 真正扣额度的那一步：一次 createGenerationJob。调用方负责先过额度确认闸门。 */
export function submitModelJob(controller: BackendSession, input: SubmitModelJobInput): Promise<GenerationJob> {
  const provider = providerFor(input.engine);
  const prompt = input.prompt.trim();
  return controller.createGenerationJob(prompt, crypto.randomUUID(), input.mode === 'image' && input.referenceImageAssetId
    ? { kind: 'image', referenceImageAssetId: input.referenceImageAssetId, ...provider }
    : { kind: 'text', ...provider });
}

/** 参考图先上传成资产，提交时只带 id；返回原名给面板回显。 */
export async function uploadModelReference(controller: BackendSession, file: File): Promise<{ id: string; name: string }> {
  const uploaded = await controller.uploadGenerationReference(file);
  return { id: uploaded.id, name: file.name };
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
