import { layoutForExport } from '../../../lib/layout-export';
import { MAX_LAYOUT_JSON_BYTES, parseStoredLayout } from './schema';
import type { RoomLayout } from './types';

export function downloadLayoutAsJson(layout: RoomLayout): void {
  const blob = new Blob([JSON.stringify(layoutForExport(layout), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    // Guard the empty-name case (mirrors the CSV path) so we never produce a
    // bare `.json` filename.
    link.download = `${(layout.name || 'layout').replace(/\s+/g, '_')}.json`;
    link.click();
  } finally {
    // Defer the revoke: revoking synchronously right after click() can cancel
    // the download mid-flight in some browsers. A 0ms timeout releases the URL
    // after the click has been dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function readLayoutFromFile(file: File): Promise<RoomLayout> {
  // Checked before reading: a multi-hundred-MB file would otherwise be read
  // and parsed whole before the schema ever saw it (#332).
  if (file.size > MAX_LAYOUT_JSON_BYTES) {
    const limitMb = MAX_LAYOUT_JSON_BYTES / (1024 * 1024);
    throw new Error(
      `这个文件 ${(file.size / (1024 * 1024)).toFixed(1)} MB，远超场地备份的上限 ${limitMb} MB，未打开。`
    );
  }
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  const layout = parseStoredLayout(parsed);
  if (!layout) {
    throw new Error('备份文件结构不对，无法作为场地布置打开。');
  }
  return layout;
}

/** Longest-edge cap for a stored floor plan, in pixels. */
const MAX_IMAGE_EDGE = 1500;

export async function readImageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件（PNG、JPG等）。');
  }
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const failed = () => { reject(new Error('图片读取失败，请重新选择。')); };
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) resolve(reader.result);
      else failed();
    };
    reader.onerror = failed;
    reader.onabort = failed;
    reader.readAsDataURL(file);
  }).catch(() => {
    throw new Error('图片读取失败，请重新选择。');
  });

  // A full-resolution floor plan can easily be several MB of base64, which
  // exhausts the ~5MB localStorage budget and makes every save fail. Downscale
  // anything larger than MAX_IMAGE_EDGE on its long edge and re-encode as JPEG
  // so the stored layout stays well within budget.
  return downscaleDataUrl(rawDataUrl);
}

function downscaleDataUrl(dataUrl: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const release = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };
    image.onload = () => {
      let canvas: HTMLCanvasElement | undefined;
      try {
        const width = image.naturalWidth, height = image.naturalHeight;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          throw new Error('图片尺寸无效，请重新选择。');
        }
        const longEdge = Math.max(width, height);
        if (longEdge <= MAX_IMAGE_EDGE) {
          resolve(dataUrl);
          return;
        }
        const scale = MAX_IMAGE_EDGE / longEdge;
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('当前浏览器无法读取这张图片。');
        // JPEG has no alpha; keep transparent floor plans on a white background.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/jpeg', 0.85);
        if (!result.startsWith('data:image/')) throw new Error('图片编码失败，请重新选择。');
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        release();
      }
    };
    image.onerror = () => {
      release();
      reject(new Error('Image decode failed.'));
    };
    image.src = dataUrl;
  }).catch(() => {
    throw new Error('图片处理失败，请重新选择有效的平面图。');
  });
}

/**
 * Trigger a PNG download of the canvas. Resolves to `true` after dispatch and
 * `false` when encoding or download setup fails; this does not verify a file on disk.
 */
export function downloadCanvasAsPng(canvas: HTMLCanvasElement, baseName: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        try {
          if (!blob) { resolve(false); return; }
          const url = URL.createObjectURL(blob);
          try {
            const link = document.createElement('a');
            link.href = url;
            link.download = `${(baseName || 'screenshot').replace(/\s+/g, '_')}.png`;
            link.click();
          } finally {
            // Revoke after dispatch so the browser can start the download.
            setTimeout(() => URL.revokeObjectURL(url), 0);
          }
          resolve(true);
        } catch {
          resolve(false);
        }
      }, 'image/png');
    } catch {
      resolve(false);
    }
  });
}

/** 已经编码好的 PNG（导出预览那张）直接触发下载，不再重渲染一遍。 */
export function downloadDataUrlAsPng(dataUrl: string, baseName: string): boolean {
  try {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${(baseName || 'screenshot').replace(/\s+/g, '_')}.png`;
    link.click();
    return true;
  } catch {
    return false;
  }
}
