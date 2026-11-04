import { describe, expect, it, vi } from 'vitest';
import { DIRECT_BASE } from './aholo-assets';
import { submitMaterialGenerate } from './material-generate';

const PNG = 'data:image/png;base64,aGVsbG8=';

function cloudLane(overrides: Partial<{ createJob: (p: string, o: unknown) => Promise<{ id: string }>; uploadReference: (f: File) => Promise<{ id: string }> }> = {}) {
  const jobs: { prompt: string; options: unknown }[] = [];
  const uploads: File[] = [];
  return {
    jobs,
    uploads,
    lane: {
      createJob: overrides.createJob ?? (async (prompt: string, options: unknown) => { jobs.push({ prompt, options }); return { id: '7f3c9a5e-job' }; }),
      uploadReference: overrides.uploadReference ?? (async (file: File) => { uploads.push(file); return { id: 'ref-1' }; }),
    },
  };
}

describe('submitMaterialGenerate', () => {
  it('两条通道都没有时停在可读提示上，不静默失败', async () => {
    const fetchImpl = vi.fn();
    const text = await submitMaterialGenerate({ kind: 'text', prompt: '一把沙滩折叠椅' }, { localProxy: false, fetchImpl });
    expect(text).toMatchObject({ ok: false, stub: true });
    expect(String((text as { message: string }).message)).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('直连通道可用时优先走它（本机代理只是加速）', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ taskid: '4475964' }), { status: 200 }));
    const result = await submitMaterialGenerate({ kind: 'text', prompt: '一把椅子' }, { localProxy: true, fetchImpl });
    expect(result).toEqual({ ok: true, taskid: '4475964', kind: 'text', lane: 'direct' });
    expect(fetchImpl).toHaveBeenCalledWith(`${DIRECT_BASE}/text-to-3d`, expect.objectContaining({ method: 'POST' }));
  });

  it('图片走直连时仍是 data URL，不被云端上传逻辑截走', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ taskid: '88' }), { status: 200 }));
    const result = await submitMaterialGenerate({ kind: 'image', imageDataUrl: PNG }, { localProxy: true, fetchImpl });
    expect(result).toEqual({ ok: true, taskid: '88', kind: 'image', lane: 'direct' });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ img: PNG });
  });

  it('生产构建没有直连通道时提交云端任务（文字）', async () => {
    const cloud = cloudLane();
    const result = await submitMaterialGenerate({ kind: 'text', prompt: '一圈暖白灯带' }, { localProxy: false, cloud: cloud.lane });
    expect(result).toEqual({ ok: true, taskid: '7f3c9a5e-job', kind: 'text', lane: 'cloud' });
    expect(cloud.jobs).toEqual([{ prompt: '一圈暖白灯带', options: { kind: 'text' } }]);
  });

  it('生产构建没有直连通道时：先传参考图，再提交图片任务', async () => {
    const cloud = cloudLane();
    const result = await submitMaterialGenerate({ kind: 'image', imageDataUrl: PNG, prompt: '环形装置' }, { localProxy: false, cloud: cloud.lane });
    expect(result).toEqual({ ok: true, taskid: '7f3c9a5e-job', kind: 'image', lane: 'cloud' });
    expect(cloud.uploads).toHaveLength(1);
    expect(cloud.uploads[0]!.type).toBe('image/png');
    expect(cloud.jobs).toEqual([{ prompt: '环形装置', options: { kind: 'image', referenceImageAssetId: 'ref-1' } }]);
  });

  it('直连通道打不通时自动落到云端队列，不把用户卡在 3199', async () => {
    const cloud = cloudLane();
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const result = await submitMaterialGenerate({ kind: 'text', prompt: '金属台' }, { localProxy: true, fetchImpl, cloud: cloud.lane });
    expect(result).toMatchObject({ ok: true, lane: 'cloud', taskid: '7f3c9a5e-job' });
  });

  it('云端缺凭证时说清缺哪个变量', async () => {
    const cloud = cloudLane({ createJob: async () => { throw new Error('SERVICE_NOT_CONFIGURED'); } });
    const result = await submitMaterialGenerate({ kind: 'text', prompt: '金属台' }, { localProxy: false, cloud: cloud.lane });
    expect(result).toMatchObject({ ok: false, stub: false });
    expect(String((result as { message: string }).message)).toContain('LUX3D_API_KEY');
  });
});
