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

  it('直连请求抛出网络错误时视为结果未知，绝不自动转云端', async () => {
    const cloud = cloudLane();
    const fetchImpl = vi.fn(async () => { throw new TypeError('private network detail'); });
    const result = await submitMaterialGenerate({ kind: 'text', prompt: '金属台' }, { localProxy: true, fetchImpl, cloud: cloud.lane });
    expect(result).toMatchObject({ ok: false, stub: false, outcome:'unknown' });
    expect(!result.ok && result.message).toMatch(/结果暂时无法确认.*可能已创建任务或产生费用/);
    expect(!result.ok && result.message).not.toContain('private network detail');
    expect(fetchImpl).toHaveBeenCalledOnce();expect(cloud.jobs).toHaveLength(0);expect(cloud.uploads).toHaveLength(0);
  });

  it.each([
    ['响应丢失任务号',()=>new Response(JSON.stringify({}),{status:200})],
    ['响应不是 JSON',()=>new Response('bad json',{status:200})],
    ['上游 500',()=>new Response(JSON.stringify({error:'private failure'}),{status:500})],
    ['上游 400',()=>new Response(JSON.stringify({error:'rejected'}),{status:400})],
  ])('直连%s时不自动提交云端，保留不确定提示',async(_name,response)=>{
    const cloud=cloudLane();const fetchImpl=vi.fn(async()=>response());
    const result=await submitMaterialGenerate({kind:'text',prompt:'金属台'},{localProxy:true,fetchImpl,cloud:cloud.lane});
    expect(result).toMatchObject({ok:false,outcome:'unknown'});expect(!result.ok&&result.message).toContain('先查看生成任务记录');
    expect(cloud.jobs).toHaveLength(0);expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('图片直连响应丢失时不上传参考图或创建第二个云端任务',async()=>{
    const cloud=cloudLane();const fetchImpl=vi.fn(async()=>{throw Error('connection lost after dispatch');});
    const result=await submitMaterialGenerate({kind:'image',imageDataUrl:PNG},{localProxy:true,fetchImpl,cloud:cloud.lane});
    expect(result).toMatchObject({ok:false,outcome:'unknown'});expect(cloud.uploads).toHaveLength(0);expect(cloud.jobs).toHaveLength(0);
  });

  it('云端生成请求断线时不冒称未提交，也不暴露错误内容',async()=>{
    const cloud=cloudLane({createJob:async()=>{throw Error('private request details');}});
    const result=await submitMaterialGenerate({kind:'text',prompt:'金属台'},{localProxy:false,cloud:cloud.lane});
    expect(result).toMatchObject({ok:false,outcome:'unknown'});expect(!result.ok&&result.message).toMatch(/结果暂时无法确认.*可能已创建任务或产生费用/);
    expect(!result.ok&&result.message).not.toContain('private request details');
  });

  it('云端缺凭证时说清缺哪个变量', async () => {
    const cloud = cloudLane({ createJob: async () => { throw new Error('SERVICE_NOT_CONFIGURED'); } });
    const result = await submitMaterialGenerate({ kind: 'text', prompt: '金属台' }, { localProxy: false, cloud: cloud.lane });
    expect(result).toMatchObject({ ok: false, stub: false });
    expect(String((result as { message: string }).message)).toContain('LUX3D_API_KEY');
  });
});
