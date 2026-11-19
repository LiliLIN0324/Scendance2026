import { describe, expect, it, vi } from 'vitest';
import {
  UNKNOWN_SUBMISSION_NOTICE,
  engineLabel,
  engineSupports,
  generationBlockReason,
  generationFailureDisposition,
  isGenerationBusy,
  modeSupports,
  pickEngine,
  plainFailure,
  providerFor,
  submitModelJob,
  uploadModelReference,
} from './model-generation';
import { GENERATION_BUSY_NOTICE, assetError } from '@/lib/assets-api';
import { SceneApiError } from '@/lib/backend-session';
import type { BackendSession, GenerationCapabilities } from '@/lib/backend-session';

/**
 * 生成的提交规则只该有一处：统一面板与历史生成卡共用这份。
 * 这里锁住「引擎能力判断 / provider 口径 / 提交前必须先过额度闸门」三条。
 */
const caps = (patch: Partial<GenerationCapabilities>): GenerationCapabilities => ({
  model: 'hy-3d-3.0', textToModel: false, imageToModel: false,
  texture: false, textureRequiresImage: true, aholoTextToModel: false, aholoImageToModel: false,
  ...patch,
} as GenerationCapabilities);

const fakeController = (overrides: Partial<BackendSession> = {}): BackendSession => ({
  createGenerationJob: vi.fn().mockResolvedValue({ id: 'job-1', prompt: '椅子' }),
  uploadGenerationReference: vi.fn().mockResolvedValue({ id: 'ref-1' }),
  ...overrides,
} as unknown as BackendSession);

describe('模型生成规则', () => {
  it('计量文字/图片优先 Aholo Lux3D，没配再回 HY-3D', () => {
    const onlyAholo = caps({ aholoTextToModel: true });
    const both = caps({ textToModel: true, imageToModel: true, aholoTextToModel: true, aholoImageToModel: true });
    expect(engineSupports(onlyAholo, 'hy3d', 'text')).toBe(false);
    expect(modeSupports(onlyAholo, 'text')).toBe(true);
    expect(pickEngine(onlyAholo, 'text')).toBe('aholo');
    expect(pickEngine(both, 'text')).toBe('aholo');
    expect(pickEngine(both, 'image')).toBe('aholo');
    expect(pickEngine(caps({ textToModel: true }), 'text')).toBe('hy3d');
    expect(pickEngine(caps({ imageToModel: true, aholoTextToModel: true }), 'image')).toBe('hy3d');
    expect(engineLabel('aholo')).toBe('Aholo Lux3D');
  });

  it('HY-3D 不带 provider，Aholo 显式声明', () => {
    expect(providerFor('hy3d')).toEqual({});
    expect(providerFor('aholo')).toEqual({ provider: 'aholo' });
  });

  it('提交时按方式带参考图 id，并透传引擎口径', async () => {
    const controller = fakeController();
    await submitModelJob(controller, { mode: 'image', prompt: '  按照片做同款  ', engine: 'aholo', referenceImageAssetId: 'ref-9' });
    expect(controller.createGenerationJob).toHaveBeenCalledTimes(1);
    const [, , options] = (controller.createGenerationJob as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(options).toEqual({ kind: 'image', referenceImageAssetId: 'ref-9', provider: 'aholo' });

    await submitModelJob(controller, { mode: 'text', prompt: '折叠椅', engine: 'hy3d' });
    const [, , textOptions] = (controller.createGenerationJob as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]!;
    expect(textOptions).toEqual({ kind: 'text' });
  });

  it('参考图上传回原名，并带回归一化说明', async () => {
    const controller = fakeController();
    const uploaded = await uploadModelReference(controller, new File(['x'], '椅子.png', { type: 'image/png' }));
    // notice 是新增的：照片被 HEIC 转换 / 缩尺寸 / 压体积时要告诉用户改了什么。
    expect(uploaded).toEqual({ id: 'ref-1', name: '椅子.png', notice: '' });
  });

  it('回执的 requestId 由面板传入；缺省仍生成合法 UUID', async () => {
    const controller = fakeController();
    await submitModelJob(controller, { mode: 'text', prompt: '椅子', engine: 'hy3d', requestId: '11111111-1111-4111-8111-111111111111' });
    const calls = (controller.createGenerationJob as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0]![1]).toBe('11111111-1111-4111-8111-111111111111');
    await submitModelJob(controller, { mode: 'text', prompt: '椅子', engine: 'hy3d' });
    expect(calls[1]![1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('只有服务端明确拒绝才算 failed；断网/超时/5xx/坏响应都算 unknown', () => {
    expect(generationFailureDisposition(new SceneApiError('BUDGET_EXCEEDED', 402, null))).toBe('failed');
    expect(generationFailureDisposition(new SceneApiError('UNAUTHENTICATED', 401, null))).toBe('failed');
    expect(generationFailureDisposition(new SceneApiError('INVALID_RESPONSE', 502, null))).toBe('unknown');
    expect(generationFailureDisposition(new SceneApiError('HTTP_ERROR', 503, null))).toBe('unknown');
    expect(generationFailureDisposition(new TypeError('Failed to fetch'))).toBe('unknown');
    expect(generationFailureDisposition(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe('unknown');
    expect(UNKNOWN_SUBMISSION_NOTICE).toContain('先查任务记录与费用');
    expect(UNKNOWN_SUBMISSION_NOTICE).toContain('不重试');
  });

  it('网络失败不把原文甩给用户', () => {
    expect(plainFailure(new Error('Failed to fetch'))).toContain('连不上云端');
    expect(plainFailure(new Error('额度不足'))).toContain('额度不足');
  });

  it('不能提交时按登录/能力/编辑权顺序给出原因', () => {
    const base = { signedIn: true, capabilityState: 'ready' as const, anyConfigured: true, disabled: false, writeBlocked: false };
    expect(generationBlockReason({ ...base, signedIn: false })).toContain('登录云项目');
    expect(generationBlockReason({ ...base, capabilityState: 'loading' })).toContain('正在读取');
    expect(generationBlockReason({ ...base, capabilityState: 'failed' })).toContain('连不上云端');
    expect(generationBlockReason({ ...base, anyConfigured: false })).toContain('尚未连接服务商');
    expect(generationBlockReason(base)).toBe('');
  });

  it('槽位满时用同源的那一句，并说清是这个账号的并发上限', () => {
    const base = { signedIn: true, capabilityState: 'ready' as const, anyConfigured: true, disabled: false, writeBlocked: false };
    // 与资产接口同源：两个入口不能各说各的。
    expect(generationBlockReason({ ...base, busy: true })).toBe(GENERATION_BUSY_NOTICE);
    expect(generationBlockReason({ ...base, busy: true })).toBe(assetError(new SceneApiError('GENERATION_BUSY', 429, null)));
    expect(GENERATION_BUSY_NOTICE).toContain('3 个生成任务');
    expect(isGenerationBusy(new SceneApiError('GENERATION_BUSY', 429, null))).toBe(true);
    expect(isGenerationBusy(new SceneApiError('BUDGET_EXCEEDED', 402, null))).toBe(false);
    expect(isGenerationBusy(new Error('别的错'))).toBe(false);
  });
});
