/// <reference path="../../supabase/functions/_shared/vendor.d.ts" />
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSceneClient } from '../../client/scene-client';
import { assetRecord } from '../../supabase/functions/_shared/assets';
import { packGltf } from '../../supabase/functions/_shared/models';
import { owner, editor, studio, scene, chair } from '../../tests/fixtures';
import { startLocalServer, testAccounts, testPublicKey } from '../../tests/local-server';
import { tetrahedron } from '../../tests/model-fixture';
import { backendSceneToLayout, layoutToBackendScene } from '../components/room-organizer/lib/backend-adapter';
import { INITIAL_LAYOUT } from '../components/room-organizer/lib/initial-layout';
import { parseStoredLayout } from '../components/room-organizer/lib/schema';
import { clearGlbAssetCache, ensureGlbAsset, getGlbAssetState } from '../components/room-organizer/three/glb-assets';
import { BackendSession, getBackendConfig } from './backend-session';

describe('frontend session → HTTP API → migrated PostgreSQL', () => {
  let server: Awaited<ReturnType<typeof startLocalServer>>;
  const controllers: BackendSession[] = [];
  beforeAll(async () => { server = await startLocalServer(); }, 30_000);
  afterEach(() => { for (const c of controllers.splice(0)) c.dispose(); clearGlbAssetCache(); });
  afterAll(async () => { await server?.close(); });
  function controller() {
    const c = new BackendSession(getBackendConfig({ url: server.url, anonKey: testPublicKey }));
    controllers.push(c);
    return c;
  }
  async function login(index = 0) {
    const c = controller(), account = testAccounts[index]!;
    await c.signIn(account.email, account.password);
    return c;
  }
  async function rawClient(index = 0) {
    const account = testAccounts[index]!;
    const auth = await fetch(`${server.url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: testPublicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: account.password }),
    }).then(r => r.json());
    return createSceneClient(`${server.url}/functions/v1/scene-api`, async () => auth.access_token);
  }

  it('round-trips actual editor coordinates, rotation and notes through save and a new login', async () => {
    const a = await login();
    expect(await a.listStudios()).toEqual([expect.objectContaining({ id: studio, role: 'owner' })]);
    const initial = layoutToBackendScene(structuredClone(INITIAL_LAYOUT));
    const p = await a.createProject(studio, '前后端联调', initial);
    expect(p.revision).toBe(0);
    const acquired = await a.acquireLease(p.id);
    const layout = backendSceneToLayout(acquired.scene, { projectId: p.id, name: p.name });
    const object = layout.floors[0]!.items[0]!;
    object.position = { x: 2.5, z: 1 };
    object.rotation = -Math.PI / 6;
    object.width = 1.8; object.depth = 0.9; object.height = 0.75;
    object.locked = true; object.notes = '联调私有备注';
    const submitted = layoutToBackendScene(layout);
    const saved = await a.saveScene(submitted);
    expect(saved.revision).toBe(1);
    expect(saved.scene.objects[0]).toMatchObject({ position: { x: 7.5, z: 5 }, locked: true, notes: '联调私有备注' });
    expect(saved.scene.objects[0]!.rotation).toBeCloseTo(30, 10);
    await a.renewLease();
    await a.signOut();
    const reopened = await (await login()).getProject(p.id);
    expect(layoutToBackendScene(backendSceneToLayout(reopened.scene))).toEqual(submitted);
    expect(reopened.revision).toBe(1);
  });

  it('enforces two-account and duplicate-tab leases, then hands off the saved scene', async () => {
    const a = await login(), b = await login(1), duplicate = await login();
    const p = await a.createProject(studio, '交接验证', scene());
    await a.acquireLease(p.id);
    await b.getProject(p.id);
    await duplicate.getProject(p.id);
    await expect(b.acquireLease(p.id)).rejects.toMatchObject({ code: 'LEASE_BUSY' });
    await expect(duplicate.acquireLease(p.id)).rejects.toMatchObject({ code: 'LEASE_BUSY' });
    const draft = scene(); draft.objects.push(chair());
    await a.saveScene(draft);
    await a.releaseLease();
    const lease = await b.acquireLease(p.id);
    expect(lease.scene).toEqual(draft);
    const next = { ...lease.scene, lighting: 'warm' as const };
    expect((await b.saveScene(next)).revision).toBe(2);
    await b.releaseLease();
    expect((await a.getProject(p.id)).scene).toEqual(next);
  });

  it('preserves the local draft when the real database rejects a stale revision', async () => {
    const a = await login(), p = await a.createProject(studio, '版本冲突', scene());
    const lease = await a.acquireLease(p.id);
    await server.rpc(owner, 'scene.save', { projectId: p.id, sessionId: lease.sessionId, generation: lease.generation, expectedRevision: 0, scene: scene() });
    const draft = { ...scene(), lighting: 'cool' as const };
    await expect(a.saveScene(draft)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(a.getSnapshot()).toMatchObject({ revision: 0, draft, dirty: true, writeBlocked: true });
    await expect(a.saveScene(draft)).rejects.toMatchObject({ code: 'CLOUD_WRITE_BLOCKED' });
  });

  it('fences an expired editor after a second account takes over', async () => {
    const a = await login(), b = await login(1), p = await a.createProject(studio, '过期交接', scene());
    const first = await a.acquireLease(p.id);
    await server.db.query("update scene_private.projects set lease_expires=now()-interval '1 second' where id=$1", [p.id]);
    const second = await b.acquireLease(p.id);
    expect(second.generation).toBeGreaterThan(first.generation);
    const draft = { ...scene(), camera: 'top' as const };
    await expect(a.saveScene(draft)).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(a.getSnapshot()).toMatchObject({ draft, dirty: true, writeBlocked: true });
    await b.releaseLease();
  });

  it('authorizes a referenced GLB for a teammate and keeps loading URLs out of persisted scenes', async () => {
    const { json, resources } = tetrahedron(), bytes = packGltf(json, resources);
    const record = await assetRecord(owner, bytes, { name: '联调四面体', source: 'upload', license: { id: 'test' }, metadata: {} });
    await server.backend.upload(record.storagePath, bytes, 'model/gltf-binary');
    await server.rpc(owner, 'assets.register', record);
    const source = scene();
    source.objects.push({ ...chair(), materialId: 'asset', assetId: record.id });
    const a = await login(), p = await a.createProject(studio, '共享资产', source);
    const b = await login(1), loaded = await b.getProject(p.id);
    const assets = await b.authorizeAssets(loaded.scene);
    const url = assets.assetUrls[record.id]!;
    expect(new Uint8Array(await (await fetch(url)).arrayBuffer())).toEqual(bytes);
    await ensureGlbAsset(record.id, url);
    expect(getGlbAssetState(record.id).status).toBe('ready');
    const layout = backendSceneToLayout(loaded.scene, assets);
    expect(layout.floors[0]!.items[0]!.glbUrl).toBe(url);
    const restored = parseStoredLayout(JSON.parse(JSON.stringify(layout)));
    expect(restored?.floors[0]?.items[0]?.glbUrl).toBe(url);
    expect(layoutToBackendScene(layout)).toEqual(source);
    const denied = await login(2);
    await expect(denied.authorizeAssets(source)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    const link = [...server.links.values()].find(link => link.path === record.storagePath)!;
    link.until = Date.now() - 1;
    expect((await fetch(url)).status).toBe(404);
  });

  it('publishes an immutable anonymous snapshot, strips private notes, and revokes it', async () => {
    const a = await login(), source = scene(); source.objects.push(chair('绝不能公开的内部备注'));
    const p = await a.createProject(studio, '分享联调', source), client = await rawClient();
    const share = await client.request<{ token: string; shareId: string }>(`/projects/${p.id}/publish`, 'POST', { expectedRevision: 0 });
    await a.acquireLease(p.id);
    await a.saveScene(scene());
    const anonymous = createSceneClient(`${server.url}/functions/v1/scene-api`, async () => null);
    const read = await anonymous.readShare(share.token) as { scene: { objects: unknown[] } };
    expect(read.scene.objects).toHaveLength(1);
    expect(JSON.stringify(read)).not.toContain('绝不能公开的内部备注');
    await client.request(`/projects/${p.id}/shares/${share.shareId}`, 'DELETE');
    await expect(anonymous.readShare(share.token)).rejects.toMatchObject({ code: 'SHARE_NOT_FOUND' });
    await a.releaseLease();
  });

  it('rejects wrong credentials and outsiders; does not silently enable paid generation', async () => {
    const a = controller();
    await expect(a.signIn(testAccounts[0]!.email, 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(a.getSnapshot().user).toBeNull();
    const outside = await login(2);
    expect(await outside.listStudios()).toEqual([]);
    await expect(outside.createProject(studio, '越权', scene())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const client = await rawClient();
    await expect(client.request('/jobs', 'POST', { requestId: crypto.randomUUID(), prompt: '桌子' })).rejects.toMatchObject({ status: 503 });
    expect((await server.db.query('select * from scene_private.generation_jobs')).rows).toHaveLength(0);
    expect((await server.rpc(editor, 'projects.list')).length).toBeGreaterThan(0);
  });

  it('accepts the configured browser preflight and rejects another Origin', async () => {
    const url = `${server.url}/functions/v1/scene-api/projects`;
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3018', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3018');
    const denied = await fetch(url, { headers: { Origin: 'https://untrusted.example' } });
    expect(denied.status).toBe(403);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});
