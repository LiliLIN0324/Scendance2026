/**
 * 采集守门员 · 浏览器端图像快检。
 *
 * 纯函数部分（亮度统计、8×8 感知哈希、重复判定）可在 Node 单测里直接跑；
 * 画布/文件/视频解码只在组件真正调用 analyse 系列函数时才会用到。
 */

import { findNearDuplicateIndices, hammingDistanceHex, type CaptureLayer, type FrameSample, type GpsFix } from './scoring';

export interface LumaStats {
  mean: number;
  brightRatio: number;
  darkRatio: number;
}

export interface AnalyseMeta {
  layer: CaptureLayer;
  gps: GpsFix | null;
  heading: number | null;
  at: number;
}

export interface AnalyzedImage extends FrameSample {
  name: string;
  thumb: string;
  /** 256×256 灰度上的拉普拉斯方差；越低越糊，用于逐张判定。 */
  sharpness: number;
}

/** 取所有像素的亮度直方图摘要（0–255）。 */
export function lumaStatsFromRgba(rgba: ArrayLike<number>): LumaStats {
  const pixelCount = Math.max(1, Math.floor(rgba.length / 4));
  let sum = 0;
  let bright = 0;
  let dark = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    const r = rgba[index] ?? 0;
    const g = rgba[index + 1] ?? 0;
    const b = rgba[index + 2] ?? 0;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += luma;
    if (luma >= 245) bright += 1;
    if (luma <= 25) dark += 1;
  }
  return {
    mean: Math.round((sum / pixelCount) * 10) / 10,
    brightRatio: Math.round((bright / pixelCount) * 1000) / 1000,
    darkRatio: Math.round((dark / pixelCount) * 1000) / 1000,
  };
}

/** 64×64 灰度 → 亮度摘要。直接算，避免把灰度再拼成 RGBA 绕一圈。 */
export function lumaStatsFromGray(gray: ArrayLike<number>): LumaStats {
  const pixelCount = Math.max(1, gray.length);
  let sum = 0;
  let bright = 0;
  let dark = 0;
  for (let index = 0; index < gray.length; index += 1) {
    const luma = gray[index] ?? 0;
    sum += luma;
    if (luma >= 245) bright += 1;
    if (luma <= 25) dark += 1;
  }
  return {
    mean: Math.round((sum / pixelCount) * 10) / 10,
    brightRatio: Math.round((bright / pixelCount) * 1000) / 1000,
    darkRatio: Math.round((dark / pixelCount) * 1000) / 1000,
  };
}

/**
 * 64×64 灰度 → 8×8 块均值 → 16 位十六进制感知哈希。
 * 不要直接把原图一步 drawImage 到 8×8：极端缩小时浏览器采样不足，
 * 不同机位会被压成同一个哈希，去重分因此被误扣。
 */
export function averageHashFromGrid(gray: ArrayLike<number>): string {
  if (gray.length < 64 * 64) return '0000000000000000';
  const cells: number[] = [];
  for (let cellY = 0; cellY < 8; cellY += 1) {
    for (let cellX = 0; cellX < 8; cellX += 1) {
      let sum = 0;
      for (let y = 0; y < 8; y += 1) {
        const row = (cellY * 8 + y) * 64;
        for (let x = 0; x < 8; x += 1) sum += gray[row + cellX * 8 + x] ?? 0;
      }
      cells.push(sum / 64);
    }
  }
  return averageHashFromGray(cells);
}

/**
 * 4 邻域拉普拉斯方差：判断是否糊片。
 * 平坦图接近 0，纹理清晰的图通常 > 60；阈值放在 shot-rules 里。
 */
export function laplacianVarianceFromGray(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3 || gray.length < width * height) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value =
        (gray[index - width] ?? 0) +
        (gray[index + width] ?? 0) +
        (gray[index - 1] ?? 0) +
        (gray[index + 1] ?? 0) -
        4 * (gray[index] ?? 0);
      sum += value;
      sumSq += value * value;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.round((sumSq / count - mean * mean) * 10) / 10;
}

/** 64 个灰度值 → 16 位十六进制感知哈希。 */
export function averageHashFromGray(gray: ArrayLike<number>): string {
  if (gray.length < 64) return '0000000000000000';
  let sum = 0;
  for (let index = 0; index < 64; index += 1) sum += gray[index] ?? 0;
  const average = sum / 64;
  let hash = '';
  for (let nibble = 0; nibble < 16; nibble += 1) {
    let value = 0;
    for (let bit = 0; bit < 4; bit += 1) {
      if ((gray[nibble * 4 + bit] ?? 0) > average) value |= 1 << (3 - bit);
    }
    hash += value.toString(16);
  }
  return hash;
}

/** 连续帧里，与更早样本过近的帧下标。 */
export function findDuplicateFrames(hashes: string[], threshold = 6): number[] {
  return findNearDuplicateIndices(hashes, threshold);
}

export function duplicateIdsFor(frames: Array<Pick<FrameSample, 'id' | 'hash'>>, threshold = 6): Set<string> {
  const duplicateIndices = new Set(findDuplicateFrames(frames.map(frame => frame.hash), threshold));
  const ids = new Set<string>();
  frames.forEach((frame, index) => {
    if (duplicateIndices.has(index)) ids.add(frame.id);
  });
  return ids;
}

export function hashesDifferEnough(left: string, right: string, threshold = 6): boolean {
  return hammingDistanceHex(left, right) > threshold;
}

function grayFromImageData(data: Uint8ClampedArray): number[] {
  const gray: number[] = [];
  for (let index = 0; index < data.length; index += 4) {
    gray.push(
      0.2126 * (data[index] ?? 0) +
        0.7152 * (data[index + 1] ?? 0) +
        0.0722 * (data[index + 2] ?? 0),
    );
  }
  return gray;
}

type Drawable = ImageBitmap | HTMLImageElement | HTMLVideoElement;

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器不支持 Canvas 2D');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return [canvas, context];
}

function drawSource(source: Drawable, size: number): number[] {
  const [, context] = makeCanvas(size);
  context.drawImage(source, 0, 0, size, size);
  return grayFromImageData(context.getImageData(0, 0, size, size).data);
}

function drawThumb(source: Drawable, longEdge = 220): string {
  const ratio = source.width / source.height;
  const width = ratio >= 1 ? longEdge : Math.round(longEdge * ratio);
  const height = ratio >= 1 ? Math.round(longEdge / ratio) : longEdge;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

async function loadDrawable(file: File): Promise<{ source: Drawable; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, release: () => bitmap.close() };
    } catch {
      // 部分浏览器不支持 createImageBitmap 的方向参数，回退到 <img>。
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('图片无法解码'));
  });
  return { source: image, release: () => URL.revokeObjectURL(url) };
}

/** 单张照片 → 评分所需的帧证据 + 缩略图。 */
export async function analyseImageFile(file: File, meta: AnalyseMeta): Promise<AnalyzedImage> {
  const { source, release } = await loadDrawable(file);
  try {
    const statsGray = drawSource(source, 64);
    const stats = lumaStatsFromGray(statsGray);
    const sharpGray = drawSource(source, 256);
    return {
      id: `${file.name}-${file.lastModified}-${meta.at}`,
      name: file.name,
      layer: meta.layer,
      width: source.width,
      height: source.height,
      meanLuma: stats.mean,
      brightRatio: stats.brightRatio,
      darkRatio: stats.darkRatio,
      hash: averageHashFromGrid(statsGray),
      heading: meta.heading,
      gps: meta.gps,
      at: meta.at,
      thumb: drawThumb(source),
      sharpness: laplacianVarianceFromGray(sharpGray, 256, 256),
    };
  } finally {
    release();
  }
}

function waitForEvent(target: EventTarget, event: string, timeoutMs = 8000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer = 0;
    const cleanup = (): void => {
      target.removeEventListener(event, done);
      target.removeEventListener('error', failed);
      window.clearTimeout(timer);
    };
    const done = (): void => {
      cleanup();
      resolve();
    };
    const failed = (): void => {
      cleanup();
      reject(new Error('视频解码失败'));
    };
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', failed, { once: true });
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('视频解码超时'));
    }, timeoutMs);
  });
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const finished = waitForEvent(video, 'seeked', 5000);
  video.currentTime = time;
  await finished;
}

function analyseDrawable(source: Drawable, meta: AnalyseMeta, name: string, index: number): AnalyzedImage {
  const statsGray = drawSource(source, 64);
  const stats = lumaStatsFromGray(statsGray);
  const sharpGray = drawSource(source, 256);
  return {
    id: `${name}-frame-${index}-${meta.at}`,
    name: `${name} · ${index + 1}`,
    layer: meta.layer,
    width: source.width,
    height: source.height,
    meanLuma: stats.mean,
    brightRatio: stats.brightRatio,
    darkRatio: stats.darkRatio,
    hash: averageHashFromGrid(statsGray),
    heading: meta.heading,
    gps: meta.gps,
    at: meta.at + index * 1000,
    thumb: drawThumb(source, 180),
    sharpness: laplacianVarianceFromGray(sharpGray, 256, 256),
  };
}

/**
 * 视频 → 按约 1 秒抽帧（最多 20 帧/段），让视频路径也能吃到曝光与重复快检。
 * 解码失败时返回空数组，由界面提示改用照片补拍。
 */
export async function analyseVideoFile(
  file: File,
  meta: AnalyseMeta,
  onProgress?: (done: number, total: number) => void,
): Promise<AnalyzedImage[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitForEvent(video, 'loadedmetadata');
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (duration === 0) return [];
    const total = Math.min(20, Math.max(2, Math.floor(duration)));
    const frames: AnalyzedImage[] = [];
    for (let index = 0; index < total; index += 1) {
      const time = Math.min(duration - 0.05, (duration / (total + 1)) * (index + 1));
      await seekVideo(video, Math.max(0.05, time));
      frames.push(analyseDrawable(video, meta, file.name, index));
      onProgress?.(index + 1, total);
    }
    return frames;
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}
