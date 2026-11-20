/** Browser durable private archive outbox. This is local bookkeeping, not a wire schema. */
export interface ArchiveScope { userId: string; studioId?: string }
export interface ArchiveJob {
  key: string; scope: ArchiveScope; localId: string; requestId: string;
  name: string; kind: 'model' | 'scan' | 'floorplan' | 'photo' | 'attachment';
  blob?: Blob; localUrl?: string; bytes: number;
  state: 'pending' | 'uploading' | 'failed' | 'needs-file' | 'uploaded';
  progress: number; attempts: number; error?: string;
  /** 归档目标工作室；省略 = 个人私有（A 契约：指定官方工作室需当前管理员）。 */
  studioId?: string;
  /** 本地算好的内容指纹；重试不重复算，服务端按它做幂等去重。 */
  sha256?: string;
  assetId?: string; confirmedAt?: number;
}
export interface ArchiveStore {
  list(): Promise<ArchiveJob[]>;
  put(job: ArchiveJob): Promise<void>;
}
export function archiveKey(scope: ArchiveScope, localId: string): string {
  if (!scope.userId || !localId) throw new Error('归档需要当前账号和本机素材编号。');
  return JSON.stringify([scope.userId, scope.studioId ?? '', localId]);
}
export function sameArchiveScope(a: ArchiveScope, b: ArchiveScope): boolean {
  return a.userId === b.userId && (a.studioId ?? '') === (b.studioId ?? '');
}
/** 断电/刷新后，上一会话卡在 uploading 的任务恢复成 pending：本机原件还在，重试即可。 */
function normalizeInterrupted(jobs: ArchiveJob[]): ArchiveJob[] {
  return jobs.map(job => job.state === 'uploading'
    ? { ...job, state: 'pending' as const, progress: 0, error: '上次上传被中断，本机原件还在，可重试。' }
    : job);
}
export class IndexedArchiveStore implements ArchiveStore {
  private async open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') throw new Error('浏览器无法持久保存上传队列，请保留原文件。');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('scendance-private-archive-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'key' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('jobs', mode);
      const request = run(tx.objectStore('jobs'));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('上传队列未写入，请保留原文件。')); };
      tx.onerror = () => { /* abort carries the error */ };
    });
  }
  list(): Promise<ArchiveJob[]> { return this.transaction('readonly', store => store.getAll()); }
  async put(job: ArchiveJob): Promise<void> { await this.transaction('readwrite', store => store.put(job)); }
}
export type ArchiveProgressPhase = 'hash' | 'upload';
export type ArchiveUpload = (job: ArchiveJob, file: Blob, signal: AbortSignal, progress: (loaded: number, total: number, phase?: ArchiveProgressPhase) => void) => Promise<{ id: string; byteSize: number; sha256: string }>;

/** Keep source bytes after success; removing the only local copy is never a queue operation. */
export class ArchiveQueue {
  private active: AbortController | undefined;
  private running: Promise<void> | undefined;
  private epoch = 0;
  private listeners = new Set<() => void>();
  constructor(readonly store: ArchiveStore = new IndexedArchiveStore()) {}
  /** UI 订阅：每次落盘（入队/状态推进）都广播，读侧用 useSyncExternalStore 拉最新列表。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit(): void { for (const listener of [...this.listeners]) listener(); }
  stop(): void { this.epoch += 1; this.active?.abort(); this.active = undefined; }
  async enqueue(input: Omit<ArchiveJob, 'key' | 'requestId' | 'state' | 'attempts' | 'progress'>): Promise<ArchiveJob> {
    const key = archiveKey(input.scope, input.localId);
    const existing = (await this.store.list()).find(job => job.key === key);
    // 内容变了（字节数不同）必须换 requestId：服务端把 requestId 绑定内容指纹，
    // 复用旧号传新内容会被 409 IDEMPOTENCY_CONFLICT 拒掉，这是契约不是障碍。
    const contentUnchanged = Boolean(existing && existing.bytes === input.bytes);
    const job: ArchiveJob = {
      ...input, key,
      requestId: contentUnchanged ? existing!.requestId : crypto.randomUUID(),
      state: 'pending', attempts: contentUnchanged ? existing!.attempts : 0, progress: 0,
      ...(contentUnchanged && existing!.sha256 ? { sha256: existing!.sha256 } : {}),
    };
    await this.store.put(job);
    this.emit();
    return job;
  }
  async inventory(scope: ArchiveScope): Promise<ArchiveJob[]> {
    const jobs = (await this.store.list()).filter(job => sameArchiveScope(job.scope, scope));
    return normalizeInterrupted(jobs);
  }
  /** 发布闸门用：按账号聚合全部工作室的已上传回执（资产归账号，不归单个工作室视图）。 */
  async inventoryForUser(userId: string): Promise<ArchiveJob[]> {
    if (!userId) return [];
    const jobs = (await this.store.list()).filter(job => job.scope.userId === userId);
    return normalizeInterrupted(jobs);
  }
  drain(scope: ArchiveScope, upload: ArchiveUpload, current: () => boolean, fetchImpl: typeof fetch = fetch): Promise<void> {
    if (this.running) return this.running;
    const epoch = this.epoch;
    const abort = new AbortController(); this.active = abort;
    const authorized = () => epoch === this.epoch && !abort.signal.aborted && current();
    this.running = (async () => {
      for (const saved of await this.inventory(scope)) {
        if (!authorized()) break;
        if (saved.state === 'uploaded') continue;
        let job = { ...saved, state: 'uploading' as ArchiveJob['state'], attempts: saved.attempts + 1, progress: 0 };
        delete job.error;
        await this.store.put(job);
        this.emit();
        try {
          let file = job.blob;
          if (!file && job.localUrl) {
            const response = await fetchImpl(job.localUrl, { signal: abort.signal, cache: 'no-store', credentials: 'omit' });
            if (!response.ok) {
              // 地址读不到（代理没开/文件被清）：这是「需要原文件」，不是普通失败——重试也不会好。
              job.state = 'needs-file';
              throw new Error(`无法读取原设备文件（HTTP ${response.status}），请启动原设备代理或重新选择原文件。`);
            }
            file = await response.blob();
          }
          if (!file) { job.state = 'needs-file'; throw new Error('原文件不可读，请在原设备重新选择；本机记录仍保留。'); }
          if (file.size !== job.bytes || !file.size) throw new Error('原文件大小与归档清单不符，请重新选择原文件。');
          if (!authorized()) break;
          const result = await upload(job, file, abort.signal, (loaded, total) => {
            // UI progress is volatile; never race an async progress write against the final receipt.
            if (authorized()) job.progress = total > 0 ? Math.min(1, loaded / total) : 0;
            this.emit();
          });
          if (!authorized()) break;
          if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result.id) || result.byteSize !== file.size || !/^[0-9a-f]{64}$/i.test(result.sha256)) throw new Error('服务器归档凭证缺失或文件大小不符，未确认成功。');
          job = { ...job, state: 'uploaded', assetId: result.id, sha256: result.sha256, confirmedAt: Date.now(), progress: 1 };
        } catch (error) {
          if (!authorized()) break;
          job.state = job.state === 'needs-file' ? 'needs-file' : 'failed';
          job.error = error instanceof Error ? error.message : '归档失败，原文件保留，可重试。';
        }
        await this.store.put(job);
        this.emit();
      }
    })().finally(() => { this.running = undefined; if (this.active === abort) this.active = undefined; this.emit(); });
    return this.running;
  }
}

/** 进程内共享队列：hook、云面板与发布闸门读同一份登记，不各开各的连接。 */
export const sharedArchiveQueue = new ArchiveQueue();
