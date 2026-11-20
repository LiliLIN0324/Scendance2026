/// <reference path="../../supabase/functions/_shared/vendor.d.ts" />
/**
 * 国内案例云端种子（C08）：
 * - 默认（未设 CLOUD_SEED_REMOTE=1）：只做 payload 纯校验，不发任何网络请求。
 * - CLOUD_SEED_REMOTE=1 时对**已部署后端**执行真实迁入：需要平台管理员账号
 *   （CLOUD_SEED_EMAIL / CLOUD_SEED_PASSWORD）、官方工作区已配置、审核 SQL 已应用。
 *   幂等：同 stableId 已存在（草稿或已发布）即跳过；重复执行不重复迁入。
 * 凭据只从环境变量/.env.local 读取，不写进代码、不打印任何 token。
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createSceneClient, SceneApiError } from '../../client/scene-client';
import { cnCaseSeedPayloads, needsSeeding } from '../components/room-organizer/lib/cloud-case-seed';

const REMOTE = process.env.CLOUD_SEED_REMOTE === '1';

function envOf(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  for (const path of ['.env.local', '../.env.local']) {
    if (!existsSync(path)) continue;
    try {
      const parsed = parseEnv(readFileSync(path, 'utf8'));
      if (parsed[name]) return parsed[name];
    } catch { /* 读不到就继续找下一个 */ }
  }
  return undefined;
}

const SEED_MINIMAL_SCENE = {
  schemaVersion: 1 as const,
  venue: { shape: 'rectangle' as const, width: 12, depth: 10, height: 3, entrances: [] },
  objects: [],
  camera: 'overview' as const,
  lighting: 'neutral' as const,
};

describe('CN case cloud seed payloads (C08)', () => {
  const payloads = cnCaseSeedPayloads();

  it('builds one payload per official-site CN case, with valid plans and provenance', () => {
    expect(payloads.length).toBeGreaterThan(0);
    const ids = new Set(payloads.map(payload => payload.stableId));
    expect(ids.size).toBe(payloads.length);
    for (const payload of payloads) {
      expect(payload.stableId).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
      expect(payload.stableId.startsWith('cn-')).toBe(true);
      expect(payload.title.trim().length).toBeGreaterThan(0);
      expect(payload.category.trim().length).toBeGreaterThan(0);
      expect(payload.provenance.length).toBeGreaterThan(0);
      expect(payload.provenance.length).toBeLessThanOrEqual(4000);
      expect(payload.plan.boundary.length).toBeGreaterThan(0);
    }
  });

  it('reports idempotency per case from known drafts/published rows', () => {
    const first = payloads[0]!;
    expect(needsSeeding(first, {})).toBe(true);
    expect(needsSeeding(first, { drafts: [{ id: first.stableId }] })).toBe(false);
    expect(needsSeeding(first, { drafts: [{ id: crypto.randomUUID(), stableId: first.stableId }] })).toBe(false);
    expect(needsSeeding(first, { published: [{ id: first.stableId }] })).toBe(false);
    expect(needsSeeding(first, { drafts: [{ id: 'other-case' }] })).toBe(true);
  });

  describe.skipIf(!REMOTE)('against a deployed backend (CLOUD_SEED_REMOTE=1)', () => {
    const url = envOf('CLOUD_SEED_URL') ?? envOf('SUPABASE_URL')?.replace(/\/$/, '');
    const anonKey = envOf('CLOUD_SEED_ANON_KEY') ?? envOf('SUPABASE_PUBLISHABLE_KEY');
    const email = envOf('CLOUD_SEED_EMAIL');
    const password = envOf('CLOUD_SEED_PASSWORD');
    const origin = (envOf('ALLOWED_ORIGINS') ?? envOf('PUBLIC_APP_URL') ?? '').split(',')[0]?.trim();
    const released: Array<{ projectId: string; body: { sessionId: string; generation: number } }> = [];
    let accessToken: string | null = null;

    afterAll(async () => {
      if (!REMOTE || !url || !anonKey || !accessToken) return;
      for (const lease of released) {
        try {
          await fetch(`${url}/functions/v1/scene-api/projects/${lease.projectId}/lease/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin!, Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify(lease.body),
          });
        } catch { /* 租约最长 90 秒后自动过期，不影响线上状态 */ }
      }
    });

    it('seeds and publishes official-site CN cases idempotently', async () => {
      if (!url || !anonKey || !email || !password || !origin) throw new Error('缺少 CLOUD_SEED_URL/ANON_KEY/EMAIL/PASSWORD 或 ALLOWED_ORIGINS 配置');
      const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await auth.auth.signInWithPassword({ email, password });
      expect(error).toBeNull();
      const token = data.session!.access_token;
      accessToken = token;
      const client = createSceneClient(`${url}/functions/v1/scene-api`, async () => token);
      const request = async (path: string, method: 'GET' | 'POST', body?: unknown) => {
        const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, Origin: origin } };
        if (body !== undefined) {
          init.body = JSON.stringify(body);
          (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
        }
        const response = await fetch(`${url}/functions/v1/scene-api${path}`, init);
        const payload = await response.json().catch(() => null);
        return { status: response.status, payload: payload as Record<string, unknown> | null };
      };

      const capabilities = await client.getCloudCapabilities();
      expect(capabilities.superAdmin).toBe(true);
      const officialStudioId = capabilities.officialStudioId;
      expect(officialStudioId).toBeTruthy();

      const drafts = await client.listCloudCaseDrafts();
      const published = await client.listCloudCases();
      const summary: Array<{ stableId: string; action: 'skipped' | 'published' }> = [];
      for (const payload of cnCaseSeedPayloads()) {
        if (!needsSeeding(payload, { drafts, published })) {
          summary.push({ stableId: payload.stableId, action: 'skipped' });
          continue;
        }
        const created = await request('/projects', 'POST', { studioId: officialStudioId, name: payload.title, scene: SEED_MINIMAL_SCENE });
        expect(created.status).toBe(201);
        const projectId = String(created.payload!.id);
        const lease = await request(`/projects/${projectId}/lease/acquire`, 'POST', { sessionId: crypto.randomUUID() });
        expect(lease.status).toBe(200);
        const generation = Number((lease.payload as { generation: number }).generation);
        released.push({ projectId, body: { sessionId: String((lease.payload as { sessionId: string }).sessionId), generation } });
        await client.saveCompleteProject(projectId, {
          requestId: crypto.randomUUID(),
          sessionId: String((lease.payload as { sessionId: string }).sessionId),
          generation,
          expectedRevision: 0,
          manifest: {
            version: 1,
            scene: SEED_MINIMAL_SCENE,
            outdoor: payload.plan as unknown as Record<string, unknown>,
            sources: {},
            dependencies: [],
          },
        });
        const draft = await client.upsertCloudCase(payload.stableId, {
          requestId: crypto.randomUUID(),
          expectedVersion: 0,
          title: payload.title,
          description: payload.description,
          category: payload.category,
          coverAssetId: null,
          sortOrder: payload.sortOrder,
          projectId,
          provenance: payload.provenance,
        });
        expect(draft.stableId).toBe(payload.stableId);
        const publishedCase = await client.publishCloudCase(payload.stableId, { requestId: crypto.randomUUID(), expectedVersion: 0, expectedRevision: 0 });
        expect(publishedCase.status).toBe('published');
        const read = await client.readCloudCase(payload.stableId);
        expect(read.manifest.outdoor).toBeTruthy();
        expect(Object.hasOwn(read.manifest, 'sources')).toBe(false);
        summary.push({ stableId: payload.stableId, action: 'published' });
      }
      // 汇总只留稳定 ID 与动作，不打印任何凭据。
      console.log('[cloud-case-seed]', JSON.stringify(summary));
      expect(summary.length).toBe(cnCaseSeedPayloads().length);
    }, 120_000);

    it.skipIf(!envOf('CLOUD_SEED_NON_ADMIN_EMAIL'))('refuses to run without platform admin rights instead of faking success', async () => {
      if (!url || !anonKey || !origin) throw new Error('缺少远程配置');
      const unprivileged = createSceneClient(`${url}/functions/v1/scene-api`, async () => {
        const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: envOf('CLOUD_SEED_NON_ADMIN_EMAIL')!, password: envOf('CLOUD_SEED_NON_ADMIN_PASSWORD')! }),
        }).then(response => response.json() as Promise<{ access_token?: string }>);
        return auth.access_token ?? '';
      });
      await expect(unprivileged.listCloudCaseDrafts()).rejects.toSatisfy((error: unknown) =>
        error instanceof SceneApiError && [401, 403].includes(error.status));
    }, 60_000);
  });
});
