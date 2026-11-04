import type { FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';

/** 单条物料的指纹记录（顺序无关、字段固定）。 */
export interface ItemFingerprint {
  id: string;
  type: string;
  assetId: string;
  /** 规范化到 1e-6 */
  x: number;
  /** 规范化到 1e-6 */
  z: number;
  /** 规范化到 1e-6 */
  rotation: number;
  /** 规范化到 1e-6 */
  width: number;
  /** 规范化到 1e-6 */
  depth: number;
}

/** FNV-1a 初始偏移 basis。 */
const FNV_OFFSET = 2166136261;
/** FNV-1a 32 位素数。 */
const FNV_PRIME = 16777619;

/**
 * 把一个数字规范化到 1e-6 精度，并把 -0 归一成 0。
 * 缺值（undefined / NaN）按 0 处理，保证指纹稳定。
 */
function normalizeNumber(value: number | undefined): number {
  if (value === undefined || value === null || Number.isNaN(value)) return 0;
  const rounded = Math.round(value * 1e6) / 1e6;
  // Object.is(0, -0) === false，借此把 -0 拍回 0。
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * 把单条物料压成 ItemFingerprint。
 * 缺字段用 '' / 0 兜底，数字统一规范化到 1e-6。
 */
export function itemFingerprint(item: FurnitureItem): ItemFingerprint {
  const x = normalizeNumber(item.position?.x);
  const z = normalizeNumber(item.position?.z);
  const rotation = normalizeNumber(item.rotation);
  const width = normalizeNumber(item.width);
  const depth = normalizeNumber(item.depth);
  return {
    id: item.id ?? '',
    type: item.type ?? '',
    assetId: item.assetId ?? '',
    x,
    z,
    rotation,
    width,
    depth,
  };
}

/** 把 ItemFingerprint 序列化成稳定字符串（字段顺序固定，避免 JSON key 漂移）。 */
function serializeItem(fp: ItemFingerprint): string {
  return [
    fp.id,
    fp.type,
    fp.assetId,
    fp.x,
    fp.z,
    fp.rotation,
    fp.width,
    fp.depth,
  ].join('|');
}

/** 对一段字符串做 FNV-1a 32 位哈希，输出 8 位十六进制。 */
function fnv1aHex(input: string): string {
  // 用 TextEncoder 拿到 UTF-8 字节，避免非 ASCII 字符按 UTF-16 单元累加造成歧义。
  const bytes = new TextEncoder().encode(input);
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    // Math.imul 保证 32 位乘法，避免 double 精度漂移。
    h = Math.imul(h, FNV_PRIME);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 整份布局的指纹：跨 floor 把所有 items 摊平，按 item.id 字典序排序后串成稳定字符串。
 * floor 顺序、items 数组原始下标都不进指纹；layout.width / height 进指纹。
 */
export function layoutFingerprint(
  layout: Pick<RoomLayout, 'width' | 'height' | 'floors'>,
): string {
  const width = normalizeNumber(layout.width);
  const height = normalizeNumber(layout.height);

  const items: FurnitureItem[] = [];
  const floors = layout.floors ?? [];
  for (const floor of floors) {
    if (floor && Array.isArray(floor.items)) {
      for (const it of floor.items) items.push(it);
    }
  }

  items.sort((a, b) => {
    const idA = a.id ?? '';
    const idB = b.id ?? '';
    if (idA < idB) return -1;
    if (idA > idB) return 1;
    return 0;
  });

  const lines: string[] = [`W=${width}`, `H=${height}`];
  for (const it of items) {
    lines.push(serializeItem(itemFingerprint(it)));
  }
  return fnv1aHex(lines.join('\n'));
}

/**
 * 比对两份布局指纹是否一致。
 * 因为规范化已经在生成阶段完成，1e-6 内的浮点尾数差异不会污染最终字符串，
 * 这里直接做等值比较即可。
 */
export function fingerprintsEqual(a: string, b: string): boolean {
  return a === b;
}
