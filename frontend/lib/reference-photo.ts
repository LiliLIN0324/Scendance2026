/**
 * 图生 3D 的参考图归一化：用户手机里的照片直接就能喂给生成链路。
 *
 * 服务端的硬约束（supabase/functions/_shared/generation-input.ts 与 api.ts）：
 * 只收 PNG/JPEG、单边 128–4096、整张 ≤5MB。原样把手机大图丢上去会被服务端打回，
 * 用户只看到一句「请选择 5 MB 以内的 PNG 或 JPEG 参考图」，不知道该怎么做。
 *
 * 这里的分工：
 * · 合规照片**直接读文件头拿尺寸**就能判定，原样上传——不重新编码，不掉画质，
 *   同一张照片的资产 id 也稳定。读文件头不需要 canvas，真机和测试环境都稳。
 * · 超尺寸（长边 >4096）、超体积（>5MB）或者不是 PNG/JPEG（HEIC、webp）时，
 *   才真的解码并重新编码成 JPEG：HEIC 靠浏览器能解码就转，解码不了就说清怎么办。
 */

export const REFERENCE_MAX_SIDE = 4096;
export const REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
export const REFERENCE_MIN_SIDE = 128;

const JPEG_QUALITY_STEPS = [0.92, 0.85, 0.75, 0.65, 0.55];
const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
const HEIC_EXTENSIONS = ['.heic', '.heif'];
const DECODE_TIMEOUT_MS = 8000;

/** iPhone 的 HEIC 照片：服务端不收，但用户手里的照片九成是它。 */
export function isHeicFile(file: { type?: string; name?: string }): boolean {
  if (file.type && HEIC_TYPES.includes(file.type.toLowerCase())) return true;
  const name = (file.name ?? '').toLowerCase();
  return HEIC_EXTENSIONS.some(extension => name.endsWith(extension));
}

export interface ReferenceResizePlan {
  /** 等比缩放系数，1 表示不用缩。 */
  scale: number;
  /** 缩完后的长边。 */
  targetSide: number;
  /** 是否需要重新编码成 JPEG。 */
  reencode: boolean;
  /** 为什么要动它，给界面一句话用。 */
  reason: 'ok' | 'too-large' | 'too-heavy' | 'convert';
}

/**
 * 只算不碰：给定原图尺寸与字节数，算出上传前该怎么处理。
 * 纯函数，界面与测试都读它。
 */
export function planReferenceResize(input: {
  width: number;
  height: number;
  bytes: number;
  convert?: boolean;
}): ReferenceResizePlan {
  const { width, height, bytes } = input;
  const longest = Math.max(width, height);
  const scale = longest > REFERENCE_MAX_SIDE ? REFERENCE_MAX_SIDE / longest : 1;
  const targetSide = Math.round(longest * scale);
  if (input.convert) return { scale, targetSide, reencode: true, reason: 'convert' };
  if (scale < 1) return { scale, targetSide, reencode: true, reason: 'too-large' };
  if (bytes > REFERENCE_MAX_BYTES) return { scale, targetSide, reencode: true, reason: 'too-heavy' };
  return { scale, targetSide, reencode: false, reason: 'ok' };
}

/** 一句话说清这张照片被改了什么。空串表示原样上传。 */
export function referenceResizeNotice(plan: ReferenceResizePlan): string {
  if (plan.reason === 'convert') return '已转成 JPEG 上传。';
  if (plan.reason === 'too-large') return `照片长边超过 ${REFERENCE_MAX_SIDE} 像素，已缩到 ${plan.targetSide} 像素上传。`;
  if (plan.reason === 'too-heavy') return '照片超过 5 MB，已压到 5 MB 以内上传。';
  return '';
}

export class ReferenceImageError extends Error {
  constructor(message: string) { super(message); this.name = 'ReferenceImageError'; }
}

/**
 * 从文件头读 PNG / JPEG 的尺寸。读不出来就返回 null——那表示「这台设备读不懂」，
 * 不是「这张图是 0×0」。
 */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  if (head.length < 24) return null;
  // PNG：8 字节签名 + IHDR。
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    const width = (head[16] << 24) | (head[17] << 16) | (head[18] << 8) | head[19];
    const height = (head[20] << 24) | (head[21] << 16) | (head[22] << 8) | head[23];
    return width > 0 && height > 0 ? { width, height } : null;
  }
  // JPEG：扫 SOFn 标记。
  if (head[0] === 0xff && head[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < head.length) {
      if (head[offset] !== 0xff) { offset += 1; continue; }
      const marker = head[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const height = (head[offset + 5] << 8) | head[offset + 6];
        const width = (head[offset + 7] << 8) | head[offset + 8];
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += 2 + (((head[offset + 2] << 8) | head[offset + 3]) || 1);
    }
  }
  return null;
}

/** 浏览器解出来的图。 */
interface DecodedImage { width: number; height: number; bitmap: CanvasImageSource }

async function decodeImage(file: File): Promise<DecodedImage | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height, bitmap };
    } catch { /* 落到 <img> 解码；HEIC 在多数桌面浏览器会在这里失败。 */ }
  }
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Image === 'undefined') return null;
  let url: string;
  try { url = URL.createObjectURL(file); } catch { return null; }
  try {
    return await new Promise<DecodedImage | null>(resolve => {
      const finish = (value: DecodedImage | null) => resolve(value);
      // 有些环境不会触发 onload/onerror；到点就当读不出来，不能把界面吊住。
      const timer = setTimeout(() => finish(null), DECODE_TIMEOUT_MS);
      const image = new Image();
      image.onload = () => { clearTimeout(timer); finish({ width: image.naturalWidth, height: image.naturalHeight, bitmap: image }); };
      image.onerror = () => { clearTimeout(timer); finish(null); };
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
  });
}

function closeBitmap(bitmap: CanvasImageSource): void {
  if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) bitmap.close?.();
}

function replaceExtension(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return `${base || '参考图'}.jpg`;
}

/** 解码 → 等比缩到长边上限 → 逐档降画质；压不下去就继续等比缩小。 */
async function reencode(file: File, reason: ReferenceResizePlan['reason']): Promise<{ file: File; notice: string }> {
  const decoded = await decodeImage(file);
  if (!decoded || !decoded.width || !decoded.height) {
    throw new ReferenceImageError(
      isHeicFile(file)
        ? '这台设备读不了这张 HEIC 照片。请先用系统相册把它另存为 JPG 或 PNG，再选一次。'
        : '这张照片在本机处理不了。请换一张 JPG 或 PNG 试试。',
    );
  }
  if (typeof document === 'undefined') throw new ReferenceImageError('这个环境不支持处理照片，请换用支持图片处理的浏览器。');
  const plan = planReferenceResize({ width: decoded.width, height: decoded.height, bytes: file.size, convert: reason === 'convert' });
  const notice = referenceResizeNotice(plan);

  let side = Math.max(plan.targetSide, REFERENCE_MIN_SIDE);
  let best: Blob | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const longest = Math.max(decoded.width, decoded.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(decoded.width * (side / longest)));
    canvas.height = Math.max(1, Math.round(decoded.height * (side / longest)));
    const context = canvas.getContext('2d');
    if (!context) { closeBitmap(decoded.bitmap); throw new ReferenceImageError('这个环境处理不了照片，请换用支持图片处理的浏览器。'); }
    context.drawImage(decoded.bitmap, 0, 0, canvas.width, canvas.height);
    const quality = JPEG_QUALITY_STEPS[Math.min(attempt, JPEG_QUALITY_STEPS.length - 1)];
    const blob = await canvasToBlob(canvas, quality);
    if (blob && (!best || blob.size < best.size)) best = blob;
    if (blob && blob.size <= REFERENCE_MAX_BYTES) {
      closeBitmap(decoded.bitmap);
      return { file: new File([blob], replaceExtension(file.name), { type: 'image/jpeg' }), notice };
    }
    side = Math.max(REFERENCE_MIN_SIDE, Math.round(side * 0.85));
  }
  closeBitmap(decoded.bitmap);
  if (best && best.size <= REFERENCE_MAX_BYTES) {
    return { file: new File([best], replaceExtension(file.name), { type: 'image/jpeg' }), notice };
  }
  throw new ReferenceImageError('这张照片压到 5 MB 以内仍然太大。请换一张主体清楚、尺寸小一些的照片。');
}

/**
 * 把一张照片变成服务端能收的参考图。
 * 原样合规就原样返回（返回的 file 与入参是同一个对象），不合规才重新编码。
 */
export async function normalizeReferenceImage(file: File): Promise<{ file: File; notice: string }> {
  const heic = isHeicFile(file);
  const supported = file.type === 'image/png' || file.type === 'image/jpeg';
  if (supported && !heic) {
    const size = await readImageSize(file);
    // 尺寸读不出来时不猜：服务端还会再验一次，原样上传让它说话。
    const tooLarge = size ? Math.max(size.width, size.height) > REFERENCE_MAX_SIDE : false;
    const tooHeavy = file.size > REFERENCE_MAX_BYTES;
    if (!tooLarge && !tooHeavy) return { file, notice: '' };
    if (!size) throw new ReferenceImageError('这张照片超过 5 MB，且本机读不出它的尺寸。请换一张小一点的照片。');
    return reencode(file, tooLarge ? 'too-large' : 'too-heavy');
  }
  // HEIC 与其它格式：服务端只收 PNG/JPEG，必须转。
  return reencode(file, 'convert');
}
