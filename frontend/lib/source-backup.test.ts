import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeSourceDocuments, encodeSourceDocuments, sourceDocumentsSchema, MAX_SOURCE_BYTES, type SourceDocuments } from './source-backup';
import type { StoredSource } from './source-storage';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ioAAAAASUVORK5CYII=';
const bytes = (base64 = png) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
const source = (patch: Partial<StoredSource> = {}): StoredSource => ({ id: 'original-image', scope: 'activity-a', name: '原图.png',
  kind: 'floorplan', width: 1, height: 1, blob: new Blob([bytes()], { type: 'image/png' }), ...patch });
const snapshot = (sources = [source()], form: unknown = undefined) => ({ scope: 'activity-a', sources, form });
const documents = (): SourceDocuments => ({ status: 'present', sources: [{ id: 'original-image', name: '原图.png', kind: 'floorplan',
  width: 1, height: 1, mimeType: 'image/png', base64: png }] });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('portable source documents', () => {
  it('roundtrips real Blob bytes, original identity and image kind without making cloud authorization claims', async () => {
    const assetId = '80000000-0000-4000-8000-000000000001';
    const input = source({ assetId, uploadedKind: 'photo' });
    const encoded = await encodeSourceDocuments(snapshot([input]));
    expect(encoded.sources[0]).toMatchObject({ id: input.id, kind: 'floorplan', assetId, uploadedKind: 'photo', base64: png });
    expect(encoded.sources[0]).not.toHaveProperty('scope'); expect(encoded.sources[0]).not.toHaveProperty('url');
    const close = vi.fn(), decode = vi.fn().mockResolvedValue({ width: 1, height: 1, close });
    vi.stubGlobal('createImageBitmap', decode); const network = vi.fn(); vi.stubGlobal('fetch', network);
    const restored = await decodeSourceDocuments(encoded, 'activity-a');
    expect(restored.sources[0]).toMatchObject({ id: input.id, scope: 'activity-a', kind: 'floorplan', assetId, uploadedKind: 'photo' });
    expect(new Uint8Array(await restored.sources[0]!.blob!.arrayBuffer())).toEqual(bytes());
    expect(restored.sources[0]!.blob!.type).toBe('image/png'); expect(close).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
  });

  it('retains form-only input, partial registration and dimension semantics but strips live job/request state', async () => {
    const form = { width: '12.0', depth: '', height: '3', text: '现场原话', adjustment: '旧调整',
      constraints: [{ id: '80000000-0000-4000-8000-000000000001', kind: 'width', valueMeters: 12, status: 'confirmed', label: '现场宽' }],
      registration: { sourceId: 'original-image', points: [{ x: 0, z: 0 }] },
      requestId: 'PRIVATE_REQUEST', jobId: 'PRIVATE_JOB', jobIdentity: 'PRIVATE_IDENTITY', fixedIds: { secret: 'PRIVATE_FIXED' } };
    const encoded = await encodeSourceDocuments(snapshot([], form));
    expect(encoded.form).toEqual({ width: '12.0', depth: '', height: '3', text: '现场原话', adjustment: '旧调整',
      constraints: form.constraints, registration: form.registration });
    expect(JSON.stringify(encoded)).not.toContain('PRIVATE_');
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
    expect(await decodeSourceDocuments(encoded, 'activity-a')).toEqual({ sources: [], form: encoded.form });
    expect(decode).not.toHaveBeenCalled();
  });

  it('freezes all image metadata and form fields before an asynchronous Blob read completes', async () => {
    const input = source(), form = { text: '原文' };
    let finish!: (value: ArrayBuffer) => void;
    vi.spyOn(input.blob!, 'arrayBuffer').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const output = encodeSourceDocuments(snapshot([input], form));
    input.name = '后来图片'; input.kind = 'photo'; input.width = 2; form.text = '后来原文';
    finish(bytes().buffer); const encoded = await output;
    expect(encoded.sources[0]).toMatchObject({ name: '原图.png', kind: 'floorplan', width: 1 });
    expect(encoded.form?.text).toBe('原文');
  });

  it.each(['missing blob', 'other scope', 'oversize', 'too many', 'duplicate', 'wrong mime'] as const)('rejects %s before returning portable records', async reason => {
    let sources = [source()];
    if (reason === 'missing blob') delete sources[0]!.blob;
    if (reason === 'other scope') sources[0]!.scope = 'activity-b';
    if (reason === 'oversize') sources[0]!.blob = new Blob([new Uint8Array(MAX_SOURCE_BYTES + 1)], { type: 'image/png' });
    if (reason === 'too many') sources = Array.from({ length: 13 }, (_, index) => source({ id: String(index) }));
    if (reason === 'duplicate') sources.push(source());
    if (reason === 'wrong mime') sources[0]!.blob = new Blob([bytes()], { type: 'image/jpeg' });
    await expect(encodeSourceDocuments(snapshot(sources))).rejects.toThrow();
  });

  it.each(['', 'AAAA=', 'AAAA===', 'AB==', 'AAB=', 'data:image/png;base64,AAAA', 'AAAA\n', '!!!!'])('refuses malformed or noncanonical Base64 %j in the pure schema', base64 => {
    const input = documents(); input.sources[0]!.base64 = base64;
    expect(sourceDocumentsSchema.safeParse(input).success).toBe(false);
  });

  it.each(['mime', 'size', 'decode'] as const)('does not return records after a real-image %s check fails', async reason => {
    const input = documents(), close = vi.fn();
    const decode = reason === 'decode' ? vi.fn().mockRejectedValue(new Error('decode failed')) : vi.fn().mockResolvedValue({ width: 2, height: 1, close });
    vi.stubGlobal('createImageBitmap', decode);
    if (reason === 'mime') input.sources[0]!.mimeType = 'image/webp';
    await expect(decodeSourceDocuments(input, 'activity-a')).rejects.toThrow();
    if (reason === 'size') expect(close).toHaveBeenCalledOnce();
    if (reason === 'mime') expect(decode).not.toHaveBeenCalled();
  });

  it('closes decoded images and returns nothing when a later image is corrupt', async () => {
    const input = documents(); input.sources.push({ ...input.sources[0]!, id: 'second-image' });
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce({ width: 1, height: 1, close })
      .mockRejectedValueOnce(new Error('second image corrupt')));
    await expect(decodeSourceDocuments(input, 'activity-a')).rejects.toThrow('无法真实解码');
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects decoded bytes over 5 MiB and any source list above 12 entries', () => {
    const input = documents(); input.sources[0]!.base64 = 'A'.repeat(Math.ceil((MAX_SOURCE_BYTES + 1) / 3) * 4);
    expect(sourceDocumentsSchema.safeParse(input).success).toBe(false);
    input.sources = Array.from({ length: 13 }, (_, index) => ({ ...documents().sources[0]!, id: String(index) }));
    expect(sourceDocumentsSchema.safeParse(input).success).toBe(false);
  });

  it.each([{ width: 4097 }, { height: 0 }, { width: 1.5 }, { kind: 'drawing' }, { extra: 'private' }])('rejects invalid image metadata %j', patch => {
    const input = documents(); Object.assign(input.sources[0]!, patch);
    expect(sourceDocumentsSchema.safeParse(input).success).toBe(false);
  });

  it('rejects invalid shared dimensions and registration without repairing them', async () => {
    await expect(encodeSourceDocuments(snapshot([], { constraints: [{ id: 'bad', valueMeters: -1 }] }))).rejects.toThrow('表单字段无效');
    await expect(encodeSourceDocuments(snapshot([], { registration: { sourceId: 'original-image', points: [{ x: Infinity, z: 0 }] } }))).rejects.toThrow('表单字段无效');
  });
});
