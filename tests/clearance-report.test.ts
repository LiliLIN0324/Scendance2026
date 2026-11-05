import { describe, expect, it } from 'vitest';
import { sceneSchema, type Scene } from '../supabase/functions/_shared/domain.ts';
import { clearanceReport, polygonGap } from '../supabase/functions/_shared/clearance-report.ts';
import { footprint } from '../supabase/functions/_shared/structural-geometry.ts';

const id = (n: number) => `94000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const box = (n: number, x: number, z: number, width: number, depth: number, rotation = 0) => ({
  id: id(n), materialId: 'table', position: { x, z }, rotation,
  size: { width, depth, height: 0.75 }, color: '#ffffff', locked: false, notes: '',
});

/** 12×10 的空场地；墙/柱子按需给，这样每种净距测的都是单一来源。 */
function scene(input: { objects: ReturnType<typeof box>[]; walls?: unknown[]; columns?: unknown[] }): Scene {
  return sceneSchema.parse({
    schemaVersion: 2,
    venue: { shape: 'rectangle', width: 12, depth: 10, height: 3.2, heightSource: 'confirmed', entrances: [] },
    structure: { walls: input.walls ?? [], openings: [], columns: input.columns ?? [] },
    sources: [], dimensions: [], objects: input.objects,
    camera: 'overview', lighting: 'neutral',
  });
}
const wall = (n: number, x1: number, z1: number, x2: number, z2: number, thickness = 0.2) => ({
  id: id(n), start: { x: x1, z: z1 }, end: { x: x2, z: z2 }, thickness, height: 3.2, kind: 'exterior', status: 'confirmed',
});
const column = (n: number, x: number, z: number) => ({
  id: id(n), position: { x, z }, size: { width: 0.4, depth: 0.4, height: 3.2 }, rotation: 0, status: 'confirmed',
});

describe('净距报告', () => {
  it('量的是真占地，不是包围盒：3.0–3.6 与 3.95 之间就是 0.35 米', () => {
    const s = scene({ objects: [box(21, 3, 3, 1.2, 0.6), box(22, 4.2, 3, 0.5, 0.5)] });
    const [table] = clearanceReport(s, [id(21)]);
    expect(table.gap).toBe(0.35);
    expect(table.nearest).toEqual({ kind: 'object', ref: id(22) });
  });

  it('重叠报 0，不报负数', () => {
    const s = scene({ objects: [box(21, 3, 3, 1.2, 0.6), box(22, 3.3, 3, 0.5, 0.5)] });
    expect(clearanceReport(s, [id(21)])[0].gap).toBe(0);
  });

  it('没有墙时量到场地边界', () => {
    const s = scene({ objects: [box(21, 6, 5, 1, 1)] });
    const [item] = clearanceReport(s, [id(21)]);
    expect(item.gap).toBe(4.5);
    expect(item.nearest).toEqual({ kind: 'edge', ref: 'venue' });
  });

  it('柱子比远处的墙更近时，报柱子', () => {
    const s = scene({ objects: [box(21, 6, 5, 1, 1)], walls: [wall(1, 0, 0, 12, 0)], columns: [column(6, 6, 6)] });
    const [item] = clearanceReport(s, [id(21)]);
    expect(item.gap).toBe(0.3);
    expect(item.nearest).toEqual({ kind: 'column', ref: id(6) });
  });

  it('旋转 90° 后净距跟着真实朝向变，不沿用原来的宽深', () => {
    const straight = clearanceReport(scene({ objects: [box(21, 6, 5, 1.2, 0.6)] }), [id(21)])[0];
    const turned = clearanceReport(scene({ objects: [box(21, 6, 5, 1.2, 0.6, 90)] }), [id(21)])[0];
    expect(straight.gap).toBe(4.7);
    expect(turned.gap).toBe(4.4);
  });

  it('只量点名的物件，别的不入报告', () => {
    const s = scene({ objects: [box(21, 3, 3, 1.2, 0.6), box(22, 8, 8, 1, 1)] });
    expect(clearanceReport(s, [id(22)]).map(item => item.id)).toEqual([id(22)]);
  });

  it('多边形净距函数：相交为 0，分离为最短边距', () => {
    const a = footprint({ position: { x: 0, z: 0 }, size: { width: 2, depth: 2 }, rotation: 0 });
    const near = footprint({ position: { x: 2.5, z: 0 }, size: { width: 1, depth: 1 }, rotation: 0 });
    const overlap = footprint({ position: { x: 1, z: 0 }, size: { width: 2, depth: 2 }, rotation: 0 });
    expect(polygonGap(a, near)).toBe(1);
    expect(polygonGap(a, overlap)).toBe(0);
  });
});
