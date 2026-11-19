// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  REFERENCE_MAX_BYTES,
  REFERENCE_MAX_SIDE,
  isHeicFile,
  normalizeReferenceImage,
  planReferenceResize,
  readImageSize,
  referenceResizeNotice,
} from './reference-photo';

/** 只够读头的 PNG：签名 + IHDR 的宽高。 */
function pngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(new ArrayBuffer(32));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

/** 只够读头的 JPEG：SOI + SOF0 的宽高。 */
function jpegHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(new ArrayBuffer(32));
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return bytes.buffer;
}

describe('reference photo normalization', () => {
  it('keeps a compliant photo byte-for-byte instead of re-encoding it', async () => {
    const file = new File([pngHeader(1600, 1200)], '现场照片.png', { type: 'image/png' });
    const prepared = await normalizeReferenceImage(file);
    expect(prepared.file).toBe(file);
    expect(prepared.notice).toBe('');
  });

  it('reads PNG and JPEG dimensions from the file header alone', async () => {
    expect(await readImageSize(new Blob([pngHeader(4032, 3024)]))).toEqual({ width: 4032, height: 3024 });
    expect(await readImageSize(new Blob([jpegHeader(2048, 1536)]))).toEqual({ width: 2048, height: 1536 });
    expect(await readImageSize(new Blob(['not an image']))).toBeNull();
  });

  it('recognises HEIC by mime type and by extension', () => {
    expect(isHeicFile({ type: 'image/heic', name: 'IMG_0001' })).toBe(true);
    expect(isHeicFile({ type: '', name: 'IMG_0001.HEIC' })).toBe(true);
    expect(isHeicFile({ type: 'image/jpeg', name: 'IMG_0001.JPG' })).toBe(false);
  });

  it('plans downscale, recompression and conversion against the server limits', () => {
    const oversized = planReferenceResize({ width: 6000, height: 4000, bytes: 1024 });
    expect(oversized.reason).toBe('too-large');
    expect(oversized.targetSide).toBe(REFERENCE_MAX_SIDE);
    expect(oversized.scale).toBeCloseTo(REFERENCE_MAX_SIDE / 6000);
    expect(referenceResizeNotice(oversized)).toContain(String(REFERENCE_MAX_SIDE));

    const heavy = planReferenceResize({ width: 1024, height: 768, bytes: REFERENCE_MAX_BYTES + 1 });
    expect(heavy.reason).toBe('too-heavy');
    expect(referenceResizeNotice(heavy)).toContain('5 MB');

    const convert = planReferenceResize({ width: 1024, height: 768, bytes: 1024, convert: true });
    expect(convert.reason).toBe('convert');
    expect(convert.reencode).toBe(true);

    const ok = planReferenceResize({ width: 1024, height: 768, bytes: 1024 });
    expect(ok.reason).toBe('ok');
    expect(ok.reencode).toBe(false);
    expect(referenceResizeNotice(ok)).toBe('');
  });

  it('says plainly what happened instead of failing silently', async () => {
    const file = new File([pngHeader(6000, 4000)], '大图.png', { type: 'image/png' });
    // 这台环境解不开图：必须说清楚，不能假装上传成功。
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('这台环境没有 blob 地址'); });
    await expect(normalizeReferenceImage(file)).rejects.toThrow(/处理不了/);
    vi.restoreAllMocks();
  });
});
