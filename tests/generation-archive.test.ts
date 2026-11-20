import { describe, expect, it, vi } from 'vitest';
import { processGeneration } from '../supabase/functions/_shared/worker.ts';
import { packGltf } from '../supabase/functions/_shared/models.ts';
import type { Backend, Rpc } from '../supabase/functions/_shared/backend.ts';
import type { Env, Fetcher } from '../supabase/functions/_shared/http.ts';
import { tetrahedron } from './model-fixture.ts';

/**
 * 归档只关心「供应商给了什么、库里落了什么」，不需要真数据库。
 * 这里用内存 backend 守住三件事：入库名不是整段提示词；完整提示词仍留在 metadata；
 * 供应商预览图会被存下来。
 */
const owner = '10000000-0000-4000-8000-000000000009';
const prompt = '户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米，展开尺寸约 45×50×88 厘米';

const env: Env = key => ({
  HUNYUAN_API_KEY: 'test',
  HUNYUAN_API_MODE: 'tokenhub',
  HUNYUAN_TERMS_URL: 'https://example.test/terms',
  HUNYUAN_TERMS_REVIEWED_AT: '2026-10-03',
})[key];

const glb = () => new Uint8Array(packGltf(tetrahedron().json, tetrahedron().resources));
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    owner_id: owner,
    worker_token: 'worker-token',
    provider_mode: 'tokenhub',
    provider_model: 'hy-3d-3.0',
    provider_job_id: 'vendor-1',
    state: 'processing',
    kind: 'text',
    prompt,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const uploads: { path: string; mime: string; bytes: Uint8Array }[] = [];
  const completions: { id: string; asset: Record<string, unknown> }[] = [];
  const calls: string[] = [];
  const jobs: Rpc = async (_actor, action, data = {}) => {
    calls.push(action);
    if (action === 'jobs.claim') return job(overrides);
    if (action === 'jobs.complete') {
      completions.push(data as { id: string; asset: Record<string, unknown> });
      return null;
    }
    return null;
  };
  const backend: Backend = {
    user: async () => owner,
    scene: async () => null,
    cloud: async () => null,
    jobs,
    reconstruction: async () => null,
    upload: async (path, bytes, mime) => { uploads.push({ path, mime, bytes }); },
    sign: async path => `https://storage.test/${path}`,
  };
  return { uploads, completions, calls, backend };
}

function network(preview = 'https://assets.myqcloud.com/prop.png'): Fetcher {
  return vi.fn(async (input: string | URL | Request) => {
    const href = String(input);
    if (href.endsWith('/query')) {
      return json({
        status: 'completed',
        data: [{ type: 'glb', url: 'https://assets.myqcloud.com/prop.glb', preview_image_url: preview }],
      });
    }
    if (href === 'https://assets.myqcloud.com/prop.glb') return new Response(glb());
    if (href === preview) return new Response(png());
    throw new Error(`unexpected ${href}`);
  }) as unknown as Fetcher;
}

describe('generation archive: name and preview', () => {
  it('stores a short object name and archives the provider preview image', async () => {
    const h = harness();
    await processGeneration(h.backend, env, network());
    expect(h.completions).toHaveLength(1);
    const asset = h.completions[0]!.asset;
    expect(asset.name).toBe('户外折叠椅');
    expect(asset.metadata).toMatchObject({
      originalPrompt: prompt,
      previewPath: `${owner}/${job().id}/preview.png`,
    });
    expect(h.uploads.map(item => item.mime)).toEqual(['image/png', 'model/gltf-binary']);
    expect(h.uploads[0]!.path).toBe(`${owner}/${job().id}/preview.png`);
  });

  it('keeps the model when the preview URL is not a real image', async () => {
    const h = harness();
    const bad = vi.fn(async (input: string | URL | Request) => {
      const href = String(input);
      if (href.endsWith('/query')) {
        return json({
          status: 'completed',
          data: [{ type: 'glb', url: 'https://assets.myqcloud.com/prop.glb', preview_image_url: 'https://assets.myqcloud.com/error.png' }],
        });
      }
      if (href === 'https://assets.myqcloud.com/prop.glb') return new Response(glb());
      return new Response('<html>not an image</html>');
    }) as unknown as Fetcher;
    await processGeneration(h.backend, env, bad);
    expect(h.completions[0]!.asset.metadata).not.toHaveProperty('previewPath');
    expect(h.uploads.map(item => item.mime)).toEqual(['model/gltf-binary']);
  });

  it('keeps the model when the preview download fails', async () => {
    const h = harness();
    const failing = vi.fn(async (input: string | URL | Request) => {
      const href = String(input);
      if (href.endsWith('/query')) {
        return json({
          status: 'completed',
          data: [{ type: 'glb', url: 'https://assets.myqcloud.com/prop.glb', preview_image_url: 'https://assets.myqcloud.com/prop.png' }],
        });
      }
      if (href === 'https://assets.myqcloud.com/prop.png') throw new Error('preview timeout');
      return new Response(glb());
    }) as unknown as Fetcher;
    await processGeneration(h.backend, env, failing);
    expect(h.completions).toHaveLength(1);
    expect(h.uploads).toHaveLength(1);
    expect(h.calls).toContain('jobs.archive_start');
  });
});
