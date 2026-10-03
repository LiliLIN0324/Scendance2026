import { afterAll, beforeAll, expect, it } from 'vitest';
import { database, owner, editor, outsider, studio, session, scene } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';

let f: Awaited<ReturnType<typeof database>>, api: ReturnType<typeof createApi>;
beforeAll(async () => { f = await database(); api = createApi(f.backend, key => key === 'PUBLIC_APP_URL' ? 'https://app.example' : undefined); }, 30000);
afterAll(async () => { await f?.db.close(); });
async function create() { return f.rpc(owner, 'projects.create', { studioId: studio, name: '可删除方案', scene: scene() }); }
function remove(id: string, actor = owner, revision = 0) {
  return api(new Request(`https://backend.example/projects/${id}`, { method: 'DELETE',
    headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: revision }) }));
}
it('deletes an idle project, revokes shares and preserves audit records; repeated deletion is idempotent', async () => {
  const project = await create();
  const share = await api(new Request(`https://backend.example/projects/${project.id}/publish`, { method: 'POST',
    headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: '{"expectedRevision":0}' }));
  const published = await share.json();
  expect(share.status).toBe(201);
  expect((await remove(project.id)).status).toBe(200);
  expect((await f.rpc(owner, 'projects.list')).some((p: { id: string }) => p.id === project.id)).toBe(false);
  await expect(f.rpc(owner, 'projects.get', { projectId: project.id })).rejects.toThrow('PROJECT_NOT_FOUND');
  await expect(f.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session })).rejects.toThrow('PROJECT_NOT_FOUND');
  const read = await api(new Request('https://backend.example/share/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: published.token }) }));
  expect(read.status).toBe(404);
  expect((await f.db.query('select * from scene_private.publications where project_id=$1', [project.id])).rows).toHaveLength(1);
  expect((await remove(project.id)).status).toBe(200);
});
it('refuses nonmembers, editors, stale revisions and active leases without removing the project', async () => {
  const project = await create();
  expect((await remove(project.id, outsider)).status).toBe(404);
  expect((await remove(project.id, editor)).status).toBe(403);
  expect((await remove(project.id, owner, 99)).status).toBe(409);
  await f.rpc(editor, 'lease.acquire', { projectId: project.id, sessionId: session });
  expect((await remove(project.id)).status).toBe(429);
  expect((await f.rpc(owner, 'projects.get', { projectId: project.id })).id).toBe(project.id);
});
it('blocks deletion during reconstruction and hides the job after a later successful deletion', async () => {
  const project = await create();
  const job = (await f.db.query<{ id: string }>(`insert into scene_private.reconstruction_jobs
    (project_id,owner_id,request_key,fingerprint,input,base_hash,reserve_cents)
    values ($1,$2,gen_random_uuid(),'test','{}','test',1) returning id`, [project.id, owner])).rows[0]!;
  const blocked = await remove(project.id);
  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toMatchObject({ error: { code: 'RECONSTRUCTION_BUSY' } });
  await f.db.query("update scene_private.reconstruction_jobs set state='ready' where id=$1", [job.id]);
  expect((await remove(project.id)).status).toBe(200);
  const read = await api(new Request(`https://backend.example/projects/${project.id}/reconstructions/${job.id}`, { headers: { Authorization: `Bearer ${owner}` } }));
  expect(read.status).toBe(404);
});
