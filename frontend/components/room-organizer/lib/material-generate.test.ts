import { describe, expect, it, vi } from 'vitest';
import { DIRECT_BASE } from './aholo-assets';
import { submitMaterialGenerate } from './material-generate';

describe('submitMaterialGenerate', () => {
  it('does not call the network when the local proxy is off', async () => {
    const fetchImpl = vi.fn();
    const text = await submitMaterialGenerate({ kind: 'text', prompt: '一把沙滩折叠椅' }, { localProxy: false, fetchImpl });
    const image = await submitMaterialGenerate({ kind: 'image', imageDataUrl: 'data:image/png;base64,a' }, { localProxy: false, fetchImpl });
    expect(text).toMatchObject({ ok: false, stub: true });
    expect(image).toMatchObject({ ok: false, stub: true });
    expect(String((text as { message: string }).message)).toContain('/text-to-3d');
    expect(String((image as { message: string }).message)).toContain('/image-to-3d');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts a description to the existing text-to-3d path', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ taskid: '4475964' }), { status: 200 }));
    const result = await submitMaterialGenerate({ kind: 'text', prompt: '一把椅子' }, { localProxy: true, fetchImpl });
    expect(result).toEqual({ ok: true, taskid: '4475964', kind: 'text' });
    expect(fetchImpl).toHaveBeenCalledWith(`${DIRECT_BASE}/text-to-3d`, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ prompt: '一把椅子' });
  });

  it('posts a picture to the existing image-to-3d path', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ taskid: '88' }), { status: 200 }));
    const result = await submitMaterialGenerate({ kind: 'image', imageDataUrl: 'data:image/jpeg;base64,abc' }, { localProxy: true, fetchImpl });
    expect(result).toEqual({ ok: true, taskid: '88', kind: 'image' });
    expect(fetchImpl).toHaveBeenCalledWith(`${DIRECT_BASE}/image-to-3d`, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ img: 'data:image/jpeg;base64,abc' });
  });
});
