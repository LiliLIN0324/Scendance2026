// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGeneratedFacilityModelsForTests,
  consumeFacilityGenerateLink,
  findGeneratedFacilityModel,
  listFacilityGenerateLinks,
  listGeneratedFacilityModels,
  recordFacilityGenerateLink,
  registerGeneratedFacilityModel,
  resolveFacilityGenerateLink,
  type GeneratedFacilityModel,
} from './facility-generated-models';
import { loadAholoCatalogItem } from './aholo-model-placement';

// resolve 的落盘段动态引这两个模块：loadAholoCatalogItem 背后是 three/glb-assets +
// 本机代理网络，测试里 mock 成纯数据；fetchLux3dTask/glbOutputOf 走真的（吃 fetchImpl 替身）。
vi.mock('./aholo-model-placement', () => ({
  loadAholoCatalogItem: vi.fn(),
}));

function model(overrides: Partial<GeneratedFacilityModel> = {}): GeneratedFacilityModel {
  return {
    slug: 'generated:4475964',
    name: '舞台',
    glbUrl: 'http://127.0.0.1:3199/asset/abc123.glb',
    width: 6,
    depth: 4,
    height: 3,
    facilityId: 'facility-1',
    facilityName: '主舞台',
    createdAt: Date.now(),
    ...overrides,
  };
}

function taskResponse(status: number, outputs: string[] = [], progress?: number): Response {
  return new Response(JSON.stringify({ status, outputs, ...(progress !== undefined ? { progress } : {}) }), { status: 200 });
}

const SIGNED_GLB = 'https://cos.example.com/lux3d/outputs/4475964/model.glb?sign=1';

function seedLink(taskid = '4475964'): void {
  recordFacilityGenerateLink({ facilityId: 'facility-1', facilityName: '主舞台' });
  expect(consumeFacilityGenerateLink(taskid, '舞台')).toBe(true);
}

beforeEach(() => {
  clearGeneratedFacilityModelsForTests();
  vi.mocked(loadAholoCatalogItem).mockReset();
});

describe('生成模型注册表（V-5b/c 候选回填）', () => {
  it('注册后按设施列出、按 slug 命中；未注册的 slug 返 null', () => {
    registerGeneratedFacilityModel(model());
    registerGeneratedFacilityModel(model({ slug: 'generated:88', facilityId: 'facility-2', facilityName: '入口' }));
    expect(listGeneratedFacilityModels('facility-1').map(item => item.slug)).toEqual(['generated:4475964']);
    expect(findGeneratedFacilityModel('generated:4475964')?.facilityName).toBe('主舞台');
    expect(findGeneratedFacilityModel('event-tent-05m')).toBeNull();
  });

  it('同 slug 重注册就地替换不重复', () => {
    registerGeneratedFacilityModel(model());
    registerGeneratedFacilityModel(model({ name: '舞台（重测）' }));
    expect(listGeneratedFacilityModels('facility-1')).toHaveLength(1);
    expect(findGeneratedFacilityModel('generated:4475964')?.name).toBe('舞台（重测）');
  });

  it('sessionOnly 候选会话内可用但不写盘', () => {
    registerGeneratedFacilityModel(model({ slug: 'generated:local-glb:x', glbUrl: 'local-glb:x', sessionOnly: true }));
    expect(findGeneratedFacilityModel('generated:local-glb:x')).not.toBeNull();
    expect(localStorage.getItem('scendance:facility-generated-models')).toBe('[]');
  });

  it('超出上限丢最旧的', () => {
    for (let index = 0; index < 22; index += 1) {
      registerGeneratedFacilityModel(model({ slug: `generated:${index}`, createdAt: Date.now() + index }));
    }
    const all = listGeneratedFacilityModels();
    expect(all).toHaveLength(20);
    expect(findGeneratedFacilityModel('generated:0')).toBeNull();
    expect(findGeneratedFacilityModel('generated:21')).not.toBeNull();
  });

  it('持久化 roundtrip：http 候选写盘，重载模块后还在（sessionOnly 仍被丢掉）', async () => {
    registerGeneratedFacilityModel(model());
    registerGeneratedFacilityModel(model({ slug: 'generated:local-glb:y', glbUrl: 'local-glb:y', sessionOnly: true }));
    expect(localStorage.getItem('scendance:facility-generated-models')).toContain('generated:4475964');
    vi.resetModules();
    const fresh = await import('./facility-generated-models');
    expect(fresh.listGeneratedFacilityModels('facility-1').map(item => item.slug)).toEqual(['generated:4475964']);
    expect(fresh.findGeneratedFacilityModel('generated:local-glb:y')).toBeNull();
  });
});

describe('staged 链接（生成框消费）', () => {
  it('record → consume 落成 taskid↔facility 链接；二次 consume 返 false', () => {
    seedLink();
    const links = listFacilityGenerateLinks('facility-1');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ taskid: '4475964', facilityId: 'facility-1', facilityName: '主舞台', name: '舞台' });
    expect(consumeFacilityGenerateLink('other', 'x')).toBe(false);
    expect(listFacilityGenerateLinks()).toHaveLength(1);
  });

  it('物料库自己发起的生成没有 staged 链接，不落链接', () => {
    expect(consumeFacilityGenerateLink('4475964', '舞台')).toBe(false);
    expect(listFacilityGenerateLinks()).toHaveLength(0);
  });

  it('过期（>10 分钟）不挂到旧设施上', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
      recordFacilityGenerateLink({ facilityId: 'facility-1', facilityName: '主舞台' });
      vi.setSystemTime(new Date('2026-11-13T10:11:00Z'));
      expect(consumeFacilityGenerateLink('4475964', '舞台')).toBe(false);
      expect(listFacilityGenerateLinks()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('空 facilityId 不记 staged；空 taskid 不落链接', () => {
    recordFacilityGenerateLink({ facilityId: '   ', facilityName: '主舞台' });
    expect(consumeFacilityGenerateLink('4475964', '舞台')).toBe(false);
    recordFacilityGenerateLink({ facilityId: 'facility-1', facilityName: '主舞台' });
    expect(consumeFacilityGenerateLink('', '舞台')).toBe(false);
    expect(listFacilityGenerateLinks()).toHaveLength(0);
  });
});

describe('resolveFacilityGenerateLink（轮询取件）', () => {
  it('没有链接的 taskid 直接 failed', async () => {
    const result = await resolveFacilityGenerateLink('4475964');
    expect(result).toEqual({ state: 'failed', message: '这条生成任务已失效，请重新生成。' });
  });

  it('排队/生成中返回可读进度，链接保留', async () => {
    seedLink();
    const fetchImpl = vi.fn(async () => taskResponse(1, [], 62));
    const result = await resolveFacilityGenerateLink('4475964', { fetchImpl });
    expect(result).toMatchObject({ state: 'pending' });
    expect(result.state === 'pending' && result.message).toContain('62%');
    expect(listFacilityGenerateLinks('facility-1')).toHaveLength(1);
  });

  it('网络抖动按可重试 pending 处理，链接保留', async () => {
    seedLink();
    const fetchImpl = vi.fn(async () => { throw new TypeError('failed to fetch'); });
    const result = await resolveFacilityGenerateLink('4475964', { fetchImpl });
    expect(result.state).toBe('pending');
    expect(listFacilityGenerateLinks('facility-1')).toHaveLength(1);
  });

  it('生成失败（status 4）删链接并报原因', async () => {
    seedLink();
    const fetchImpl = vi.fn(async () => taskResponse(4));
    const result = await resolveFacilityGenerateLink('4475964', { fetchImpl });
    expect(result).toMatchObject({ state: 'failed' });
    expect(result.state === 'failed' && result.message).toContain('生成失败');
    expect(listFacilityGenerateLinks()).toHaveLength(0);
  });

  it('完成但没有 GLB 产物：删链接报「产物里没有 GLB」', async () => {
    seedLink();
    const fetchImpl = vi.fn(async () => taskResponse(3, ['https://cos.example.com/preview.png']));
    const result = await resolveFacilityGenerateLink('4475964', { fetchImpl });
    expect(result.state === 'failed' && result.message).toContain('没有 GLB');
    expect(listFacilityGenerateLinks()).toHaveLength(0);
  });

  it('完成且带 GLB：落盘入库、注册 generated:<taskid> 候选、删链接', async () => {
    seedLink();
    vi.mocked(loadAholoCatalogItem).mockResolvedValueOnce({
      type: 'glb-asset', name: '舞台', glbUrl: 'http://127.0.0.1:3199/asset/xyz789.glb',
      width: 6, depth: 4, height: 3, color: '#ffffff', icon: '◇', price: 0, category: 'decor', notes: '',
    });
    const fetchImpl = vi.fn(async () => taskResponse(3, [SIGNED_GLB]));
    const result = await resolveFacilityGenerateLink('4475964', { fetchImpl });
    expect(result.state).toBe('imported');
    expect(loadAholoCatalogItem).toHaveBeenCalledWith({ url: SIGNED_GLB, name: '舞台', taskid: '4475964' });
    const registered = findGeneratedFacilityModel('generated:4475964');
    expect(registered).toMatchObject({
      name: '舞台',
      glbUrl: 'http://127.0.0.1:3199/asset/xyz789.glb',
      facilityId: 'facility-1',
      facilityName: '主舞台',
    });
    expect(listFacilityGenerateLinks()).toHaveLength(0);
  });

  it('落盘时代理暂时连不上：pending 保留链接下一轮再试', async () => {
    seedLink();
    vi.mocked(loadAholoCatalogItem).mockRejectedValueOnce(new Error('代理暂时连不上（HTTP 502），请稍后重试。'));
    const fetchImpl = vi.fn(async () => taskResponse(3, [SIGNED_GLB]));
    const result = await resolveFacilityGenerateLink('4475964', { fetchImpl });
    expect(result.state).toBe('pending');
    expect(listFacilityGenerateLinks('facility-1')).toHaveLength(1);
  });

  it('模型本身坏掉：failed 删链接，不留死链', async () => {
    seedLink();
    vi.mocked(loadAholoCatalogItem).mockRejectedValueOnce(new Error('模型没有量出尺寸，请重新落盘。'));
    const fetchImpl = vi.fn(async () => taskResponse(3, [SIGNED_GLB]));
    const result = await resolveFacilityGenerateLink('4475964', { fetchImpl });
    expect(result.state).toBe('failed');
    expect(listFacilityGenerateLinks()).toHaveLength(0);
  });
});
