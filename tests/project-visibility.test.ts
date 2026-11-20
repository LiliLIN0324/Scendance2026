import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, owner, editor, outsider, studio, session, scene } from './fixtures.ts';

interface ProjectRow { id: string; name: string; visibility?: string }

describe('project visibility tiers', { timeout: 60_000 }, () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { f = await database(); }, 60_000);
  afterAll(async () => { await f?.db.close(); });

  async function create(actor: string, name: string): Promise<ProjectRow> {
    return f.rpc(actor, 'projects.create', { studioId: studio, name, scene: scene() }) as Promise<ProjectRow>;
  }
  async function list(actor: string): Promise<ProjectRow[]> {
    return (await f.rpc(actor, 'projects.list')) as ProjectRow[];
  }

  it('keeps a team project visible and editable to fellow members by default', async () => {
    const project = await create(owner, '团队方案');
    expect((await list(editor)).some(row => row.id === project.id)).toBe(true);
    await expect(f.rpc(editor, 'lease.acquire', { projectId: project.id, sessionId: session })).resolves.toMatchObject({ sessionId: session });
  });

  it('lets fellow members read a view-only project but blocks them from taking a lease or saving', async () => {
    const project = await create(owner, '只读方案');
    await f.rpc(owner, 'projects.set_visibility', { projectId: project.id, visibility: 'view-only' });

    // 同室成员仍能在列表看到、能打开。
    expect((await list(editor)).some(row => row.id === project.id)).toBe(true);
    await expect(f.rpc(editor, 'projects.get', { projectId: project.id })).resolves.toMatchObject({ id: project.id, visibility: 'view-only' });

    // 但不能抢锁、不能改名。
    await expect(f.rpc(editor, 'lease.acquire', { projectId: project.id, sessionId: session })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.rpc(editor, 'projects.rename', { projectId: project.id, sessionId: session, generation: 0, expectedRevision: 0, name: '被改名' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // 物主本人不受只读限制。
    await expect(f.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session })).resolves.toMatchObject({ sessionId: session });
  });

  it('hides a private project from fellow members in both list and read', async () => {
    const project = await create(owner, '私有方案');
    await f.rpc(owner, 'projects.set_visibility', { projectId: project.id, visibility: 'private' });

    expect((await list(editor)).some(row => row.id === project.id)).toBe(false);
    await expect(f.rpc(editor, 'projects.get', { projectId: project.id })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await expect(f.rpc(editor, 'lease.acquire', { projectId: project.id, sessionId: session })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });

    // 物主本人仍可见可写。
    expect((await list(owner)).some(row => row.id === project.id)).toBe(true);
    await expect(f.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session })).resolves.toMatchObject({ sessionId: session });
  });

  it('refuses visibility changes from non-owners and rejects unknown tiers', async () => {
    const project = await create(owner, '权限校验方案');
    // editor 既不是物主也不是工作室 owner，不能改可见性。
    await expect(f.rpc(editor, 'projects.set_visibility', { projectId: project.id, visibility: 'private' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.rpc(owner, 'projects.set_visibility', { projectId: project.id, visibility: 'secret' })).rejects.toMatchObject({ code: 'INVALID_VISIBILITY' });
    // 非成员读不到，也无从改起。
    await expect(f.rpc(outsider, 'projects.set_visibility', { projectId: project.id, visibility: 'team' })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });
});
