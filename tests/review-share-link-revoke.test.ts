import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, owner, editor, outsider } from './fixtures.ts';

/**
 * 评审短链吊销闭环（P1）：
 * - 物主本人可以吊销自己发出的短链；
 * - 吊销后匿名读取立刻拿不到内容；
 * - 非物主、未登录、重复吊销、码不存在都拒绝；
 * - 旧行没有 revoked_at 不受影响。
 *
 * 夹具里 auth.uid() 默认返回 null；这里按用例覆盖成指定用户来模拟登录身份。
 */
const code = 'abcdef1234567890abcdef12';
const longHash = '#layout=v1.revoke-test-snapshot';
const payload = { reviewAccess: { pins: true, levels: false, basemap: false } };

async function signAs(db: { exec: (sql: string) => Promise<unknown> }, userId: string | null): Promise<void> {
  const uid = userId === null ? 'null::uuid' : `'${userId}'::uuid`;
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select ${uid} $$`);
}

describe('review share link revocation', { timeout: 60_000 }, () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => {
    f = await database();
    await signAs(f.db, owner);
    await f.db.query(
      'select public.review_share_link_create($1, $2, $3::jsonb)',
      [code, longHash, JSON.stringify(payload)],
    );
  }, 60_000);
  afterAll(async () => { await f?.db.close(); });

  async function read(shortCode: string): Promise<unknown> {
    const result = await f.db.query<{ result: unknown }>(
      'select public.review_share_link_read($1) as result',
      [shortCode],
    );
    return result.rows[0]?.result ?? null;
  }

  async function revoke(shortCode: string): Promise<unknown> {
    const result = await f.db.query<{ result: unknown }>(
      'select public.review_share_link_revoke($1) as result',
      [shortCode],
    );
    return result.rows[0]?.result ?? null;
  }

  it('serves the link to anonymous readers before revocation', async () => {
    const record = (await read(code)) as { longHash?: string; payload?: unknown } | null;
    expect(record).toBeTruthy();
    expect(record?.longHash).toBe(longHash);
  });

  it('refuses revocation by a non-owner', async () => {
    await signAs(f.db, editor);
    await expect(revoke(code)).rejects.toThrow(/FORBIDDEN/);
    // 拒绝后链接仍然可读。
    expect((await read(code))).toBeTruthy();
  });

  it('refuses revocation without a signed-in user', async () => {
    await signAs(f.db, null);
    await expect(revoke(code)).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('lets the owner revoke, after which anonymous read returns nothing', async () => {
    await signAs(f.db, owner);
    const result = (await revoke(code)) as { code?: string; revoked?: boolean };
    expect(result).toMatchObject({ code, revoked: true });
    expect(await read(code)).toBeNull();
  });

  it('treats a revoked or unknown code as not found on a second revoke', async () => {
    await signAs(f.db, owner);
    await expect(revoke(code)).rejects.toThrow(/REVIEW_LINK_NOT_FOUND/);
    await expect(revoke('000000000000000000000000')).rejects.toThrow(/REVIEW_LINK_NOT_FOUND/);
  });

  it('does not leak the revoked link to another user either', async () => {
    await signAs(f.db, outsider);
    expect(await read(code)).toBeNull();
  });
});
