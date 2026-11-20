// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  Sha256Hasher,
  assertArchiveReceipt,
  archiveErrorText,
  archiveFormatOf,
  computeSha256Hex,
  createDirectArchiveUpload,
  resolveCloudArchiveTransport,
  type CloudArchiveTransport,
} from './cloud-archive';

const encoder = new TextEncoder();

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

describe('sha-256 incremental hasher', () => {
  it('matches the NIST vector for "abc"', () => {
    const hasher = new Sha256Hasher();
    hasher.update(encoder.encode('abc'));
    expect(hasher.digestHex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches the empty vector', () => {
    expect(new Sha256Hasher().digestHex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the 56-byte NIST vector (padding boundary)', () => {
    const hasher = new Sha256Hasher();
    hasher.update(encoder.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'));
    expect(hasher.digestHex()).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('handles chunked updates across block boundaries', () => {
    const data = encoder.encode('a'.repeat(1000) + 'bc');
    const oneShot = new Sha256Hasher();
    oneShot.update(data);
    const chunked = new Sha256Hasher();
    for (let offset = 0; offset < data.length; offset += 7) chunked.update(data.subarray(offset, Math.min(offset + 7, data.length)));
    expect(chunked.digestHex()).toBe(oneShot.digestHex());
  });
});

describe('computeSha256Hex', () => {
  it('hashes a blob in chunks with progress', async () => {
    const blob = new Blob([new Uint8Array(64).fill(7), new Uint8Array(100).fill(9)]);
    const seen: Array<[number, number]> = [];
    const hex = await computeSha256Hex(blob, { chunkBytes: 64, onProgress: (loaded, total) => seen.push([loaded, total]) });
    const hasher = new Sha256Hasher();
    hasher.update(new Uint8Array(64).fill(7));
    hasher.update(new Uint8Array(100).fill(9));
    expect(hex).toBe(hasher.digestHex());
    expect(seen.at(-1)).toEqual([164, 164]);
  });

  it('agrees with the platform crypto where available', async () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) return;
    const bytes = new Uint8Array(1024).map((_, index) => index % 251);
    const blob = new Blob([bytes]);
    const ours = await computeSha256Hex(blob);
    const platform = hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    expect(ours).toBe(platform);
  });
});

describe('transport detection', () => {
  const full: CloudArchiveTransport = {
    getCloudCapabilities: async () => ({ version: 1, superAdmin: false, officialStudioId: null }),
    prepareArchiveUpload: async () => ({ uploadId: 'u1', assetId: null, state: 'pending', uploadUrl: null, token: null, storagePath: 'sp' }),
    completeArchiveUpload: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'a', kind: 'model', format: 'glb', byteSize: 1, sha256: 'a'.repeat(64) }),
    listArchiveAssets: async () => [],
    archiveAssetUrl: async () => ({ id: 'x', url: 'https://example.test/x', expiresIn: 300 }),
  };

  it('returns null when backendSession lacks the archive methods', () => {
    expect(resolveCloudArchiveTransport({})).toBeNull();
    expect(resolveCloudArchiveTransport(null)).toBeNull();
    expect(resolveCloudArchiveTransport({ getCloudCapabilities: full.getCloudCapabilities })).toBeNull();
  });

  it('accepts a session exposing all five methods', () => {
    expect(resolveCloudArchiveTransport(full)).toBe(full);
  });
});

describe('receipt validation', () => {
  it('accepts a consistent receipt', () => {
    assertArchiveReceipt({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'a', kind: 'model', format: 'glb', byteSize: 8, sha256: 'a'.repeat(64) }, { size: 8 }, 'a'.repeat(64));
  });

  it('rejects size or hash mismatches instead of faking success', () => {
    const receipt = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'a', kind: 'model', format: 'glb', byteSize: 9, sha256: 'a'.repeat(64) };
    expect(() => assertArchiveReceipt(receipt, { size: 8 }, 'a'.repeat(64))).toThrow('大小');
    expect(() => assertArchiveReceipt({ ...receipt, byteSize: 8, sha256: 'zz' }, { size: 8 }, 'a'.repeat(64))).toThrow('哈希');
    expect(() => assertArchiveReceipt({ ...receipt, sha256: 'b'.repeat(64) }, { size: 8 }, 'a'.repeat(64))).toThrow('不一致');
  });
});

describe('direct archive upload executor', () => {
  // 基础夹具：complete 返回与本地不一致的哈希，用于「拒绝登记」分支；各用例按需覆盖。
  const transport: CloudArchiveTransport = {
    getCloudCapabilities: async () => ({ version: 1, superAdmin: false, officialStudioId: null }),
    prepareArchiveUpload: vi.fn(async () =>
      ({ uploadId: 'upload-1', assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'pending' as const, uploadUrl: 'https://storage.test/put', token: 'tok', storagePath: 'archive/req-1' })),
    completeArchiveUpload: vi.fn(async () =>
      ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'a.glb', kind: 'model', format: 'glb', byteSize: 4, sha256: 'b'.repeat(64) })),
    listArchiveAssets: async () => [],
    getArchiveAssetUrl: async () => ({ id: 'x', url: 'https://example.test/x', expiresIn: 300 }),
  };

  it('hashes, prepares, puts and completes with a valid receipt', async () => {
    const sha = 'a'.repeat(64);
    const complete = vi.fn(async () =>
      ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'a.glb', kind: 'model', format: 'glb', byteSize: 4, sha256: sha }));
    const localTransport = { ...transport, completeArchiveUpload: complete };
    const puts: Array<{ url: string; token: string | undefined; size: number }> = [];
    const upload = createDirectArchiveUpload(localTransport, {
      sha256Of: async (_file, _signal, onProgress) => { onProgress(4, 4); return sha; },
      putObject: async (url, token, file) => { puts.push({ url, token, size: file.size }); },
    });
    const phases: Array<string | undefined> = [];
    const result = await upload(
      { key: 'k', scope: { userId: 'u', studioId: 's' }, localId: 'a', requestId: 'req-1', name: 'a.glb', kind: 'model', bytes: 4, state: 'uploading', progress: 0, attempts: 1 },
      new Blob([new Uint8Array(4)]),
      new AbortController().signal,
      (loaded, total, phase) => { phases.push(phase); void loaded; void total; },
    );
    expect(transport.prepareArchiveUpload).toHaveBeenCalled();
    const prepareInput = (transport.prepareArchiveUpload as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prepareInput).toMatchObject({ requestId: 'req-1', byteSize: 4, sha256: sha, kind: 'model', format: 'glb' });
    expect(puts).toEqual([{ url: 'https://storage.test/put', token: 'tok', size: 4 }]);
    expect(complete).toHaveBeenCalledWith('upload-1');
    expect(result).toEqual({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', byteSize: 4, sha256: sha });
    expect(phases[0]).toBe('hash');
    expect(phases.at(-1)).toBe('upload');
  });

  it('skips the PUT when prepare reports the object already complete (idempotent replay)', async () => {
    const prepare = vi.fn(async () => ({ uploadId: 'upload-1', assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'complete' as const, uploadUrl: null, token: null, storagePath: 'archive/req-1' }));
    const putObject = vi.fn(async () => undefined);
    const upload = createDirectArchiveUpload({ ...transport, prepareArchiveUpload: prepare, completeArchiveUpload: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'a.glb', kind: 'model', format: 'glb', byteSize: 4, sha256: 'a'.repeat(64) }) }, {
      sha256Of: async () => 'a'.repeat(64),
      putObject,
    });
    const result = await upload(
      { key: 'k', scope: { userId: 'u' }, localId: 'a', requestId: 'req-1', name: 'a.glb', kind: 'model', bytes: 4, state: 'uploading', progress: 0, attempts: 1 },
      new Blob([new Uint8Array(4)]),
      new AbortController().signal,
      () => undefined,
    ) as { id: string; byteSize: number; sha256: string };
    expect(putObject).not.toHaveBeenCalled();
    expect(result.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('prefers the session-provided signed-url transport over a raw PUT', async () => {
    const signed = vi.fn(async (_receipt: unknown, _body: Blob, _mime: string) => undefined);
    const putObject = vi.fn(async () => undefined);
    const upload = createDirectArchiveUpload({
      ...transport,
      uploadArchiveToSignedUrl: signed,
      completeArchiveUpload: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'a.glb', kind: 'model', format: 'glb', byteSize: 4, sha256: 'a'.repeat(64) }),
    }, {
      sha256Of: async () => 'a'.repeat(64),
      putObject,
    });
    await upload(
      { key: 'k', scope: { userId: 'u' }, localId: 'a', requestId: 'req-1', name: 'a.glb', kind: 'model', bytes: 4, state: 'uploading', progress: 0, attempts: 1 },
      new Blob([new Uint8Array(4)]),
      new AbortController().signal,
      () => undefined,
    );
    expect(signed).toHaveBeenCalledTimes(1);
    expect(putObject).not.toHaveBeenCalled();
    expect((signed.mock.calls[0][2] as string)).toBe('model/gltf-binary');
  });

  it('refuses unsupported formats before calling prepare instead of hitting a 422', async () => {
    const prepare = vi.fn(async () => ({ uploadId: 'u', assetId: null, state: 'pending' as const, uploadUrl: null, token: null, storagePath: 'sp' }));
    const upload = createDirectArchiveUpload({ ...transport, prepareArchiveUpload: prepare }, { sha256Of: async () => 'a'.repeat(64) });
    await expect(upload(
      { key: 'k', scope: { userId: 'u' }, localId: 'a', requestId: 'req-1', name: '场地.obj', kind: 'model', bytes: 4, state: 'uploading', progress: 0, attempts: 1 },
      new Blob([new Uint8Array(4)]),
      new AbortController().signal,
      () => undefined,
    )).rejects.toThrow('.obj');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('throws instead of registering when the receipt hash disagrees with the local hash', async () => {
    const upload = createDirectArchiveUpload(transport, {
      sha256Of: async () => 'a'.repeat(64),
      putObject: async () => undefined,
    });
    await expect(upload(
      { key: 'k', scope: { userId: 'u' }, localId: 'a', requestId: 'req-1', name: 'a.glb', kind: 'model', bytes: 4, state: 'uploading', progress: 0, attempts: 1 },
      new Blob([new Uint8Array(4)]),
      new AbortController().signal,
      () => undefined,
    )).rejects.toThrow('不一致');
  });
});

describe('errors and formats', () => {
  it('maps contract error codes to actionable text', () => {
    expect(archiveErrorText({ code: 'IDEMPOTENCY_CONFLICT' })).toContain('requestId');
    expect(archiveErrorText({ code: 'UPLOAD_INTEGRITY_FAILED' })).toContain('哈希');
    expect(archiveErrorText({ code: 'CLOUD_STORAGE_UNAVAILABLE' })).toContain('暂不可用');
    expect(archiveErrorText(new Error('boom'))).toBe('boom');
  });

  it('derives format from the file name, allows models without extension, and refuses unknown extensions', () => {
    expect(archiveFormatOf('场地扫描.SPZ', 'scan')).toBe('spz');
    expect(archiveFormatOf('未命名', 'model')).toBe('glb');
    expect(() => archiveFormatOf('未命名', 'attachment')).toThrow('扩展名');
    expect(() => archiveFormatOf('场地.obj', 'model')).toThrow('.obj');
  });
});
