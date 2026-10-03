import { afterAll, beforeAll, expect, it } from 'vitest';
import { database, owner, studio, scene } from './fixtures.ts';

let f: Awaited<ReturnType<typeof database>>;
beforeAll(async () => {
  f = await database();
  await f.db.exec('alter table auth.users add column email_confirmed_at timestamptz, add column raw_user_meta_data jsonb');
}, 30000);
afterAll(async () => { await f?.db.close(); });

it('provisions one private studio at confirmation and preserves existing memberships', async () => {
  const id = crypto.randomUUID();
  await f.db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [id, JSON.stringify({ display_name: '新用户' })]);
  expect(await f.rpc(id, 'studios')).toEqual([]);
  await f.db.query('update auth.users set email_confirmed_at=now() where id=$1', [id]);
  const studios = await f.rpc(id, 'studios');
  expect(studios).toHaveLength(1);
  expect(studios[0]).toMatchObject({ name: '新用户的工作室', role: 'owner', displayName: '新用户' });
  const project = await f.rpc(id, 'projects.create', { studioId: studios[0].id, name: '第一场活动', scene: scene() });
  await expect(f.rpc(owner, 'projects.get', { projectId: project.id })).rejects.toThrow('PROJECT_NOT_FOUND');
  await expect(f.rpc(id, 'projects.create', { studioId: studio, name: '禁止访问', scene: scene() })).rejects.toThrow('FORBIDDEN');
  await f.db.query('update auth.users set email_confirmed_at=now() where id in ($1,$2)', [id, owner]);
  expect(await f.rpc(id, 'studios')).toEqual(studios);
  expect(await f.rpc(owner, 'studios')).toHaveLength(1);
});

it('does not recreate a deliberately deleted last studio on later account updates', async () => {
  const id = crypto.randomUUID();
  await f.db.query('insert into auth.users(id,email_confirmed_at) values($1,now())', [id]);
  const [personal] = await f.rpc(id, 'studios');
  await f.rpc(id, 'studios.delete', { studioId: personal.id });
  await f.db.query("update auth.users set raw_user_meta_data='{}'::jsonb where id=$1", [id]);
  expect(await f.rpc(id, 'studios')).toEqual([]);
});
