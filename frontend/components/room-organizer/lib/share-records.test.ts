// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendShareRecord, mergeShareRows, readShareRecords, type ServerShare } from './share-records';
import { MemoryStorage } from '@/lib/test-support-memory-storage';

let memStorage: MemoryStorage;
beforeEach(() => {
  memStorage = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', memStorage);
  window.localStorage = memStorage;
});
afterEach(() => {
  memStorage?.clear();
  vi.unstubAllGlobals();
});

const serverShare = (patch: Partial<ServerShare>): ServerShare => ({
  shareId: patch.shareId ?? 'sh-1',
  publicationId: patch.publicationId ?? 'pub-1',
  revision: patch.revision ?? 2,
  createdAt: patch.createdAt ?? '2026-11-17T04:12:00Z',
  revokedAt: patch.revokedAt ?? null,
});

describe('分享记录：本机日志', () => {
  it('旧单条发布键第一次读取时迁移成一条 web 记录，不删旧键', () => {
    localStorage.clear();
    localStorage.setItem('scendance.publishedLink.v1.project-1', JSON.stringify({ url: 'https://studio.example/view/#old', revision: 1 }));
    const records = readShareRecords('project-1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'web', url: 'https://studio.example/view/#old', revision: 1, at: 0 });
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toContain('#old');
  });

  it('追加落在 scendance.shareLog.v1 键下，上限 50 条丢最旧', () => {
    localStorage.clear();
    for (let index = 0; index < 52; index += 1) {
      appendShareRecord('p', { kind: 'viewer', url: `https://studio.example/view/#s${index}`, revision: null, at: index });
    }
    const records = readShareRecords('p');
    expect(records).toHaveLength(50);
    expect(records[0]!.at).toBe(2);
    expect(records.at(-1)!.url).toContain('#s51');
  });

  it('追加不迁移旧键：同一 revision 不重复记，另一版则补进清单', () => {
    localStorage.clear();
    appendShareRecord('dup', { kind: 'web', url: 'https://new', revision: 2, at: 5 });
    localStorage.setItem('scendance.publishedLink.v1.dup', JSON.stringify({ url: 'https://new', revision: 2 }));
    expect(readShareRecords('dup')).toHaveLength(1);
    localStorage.setItem('scendance.publishedLink.v1.dup2', JSON.stringify({ url: 'https://old', revision: 1 }));
    appendShareRecord('dup2', { kind: 'web', url: 'https://new', revision: 2, at: 5 });
    expect(readShareRecords('dup2')).toHaveLength(2);
  });

  it('坏数据与空 projectId 不抛错', () => {
    localStorage.clear();
    localStorage.setItem('scendance.shareLog.v1.bad', 'not-json');
    localStorage.setItem('scendance.shareLog.v1.junk', JSON.stringify([{ kind: 'web', url: '' }]));
    expect(readShareRecords('bad')).toEqual([]);
    expect(readShareRecords('junk')).toEqual([]);
    expect(readShareRecords()).toEqual([]);
    const record = appendShareRecord(undefined, { kind: 'web', url: 'https://x', revision: 1, at: 1 });
    expect(record.id).toBeTruthy();
  });
});

describe('分享记录：服务端合并', () => {
  it('服务端按 revision 认领本机 URL 行，撤回状态以服务端为准', () => {
    const local = [
      { id: 'r1', kind: 'web' as const, url: 'https://studio.example/view/#tok', revision: 2, at: Date.parse('2026-11-17T04:12:00Z') },
    ];
    const rows = mergeShareRows(local, [serverShare({ shareId: 'sh-9', revision: 2, revokedAt: '2026-11-17T05:30:00Z' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'sh-9', kind: 'web', revision: 2, url: 'https://studio.example/view/#tok', shareId: 'sh-9', revoked: true });
  });

  it('服务端多出的行单独成行且无 URL；3D 漫游记录不参与匹配', () => {
    const local = [
      { id: 'r1', kind: 'web' as const, url: 'https://studio.example/view/#tok', revision: 2, at: Date.parse('2026-11-17T05:07:00Z') },
      { id: 'r2', kind: 'viewer' as const, url: 'https://studio.example/view/#s1=a', revision: null, at: Date.parse('2026-11-17T05:20:00Z') },
    ];
    const rows = mergeShareRows(local, [serverShare({ shareId: 'sh-9', revision: 2 }), serverShare({ shareId: 'sh-3', revision: 1, createdAt: '2026-11-17T04:00:00Z' })]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ key: 'r2', kind: 'viewer', url: 'https://studio.example/view/#s1=a' });
    expect(rows[1]).toMatchObject({ key: 'sh-9', url: 'https://studio.example/view/#tok', revoked: false });
    expect(rows[2]).toMatchObject({ key: 'sh-3', url: null, revision: 1 });
  });

  it('服务端为 null 时退化为纯本机行，按时间倒序', () => {
    const rows = mergeShareRows([
      { id: 'a', kind: 'web', url: 'https://a', revision: 1, at: 100 },
      { id: 'b', kind: 'web', url: 'https://b', revision: 2, at: 200 },
    ], null);
    expect(rows.map(row => row.key)).toEqual(['b', 'a']);
  });

  it('本机 at 为 0（旧迁移）时借用服务端 createdAt 排序', () => {
    const rows = mergeShareRows(
      [{ id: 'legacy-x', kind: 'web', url: 'https://old', revision: 1, at: 0 }],
      [serverShare({ revision: 1, createdAt: '2026-11-17T04:00:00Z' })],
    );
    expect(rows[0]!.at).toBe(Date.parse('2026-11-17T04:00:00Z'));
    expect(rows[0]!.url).toBe('https://old');
  });
});
