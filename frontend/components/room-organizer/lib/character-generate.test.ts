import { describe, expect, it, vi } from 'vitest';
import { DIRECT_BASE } from './aholo-assets';
import {
  imageOutputOf,
  modelOutputOf,
  submitCharacterFourView,
  submitCharacterReference,
  submitCharacterRetarget,
  submitCharacterRig,
} from './character-generate';

const PNG = 'data:image/png;base64,aGVsbG8=';
const MODEL = 'https://cdn.example.test/char.glb?signature=abc';

function okResponse(): Response {
  return new Response(JSON.stringify({ taskid: '4475964' }), { status: 200 });
}

describe('人物设计链服务层', () => {
  it('没有直连通道时停在可读提示上，不发起请求', async () => {
    const fetchImpl = vi.fn();
    const result = await submitCharacterReference('古风女子', { localProxy: false, fetchImpl });
    expect(result).toMatchObject({ ok: false, stub: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('参考图提交到 /ref-image，描述去空格后透传', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const result = await submitCharacterReference(' 古风女子，A 字站姿 ', { localProxy: true, fetchImpl });
    expect(result).toEqual({ ok: true, taskid: '4475964', lane: 'direct' });
    expect(fetchImpl).toHaveBeenCalledWith(`${DIRECT_BASE}/ref-image`, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ prompt: '古风女子，A 字站姿' });
  });

  it('四视图提交到 /four-view，带与不带补充描述两种形态', async () => {
    const withPrompt = vi.fn(async () => okResponse());
    const a = await submitCharacterFourView(PNG, ' 保持服装一致 ', { localProxy: true, fetchImpl: withPrompt });
    expect(a).toMatchObject({ ok: true });
    expect(JSON.parse(String((withPrompt.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      img: PNG, prompt: '保持服装一致',
    });

    const noPrompt = vi.fn(async () => okResponse());
    const b = await submitCharacterFourView(PNG, undefined, { localProxy: true, fetchImpl: noPrompt });
    expect(b).toMatchObject({ ok: true });
    expect(JSON.parse(String((noPrompt.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ img: PNG });
  });

  it('绑骨提交到 /rig，模型地址原样透传', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const result = await submitCharacterRig(MODEL, { localProxy: true, fetchImpl });
    expect(result).toMatchObject({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(`${DIRECT_BASE}/rig`, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ modelUrl: MODEL });
  });

  it('重定向提交到 /retarget，带骨地址与动作清单透传', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const result = await submitCharacterRetarget(MODEL, ['Idle_Loop', 'Walk_Loop'], { localProxy: true, fetchImpl });
    expect(result).toMatchObject({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(`${DIRECT_BASE}/retarget`, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ rigModelUrl: MODEL, animationIds: ['Idle_Loop', 'Walk_Loop'] });
  });

  it.each([
    ['参考图空描述', () => submitCharacterReference('   ', { localProxy: true, fetchImpl: vi.fn() }), '描述'],
    ['四视图非图片', () => submitCharacterFourView('https://127.0.0.1/x.png', undefined, { localProxy: true, fetchImpl: vi.fn() }), 'PNG 或 JPEG'],
    ['绑骨 http 地址', () => submitCharacterRig('http://cdn.example.test/a.glb', { localProxy: true, fetchImpl: vi.fn() }), 'HTTPS'],
    ['重定向无动作', () => submitCharacterRetarget(MODEL, [], { localProxy: true, fetchImpl: vi.fn() }), '动作'],
    ['重定向动作超 10 条', () => submitCharacterRetarget(MODEL, Array(11).fill('Idle_Loop'), { localProxy: true, fetchImpl: vi.fn() }), '动作'],
    ['重定向动作非字符串', () => submitCharacterRetarget(MODEL, [123] as unknown as string[], { localProxy: true, fetchImpl: vi.fn() }), '动作'],
    ['重定向缺带骨模型', () => submitCharacterRetarget('', ['Idle_Loop'], { localProxy: true, fetchImpl: vi.fn() }), 'HTTPS'],
  ])('%s：本地校验拦截，不触达上游', async (_name, runner, hint) => {
    const fetchImpl = vi.fn();
    const result = await runner();
    expect(result).toMatchObject({ ok: false, stub: false });
    expect(String((result as { message: string }).message)).toContain(hint);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('直连抛网络错误时视为结果未知，不编任务号', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('private network detail'); });
    const result = await submitCharacterReference('女子', { localProxy: true, fetchImpl });
    expect(result).toMatchObject({ ok: false, outcome: 'unknown' });
    expect(String((result as { message: string }).message)).toMatch(/结果暂时无法确认.*可能已创建任务/);
    expect(String((result as { message: string }).message)).not.toContain('private network detail');
  });

  it('上游非 2xx 时保留不确定提示', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'rejected' }), { status: 400 }));
    const result = await submitCharacterRig(MODEL, { localProxy: true, fetchImpl });
    expect(result).toMatchObject({ ok: false, outcome: 'unknown' });
  });

  it('产物挑选：图片给图片地址，模型给 GLB 地址', () => {
    const outputs = [
      'https://cdn.example.test/view.png?signature=abc',
      'https://cdn.example.test/char.glb',
      'https://cdn.example.test/char.zip',
    ];
    expect(imageOutputOf(outputs)).toBe('https://cdn.example.test/view.png?signature=abc');
    expect(modelOutputOf(outputs)).toBe('https://cdn.example.test/char.glb');
    expect(imageOutputOf([])).toBeUndefined();
    expect(modelOutputOf([])).toBeUndefined();
  });
});
