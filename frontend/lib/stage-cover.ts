/** Covers come from the editor's live 3D view; panels never own the WebGL scene. */
export type StageCoverCapture = () => string | null;
let capture: StageCoverCapture | null = null;

export function registerStageCover(next: StageCoverCapture): () => void {
  capture = next;
  return () => { if (capture === next) capture = null; };
}

/** No GPU, a 2D view or a busy scene all end as "no cover"; callers keep their plan fallback. */
export function captureStageCover(): string | null {
  try { return capture?.() ?? null; } catch { return null; }
}

/** Landscape card crop, so a portrait window still yields a 320:190 cover. */
export function encodeStageCover(canvas: HTMLCanvasElement, width = 640): string | null {
  const height = Math.round(width * 190 / 320);
  if (!canvas.width || !canvas.height) return null;
  const scale = Math.max(width / canvas.width, height / canvas.height);
  const sourceWidth = width / scale, sourceHeight = height / scale;
  const target = document.createElement('canvas');
  target.width = width; target.height = height;
  const context = target.getContext('2d');
  if (!context) return null;
  context.drawImage(canvas, (canvas.width - sourceWidth) / 2, (canvas.height - sourceHeight) / 2,
    sourceWidth, sourceHeight, 0, 0, width, height);
  return target.toDataURL('image/jpeg', 0.82);
}
