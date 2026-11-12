/**
 * 选区几何可信度（与 functions/api/place-shape.ts、lux3d-dev-proxy.mjs 同口径）。
 *
 * 「杭州大厦」曾出现 3 点 kind:line 垃圾几何：不能当真实占地、不能写库存、
 * 不能在搜索里标成「有轮廓」。本模块是纯函数，给搜索排序与客户端解析共用。
 */

export function normalizeOutlineName(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[\s\u3000·．.,，()（）\-—_/]+/g, '');
}

export function gcjPolylineLengthM(polygon: readonly (readonly [number, number])[]): number {
  if (polygon.length < 2) return 0;
  const lat0 = polygon[0]![1];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  let length = 0;
  for (let i = 1; i < polygon.length; i += 1) {
    const dx = (polygon[i]![0] - polygon[i - 1]![0]) * kx;
    const dy = (polygon[i]![1] - polygon[i - 1]![1]) * 110540;
    length += Math.hypot(dx, dy);
  }
  return length;
}

export function gcjBBoxAreaM2(polygon: readonly (readonly [number, number])[]): number {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  if (!Number.isFinite(west)) return 0;
  const latMid = (north + south) / 2;
  return ((east - west) * 111320 * Math.cos((latMid * Math.PI) / 180)) * ((north - south) * 110540);
}

function simpleFootprint(polygon: readonly (readonly [number, number])[]): boolean {
  if (polygon.length > 2048) return false;
  const first = polygon[0]; const last = polygon[polygon.length - 1];
  if (!first || !last) return false;
  const pts = first[0] === last[0] && first[1] === last[1] ? polygon.slice(0, -1) : polygon;
  if (pts.length < 3 || new Set(pts.map(p => `${p[0]},${p[1]}`)).size !== pts.length) return false;
  const cross = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < pts.length; i += 1) for (let j = i + 2; j < pts.length; j += 1) {
    if (i === 0 && j === pts.length - 1) continue;
    const a = pts[i]!; const b = pts[(i + 1) % pts.length]!; const c = pts[j]!; const d = pts[(j + 1) % pts.length]!;
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
  }
  return true;
}

function footprintAreaM2(polygon: readonly (readonly [number, number])[]): number {
  if (polygon.length < 3) return 0;
  const x0 = polygon[0]![0]; const y0 = polygon[0]![1];
  const kx = Math.cos(y0 * Math.PI / 180) * 111320;
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!; const b = polygon[(i + 1) % polygon.length]!;
    twice += (a[0] - x0) * kx * (b[1] - y0) * 110540 - (b[0] - x0) * kx * (a[1] - y0) * 110540;
  }
  return Math.abs(twice) / 2;
}

function readShapePoints(shape: { polygon?: unknown } | null | undefined): [number, number][] | null {
  if (!shape || !Array.isArray(shape.polygon)) return null;
  const pts: [number, number][] = [];
  for (const vertex of shape.polygon) {
    if (!Array.isArray(vertex) || vertex.length < 2 || typeof vertex[0] !== 'number' || typeof vertex[1] !== 'number') return null;
    const lng = Number(vertex[0]);
    const lat = Number(vertex[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    pts.push([lng, lat]);
  }
  return pts;
}

/** 可展示：面要有像样占地，线要有像样路长。太短的 3 点 line 回 null、只留定位钉。 */
export function isDisplayablePlaceShape(shape: { kind?: string | null; polygon?: unknown; name?: string } | null | undefined): boolean {
  const pts = readShapePoints(shape);
  if (!pts || /(?:→|->|往返|公交线路|公交路线)/u.test(shape?.name ?? '')) return false;
  if (shape!.kind === 'line') return /(?:路|街|巷|大道|高速|公路|步道|胡同|road|street|avenue|lane|highway)$/iu.test(shape?.name ?? '') && pts.length >= 2 && gcjPolylineLengthM(pts) >= 80;
  return pts.length >= 3 && simpleFootprint(pts) && footprintAreaM2(pts) >= 20;
}

/** 可入库 / 可标「有轮廓」：只认可信的面。线型一律不算占地轮廓。 */
export function isPersistablePlaceShape(shape: { kind?: string | null; polygon?: unknown; name?: string } | null | undefined): boolean {
  if (!shape || shape.kind === 'line') return false;
  return isDisplayablePlaceShape(shape);
}

/**
 * 库存 hint（无多边形，只有点数/名字）是否算「已有轮廓」。
 * 3 点或 kind=line 都否。
 */
export function isOutlineHint(hint: { kind?: string | null; pts?: number | null | undefined } | null | undefined): boolean {
  if (!hint || hint.kind === 'line') return false;
  return Number(hint.pts) >= 3;
}

/** 两个规范化名字是否指向同一地点（互为包含，且短的一边够辨识）。 */
export function namesReferToSamePlace(a: string, b: string): boolean {
  const stripCity = (name: string) => name.replace(/^(?:杭州市|杭州)/u, '');
  const left = stripCity(a); const right = stripCity(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // in77 这样的独立代码允许匹配全名；A/B/C 区或子楼栋不借用整个商业综合体的轮廓。
  if (/^[a-z]+[0-9]+$/i.test(left) && right.endsWith(left)) return true;
  if (/^[a-z]+[0-9]+$/i.test(right) && left.endsWith(right)) return true;
  return false;
}
