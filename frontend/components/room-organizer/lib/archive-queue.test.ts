import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveQueue, type ArchiveJob, type ArchiveScope, type ArchiveStore, type ArchiveUpload } from './archive-queue';

const SCOPE: ArchiveScope = { userId: 'user-1', studioId: 'studio-1' };
const OTHER_SCOPE: ArchiveScope = { userId: 'user-2', studioId: 'studio-2' };

function memoryStore(jobs: ArchiveJob[] = []): ArchiveStore & { jobs: ArchiveJob[] } {
  return {
    jobs,
    async list() { return [...this.jobs]; },
    async put(job: ArchiveJob) {
      const index = this.jobs.findIndex(item => item.key === job.key);
      if (index >= 0) this.jobs[index] = job; else this.jobs.push(job);
    },
  };
}

function job(overrides: Partial<ArchiveJob> & { localId: string }): ArchiveJob {
  const scope = overrides.scope ?? SCOPE;
  return {
    ...overrides,
    key: JSON.stringify([scope.userId, scope.studioId ?? '', overrides.localId]),
    scope,
    requestId: overrides.requestId ?? `req-${overrides.localId}`,
    name: overrides.name ?? `${overrides.localId}.glb`,
    kind: overrides.kind ?? 'model',
    bytes: overrides.bytes ?? 8,
    state: overrides.state ?? 'pending',
    progress: overrides.progress ?? 0,
    attempts: overrides.attempts ?? 0,
  };
}

const okUpload: ArchiveUpload = async (_job, file) => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', byteSize: file.size, sha256: 'a'.repeat(64) });

beforeEach(() => { vi.restoreAllMocks(); });

describe('archive queue enqueue and dedup', () => {
  it('keeps the same requestId and attempts when content is unchanged', async () => {
    const store = memoryStore([job({ localId: 'a', requestId: 'req-orig', bytes: 8, attempts: 3, sha256: 'b'.repeat(64) })]);
    const queue = new ArchiveQueue(store);
    const enqueued = await queue.enqueue({ scope: SCOPE, localId: 'a', name: 'a.glb', kind: 'model', bytes: 8 });
    expect(enqueued.requestId).toBe('req-orig');
    expect(enqueued.attempts).toBe(3);
    expect(enqueued.sha256).toBe('b'.repeat(64));
  });

  it('issues a fresh requestId when the content bytes change', async () => {
    const store = memoryStore([job({ localId: 'a', requestId: 'req-orig', bytes: 8 })]);
    const queue = new ArchiveQueue(store);
    const enqueued = await queue.enqueue({ scope: SCOPE, localId: 'a', name: 'a.glb', kind: 'model', bytes: 16 });
    expect(enqueued.requestId).not.toBe('req-orig');
    expect(enqueued.attempts).toBe(0);
  });
});

describe('archive queue drain', () => {
  it('uploads pending jobs and records the real receipt', async () => {
    const blob = new Blob([new Uint8Array(8)]);
    const store = memoryStore([job({ localId: 'a', blob })]);
    const queue = new ArchiveQueue(store);
    const upload = vi.fn(okUpload);
    await queue.drain(SCOPE, upload, () => true);
    expect(upload).toHaveBeenCalledTimes(1);
    const saved = store.jobs[0];
    expect(saved.state).toBe('uploaded');
    expect(saved.assetId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(saved.sha256).toBe('a'.repeat(64));
    expect(typeof saved.confirmedAt).toBe('number');
  });

  it('fetches bytes from localUrl when no blob is attached', async () => {
    const store = memoryStore([job({ localId: 'a', localUrl: 'http://127.0.0.1:3199/asset/a.glb', bytes: 8 })]);
    const queue = new ArchiveQueue(store);
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(8), { status: 200 }));
    await queue.drain(SCOPE, okUpload, () => true, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalled();
    expect(store.jobs[0].state).toBe('uploaded');
  });

  it('marks unreadable originals as needs-file and keeps the record', async () => {
    const store = memoryStore([job({ localId: 'a', localUrl: 'http://127.0.0.1:3199/asset/a.glb', bytes: 8 })]);
    const queue = new ArchiveQueue(store);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    await queue.drain(SCOPE, okUpload, () => true, fetchImpl as unknown as typeof fetch);
    expect(store.jobs[0].state).toBe('needs-file');
    expect(store.jobs[0].error).toContain('HTTP 404');
  });

  it('marks failures without deleting the record and retries later', async () => {
    const blob = new Blob([new Uint8Array(8)]);
    const store = memoryStore([job({ localId: 'a', blob })]);
    const queue = new ArchiveQueue(store);
    let attempt = 0;
    await queue.drain(SCOPE, async (_job, file) => {
      attempt += 1;
      if (attempt === 1) throw new Error('HTTP 503');
      return { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', byteSize: file.size, sha256: 'c'.repeat(64) };
    }, () => true);
    expect(store.jobs[0].state).toBe('failed');
    expect(store.jobs[0].error).toContain('HTTP 503');
    await queue.drain(SCOPE, okUpload, () => true);
    expect(store.jobs[0].state).toBe('uploaded');
  });

  it('rejects receipts without a valid asset id or byte match', async () => {
    const blob = new Blob([new Uint8Array(8)]);
    const store = memoryStore([job({ localId: 'a', blob })]);
    const queue = new ArchiveQueue(store);
    await queue.drain(SCOPE, async () => ({ id: 'not-a-uuid', byteSize: 8, sha256: 'a'.repeat(64) }), () => true);
    expect(store.jobs[0].state).toBe('failed');
    expect(store.jobs[0].error).toContain('归档凭证');
  });

  it('isolates jobs per account scope', async () => {
    const blob = new Blob([new Uint8Array(8)]);
    const store = memoryStore([job({ localId: 'a', blob }), job({ localId: 'b', scope: OTHER_SCOPE, blob })]);
    const queue = new ArchiveQueue(store);
    const upload = vi.fn(okUpload);
    await queue.drain(SCOPE, upload, () => true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(store.jobs.find(item => item.localId === 'a')?.state).toBe('uploaded');
    expect(store.jobs.find(item => item.localId === 'b')?.state).toBe('pending');
  });

  it('stops mid-queue when the account scope changes, leaving later jobs pending', async () => {
    const blob = new Blob([new Uint8Array(8)]);
    const store = memoryStore([job({ localId: 'a', blob }), job({ localId: 'b', blob })]);
    const queue = new ArchiveQueue(store);
    // 第一个任务处理完后立即「换账号」：第二个任务必须在循环入口被拦下，不进入上传；
    // 第一个任务的回执在授权失效后不冒认成功——留在 uploading，下次读取按 pending 重放（同 requestId 幂等）。
    let processed = 0;
    await queue.drain(SCOPE, async (_job, file) => {
      processed += 1;
      return { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', byteSize: file.size, sha256: 'a'.repeat(64) };
    }, () => processed < 1);
    expect(store.jobs[0].state).toBe('uploading');
    expect(store.jobs[1].state).toBe('pending');
    expect(store.jobs[1].attempts).toBe(0);
    // 恢复（回到当前 scope）后：第一项按 pending 重放并成功，第二项继续。
    const listed = await queue.inventory(SCOPE);
    expect(listed[0].state).toBe('pending');
    await queue.drain(SCOPE, okUpload, () => true);
    expect(store.jobs[0].state).toBe('uploaded');
    expect(store.jobs[1].state).toBe('uploaded');
  });

  it('normalizes interrupted uploading jobs back to pending on read', async () => {
    const store = memoryStore([job({ localId: 'a', state: 'uploading', progress: 0.4 })]);
    const queue = new ArchiveQueue(store);
    const listed = await queue.inventory(SCOPE);
    expect(listed[0].state).toBe('pending');
    expect(listed[0].progress).toBe(0);
    expect(listed[0].error).toContain('中断');
  });

  it('aggregates receipts across studios per account', async () => {
    const store = memoryStore([
      job({ localId: 'a', state: 'uploaded', assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      job({ localId: 'b', scope: { userId: 'user-1', studioId: 'studio-9' }, state: 'uploaded', assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      job({ localId: 'c', scope: OTHER_SCOPE, state: 'uploaded', assetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
    ]);
    const queue = new ArchiveQueue(store);
    const listed = await queue.inventoryForUser('user-1');
    expect(listed.map(item => item.localId).sort()).toEqual(['a', 'b']);
  });

  it('emits to subscribers on enqueue and state change', async () => {
    const store = memoryStore();
    const queue = new ArchiveQueue(store);
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    await queue.enqueue({ scope: SCOPE, localId: 'a', name: 'a.glb', kind: 'model', bytes: 8 });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
