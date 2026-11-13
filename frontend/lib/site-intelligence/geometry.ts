import { gcj02ToWgs84, wgs84ToGcj02 } from '../../components/room-organizer/lib/geo-coords';
import type { Bounds, Geometry, Point } from './types';
export { gcj02ToWgs84 };
export function toLocal(lng: number, lat: number, anchor: { lng: number; lat: number }, crs: 'wgs84' | 'gcj-02'): Point {
  if (![lng, lat, anchor.lng, anchor.lat].every(Number.isFinite) || Math.abs(lng) > 180 || Math.abs(lat) > 85 || Math.abs(anchor.lat) > 85) throw new Error('Invalid or unsupported coordinate');
  const p = crs === 'wgs84' ? wgs84ToGcj02(lng, lat) : { lng, lat };
  return { x: (p.lng - anchor.lng) * Math.cos(anchor.lat * Math.PI / 180) * 111319.49, y: (p.lat - anchor.lat) * 111132.92 };
}
export function toGeographic(p: Point, anchor: { lng: number; lat: number }): { lng: number; lat: number } {
  if (![p.x, p.y, anchor.lng, anchor.lat].every(Number.isFinite) || Math.abs(anchor.lat) > 85) throw new Error('Invalid or unsupported coordinate');
  return { lng: anchor.lng + p.x / (Math.cos(anchor.lat * Math.PI / 180) * 111319.49), lat: anchor.lat + p.y / 111132.92 };
}
export function bounds(g: Geometry): Bounds {
  return { minX: Math.min(...g.points.map(p => p.x)), minY: Math.min(...g.points.map(p => p.y)), maxX: Math.max(...g.points.map(p => p.x)), maxY: Math.max(...g.points.map(p => p.y)) };
}
export function boundsIntersect(a: Bounds, b: Bounds): boolean { return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY; }
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
  const t = d === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function edges(g: Geometry): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 1; i < g.points.length; i++) out.push([g.points[i - 1]!, g.points[i]!]);
  if (g.type === 'polygon') out.push([g.points[g.points.length - 1]!, g.points[0]!]);
  return out;
}
export function containsPoint(g: Geometry, p: Point): boolean {
  if (g.type !== 'polygon') return false;
  let inside = false;
  for (const [a, b] of edges(g)) {
    if (pointSegmentDistance(p, a, b) < 1e-7) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
  if (x * y < 0 && z * w < 0) return true;
  return pointSegmentDistance(a, c, d) < 1e-7 || pointSegmentDistance(b, c, d) < 1e-7 || pointSegmentDistance(c, a, b) < 1e-7 || pointSegmentDistance(d, a, b) < 1e-7;
}
export function geometryDistance(a: Geometry, b: Geometry): number {
  if (a.points.some(p => containsPoint(b, p)) || b.points.some(p => containsPoint(a, p))) return 0;
  const ae = edges(a), be = edges(b);
  if (ae.some(([p, q]) => be.some(([r, s]) => crosses(p, q, r, s)))) return 0;
  let distance = Infinity;
  for (const p of a.points) { for (const q of b.points) distance = Math.min(distance, Math.hypot(p.x - q.x, p.y - q.y)); for (const [q, r] of be) distance = Math.min(distance, pointSegmentDistance(p, q, r)); }
  for (const p of b.points) for (const [q, r] of ae) distance = Math.min(distance, pointSegmentDistance(p, q, r));
  return distance;
}
/** All vertices and edge interiors must be contained: concave polygons cannot be checked by vertices alone. */
export function containsGeometry(outer: Geometry, inner: Geometry): boolean {
  if (outer.type !== 'polygon' || !inner.points.every(p => containsPoint(outer, p))) return false;
  // Split each segment at every boundary intersection and test each interval midpoint.
  for (const [a, b] of edges(inner)) {
    const ts = [0, 1]; const dx = b.x - a.x, dy = b.y - a.y;
    for (const [c, d] of edges(outer)) {
      const ex = d.x - c.x, ey = d.y - c.y, denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-10) continue;
      const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denom;
      const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denom;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let i = 1; i < ts.length; i++) { const t = (ts[i - 1]! + ts[i]!) / 2; if (!containsPoint(outer, { x: a.x + dx * t, y: a.y + dy * t })) return false; }
  }
  return true;
}

/** Simple ENU ring only: reject degenerate, repeated, backtracking or self-intersecting footprints. */
export function isValidGeometry(g: Geometry): boolean {
  const points = g?.points;
  if (!Array.isArray(points) || points.length > 256 || !points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
  if (g.type === 'point') return points.length === 1;
  if (g.type === 'line') return points.length >= 2 && edges(g).every(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) > 1e-6);
  if (g.type !== 'polygon' || points.length < 3) return false;
  const n = points.length, origin = points[0]!;
  let twiceArea = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!;
    twiceArea += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
    for (let j = i + 1; j < n; j++) if (Math.hypot(a.x - points[j]!.x, a.y - points[j]!.y) <= 1e-6) return false;
    const c = points[(i + 2) % n]!, cross = (a.x - b.x) * (c.y - b.y) - (a.y - b.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-8 && (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > 0) return false;
  }
  if (Math.abs(twiceArea) <= 1e-6) return false;
  const segments = edges(g);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || i === 0 && j === n - 1) continue;
    const [a, b] = segments[i]!, [c, d] = segments[j]!;
    if (crosses(a, b, c, d)) return false;
  }
  return true;
}
