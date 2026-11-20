import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, owner, editor, studio, scene, chair } from './fixtures.ts';

/** 另一个工作室的成员：团队库对他应完全不可见。 */
const peer = '10000000-0000-4000-8000-000000000004';
const peerStudio = '20000000-0000-4000-8000-000000000002';
const glbA = '41000000-0000-4000-8000-000000000001';
const glbB = '41000000-0000-4000-8000-000000000002';
const glbC = '41000000-0000-4000-8000-000000000003';
const pngD = '41000000-0000-4000-8000-000000000004';
interface TeamRow { id: string; team_studio_id?: string | null; published_at?: string | null; status?: string }

describe('studio asset submission and review flow', { timeout: 60_000 }, () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => {
    f = await database();
    await f.db.query("insert into auth.users(id,email) values($1,'peer@example.test') on conflict do nothing", [peer]);
    await f.db.query('insert into scene_private.studios(id,name) values($1,$2) on conflict do nothing', [peerStudio, 'Peer studio']);
    await f.db.query("insert into scene_private.members values($1,$2,'owner','Peer') on conflict do nothing", [peerStudio, peer]);
  }, 60_000);
  afterAll(async () => { await f?.db.close(); });

  async function register(actor: string, id: string, format: 'glb' | 'png', ownerPrefix: string): Promise<void> {
    await f.rpc(actor, 'assets.register', {
      id, name: format === 'glb' ? '团队摆件' : '参考图', source: 'upload', sourceId: null, sourceUrl: null,
      format, byteSize: 100, sha256: 'd'.repeat(64), storagePath: `${ownerPrefix}/${id}/${'d'.repeat(64)}.${format}`,
      license: { type: 'provider-terms' }, metadata: { width: 1024, height: 1024 },
    });
  }
  async function listAssets(actor: string): Promise<TeamRow[]> {
    return (await f.rpc(actor, 'assets.list')) as TeamRow[];
  }
  async function teamList(actor: string): Promise<TeamRow[]> {
    return (await f.rpc(actor, 'assets.team.list', {})) as TeamRow[];
  }

  it('keeps a submission hidden until the owner approves it, then reaches fellow members', async () => {
    await register(owner, glbA, 'glb', owner);

    // 提交前是私有件：同室成员也看不到。
    expect((await listAssets(editor)).some(row => row.id === glbA)).toBe(false);
    await expect(f.rpc(editor, 'assets.get', { assetId: glbA })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

    const submitted = await f.rpc(owner, 'assets.team.submit', { assetId: glbA, studioId: studio });
    expect(submitted).toMatchObject({ assetId: glbA, studioId: studio, status: 'pending' });

    // 待审状态不外泄：同室成员与隔壁工作室都看不到、也用不了。
    expect((await listAssets(editor)).some(row => row.id === glbA)).toBe(false);
    expect((await teamList(editor)).some(row => row.id === glbA)).toBe(false);
    await expect(f.rpc(editor, 'assets.get', { assetId: glbA })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    expect((await listAssets(peer)).some(row => row.id === glbA)).toBe(false);

    const approved = await f.rpc(owner, 'assets.team.review', { assetId: glbA, studioId: studio, decision: 'approve' });
    expect(approved).toMatchObject({ assetId: glbA, studioId: studio, status: 'approved' });

    const seen = await listAssets(editor);
    const row = seen.find(entry => entry.id === glbA);
    expect(row).toBeTruthy();
    expect(row?.team_studio_id).toBe(studio);
    expect(await f.rpc(editor, 'assets.get', { assetId: glbA })).toMatchObject({ id: glbA, format: 'glb' });

    const doc = scene();
    doc.objects = [{ ...chair(), materialId: 'asset', assetId: glbA }];
    const created = await f.rpc(editor, 'projects.create', { studioId: studio, name: '用了团队物料', scene: doc });
    expect((await f.rpc(editor, 'projects.get', { projectId: created.id })).scene).toEqual(doc);

    // 隔壁工作室仍无权取用。
    expect((await listAssets(peer)).some(entry => entry.id === glbA)).toBe(false);
    await expect(f.rpc(peer, 'assets.get', { assetId: glbA })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('only the studio owner can review; members submit only their own models', async () => {
    await register(owner, glbB, 'glb', owner);
    await register(editor, glbC, 'glb', editor);
    await register(owner, pngD, 'png', owner);

    // 不能把别人的私有件抬进团队库。
    await expect(f.rpc(editor, 'assets.team.submit', { assetId: glbB, studioId: studio })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    // 成员不能把自己的件提交到隔壁工作室。
    await expect(f.rpc(editor, 'assets.team.submit', { assetId: glbC, studioId: peerStudio })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // 图片不是可摆放物料，不能进团队库。
    await expect(f.rpc(owner, 'assets.team.submit', { assetId: pngD, studioId: studio })).rejects.toMatchObject({ code: 'ASSET_NOT_PUBLISHABLE' });
    await expect(f.rpc(null, 'assets.team.submit', { assetId: glbB, studioId: studio })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // 成员可以提交自己的件，但只有 owner 能审核。
    await f.rpc(editor, 'assets.team.submit', { assetId: glbC, studioId: studio });
    await expect(f.rpc(editor, 'assets.team.review', { assetId: glbC, studioId: studio, decision: 'approve' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const rejected = await f.rpc(owner, 'assets.team.review', { assetId: glbC, studioId: studio, decision: 'reject' });
    expect(rejected).toMatchObject({ status: 'rejected' });
    // 被拒后对同室其他成员不再可见、也不可取用；物主本人仍在个人库里保有这件私有物料。
    expect((await listAssets(owner)).some(row => row.id === glbC)).toBe(false);
    await expect(f.rpc(owner, 'assets.get', { assetId: glbC })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

    // 审核决策只能是 approve / reject。
    await expect(f.rpc(owner, 'assets.team.review', { assetId: glbC, studioId: studio, decision: 'maybe' })).rejects.toMatchObject({ code: 'INVALID_TEAM_DECISION' });
    // 隔壁工作室无权审核本工作室团队件。
    await expect(f.rpc(peer, 'assets.team.review', { assetId: glbC, studioId: studio, decision: 'approve' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps own pending and rejected submissions visible to the submitter in team.list', async () => {
    await f.rpc(owner, 'assets.team.submit', { assetId: glbB, studioId: studio });

    const mine = await teamList(owner);
    const b = mine.find(entry => entry.id === glbB);
    expect(b).toBeTruthy();
    expect(b?.status).toBe('pending');

    // 待审件不进同室成员的通用物料列表。
    expect((await listAssets(editor)).some(row => row.id === glbB)).toBe(false);
  });
});
