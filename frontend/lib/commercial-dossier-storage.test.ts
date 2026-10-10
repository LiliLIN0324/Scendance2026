import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commercialContentSchema, commercialDossierLimits, commercialDossierSchema,
  commercialSignatureReportSchema, type CommercialAttachment, type CommercialSignatureReport,
} from '../../supabase/functions/_shared/commercial-dossier-contract';
import { restoreCommercialBackupJson, serializeCommercialBackup } from './commercial-dossier-backup';
import {
  appendCommercialSignatureReport, discardCommercialDraft, freezeCommercialVersion,
  prepareCommercialOriginal, readCommercialSnapshot, restoreCommercialSnapshot,
  saveCommercialDraft, validateCommercialSnapshot, verifyCommercialOriginal,
  type CommercialRead, type CommercialStoredSnapshot,
} from './commercial-dossier-storage';
import { readSourceRecord, updateSourceForm } from './source-storage';

const projectId = 'local-commercial-test';
const key = ['commercial-domain', projectId] as [string, string];
const id = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const recorded = { recordedAt: '2026-10-09T09:00:00+08:00', recordedBy: '人工演练记录员' };
const guard = () => {};
const bytes = (blob: Blob) => Blob.prototype.arrayBuffer.call(blob).then(value => new Uint8Array(value));
const pdf = (body = 'original') => new Blob([`%PDF-1.4\n${body}\n%%EOF\n`], { type: 'application/pdf' });
const png = () => new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSAAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });
// A minimal SOF-bearing JPEG envelope: format checks are not a visual or legal validation.
const jpeg = () => new Blob([new Uint8Array([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217])], { type: 'image/jpeg' });
const metadata = (attachmentId = id(3), agreementId = id(1)) => ({
  id: attachmentId, agreementId, fileName: '演练原件.pdf', purpose: 'agreement' as const,
  documentLabel: '模拟文件', sourceUrl: null, ...recorded,
});
const content = (documentRefs: string[] = [], title = '演练委托') => commercialContentSchema.parse({
  title, documentRefs, unconfirmedNote: '演练资料，主体及范围待人工核对',
});
const draftInput = (agreementId = id(1), draftId = id(2), title = '演练委托') => ({
  agreementId, direction: 'customer_commission' as const, dataKind: 'rehearsal' as const,
  expectedDraftToken: null, draft: { id: draftId, content: content([], title) },
});
const present = (read: CommercialRead): CommercialStoredSnapshot => {
  expect(read.status).toBe('present');
  if (read.status !== 'present') throw new Error('Expected a present snapshot');
  return read.value;
};
const token = (snapshot: CommercialStoredSnapshot, agreementId = id(1)) => {
  const draft = snapshot.dossier.agreements.find(agreement => agreement.id === agreementId)?.draft;
  if (!draft) throw new Error('Expected a saved draft');
  return draft.draftToken;
};
const report = (reportId = id(5), attachmentId = id(3)): Extract<CommercialSignatureReport, { kind: 'reported_signed' }> => {
  const parsed = commercialSignatureReportSchema.parse({
    id: reportId, agreementId: id(1), versionId: id(4), kind: 'reported_signed',
    observedParties: ['our'], signedOn: null, evidenceNote: '演练人工报告，不证明真实签署',
    attachmentIds: [attachmentId], ...recorded,
  });
  if (parsed.kind !== 'reported_signed') throw new Error('Expected the reported_signed fixture');
  return parsed;
};

/** File-local native-transaction substitute, with serialized transactions and clone boundaries.
 * The public source-storage API remains real. Browser cross-tab behavior requires UI verification. */
function database() {
  type Request = { result: unknown; error: Error | null; onsuccess?: () => void; onerror?: () => void };
  type Store = { get: (key: unknown) => Request; put: (value: unknown, key: unknown) => Request; delete: (key: unknown) => Request };
  type Transaction = {
    oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error: Error | null;
    objectStore: (name: string) => Store; abort: () => void;
  };
  let stored = new Map<string, unknown>(), busy = false;
  const queue: (() => void)[] = [], readyWrites: (() => void)[] = [];
  const control = {
    holdWrites: false, failReads: 0, failCommit: false,
    beforeWriteGet: undefined as (() => void) | undefined,
    afterCommit: undefined as (() => void) | undefined,
    deferNextOpen: undefined as Promise<unknown> | undefined,
    deferAfterNextOpen: undefined as Promise<unknown> | undefined,
  };
  const close = vi.fn(), put = vi.fn(), commits = vi.fn();
  const keyOf = (value: unknown) => JSON.stringify(value);
  const tick = () => { if (!busy && queue.length) { busy = true; queue.shift()!(); } };
  const transaction = (_name: string, mode: string) => {
    expect(_name).toBe('forms');
    let working = new Map<string, unknown>(), active = false, pending = 0, ended = false, dirty = false, held = false;
    const jobs: (() => void)[] = [];
    const done = () => { busy = false; queueMicrotask(tick); };
    const tx: Transaction = { error: null, objectStore: name => { expect(name).toBe('forms'); return ownStore; }, abort: () => {
      if (ended) return; ended = true; queueMicrotask(() => { tx.onabort?.(); done(); });
    } };
    const complete = () => {
      if (ended || pending) return;
      if (mode === 'readwrite' && dirty && control.failCommit) {
        control.failCommit = false; tx.error = new Error('QuotaExceededError: 容量不足'); ended = true;
        tx.onerror?.(); done(); return;
      }
      ended = true;
      if (mode === 'readwrite' && dirty) {
        stored = working; commits();
        const hook = control.afterCommit; control.afterCommit = undefined; hook?.();
      }
      tx.oncomplete?.(); done();
    };
    const finish = () => {
      if (ended || pending) return;
      if (mode === 'readwrite' && dirty && control.holdWrites) { if (!held) { held = true; readyWrites.push(complete); } }
      else complete();
    };
    const request = (action: () => unknown, reading: boolean): Request => {
      const result: Request = { result: undefined, error: null }; pending++;
      const job = () => queueMicrotask(() => {
        if (ended) return;
        try {
          if (reading && mode === 'readonly' && control.failReads > 0) {
            control.failReads--; throw new Error('本机读取失败');
          }
          if (reading && mode === 'readwrite') control.beforeWriteGet?.();
          result.result = action(); result.onsuccess?.();
        } catch (error) {
          result.error = error instanceof Error ? error : new Error(String(error)); tx.error = result.error;
          ended = true; result.onerror?.(); tx.onerror?.(); done(); return;
        }
        pending--; queueMicrotask(finish);
      });
      if (active) job(); else jobs.push(job);
      return result;
    };
    const ownStore = {
      get: (recordKey: unknown) => request(() => structuredClone(working.get(keyOf(recordKey))), true),
      put: (value: unknown, recordKey: unknown) => {
        const cloned = structuredClone(value); // Native IDB rejects uncloneable input synchronously.
        put(recordKey, cloned); dirty = true;
        return request(() => { working.set(keyOf(recordKey), cloned); return recordKey; }, false);
      },
      delete: (recordKey: unknown) => { dirty = true; return request(() => working.delete(keyOf(recordKey)), false); },
    };
    queue.push(() => { working = structuredClone(stored); active = true; jobs.forEach(job => job()); });
    queueMicrotask(tick);
    return tx;
  };
  vi.stubGlobal('indexedDB', { open: () => {
    const request = { result: { close, transaction }, error: null as Error | null,
      onsuccess: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined };
    // Delay one caller's connection, not the serial transaction queue. A real foreign
    // API starts its initial read before this gate is set and may then finish normally.
    const gate = control.deferNextOpen; control.deferNextOpen = undefined;
    // A foreign save first awaits preparation. Let its initial connection proceed,
    // then gate the committing caller's readback while the foreign operation finishes.
    if (control.deferAfterNextOpen) {
      control.deferNextOpen = control.deferAfterNextOpen; control.deferAfterNextOpen = undefined;
    }
    if (gate) void gate.then(() => request.onsuccess?.(), error => {
      request.error = error instanceof Error ? error : new Error(String(error)); request.onerror?.();
    });
    else queueMicrotask(() => request.onsuccess?.());
    return request;
  } });
  return {
    control, close, put, commits,
    read: (recordKey: unknown = key) => structuredClone(stored.get(keyOf(recordKey))),
    seed: (value: unknown, recordKey: unknown = key) => { stored.set(keyOf(recordKey), structuredClone(value)); },
    completeWrite: () => { const complete = readyWrites.shift(); if (!complete) throw new Error('No ready write'); complete(); },
    ready: () => readyWrites.length,
  };
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function storedDraft() {
  const prepared = await prepareCommercialOriginal(metadata(), pdf());
  const value = present(await saveCommercialDraft(projectId, {
    ...draftInput(), draft: { id: id(2), content: content([id(3)]) },
    attachmentRefs: [prepared.attachment], originals: [prepared],
  }, guard));
  return { value, prepared };
}
async function fixed() {
  const { value, prepared } = await storedDraft();
  const frozen = present(await freezeCommercialVersion(projectId, id(1), token(value), {
    id: id(4), fixingNote: '明确固定演练原件', ...recorded,
  }, guard));
  return { value: frozen, prepared };
}

describe('commercial originals are actual original bytes', () => {
  it.each([[pdf, 'application/pdf'], [png, 'image/png'], [jpeg, 'image/jpeg']] as const)('prepares %s without rewriting bytes', async (make, mimeType) => {
    const blob = make(), before = await bytes(blob);
    const prepared = await prepareCommercialOriginal(metadata(), blob);
    expect(prepared.attachment).toMatchObject({ sourceState: 'local-file', mimeType, byteSize: blob.size });
    expect(prepared.attachment.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await bytes(prepared.blob)).toEqual(before);
    await expect(verifyCommercialOriginal(prepared.attachment, prepared.blob)).resolves.toBeUndefined();
  });
  it('uses magic bytes rather than a claimed MIME and refuses HTML, truncated or zero-size originals', async () => {
    const disguised = new Blob([await bytes(pdf())], { type: 'text/html' });
    expect((await prepareCommercialOriginal(metadata(), disguised)).attachment.mimeType).toBe('application/pdf');
    for (const blob of [new Blob(), new Blob(['<html>']), new Blob(['%PDF-1.4']), new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]), new Blob([new Uint8Array([255, 216, 255, 217])])]) {
      await expect(prepareCommercialOriginal(metadata(), blob)).rejects.toThrow();
    }
  });
  it('checks actual size, exact metadata hash and MIME, not local-file declaration alone', async () => {
    const prepared = await prepareCommercialOriginal(metadata(), pdf('AAAA'));
    await expect(verifyCommercialOriginal(prepared.attachment, pdf('BBBB'))).rejects.toThrow();
    await expect(verifyCommercialOriginal({ ...prepared.attachment, byteSize: prepared.blob.size + 1 }, prepared.blob)).rejects.toThrow();
    await expect(verifyCommercialOriginal({ ...prepared.attachment, mimeType: 'image/png' }, prepared.blob)).rejects.toThrow();
    await expect(verifyCommercialOriginal({ ...prepared.attachment, sha256: '0'.repeat(64) }, prepared.blob)).rejects.toThrow();
    const over = new Blob(['%PDF-1.4\n', new Uint8Array(commercialDossierLimits.fileBytes), '\n%%EOF']);
    await expect(prepareCommercialOriginal(metadata(), over)).rejects.toThrow();
  });
  it('accepts the exact 10MiB boundary and keeps the original byte count', async () => {
    const header = '%PDF-1.4\n', end = '\n%%EOF\n';
    const blob = new Blob([header, new Uint8Array(commercialDossierLimits.fileBytes - header.length - end.length), end]);
    expect((await prepareCommercialOriginal(metadata(), blob)).attachment.byteSize).toBe(commercialDossierLimits.fileBytes);
  });
  it('rejects fake Blob brands and a failed digest without changing caller metadata', async () => {
    const input = metadata(), before = structuredClone(input);
    await expect(prepareCommercialOriginal(input, { size: 10, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(10) } as unknown as Blob)).rejects.toThrow();
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockRejectedValue(new Error('摘要失败')) } });
    await expect(prepareCommercialOriginal(input, pdf())).rejects.toThrow();
    expect(input).toEqual(before);
  });
  it('uses native Blob bytes rather than overridden subclass accessors', async () => {
    class MisleadingBlob extends Blob { override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('caller override'); } }
    const blob = new MisleadingBlob(['%PDF-1.4\nreal original\n%%EOF']);
    const prepared = await prepareCommercialOriginal(metadata(), blob);
    await expect(verifyCommercialOriginal(prepared.attachment, prepared.blob)).resolves.toBeUndefined();
    expect(await bytes(prepared.blob)).toEqual(await bytes(blob));
  });
});

describe('commercial native form storage and draft CAS', () => {
  it('distinguishes an absent row from read errors and damaged private containers', async () => {
    const db = database();
    expect(await readCommercialSnapshot(projectId, guard)).toEqual({ status: 'absent', projectId });
    db.control.failReads = 1;
    await expect(readCommercialSnapshot(projectId, guard)).rejects.toThrow('读取失败');
    db.seed({ schemaVersion: 1, storageToken: 'damaged', dossier: { projectId, dataKind: 'invalid' }, originals: {} });
    await expect(readCommercialSnapshot(projectId, guard)).rejects.toThrow();
    db.seed({ schemaVersion: 1, storageToken: 'extra', dossier: commercialDossierSchema.parse({ projectId }), originals: {}, unknown: true });
    await expect(readCommercialSnapshot(projectId, guard)).rejects.toThrow();
  });
  it('saves record and original together, waits for native commit and reads detached original bytes', async () => {
    const db = database(), prepared = await prepareCommercialOriginal(metadata(), pdf());
    db.control.holdWrites = true;
    const input = { ...draftInput(), draft: { id: id(2), content: content([id(3)]) }, attachmentRefs: [prepared.attachment], originals: [prepared] };
    const pending = saveCommercialDraft(projectId, input, guard); let settled = false;
    void pending.then(() => { settled = true; });
    await vi.waitFor(() => expect(db.ready()).toBe(1));
    expect(db.read()).toBeUndefined(); expect(settled).toBe(false);
    input.draft.content.title = 'after invocation'; input.attachmentRefs[0].documentLabel = 'after invocation';
    db.completeWrite(); db.control.holdWrites = false;
    const value = present(await pending);
    expect(value.dossier.agreements[0].draft?.content.title).toBe('演练委托');
    expect(value.dossier.attachmentRefs[0].documentLabel).toBe('模拟文件');
    expect(await bytes(value.originals[id(3)])).toEqual(await bytes(prepared.blob));
    expect(await readSourceRecord(key)).toEqual(db.read());
    value.dossier.agreements[0].draft!.content.title = 'read result mutation';
    expect(present(await readCommercialSnapshot(projectId, guard)).dossier.agreements[0].draft?.content.title).toBe('演练委托');
    expect(db.put.mock.calls.every(([storedKey]) => JSON.stringify(storedKey) === JSON.stringify(key))).toBe(true);
  });
  it('serializes competing old-token writes to one draft, preserving the winning edit', async () => {
    const db = database(), original = present(await saveCommercialDraft(projectId, draftInput(), guard));
    const expectedDraftToken = token(original);
    const result = await Promise.allSettled(['first edit', 'second edit'].map(title => saveCommercialDraft(projectId, {
      ...draftInput(), expectedDraftToken, draft: { id: id(2), content: content([], title) },
    }, guard)));
    expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(value => value.status === 'rejected')).toHaveLength(1);
    const latest = present(await readCommercialSnapshot(projectId, guard));
    expect(['first edit', 'second edit']).toContain(latest.dossier.agreements[0].draft?.content.title);
    expect(token(latest)).not.toBe(expectedDraftToken); expect(db.commits).toHaveBeenCalledTimes(2);
  });
  it('allows concurrent drafts of different agreements without losing either', async () => {
    database();
    await Promise.all([saveCommercialDraft(projectId, draftInput(), guard), saveCommercialDraft(projectId, draftInput(id(10), id(11), '租赁演练'), guard)]);
    const latest = present(await readCommercialSnapshot(projectId, guard));
    expect(latest.dossier.agreements.map(value => value.id).sort()).toEqual([id(1), id(10)].sort());
  });
  it('confirms B after another real operation discards unrelated A and its temporary original before B readback', async () => {
    const db = database(), { value: a } = await storedDraft();
    const bOriginal = await prepareCommercialOriginal(metadata(id(13), id(10)), pdf('B original'));
    let foreign: Promise<CommercialRead> | undefined;
    db.control.afterCommit = () => {
      foreign = discardCommercialDraft(projectId, id(1), token(a), guard);
      db.control.deferNextOpen = foreign;
    };
    const b = present(await saveCommercialDraft(projectId, { ...draftInput(id(10), id(11), 'B saved'),
      draft: { id: id(11), content: content([id(13)], 'B saved') }, originals: [bOriginal],
    }, guard));
    expect(foreign).toBeDefined(); await foreign;
    expect(b.dossier.agreements.map(agreement => agreement.id)).toEqual([id(10)]);
    expect(b.dossier.agreements[0].draft?.content).toEqual(content([id(13)], 'B saved'));
    expect(b.dossier.attachmentRefs).toEqual([bOriginal.attachment]);
    expect(Object.keys(b.originals)).toEqual([id(13)]);
    expect(await bytes(b.originals[id(13)])).toEqual(await bytes(bOriginal.blob));
    const readBack = present(await readCommercialSnapshot(projectId, guard));
    expect(readBack.dossier).toEqual(b.dossier); expect(readBack.originals[id(3)]).toBeUndefined();
    expect(await bytes(readBack.originals[id(13)])).toEqual(await bytes(bOriginal.blob));
    expect(db.commits).toHaveBeenCalledTimes(3);
  });
  it.each(['freeze', 'discard'] as const)('still reports B unconfirmed if a real concurrent %s changes B itself before readback', async action => {
    const db = database(), bOriginal = await prepareCommercialOriginal(metadata(id(13), id(10)), pdf('B original'));
    let foreign: Promise<CommercialRead> | undefined;
    db.control.afterCommit = () => {
      const committed = db.read() as CommercialStoredSnapshot;
      foreign = action === 'freeze'
        ? freezeCommercialVersion(projectId, id(10), token(committed, id(10)), { id: id(14), fixingNote: '并发明确固定B', ...recorded }, guard)
        : discardCommercialDraft(projectId, id(10), token(committed, id(10)), guard);
      db.control.deferNextOpen = foreign;
    };
    await expect(saveCommercialDraft(projectId, { ...draftInput(id(10), id(11), 'B saved'),
      draft: { id: id(11), content: content([id(13)], 'B saved') }, originals: [bOriginal],
    }, guard)).rejects.toMatchObject({ committed: true });
    expect(foreign).toBeDefined(); await foreign;
    const latest = present(await readCommercialSnapshot(projectId, guard));
    if (action === 'freeze') {
      expect(latest.dossier.agreements[0].draft).toBeNull();
      expect(latest.dossier.agreements[0].versions[0].id).toBe(id(14));
      expect(await bytes(latest.originals[id(13)])).toEqual(await bytes(bOriginal.blob));
    } else {
      expect(latest.dossier.agreements).toEqual([]); expect(latest.originals).toEqual({});
    }
    expect(db.commits).toHaveBeenCalledTimes(2);
  });
  it('still reports B unconfirmed when real cleanup removes its new unreferenced original without changing B draft token', async () => {
    const db = database(), bOriginal = await prepareCommercialOriginal(metadata(id(13), id(10)), pdf('B original'));
    let foreign: Promise<CommercialRead> | undefined, committedDraftToken = '';
    db.control.afterCommit = () => {
      const committed = db.read() as CommercialStoredSnapshot;
      committedDraftToken = token(committed, id(10));
      foreign = saveCommercialDraft(projectId, { ...draftInput(id(10), id(11), 'B saved'),
        expectedDraftToken: committedDraftToken, cleanupUnreferenced: true,
      }, guard);
      db.control.deferAfterNextOpen = foreign;
    };
    await expect(saveCommercialDraft(projectId, { ...draftInput(id(10), id(11), 'B saved'), originals: [bOriginal] }, guard))
      .rejects.toMatchObject({ committed: true });
    expect(foreign).toBeDefined(); const cleaned = present(await foreign!);
    expect(token(cleaned, id(10))).toBe(committedDraftToken);
    expect(cleaned.dossier.agreements[0].draft?.content).toEqual(content([], 'B saved'));
    expect(cleaned.dossier.attachmentRefs).toEqual([]); expect(cleaned.originals).toEqual({});
    const latest = present(await readCommercialSnapshot(projectId, guard));
    expect(token(latest, id(10))).toBe(committedDraftToken); expect(latest.originals[id(13)]).toBeUndefined();
    expect(db.commits).toHaveBeenCalledTimes(2);
  });
  it('retains old record and caller input when the native transaction fails', async () => {
    const db = database(), original = present(await saveCommercialDraft(projectId, draftInput(), guard));
    const before = db.read(), input = { ...draftInput(), expectedDraftToken: token(original), draft: { id: id(2), content: content([], 'unsaved edit') } };
    const copied = structuredClone(input); db.control.failCommit = true;
    await expect(saveCommercialDraft(projectId, input, guard)).rejects.toThrow('容量不足');
    expect(db.read()).toEqual(before); expect(input).toEqual(copied);
  });
  it('does not write when actual Blob reading fails during file preparation or existing-byte validation', async () => {
    const db = database(), { value, prepared } = await storedDraft(), before = db.read();
    const input = { ...draftInput(), expectedDraftToken: token(value), originals: [prepared] };
    const copied = structuredClone(input), read = vi.spyOn(Blob.prototype, 'arrayBuffer').mockRejectedValueOnce(new Error('原字节读取失败'));
    await expect(saveCommercialDraft(projectId, input, guard)).rejects.toThrow('原字节读取失败');
    expect(db.read()).toEqual(before); expect(input).toEqual(copied);
    read.mockRejectedValueOnce(new Error('已存原件读失败'));
    await expect(readCommercialSnapshot(projectId, guard)).rejects.toThrow('已存原件读失败');
    expect(db.read()).toEqual(before);
  });
  it('rejects attachment array index and custom map getters without invoking them or changing storage', async () => {
    const db = database(), { value, prepared } = await storedDraft(), before = db.read();
    for (const property of ['0', 'map']) {
      const attachmentRefs: CommercialAttachment[] = property === '0' ? [] : [prepared.attachment];
      const getter = vi.fn(() => property === '0' ? prepared.attachment : Array.prototype.map);
      Object.defineProperty(attachmentRefs, property, { enumerable: true, configurable: true, get: getter });
      await expect(saveCommercialDraft(projectId, { ...draftInput(), expectedDraftToken: token(value), attachmentRefs }, guard)).rejects.toThrow();
      expect(getter).not.toHaveBeenCalled(); expect(db.read()).toEqual(before);
    }
  });
  it('rejects an original array index getter without reading its value or changing storage', async () => {
    const db = database(), { value, prepared } = await storedDraft(), before = db.read();
    const originals: typeof prepared[] = [], getter = vi.fn(() => prepared);
    Object.defineProperty(originals, '0', { enumerable: true, configurable: true, get: getter });
    await expect(saveCommercialDraft(projectId, { ...draftInput(), expectedDraftToken: token(value), originals }, guard)).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(db.read()).toEqual(before);
  });
  it('rechecks scope within the transaction and refuses async guards', async () => {
    const db = database(), original = present(await saveCommercialDraft(projectId, draftInput(), guard));
    const before = db.read(); let stale = false;
    db.control.beforeWriteGet = () => { stale = true; };
    await expect(saveCommercialDraft(projectId, { ...draftInput(), expectedDraftToken: token(original) }, () => { if (stale) throw new Error('scope expired'); })).rejects.toThrow('scope expired');
    expect(db.read()).toEqual(before); db.control.beforeWriteGet = undefined;
    await expect(readCommercialSnapshot(projectId, async () => {})).rejects.toThrow();
    await expect(saveCommercialDraft(projectId, draftInput(id(10), id(11)), async () => {})).rejects.toThrow();
    expect(db.read()).toEqual(before);
  });
  it('reports postcommit readback failure without deleting a committed record', async () => {
    const db = database(); db.control.afterCommit = () => { db.control.failReads = 1; };
    let error: unknown;
    try { await saveCommercialDraft(projectId, draftInput(), guard); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error); expect(error).toMatchObject({ committed: true });
    expect(db.commits).toHaveBeenCalledOnce();
    expect(present(await readCommercialSnapshot(projectId, guard)).dossier.agreements[0].draft?.content.title).toBe('演练委托');
  });
  it('reports a context change after commit as committed but unconfirmed, retaining the stored edit', async () => {
    const db = database(); let stale = false;
    db.control.afterCommit = () => { stale = true; };
    await expect(saveCommercialDraft(projectId, draftInput(), () => { if (stale) throw new Error('changed context'); })).rejects.toMatchObject({ committed: true });
    expect(present(await readCommercialSnapshot(projectId, guard)).dossier.agreements[0].draft?.content.title).toBe('演练委托');
    expect(db.commits).toHaveBeenCalledOnce();
  });
  it('rejects missing true bytes, extra bytes, cross-project and changed data kind without a write', async () => {
    const db = database(), { value, prepared } = await storedDraft(), before = db.read();
    await expect(validateCommercialSnapshot(projectId, { ...value, originals: {} })).rejects.toThrow();
    await expect(validateCommercialSnapshot(projectId, { ...value, originals: { ...value.originals, [id(99)]: pdf() } })).rejects.toThrow();
    await expect(validateCommercialSnapshot('other-project', value)).rejects.toThrow();
    await expect(saveCommercialDraft(projectId, { ...draftInput(), expectedDraftToken: token(value), dataKind: 'real' }, guard)).rejects.toThrow();
    await expect(saveCommercialDraft(projectId, { ...draftInput(), expectedDraftToken: token(value), originals: [{ attachment: prepared.attachment, blob: pdf('changed same size') }] }, guard)).rejects.toThrow();
    expect(db.read()).toEqual(before);
  });
  it('retains unknown external and missing sources without fetching or inventing originals', async () => {
    database(); const fetcher = vi.fn().mockRejectedValue(new Error('network prohibited')); vi.stubGlobal('fetch', fetcher);
    const refs: CommercialAttachment[] = [
      { ...metadata(), sourceState: 'external-reference', sourceUrl: 'https://example.test/original', fileName: null, mimeType: null, byteSize: null, sha256: null },
      { ...metadata(id(6)), sourceState: 'missing', fileName: null, mimeType: null, byteSize: null, sha256: null },
    ];
    const value = present(await saveCommercialDraft(projectId, { ...draftInput(), draft: { id: id(2), content: content([id(3), id(6)]) }, attachmentRefs: refs }, guard));
    expect(value.originals).toEqual({}); expect(value.dossier.attachmentRefs).toEqual(refs); expect(fetcher).not.toHaveBeenCalled();
  });
  it('checks actual project-byte budget before changing an existing row', async () => {
    const db = database(), original = present(await saveCommercialDraft(projectId, draftInput(), guard)), before = db.read();
    const header = '%PDF-1.4\n', end = '\n%%EOF\n';
    const blob = new Blob([header, new Uint8Array(9 * 1024 * 1024 - header.length - end.length), end]);
    const originals = await Promise.all([20, 21, 22, 23].map(n => prepareCommercialOriginal(metadata(id(n)), blob)));
    const readBytes = vi.spyOn(Blob.prototype, 'arrayBuffer');
    await expect(saveCommercialDraft(projectId, { ...draftInput(), expectedDraftToken: token(original),
      draft: { id: id(2), content: content(originals.map(value => value.attachment.id)) },
      originals, attachmentRefs: originals.map(value => value.attachment),
    }, guard)).rejects.toThrow();
    expect(readBytes).not.toHaveBeenCalled(); expect(db.read()).toEqual(before);
    const duplicate = { attachment: { ...originals[0].attachment, id: originals[0].attachment.id.toUpperCase() }, blob: originals[0].blob };
    await expect(saveCommercialDraft(projectId, { ...draftInput(), expectedDraftToken: token(original),
      draft: { id: id(2), content: content([originals[0].attachment.id]) }, originals: [originals[0], duplicate],
    }, guard)).rejects.toThrow();
    expect(readBytes).not.toHaveBeenCalled(); expect(db.read()).toEqual(before);
  });
  it('accepts the exact 32MiB project boundary without recompressing any file', async () => {
    database(); const header = '%PDF-1.4\n', end = '\n%%EOF\n';
    const blob = new Blob([header, new Uint8Array(8 * 1024 * 1024 - header.length - end.length), end]);
    const originals = await Promise.all([20, 21, 22, 23].map(n => prepareCommercialOriginal(metadata(id(n)), blob)));
    const value = present(await saveCommercialDraft(projectId, { ...draftInput(),
      draft: { id: id(2), content: content(originals.map(row => row.attachment.id)) }, originals,
    }, guard));
    expect(Object.values(value.originals).reduce((sum, row) => sum + row.size, 0)).toBe(commercialDossierLimits.projectFileBytes);
  });
  it('keeps nested defaults independent across stored drafts and subsequent reads', async () => {
    database();
    const one = present(await saveCommercialDraft(projectId, draftInput(), guard));
    await saveCommercialDraft(projectId, draftInput(id(10), id(11)), guard);
    one.dossier.agreements[0].draft!.content.references.taskIds.push(id(80));
    one.dossier.agreements[0].draft!.content.ourParty.name = 'mutated';
    const read = present(await readCommercialSnapshot(projectId, guard));
    expect(read.dossier.agreements.every(value => value.draft?.content.references.taskIds.length === 0 && value.draft.content.ourParty.name === '')).toBe(true);
  });
});

describe('fixed commercial history, reports and temporary attachment cleanup', () => {
  it('freezes exactly the CAS draft and does not mislabel fixing as a signature report', async () => {
    const db = database(), { value } = await fixed();
    expect(value.dossier.agreements[0].versions).toHaveLength(1);
    expect(value.dossier.agreements[0].versions[0].content.documentRefs).toEqual([id(3)]);
    expect(value.dossier.signatureReports).toEqual([]);
    const before = db.read();
    await expect(freezeCommercialVersion(projectId, id(1), 'old-token', { id: id(9), fixingNote: 'stale', ...recorded }, guard)).rejects.toThrow();
    expect(db.read()).toEqual(before);
  });
  it('appends concurrent independent manual reports and keeps the original bytes', async () => {
    database(); const { prepared } = await fixed();
    await Promise.all([appendCommercialSignatureReport(projectId, report(), {}, guard), appendCommercialSignatureReport(projectId, report(id(6)), {}, guard)]);
    const latest = present(await readCommercialSnapshot(projectId, guard));
    expect(latest.dossier.signatureReports.map(value => value.id).sort()).toEqual([id(5), id(6)].sort());
    expect(await bytes(latest.originals[id(3)])).toEqual(await bytes(prepared.blob));
    await appendCommercialSignatureReport(projectId, report(), {}, guard);
    expect(present(await readCommercialSnapshot(projectId, guard)).dossier.signatureReports).toHaveLength(2);
  });
  it('protects original, correction and void evidence even after their effective report was voided', async () => {
    database(); await fixed();
    const correctionFile = await prepareCommercialOriginal(metadata(id(7)), pdf('correction'));
    const voidFile = await prepareCommercialOriginal(metadata(id(8)), pdf('void evidence'));
    await appendCommercialSignatureReport(projectId, report(), {}, guard);
    const corrected = commercialSignatureReportSchema.parse({ id: id(6), agreementId: id(1), versionId: id(4), kind: 'correction', targetId: id(5), reason: '更正演练说明',
      replacement: { observedParties: ['counterparty'], signedOn: null, evidenceNote: '修正人工所见', attachmentIds: [id(7)] }, ...recorded });
    await appendCommercialSignatureReport(projectId, corrected, { attachmentRefs: [correctionFile.attachment], originals: [correctionFile] }, guard);
    const voided = commercialSignatureReportSchema.parse({ id: id(9), agreementId: id(1), versionId: id(4), kind: 'void', targetId: id(6), reason: '作废演练人工报告', evidenceNote: '原报告继续保留', attachmentIds: [id(8)], ...recorded });
    const value = present(await appendCommercialSignatureReport(projectId, voided, { attachmentRefs: [voidFile.attachment], originals: [voidFile] }, guard));
    const input = { ...draftInput(), expectedDraftToken: value.dossier.agreements[0].draft?.draftToken ?? null,
      draft: { id: id(12), basedOnVersionId: id(4), content: content([], 'new editable scope') }, cleanupUnreferenced: true };
    const edited = present(await saveCommercialDraft(projectId, input, guard));
    expect(edited.dossier.signatureReports).toHaveLength(3);
    expect(Object.keys(edited.originals).sort()).toEqual([id(3), id(7), id(8)].sort());
    expect(edited.dossier.attachmentRefs.map(value => value.id).sort()).toEqual([id(3), id(7), id(8)].sort());
  });
  it('cleans only unreferenced temporary files, and explicit discard requires the current draft token', async () => {
    const db = database(), { value } = await storedDraft();
    const edited = present(await saveCommercialDraft(projectId, { ...draftInput(), expectedDraftToken: token(value), draft: { id: id(2), content: content([]) }, cleanupUnreferenced: true }, guard));
    expect(edited.originals).toEqual({}); expect(edited.dossier.attachmentRefs).toEqual([]);
    const before = db.read();
    await expect(discardCommercialDraft(projectId, id(1), token(value), guard)).rejects.toThrow();
    expect(db.read()).toEqual(before);
    const discarded = await discardCommercialDraft(projectId, id(1), token(edited), guard);
    if (discarded.status === 'present') expect(discarded.value.dossier.agreements.every(value => value.draft === null)).toBe(true);
  });
  it('refuses edits to fixed IDs, report branches and cross-agreement attachment references atomically', async () => {
    const db = database(); await fixed(); await appendCommercialSignatureReport(projectId, report(), {}, guard); const before = db.read();
    await expect(appendCommercialSignatureReport(projectId, { ...report(), evidenceNote: 'changed same report' }, {}, guard)).rejects.toThrow();
    const correction = (n: number) => commercialSignatureReportSchema.parse({ id: id(n), agreementId: id(1), versionId: id(4), kind: 'correction', targetId: id(5), reason: '演练更正', replacement: { observedParties: ['our'], signedOn: null, evidenceNote: '演练', attachmentIds: [id(3)] }, ...recorded });
    await appendCommercialSignatureReport(projectId, correction(6), {}, guard); const branchBefore = db.read();
    await expect(appendCommercialSignatureReport(projectId, correction(7), {}, guard)).rejects.toThrow();
    expect(db.read()).toEqual(branchBefore);
    expect(before).not.toEqual(branchBefore);
    await expect(saveCommercialDraft(projectId, { ...draftInput(id(10), id(11)), draft: { id: id(11), content: content([id(3)]) } }, guard)).rejects.toThrow();
    expect(db.read()).toEqual(branchBefore);
  });
});

describe('same-project commercial restore is an atomic protected union', () => {
  it('round-trips the complete package through real backup and native storage modules on an empty target', async () => {
    database(); const { value, prepared } = await storedDraft();
    const source = await readCommercialSnapshot(projectId, guard);
    const serialized = await serializeCommercialBackup(source, { id: 'commercial-package-integration', generatedAt: recorded.recordedAt });
    const targetDatabase = database();
    expect(await readCommercialSnapshot(projectId, guard)).toEqual({ status: 'absent', projectId });
    const restored = present(await restoreCommercialBackupJson(serialized, projectId, { [id(1)]: null }, guard));
    expect(token(restored)).not.toBe(token(value));
    const expectedRecords = structuredClone(value.dossier);
    expectedRecords.agreements[0].draft!.draftToken = token(restored);
    expect(restored.dossier).toEqual(expectedRecords);
    expect(await bytes(restored.originals[id(3)])).toEqual(await bytes(prepared.blob));
    const readBack = present(await readCommercialSnapshot(projectId, guard));
    expect(readBack.dossier).toEqual(expectedRecords);
    expect(await bytes(readBack.originals[id(3)])).toEqual(await bytes(prepared.blob));
    expect(targetDatabase.commits).toHaveBeenCalledOnce();
  });
  it('rejects case-duplicate target agreement token keys before any storage side effects', async () => {
    const db = database(), { value } = await storedDraft(), before = db.read();
    const expectedDraftTokens = { [id(1)]: token(value), [id(1).toUpperCase()]: token(value) };
    await expect(restoreCommercialSnapshot(projectId, value, expectedDraftTokens, guard)).rejects.toThrow();
    expect(db.read()).toEqual(before); expect(db.commits).toHaveBeenCalledOnce();
  });
  it('restores original bytes, creates a fresh target draft token and is idempotent', async () => {
    database(); const { value, prepared } = await storedDraft();
    const sourceToken = token(value), incoming = structuredClone(value);
    const empty = database();
    const restored = present(await restoreCommercialSnapshot(projectId, incoming, { [id(1)]: null }, guard));
    expect(token(restored)).not.toBe(sourceToken); expect(incoming).toEqual(value);
    expect(await bytes(restored.originals[id(3)])).toEqual(await bytes(prepared.blob));
    const result = present(await restoreCommercialSnapshot(projectId, incoming, { [id(1)]: token(restored) }, guard));
    expect(token(result)).toBe(token(restored)); expect(result.dossier).toEqual(restored.dossier);
    expect(empty.read()).toBeDefined();
  });
  it('keeps absence and incoming missing drafts from deleting local facts', async () => {
    const db = database(); const { value } = await storedDraft(); const before = db.read();
    const absent = present(await restoreCommercialSnapshot(projectId, undefined, {}, guard));
    expect(absent.dossier).toEqual(value.dossier); expect(db.read()).toEqual(before);
    const incoming = structuredClone(value); incoming.dossier.agreements[0].draft = null;
    const preserved = present(await restoreCommercialSnapshot(projectId, incoming, {}, guard));
    expect(preserved.dossier.agreements[0].draft).toEqual(value.dossier.agreements[0].draft);
  });
  it('unions legal fixed histories and reports without copying an old storage token', async () => {
    database(); const { value } = await fixed();
    const incoming = structuredClone(value); incoming.storageToken = 'source-opaque-token'; incoming.dossier.signatureReports.push(report());
    const target = present(await restoreCommercialSnapshot(projectId, incoming, {}, guard));
    expect(target.dossier.agreements[0].versions).toEqual(value.dossier.agreements[0].versions);
    expect(target.dossier.signatureReports).toEqual([report()]); expect(target.storageToken).not.toBe('source-opaque-token');
  });
  it('rejects different content under a fixed version ID and a legal-but-conflicting version branch', async () => {
    const db = database(), { value } = await fixed(), before = db.read();
    const changed = structuredClone(value); changed.dossier.agreements[0].versions[0].content.title = 'changed original';
    await expect(restoreCommercialSnapshot(projectId, changed, {}, guard)).rejects.toThrow();
    expect(db.read()).toEqual(before);
    const branch = (n: number) => {
      const incoming = structuredClone(value), root = incoming.dossier.agreements[0].versions[0];
      incoming.dossier.agreements[0].versions.push({ ...root, id: id(n), basedOnVersionId: root.id, fixingNote: 'next version' });
      return incoming;
    };
    await restoreCommercialSnapshot(projectId, branch(10), {}, guard); const latest = db.read();
    await expect(restoreCommercialSnapshot(projectId, branch(11), {}, guard)).rejects.toThrow();
    expect(db.read()).toEqual(latest);
  });
  it('rejects old target draft authorization and different mutable contents, keeping both inputs', async () => {
    const db = database(), original = present(await saveCommercialDraft(projectId, draftInput(), guard));
    const incoming = structuredClone(original); incoming.dossier.agreements[0].draft!.content.title = 'different imported draft';
    const copy = structuredClone(incoming), before = db.read();
    await expect(restoreCommercialSnapshot(projectId, incoming, { [id(1)]: token(original) }, guard)).rejects.toThrow();
    expect(db.read()).toEqual(before); expect(incoming).toEqual(copy);
    await expect(restoreCommercialSnapshot(projectId, original, { [id(1)]: 'stale-token' }, guard)).rejects.toThrow();
    expect(db.read()).toEqual(before);
  });
  it('rejects same-size different original bytes, wrong hash, different project and data kind before writing', async () => {
    const db = database(), { value } = await storedDraft(), before = db.read();
    const different = structuredClone(value); different.originals[id(3)] = pdf('different');
    const exactSize = new Blob([await bytes(value.originals[id(3)])]);
    const altered = new Uint8Array(await exactSize.arrayBuffer()); altered[10] ^= 1;
    different.originals[id(3)] = new Blob([altered]);
    expect(different.originals[id(3)].size).toBe(value.originals[id(3)].size);
    for (const invalid of [different, { ...value, dossier: { ...value.dossier, projectId: 'other-project' } }, { ...value, dossier: { ...value.dossier, dataKind: 'real' } }, { ...value, originals: {} }]) {
      await expect(restoreCommercialSnapshot(projectId, invalid as CommercialStoredSnapshot, { [id(1)]: token(value) }, guard)).rejects.toThrow();
    }
    expect(db.read()).toEqual(before);
  });
  it('retains a legal report added during postcommit readback rather than rolling history back', async () => {
    const db = database(), { value } = await fixed();
    const incoming = structuredClone(value); incoming.dossier.signatureReports.push(report());
    db.control.afterCommit = () => {
      const latest = db.read() as CommercialStoredSnapshot;
      latest.storageToken = 'legitimate-next-transaction'; latest.dossier.signatureReports.push(report(id(6)));
      db.seed(latest);
    };
    const merged = present(await restoreCommercialSnapshot(projectId, incoming, {}, guard));
    expect(merged.dossier.signatureReports.map(value => value.id).sort()).toEqual([id(5), id(6)].sort());
    expect((db.read() as CommercialStoredSnapshot).dossier.signatureReports).toHaveLength(2);
  });
  it('checks the exact stored original bytes even if a same-token container was corrupted', async () => {
    const db = database(), { value } = await storedDraft();
    const corrupted = structuredClone(value), altered = await bytes(corrupted.originals[id(3)]); altered[10] ^= 1;
    corrupted.originals[id(3)] = new Blob([altered]); db.seed(corrupted);
    await expect(readCommercialSnapshot(projectId, guard)).rejects.toThrow();
    await expect(restoreCommercialSnapshot(projectId, value, { [id(1)]: token(value) }, guard)).rejects.toThrow();
    expect(db.read()).toEqual(corrupted);
  });
  it('uses the real synchronous source updater and aborts an accidental async result', async () => {
    const db = database();
    await expect(updateSourceForm(key, async () => ({ unsafe: true }))).rejects.toThrow();
    expect(db.read()).toBeUndefined(); expect(db.commits).not.toHaveBeenCalled();
  });
});
