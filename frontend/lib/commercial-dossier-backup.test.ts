import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commercialDossierLimits, commercialDossierSchema, mergeCommercialDossiers } from '../../supabase/functions/_shared/commercial-dossier-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import {
  COMMERCIAL_BACKUP_COVERAGE, COMMERCIAL_BACKUP_FORMAT, MAX_COMMERCIAL_BACKUP_BYTES,
  encodeCommercialBackup, preflightCommercialBackupJson, restoreCommercialBackupJson, serializeCommercialBackup,
  type CommercialBackup,
} from './commercial-dossier-backup';
import { CommercialReadbackError, prepareCommercialOriginal, restoreCommercialSnapshot, type CommercialRead, type CommercialStoredSnapshot } from './commercial-dossier-storage';
import { createLocalProjectBackup, LOCAL_PROJECT_BACKUP_V1_COVERAGE, LOCAL_PROJECT_BACKUP_V3_COVERAGE, LOCAL_PROJECT_BACKUP_V4_COVERAGE } from './local-project-backup';

vi.mock('./commercial-dossier-storage', async importOriginal => ({
  ...await importOriginal<typeof import('./commercial-dossier-storage')>(), restoreCommercialSnapshot: vi.fn(),
}));
const id = (n: number) => `cd100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = '本机商务演练-1';
const generatedAt = '2026-10-09T09:12:15.123Z';
const metadata = { id: 'commercial-freeze-1', generatedAt };
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ioAAAAASUVORK5CYII='), c => c.charCodeAt(0));
// Minimal SOF + EOI fixture exercises the promised basic-format check, not a full image decoder.
const jpeg = new Uint8Array([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217]);
const restore = vi.mocked(restoreCommercialSnapshot);
const present = (value: CommercialStoredSnapshot): CommercialRead => ({ status: 'present', projectId: value.dossier.projectId, value });
const json = (value: unknown) => JSON.stringify(value);

async function snapshot(files: ('pdf' | 'png' | 'jpeg')[] = ['pdf']): Promise<CommercialStoredSnapshot> {
  const originals: Record<string, Blob> = {}, attachmentRefs = [];
  for (const [index, format] of files.entries()) {
    const bytes = { pdf, png, jpeg }[format];
    const file = await prepareCommercialOriginal({ id: id(index + 10), agreementId: id(1), fileName: `原件.${format}`,
      purpose: 'agreement', documentLabel: '演练原件', sourceUrl: null, recordedAt: generatedAt, recordedBy: '手工录入人' }, new Blob([bytes]));
    attachmentRefs.push(file.attachment); originals[file.attachment.id.toLowerCase()] = file.blob;
  }
  const dossier = commercialDossierSchema.parse({ projectId, dataKind: 'rehearsal', attachmentRefs,
    agreements: [{ id: id(1), direction: 'customer_commission', draft: { id: id(2), draftToken: 'source-draft-token',
      content: { title: '客户委托草稿', documentRefs: attachmentRefs.map(ref => ref.id), scopeIn: '原范围待核' } } }] });
  return { schemaVersion: 1, storageToken: 'source-storage-token', dossier, originals };
}
async function backup(): Promise<CommercialBackup> { return encodeCommercialBackup(present(await snapshot()), metadata); }

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  restore.mockReset();
  restore.mockResolvedValue({ status: 'absent', projectId });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('complete commercial originals package', () => {
  it('roundtrips original PDF/PNG/JPEG bytes and all public records without claiming signature or payment facts', async () => {
    const input = await snapshot(['pdf', 'png', 'jpeg']), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const text = await serializeCommercialBackup(present(input), metadata);
    const encoded = JSON.parse(text) as CommercialBackup;
    expect(encoded).toMatchObject({ format: COMMERCIAL_BACKUP_FORMAT, version: 1, projectId, ...metadata,
      dataKind: 'rehearsal', coverage: COMMERCIAL_BACKUP_COVERAGE });
    expect(encoded.records).toEqual({ status: 'present', value: input.dossier });
    expect(encoded.files.map(file => file.status)).toEqual(['included', 'included', 'included']);
    expect(text).not.toContain('source-storage-token');
    const result = await preflightCommercialBackupJson(text, projectId);
    expect(result.status).toBe('present');
    if (result.status !== 'present') throw new Error('expected present');
    expect(result.value.dossier).toEqual(input.dossier); expect(result.value.storageToken).toBe('package-preflight');
    for (const [key, original] of Object.entries(input.originals)) {
      expect(await result.value.originals[key].arrayBuffer()).toEqual(await original.arrayBuffer());
      expect(result.value.originals[key].type).toBe(original.type);
    }
    expect(result.value.dossier.signatureReports).toEqual([]);
    expect(fetch).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
  });

  it('is deterministic for the same complete read and explicit generation metadata', async () => {
    const input = present(await snapshot());
    expect(await serializeCommercialBackup(input, metadata)).toBe(await serializeCommercialBackup(input, metadata));
    const first = await serializeCommercialBackup(input, metadata);
    expect(await serializeCommercialBackup(input, { ...metadata, generatedAt: '2026-10-10T01:00:00Z' })).not.toBe(first);
  });

  it('uses null dataKind for explicitly absent records and never synthesizes an empty dossier', async () => {
    const encoded = await encodeCommercialBackup({ status: 'absent', projectId }, metadata);
    expect(encoded).toMatchObject({ dataKind: null, records: { status: 'absent' }, files: [] });
    expect(await preflightCommercialBackupJson(json(encoded), projectId)).toEqual({ status: 'absent', projectId, ...metadata });
  });

  it('preserves external and missing unknown metadata without fetching them or claiming byte proof', async () => {
    const value = await snapshot([]);
    value.dossier = commercialDossierSchema.parse({ ...value.dossier, attachmentRefs: [{ id: id(20), agreementId: id(1),
      purpose: 'quotation', sourceState: 'external-reference', sourceUrl: 'https://example.test/quote', recordedAt: generatedAt, recordedBy: '记录人' },
    { id: id(21), agreementId: id(1), purpose: 'supporting', sourceState: 'missing', recordedAt: generatedAt, recordedBy: '记录人' }] });
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const encoded = await encodeCommercialBackup(present(value), metadata);
    expect(encoded.files).toEqual([{ attachmentId: id(20), status: 'external-reference' }, { attachmentId: id(21), status: 'missing' }]);
    const result = await preflightCommercialBackupJson(json(encoded), projectId);
    expect(result.status).toBe('present');
    if (result.status === 'present') {
      expect(result.value.originals).toEqual({});
      expect(result.value.dossier.attachmentRefs).toEqual(value.dossier.attachmentRefs);
      expect(result.value.dossier.attachmentRefs[0]).toMatchObject({ fileName: null, mimeType: null, byteSize: null, sha256: null });
    }
    expect(network).not.toHaveBeenCalled();
  });

  it('normalizes only blob map keys while preserving original record ID spelling', async () => {
    const value = await snapshot();
    value.dossier.attachmentRefs[0].id = id(10).toUpperCase();
    value.dossier.agreements[0].draft!.content.documentRefs = [id(10).toUpperCase()];
    const result = await preflightCommercialBackupJson(await serializeCommercialBackup(present(value), metadata), projectId);
    if (result.status !== 'present') throw new Error('expected present');
    expect(result.value.dossier.attachmentRefs[0].id).toBe(id(10).toUpperCase());
    expect(Object.keys(result.value.originals)).toEqual([id(10)]);
  });

  it('freezes records, blob references and metadata before asynchronous hash validation', async () => {
    const value = await snapshot(), input = present(value), info = { ...metadata };
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const native = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => { await gate; return native(...args); });
    const pending = encodeCommercialBackup(input, info);
    value.dossier.agreements[0].draft!.content.title = 'later input'; value.dossier.dataKind = 'real';
    value.dossier.attachmentRefs[0].fileName = 'later.pdf'; value.originals[id(10)] = new Blob(['different']);
    info.generatedAt = '2026-10-10T00:00:00Z'; finish();
    const encoded = await pending;
    expect(encoded.generatedAt).toBe(generatedAt); expect(encoded.dataKind).toBe('rehearsal');
    if (encoded.records.status !== 'present') throw new Error('expected present');
    expect(encoded.records.value.agreements[0].draft!.content.title).toBe('客户委托草稿');
    expect(encoded.records.value.attachmentRefs[0].fileName).toBe('原件.pdf');
  });

  it('reads native immutable Blob bytes without executing overridden instance arrayBuffer or toJSON', async () => {
    const value = await snapshot(), customRead = vi.fn(() => { throw new Error('custom read'); });
    Object.defineProperty(value.originals[id(10)], 'arrayBuffer', { value: customRead });
    Object.defineProperty(value.originals[id(10)], 'toJSON', { value: customRead });
    await expect(serializeCommercialBackup(present(value), metadata)).resolves.toContain(COMMERCIAL_BACKUP_FORMAT);
    expect(customRead).not.toHaveBeenCalled();
  });

  it('does not execute getters or serializers in export metadata, records or original maps', async () => {
    const value = await snapshot(), getter = vi.fn(() => 'forbidden');
    const info = Object.defineProperty({ id: metadata.id }, 'generatedAt', { get: getter, enumerable: true });
    await expect(encodeCommercialBackup(present(value), info as typeof metadata)).rejects.toThrow('取值器');
    const originals = Object.defineProperty({}, id(10), { get: getter, enumerable: true });
    await expect(encodeCommercialBackup(present({ ...value, originals }), metadata)).rejects.toThrow('取值器');
    Object.defineProperty(value.dossier, 'toJSON', { value: getter, enumerable: true });
    await expect(encodeCommercialBackup(present(value), metadata)).rejects.toThrow(); expect(getter).not.toHaveBeenCalled();
  });

  it('fails full export on metadata-only local-file declarations rather than downgrading to absent or missing', async () => {
    const value = await snapshot(); value.originals = {};
    await expect(serializeCommercialBackup(present(value), metadata)).rejects.toThrow('实际字节缺失');
  });

  it('stops the whole package on an original read failure and does not invoke restore', async () => {
    const value = await snapshot(['pdf', 'png']);
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockRejectedValueOnce(new Error('file read failed'));
    await expect(serializeCommercialBackup(present(value), metadata)).rejects.toThrow('file read failed');
    expect(restore).not.toHaveBeenCalled();
  });

  it.each(['length', 'format', 'sha', 'extra-blob', 'project'] as const)('refuses actual snapshot %s conflicts', async reason => {
    const value = await snapshot(), read = present(value);
    if (reason === 'length') value.originals[id(10)] = new Blob(['longer wrong bytes']);
    if (reason === 'format') value.dossier.attachmentRefs[0].mimeType = 'image/png';
    if (reason === 'sha') value.dossier.attachmentRefs[0].sha256 = '0'.repeat(64);
    if (reason === 'extra-blob') value.originals[id(99)] = new Blob([pdf]);
    if (reason === 'project') value.dossier.projectId = 'other-project';
    await expect(serializeCommercialBackup(read, metadata)).rejects.toThrow();
  });

  it('rejects single-file and aggregate raw-byte excess independently of the encoded package limit', async () => {
    const value = await snapshot();
    value.originals[id(10)] = new Blob([new Uint8Array(commercialDossierLimits.fileBytes + 1)]);
    await expect(serializeCommercialBackup(present(value), metadata)).rejects.toThrow();
    const input = await backup();
    if (input.records.status !== 'present') throw new Error('expected present');
    const base = input.records.value.attachmentRefs[0];
    input.records.value.attachmentRefs = Array.from({ length: 4 }, (_, index) => ({ ...base, id: id(index + 10), byteSize: 9 * 1024 * 1024 }));
    input.records.value.agreements[0].draft!.content.documentRefs = [id(10)];
    await expect(preflightCommercialBackupJson(json(input), projectId)).rejects.toThrow();
  });

  it.each(['', 'AAAA=', 'AAAA===', 'AB==', 'AAB=', 'data:application/pdf;base64,AAAA', 'AAAA\n', '!!!!'])('refuses noncanonical Base64 %j', async base64 => {
    const input = await backup();
    Object.assign(input.files[0], { base64 });
    await expect(preflightCommercialBackupJson(json(input), projectId)).rejects.toThrow();
  });

  it.each(['version', 'unknown-field', 'coverage', 'duplicate', 'omitted', 'unreferenced', 'status', 'size', 'mime', 'sha', 'bytes', 'project', 'kind'] as const)('preflights and rejects complete-package %s corruption without writing', async reason => {
    const input = await backup();
    if (input.records.status !== 'present') throw new Error('expected present');
    if (reason === 'version') Object.assign(input, { version: 2 });
    if (reason === 'unknown-field') Object.assign(input, { secret: true });
    if (reason === 'coverage') Object.assign(input.coverage, { originalFiles: false });
    if (reason === 'duplicate') input.files.push(input.files[0]);
    if (reason === 'omitted') input.files = [];
    if (reason === 'unreferenced') Object.assign(input.files[0], { attachmentId: id(99) });
    if (reason === 'status') input.files[0] = { attachmentId: id(10), status: 'missing' };
    if (reason === 'size') Object.assign(input.files[0], { byteSize: 1 });
    if (reason === 'mime') Object.assign(input.files[0], { mimeType: 'image/png' });
    if (reason === 'sha') Object.assign(input.files[0], { sha256: 'a'.repeat(64) });
    if (reason === 'bytes') {
      const changed = pdf.slice(); changed[10] ^= 1;
      Object.assign(input.files[0], { base64: btoa(String.fromCharCode(...changed)) });
    }
    if (reason === 'project') input.projectId = 'other-project';
    if (reason === 'kind') input.dataKind = 'real';
    await expect(restoreCommercialBackupJson(json(input), projectId, { [id(1)]: null }, () => {})).rejects.toThrow();
    expect(restore).not.toHaveBeenCalled();
  });

  it('checks the actual UTF-8 encoded JSON size before parsing a package, not a declared size', async () => {
    const text = await serializeCommercialBackup({ status: 'absent', projectId }, metadata);
    await expect(preflightCommercialBackupJson(text + ' '.repeat(MAX_COMMERCIAL_BACKUP_BYTES), projectId)).rejects.toThrow('64 MiB');
  });

  it('checks final UTF-8 export size after base64 expansion even when raw originals are exactly 32 MiB', async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024).fill(32);
    bytes.set(new TextEncoder().encode('%PDF-1.4\n')); bytes.set(new TextEncoder().encode('\n%%EOF\n'), bytes.length - 7);
    const file = await prepareCommercialOriginal({ id: id(10), agreementId: id(1), fileName: 'large.pdf', purpose: 'agreement',
      documentLabel: '', sourceUrl: null, recordedAt: generatedAt, recordedBy: '演练录入人' }, new Blob([bytes]));
    const attachmentRefs = Array.from({ length: 4 }, (_, index) => ({ ...file.attachment, id: id(10 + index) }));
    const originals = Object.fromEntries(attachmentRefs.map(ref => [ref.id, file.blob]));
    const note = '原'.repeat(1000), agreements = [];
    for (let group = 0; group < 20; group++) {
      const agreementId = group ? id(100 + group) : id(1), documentId = group ? id(200 + group) : id(10);
      if (group) attachmentRefs.push({ ...file.attachment, id: documentId, agreementId,
        sourceState: 'external-reference', sourceUrl: 'https://example.test/archive', byteSize: null, sha256: null });
      agreements.push({ id: agreementId, direction: 'customer_commission', versions: Array.from({ length: 50 }, (_, index) => ({
        id: id(1000 + group * 50 + index), ...(index ? { basedOnVersionId: id(1000 + group * 50 + index - 1) } : {}),
        recordedAt: generatedAt, recordedBy: '演练录入人', fixingNote: '原件归档', content: { title: '大范围演练文件',
          documentRefs: [documentId], ourParty: { name: '', contactNote: note }, counterparty: { name: '', contactNote: note },
          scopeIn: note, scopeOut: note, eventNote: note, unconfirmedNote: note, fileAmount: { basisNote: note }, amountSourceText: note },
      })) });
    }
    const dossier = commercialDossierSchema.parse({ projectId, dataKind: 'rehearsal', agreements, attachmentRefs });
    expect(dossier.attachmentRefs.filter(ref => ref.sourceState === 'local-file').reduce((sum, ref) => sum + ref.byteSize!, 0)).toBe(commercialDossierLimits.projectFileBytes);
    await expect(serializeCommercialBackup(present({ schemaVersion: 1, storageToken: 'large-fixture', dossier, originals }), metadata)).rejects.toThrow('64 MiB');
  }, 15000);

  it('parses independently allocated nested defaults on each export and preflight', async () => {
    const value = await snapshot([]), first = await encodeCommercialBackup(present(value), metadata), second = await encodeCommercialBackup(present(value), metadata);
    if (first.records.status !== 'present' || second.records.status !== 'present') throw new Error('expected present');
    first.records.value.agreements[0].draft!.content.ourParty.name = 'later mutation';
    first.records.value.agreements[0].draft!.content.references.taskIds.push(id(80));
    expect(second.records.value.agreements[0].draft!.content.ourParty.name).toBe('');
    expect(second.records.value.agreements[0].draft!.content.references.taskIds).toEqual([]);
    expect(value.dossier.agreements[0].draft!.content.ourParty.name).toBe('');
    const a = await preflightCommercialBackupJson(json(second), projectId), b = await preflightCommercialBackupJson(json(second), projectId);
    if (a.status !== 'present' || b.status !== 'present') throw new Error('expected present');
    a.value.dossier.agreements[0].draft!.content.fileAmount.basisNote = 'changed';
    expect(b.value.dossier.agreements[0].draft!.content.fileAmount.basisNote).toBe('');
  });
});

describe('same-project guarded restoration boundary', () => {
  function oldBackup(version: 1 | 2 | 3 | 4): unknown {
    const base = createLocalProjectBackup(makeLayout({ id: projectId }), { state: 'ready', scope: projectId, brief: { status: 'absent' } }, generatedAt);
    if (version === 1) return { ...base, version, coverage: LOCAL_PROJECT_BACKUP_V1_COVERAGE };
    if (version === 2) return base;
    const v3 = { ...base, version, coverage: LOCAL_PROJECT_BACKUP_V3_COVERAGE, materialCheckins: { status: 'absent' } };
    return version === 3 ? v3 : { ...v3, coverage: LOCAL_PROJECT_BACKUP_V4_COVERAGE, sourceDocuments: { status: 'present', sources: [] } };
  }

  it.each([1, 2, 3, 4] as const)('validates old V%s then returns not-in-file and preserves current data through an explicit no-op', async version => {
    const current = present(await snapshot()); restore.mockResolvedValue(current);
    expect(await preflightCommercialBackupJson(json(oldBackup(version)), projectId)).toEqual({ status: 'not-in-file', projectId });
    const guard = vi.fn();
    expect(await restoreCommercialBackupJson(json(oldBackup(version)), projectId, {}, guard)).toBe(current);
    expect(restore).toHaveBeenCalledWith(projectId, undefined, {}, guard); expect(guard).toHaveBeenCalledTimes(3);
  });

  it('recognizes a trustworthy headerless layout but rejects arbitrary objects and repaired layouts', async () => {
    const base = oldBackup(2) as { layout: unknown };
    expect(await preflightCommercialBackupJson(json(base.layout), projectId)).toEqual({ status: 'not-in-file', projectId });
    await expect(preflightCommercialBackupJson(json({ id: projectId }), projectId)).rejects.toThrow();
    await expect(preflightCommercialBackupJson(json({ ...base.layout as object, ignored: true }), projectId)).rejects.toThrow();
  });

  it.each(['malformed', 'unknown-format', 'unknown-version', 'invalid-layout', 'missing-ledger', 'invalid-source', 'cross-project'] as const)('does not label a %s legacy file as harmless not-in-file', async reason => {
    const base = oldBackup(4) as Record<string, unknown>;
    if (reason === 'unknown-format') base.format = 'another-package';
    if (reason === 'unknown-version') base.version = 9;
    if (reason === 'invalid-layout') base.layout = { id: projectId };
    if (reason === 'missing-ledger') delete base.materialCheckins;
    if (reason === 'invalid-source') base.sourceDocuments = { status: 'present', sources: [{ id: 'bad' }] };
    const target = reason === 'cross-project' ? 'other-project' : projectId;
    await expect(restoreCommercialBackupJson(reason === 'malformed' ? '{' : json(base), target, {}, () => {})).rejects.toThrow();
    expect(restore).not.toHaveBeenCalled();
  });

  it('an absent package retains current facts through the storage no-op rather than a deleting updater', async () => {
    const current = present(await snapshot()); restore.mockResolvedValue(current);
    const text = await serializeCommercialBackup({ status: 'absent', projectId }, metadata), guard = vi.fn();
    expect(await restoreCommercialBackupJson(text, projectId, {}, guard)).toBe(current);
    expect(restore).toHaveBeenCalledWith(projectId, undefined, {}, guard);
  });

  it('uses the detached source only as data and forwards frozen target tokens, never the source token as authority', async () => {
    const text = await serializeCommercialBackup(present(await snapshot()), metadata), expected = { [id(1)]: 'target-token' }, guard = vi.fn();
    const pending = restoreCommercialBackupJson(text, projectId, expected, guard); expected[id(1)] = 'later-token';
    await pending;
    expect(restore.mock.calls[0][2]).toEqual({ [id(1)]: 'target-token' });
    expect(restore.mock.calls[0][1]!.storageToken).toBe('package-preflight');
    expect(restore.mock.calls[0][1]!.dossier.agreements[0].draft!.draftToken).toBe('source-draft-token');
  });

  it('rejects ambiguous case-duplicate target keys, invalid tokens and getters before preflight or storage', async () => {
    const text = await serializeCommercialBackup(present(await snapshot()), metadata), getter = vi.fn();
    const inputs = [{ [id(1)]: 'token', [id(1).toUpperCase()]: 'other' }, { [id(1)]: '' }, { invalid: null },
      Object.defineProperty({}, id(1), { get: getter, enumerable: true })];
    for (const tokens of inputs) await expect(restoreCommercialBackupJson(text, projectId, tokens, () => {})).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
  });

  it('requires a synchronous UI guard before preflight, after preflight and before returned data is displayed', async () => {
    const text = await serializeCommercialBackup(present(await snapshot()), metadata);
    await expect(restoreCommercialBackupJson(text, projectId, {}, undefined as unknown as () => void)).rejects.toThrow('守卫');
    await expect(restoreCommercialBackupJson(text, projectId, {}, async () => {})).rejects.toThrow('必须同步');
    const stopped = vi.fn(() => { throw new Error('scope switched'); });
    await expect(restoreCommercialBackupJson(text, projectId, {}, stopped)).rejects.toThrow('scope switched');
    expect(restore).not.toHaveBeenCalled();
    const afterPreflight = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('epoch switched'); });
    await expect(restoreCommercialBackupJson(text, projectId, {}, afterPreflight)).rejects.toThrow('epoch switched');
    expect(restore).not.toHaveBeenCalled();
  });

  it('marks a final context failure after successful present restoration as committed without retry or compensation', async () => {
    const current = present(await snapshot()), text = await serializeCommercialBackup(current, metadata);
    restore.mockResolvedValueOnce(current);
    const afterCommit = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error('display context switched'); });
    const pending = restoreCommercialBackupJson(text, projectId, {}, afterCommit);
    await expect(pending).rejects.toBeInstanceOf(CommercialReadbackError);
    await expect(pending).rejects.toMatchObject({ committed: true });
    expect(restore).toHaveBeenCalledOnce(); expect(afterCommit).toHaveBeenCalledTimes(3);
  });

  it.each(['absent', 'not-in-file'] as const)('preserves the final guard error for %s without falsely marking a no-op committed', async status => {
    const current = present(await snapshot()); restore.mockResolvedValueOnce(current);
    const text = status === 'absent' ? await serializeCommercialBackup({ status: 'absent', projectId }, metadata) : json(oldBackup(4));
    const error = new Error('display context switched'), afterRead = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw error; });
    await expect(restoreCommercialBackupJson(text, projectId, {}, afterRead)).rejects.toBe(error);
    expect(error).not.toHaveProperty('committed');
    expect(restore).toHaveBeenCalledWith(projectId, undefined, {}, afterRead); expect(restore).toHaveBeenCalledOnce();
  });

  it('propagates target draft conflict and storage failure without clearing input or retrying the operation', async () => {
    const text = await serializeCommercialBackup(present(await snapshot()), metadata);
    restore.mockRejectedValueOnce(new Error('draft CAS conflict'));
    await expect(restoreCommercialBackupJson(text, projectId, { [id(1)]: 'old-token' }, () => {})).rejects.toThrow('draft CAS conflict');
    const quota = new Error('quota exceeded'); restore.mockRejectedValueOnce(quota);
    await expect(restoreCommercialBackupJson(text, projectId, {}, () => {})).rejects.toBe(quota);
    expect(quota).not.toHaveProperty('committed');
    const readback = new CommercialReadbackError(); restore.mockRejectedValueOnce(readback);
    await expect(restoreCommercialBackupJson(text, projectId, {}, () => {})).rejects.toBe(readback);
    expect(restore).toHaveBeenCalledTimes(3);
  });

  it('does not hide a same-id immutable attachment conflict even when both files have the same size and valid hashes', async () => {
    const target = await snapshot(), changed = pdf.slice(); changed[10] ^= 1;
    const otherFile = await prepareCommercialOriginal({ id: id(10), agreementId: id(1), fileName: '原件.pdf', purpose: 'agreement',
      documentLabel: '演练原件', sourceUrl: null, recordedAt: generatedAt, recordedBy: '手工录入人' }, new Blob([changed]));
    const incoming = { ...target, dossier: commercialDossierSchema.parse({ ...target.dossier, attachmentRefs: [otherFile.attachment] }),
      originals: { [id(10)]: otherFile.blob } };
    restore.mockImplementation(async (_project, source) => {
      mergeCommercialDossiers(target.dossier, source!.dossier);
      return present(target);
    });
    const text = await serializeCommercialBackup(present(incoming), metadata);
    await expect(restoreCommercialBackupJson(text, projectId, {}, () => {})).rejects.toThrow('不同内容');
    expect(await target.originals[id(10)].arrayBuffer()).toEqual(pdf.buffer);
  });
});
