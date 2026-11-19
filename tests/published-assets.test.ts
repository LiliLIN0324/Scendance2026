import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, owner, editor, outsider, studio, scene, chair } from './fixtures.ts';

const glbId = '40000000-0000-4000-8000-000000000011';
const pngId = '40000000-0000-4000-8000-000000000012';
/** 另一个工作室的成员：没有用过这个物料的项目，所以它的可见性只由「是否公开」决定。 */
const peer = '10000000-0000-4000-8000-000000000004';
const peerStudio = '20000000-0000-4000-8000-000000000002';
interface AssetRow { id: string; owner_id?: string; published_at?: string | null; storage_path?: string }

describe('published assets reach every registered user', { timeout: 60_000 }, () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => {
    f = await database();
    await f.db.query("insert into auth.users(id,email) values($1,'peer@example.test') on conflict do nothing",[peer]);
    await f.db.query('insert into scene_private.studios(id,name) values($1,$2) on conflict do nothing',[peerStudio,'Peer studio']);
    await f.db.query("insert into scene_private.members values($1,$2,'owner','Peer') on conflict do nothing",[peerStudio,peer]);
  }, 60_000);
  afterAll(async () => { await f?.db.close(); });

  async function register(id: string, format: 'glb' | 'png'): Promise<void> {
    await f.rpc(owner, 'assets.register', {
      id, name: format === 'glb' ? '婚礼桌花' : '参考图', source: 'upload', sourceId: null, sourceUrl: null,
      format, byteSize: 100, sha256: 'c'.repeat(64), storagePath: `${owner}/${id}/${'c'.repeat(64)}.${format}`,
      license: { type: 'provider-terms' }, metadata: { width: 1024, height: 1024 },
    });
  }
  async function listAssets(actor: string): Promise<AssetRow[]> {
    return (await f.rpc(actor, 'assets.list')) as AssetRow[];
  }

  it('shows a published model to another member and lets that member place it', async () => {
    await register(glbId, 'glb');

    // 未发布时别人看不到也用不了。
    expect((await listAssets(editor)).some(row => row.id === glbId)).toBe(false);
    await expect(f.rpc(editor, 'assets.get', { assetId: glbId })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

    const published = await f.rpc(owner, 'assets.publish', { assetId: glbId });
    expect(published).toMatchObject({ assetId: glbId, catalog: 'scendance-generated' });

    const seen = await listAssets(editor);
    const row = seen.find(entry => entry.id === glbId);
    expect(row).toBeTruthy();
    expect(row?.published_at).toBeTruthy();
    // 公共目录里的物料不泄露存储路径。
    expect(row?.storage_path).toBeUndefined();

    // 能换到签名地址，也能存进自己的场景。
    const authorized = await f.rpc(editor, 'assets.get', { assetId: glbId });
    expect(authorized).toMatchObject({ id: glbId, format: 'glb' });
    const doc = scene();
    doc.objects = [{ ...chair(), materialId: 'asset', assetId: glbId }];
    const created = await f.rpc(editor, 'projects.create', { studioId: studio, name: '用了公共物料', scene: doc });
    expect((await f.rpc(editor, 'projects.get', { projectId: created.id })).scene).toEqual(doc);
  });

  it('keeps unpublished models private and does not widen material authority', async () => {
    // 没有工作室身份的人拿不到公共目录。
    expect((await listAssets(outsider)).some(entry => entry.id === glbId)).toBe(false);
    await expect(f.rpc(outsider, 'assets.get', { assetId: glbId })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('lets only the owner publish, refuses non-models, and takes publication back', async () => {
    await register(pngId, 'png');

    await expect(f.rpc(editor, 'assets.publish', { assetId: glbId })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(f.rpc(owner, 'assets.publish', { assetId: pngId })).rejects.toMatchObject({ code: 'ASSET_NOT_PUBLISHABLE' });
    await expect(f.rpc(owner, 'assets.publish', { assetId: '40000000-0000-4000-8000-000000000099' })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(f.rpc(null, 'assets.publish', { assetId: glbId })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // 撤下之后立刻不再可见、也不再可用。
    await f.rpc(owner, 'assets.publish', { assetId: glbId });
    expect((await listAssets(peer)).some(entry => entry.id === glbId)).toBe(true);
    expect(await f.rpc(owner, 'assets.unpublish', { assetId: glbId })).toMatchObject({ assetId: glbId, published: true });
    expect((await listAssets(peer)).some(entry => entry.id === glbId)).toBe(false);
    await expect(f.rpc(peer, 'assets.get', { assetId: glbId })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('leaves the owner list intact and marks only published rows', async () => {
    const before = await listAssets(owner);
    expect(before.length).toBe(2);
    await f.rpc(owner, 'assets.publish', { assetId: glbId });
    const after = await listAssets(owner);
    expect(after.length).toBe(2);
    expect(after.find(entry => entry.id === glbId)?.published_at).toBeTruthy();
    expect(after.find(entry => entry.id === pngId)?.published_at).toBeFalsy();
  });
});
