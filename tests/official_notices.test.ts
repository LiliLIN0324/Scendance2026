import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, owner, editor, outsider, studio } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';

type Row = { id: string; kind: string; title: string; body: string; link: string | null; createdAt: string; readAt: string | null };

describe('official notices', () => {
  let f: Awaited<ReturnType<typeof database>>;
  let api: ReturnType<typeof createApi>;
  beforeAll(async () => { f = await database(); api = createApi(f.backend, key => key === 'ALLOWED_ORIGINS' ? 'https://app.example' : undefined); }, 30000);
  afterAll(async () => { await f?.db.close(); });

  function req(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown, actor: string | null = owner) {
    return api(new Request(`https://backend.example/functions/v1/scene-api${path}`, { method,
      headers: { ...(actor ? { Authorization: `Bearer ${actor}` } : { 'X-No-Auth': 'true' }), 'Content-Type': 'application/json', Origin: 'https://app.example' },
      body: body === undefined ? undefined : JSON.stringify(body) }));
  }

  async function seedScoped(id: string, title: string, role: string | null, actorScope: string) {
    await f.db.query(
      `insert into scene_private.official_notifications(id,kind,title,body,studio_id,target_role)
       values ($1,'system',$2,$3,$4,$5) on conflict (id) do nothing`,
      [id, title, '工作室定向通知样例', actorScope, role]);
  }
  it('lists the seeded global broadcast and tracks unread plus read receipts', async () => {
    const list = (await (await req('/notices')).json()) as Row[];
    expect(list.length).toBe(2);
    expect(list.every(row => row.readAt === null)).toBe(true);
    expect(await (await req('/notices/unread')).json()).toEqual({ count: 2 });

    const first = list[0]!;
    expect(await (await req('/notices/read', 'POST', { noticeId: first.id })).json()).toEqual({ marked: 1 });
    const after = (await (await req('/notices')).json()) as Row[];
    expect(after.find(row => row.id === first.id)?.readAt).toEqual(expect.any(String));
    expect(await (await req('/notices/unread')).json()).toEqual({ count: 1 });
    // 重复回执不报错，也不重复计数。
    expect(await (await req('/notices/read', 'POST', { noticeId: first.id })).json()).toEqual({ marked: 1 });
  });

  it('shows global broadcasts to non-members, but scoped notices only to the right audience', async () => {
    const studioWide = '10000000-0000-4000-8000-000000000093';
    const ownerOnly = '10000000-0000-4000-8000-000000000094';
    await seedScoped(studioWide, '仅本工作室', null, studio);
    await seedScoped(ownerOnly, '仅 owner', 'owner', studio);

    const ownerList = ((await (await req('/notices')).json()) as Row[]).map(row => row.id);
    expect(ownerList).toContain(studioWide);
    expect(ownerList).toContain(ownerOnly);

    const editorList = ((await (await req('/notices', 'GET', undefined, editor)).json()) as Row[]).map(row => row.id);
    expect(editorList).toContain(studioWide);
    expect(editorList).not.toContain(ownerOnly);

    const outsiderList = ((await (await req('/notices', 'GET', undefined, outsider)).json()) as Row[]).map(row => row.id);
    expect(outsiderList).not.toContain(studioWide);
    expect(outsiderList).not.toContain(ownerOnly);
  });

  it('hides expired notices and rejects reading them with 404', async () => {
    const expired = '10000000-0000-4000-8000-000000000095';
    await f.db.query(
      `insert into scene_private.official_notifications(id,kind,title,body,expires_at)
       values ($1,'system','已过期通知','工作室定向通知样例', now() - interval '1 hour')
       on conflict (id) do nothing`,
      [expired]);

    const list = ((await (await req('/notices')).json()) as Row[]).map(row => row.id);
    expect(list).not.toContain(expired);
    expect(await (await req('/notices/read', 'POST', { noticeId: expired })).status).toBe(404);
  });

  it('rejects reading a notice the actor cannot see with 404', async () => {
    const ownerOnly = '10000000-0000-4000-8000-000000000094';
    expect(await (await req('/notices/read', 'POST', { noticeId: ownerOnly }, outsider)).status).toBe(404);
  });

  it('rejects non-http(s) links at the database gate', async () => {
    await expect(f.db.query(
      `insert into scene_private.official_notifications(id,kind,title,body,link)
       values ($1,'system','坏链接通知','样例','javascript:alert(1)')`,
      ['10000000-0000-4000-8000-000000000096'])).rejects.toThrow();
  });

  it('rejects anonymous access with 401', async () => {
    expect((await req('/notices', 'GET', undefined, null)).status).toBe(401);
    expect((await req('/notices/unread', 'GET', undefined, null)).status).toBe(401);
    expect((await req('/notices/read', 'POST', { noticeId: '00000000-0000-4000-8000-000000000000' }, null)).status).toBe(401);
  });
});
