import { isMapOutdoorLayout } from './amap-venue';
import { MAX_ROOM_DIMENSION } from './constants';
import { canApplyLayoutGeometry } from './structural-layout';
import type { RoomLayout } from './types';

export type SplatMetersLike = Readonly<{ width: number; depth: number }>;

export type SplatPreviewPlacement = Readonly<{
  /** Set when the indoor shell should follow the gaussian's measured footprint. */
  resize: { width: number; height: number } | null;
  /** Status line for the canvas banner (the exit button is separate). */
  note: string;
}>;

function roundMeter(value: number): number {
  return Math.round(value * 10) / 10;
}

function keptNote(name: string): string {
  return `环境预览：${name} · 观感已挂上，场地尺寸保持不动。第一人称走进场仍按眼高走动。`;
}

function outdoorNote(name: string): string {
  return `环境预览：${name} · 样例观感已挂上，没有改这块户外场地的尺寸（高斯不参与碰撞）。右轨「第一人称走进场」按眼高在场地里走。`;
}

function calibratedNote(name: string, width: number, depth: number): string {
  return `环境预览：${name} · 已按高斯实测 ${width} × ${depth} m 校准场地，物料照常摆`;
}

/**
 * Decide whether a ready 3DGS preview may resize the shell.
 * Map / outdoor venues (盐官 and the like) keep their surveyed shell: the
 * sample hall's metres are not that site, and forcing them through the
 * geometry gate throws out of an effect and takes the workbench down.
 * The preview still paints, and first-person walk stays at eye height.
 */
export function placeSplatPreview(
  layout: RoomLayout,
  name: string,
  meters: SplatMetersLike | null | undefined,
): SplatPreviewPlacement {
  if (!meters || !Number.isFinite(meters.width) || !Number.isFinite(meters.depth) || meters.width <= 0 || meters.depth <= 0) {
    return { resize: null, note: meters ? keptNote(name) : `环境预览：${name} · 场地壳体已让位，物料照常摆` };
  }
  if (isMapOutdoorLayout(layout)) return { resize: null, note: outdoorNote(name) };
  const width = roundMeter(meters.width);
  const height = roundMeter(meters.depth);
  if (width > MAX_ROOM_DIMENSION || height > MAX_ROOM_DIMENSION || width <= 0 || height <= 0) {
    return { resize: null, note: keptNote(name) };
  }
  if (Math.abs(width - layout.width) <= 0.05 && Math.abs(height - layout.height) <= 0.05) {
    return { resize: null, note: calibratedNote(name, width, height) };
  }
  const next = { ...layout, width, height };
  try {
    if (!canApplyLayoutGeometry(layout, next)) return { resize: null, note: keptNote(name) };
  } catch {
    return { resize: null, note: keptNote(name) };
  }
  return { resize: { width, height }, note: calibratedNote(name, width, height) };
}

/** Banner copy when the resize itself throws after the gate said yes. */
export function splatShellKeptNote(name: string): string {
  return keptNote(name);
}
