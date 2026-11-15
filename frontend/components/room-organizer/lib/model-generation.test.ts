import { describe, expect, it, vi } from 'vitest';
import {
  engineLabel,
  engineSupports,
  generationBlockReason,
  modeSupports,
  pickEngine,
  plainFailure,
  providerFor,
  submitModelJob,
  uploadModelReference,
} from './model-generation';
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
  it('引擎能力按方式判断；HY-3D 优先，未开通时自动落到 Aholo', () => {
    const onlyAholo = caps({ aholoTextToModel: true });
    expect(engineSupports(onlyAholo, 'hy3d', 'text')).toBe(false);
    expect(modeSupports(onlyAholo, 'text')).toBe(true);
    expect(pickEngine(onlyAholo, 'text')).toBe('aholo');
    expect(pickEngine(caps({ textToModel: true }), 'text')).toBe('hy3d');
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

  it('参考图上传回原名', async () => {
    const controller = fakeController();
    const uploaded = await uploadModelReference(controller, new File(['x'], '椅子.png', { type: 'image/png' }));
    expect(uploaded).toEqual({ id: 'ref-1', name: '椅子.png' });
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
});
