import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPlanFootprint } from './plan-footprint-builder';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 3D 规划层必须和 2D 同一份数据：场地边界（蓝）与设计范围（琥珀）都要出现。
 *
 * 为什么在 node 里直接建 THREE 场景来测：这两个环在 3D 里是 Line2/Mesh，
 * 只有真跑一遍 builder 才能确认「画进去了、抬升层级对、颜色对」，
 * 而不是靠人眼在浏览器里截图比对。
 */

const BOUNDARY = [
  { x: -10, y: -7 },
  { x: 10, y: -7 },
  { x: 10, y: 7 },
  { x: -10, y: 7 },
];

/** 外扩 20 m/边后的 60×54 m 设计范围（与「按场地外扩 20 m」同一套几何）。 */
const SCOPE = [
  { x: -30, y: -27 },
  { x: 30, y: -27 },
  { x: 30, y: 27 },
  { x: -30, y: 27 },
];

function makePlan(overrides: Partial<SitePlanData> = {}): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: { lng: 120.15, lat: 30.28 },
    boundary: BOUNDARY,
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
    measurements: [],
    annotations: [],
    ...overrides,
  } as unknown as SitePlanData;
}

function build(plan: SitePlanData): THREE.Group {
  const scene = new THREE.Scene();
  const ok = buildPlanFootprint(
    THREE as unknown as typeof import('three'),
    scene as unknown as import('three').Scene,
    plan,
    { width: 20, depth: 14 },
    { clampPoints: false },
  );
  expect(ok).toBe(true);
  const group = (scene.getObjectByName('plan-footprint') as THREE.Group | undefined) ?? null;
  expect(group).not.toBeNull();
  return group!;
}

function colorHex(object: THREE.Object3D): number | null {
  const material = (object as unknown as { material?: { color?: { getHex(): number } } }).material;
  return material?.color ? material.color.getHex() : null;
}

describe('3D 规划层：设计范围与场地边界同步', () => {
  it('有设计范围时：白纱蒙版 + 四角白色 L 角标（各带一圈淡墨底线），与 2D 同一个形', () => {
    const group = build(makePlan({ designScope: SCOPE }));
    const marked = group.children.filter(child => child.userData.planDesignScope === true);
    // 1 块白纱面 + 4 个角 ×（1 条白 L + 1 条淡墨底线）= 9（字在单测环境里没有 canvas，会自己跳过）
    expect(marked.length).toBe(9);

    const mask = marked.find(child => child.userData.planDesignScopeMask === true) as THREE.Mesh | undefined;
    expect(mask).toBeTruthy();
    // 2026-11-15 视觉定稿：框外不再压黑，改白纱（与 2D 的 rgba(255,255,255,0.52) 同档）。
    expect(colorHex(mask!)).toBe(0xffffff);
    expect(mask!.position.y).toBeCloseTo(0.049, 6);
    // 有洞才有内外面：外框 4 角 + 范围 4 点，三角化后顶点数一定多于一个四边形
    const position = (mask!.geometry as THREE.BufferGeometry).getAttribute('position');
    expect(position.count).toBeGreaterThan(6);

    // 2D 只留四个角的 L，不画整圈框线；带 4 个角才能和 2D 「一模一样」。
    const brackets = marked.filter(child => child.userData.planDesignScopeRing === true);
    expect(brackets.length).toBe(4);
    for (const bracket of brackets) expect(colorHex(bracket)).toBe(0xffffff);
    const halos = marked.filter(child => child.userData.planDesignScopeHalo === true);
    expect(halos.length).toBe(4);
    for (const halo of halos) expect(colorHex(halo)).toBe(0x0a0e14);
  });

  it('场地边界仍在，且用原有的蓝色（范围框不能顶掉它；范围框不再是琥珀）', () => {
    const group = build(makePlan({ designScope: SCOPE }));
    const colors = group.children.map(colorHex).filter((hex): hex is number => hex !== null);
    expect(colors).toContain(0x7fb3ff);
    expect(colors).toContain(0xffffff);
    expect(colors).not.toContain(0xf2a33c);
  });

  it('没圈设计范围时，3D 层不出现任何范围图元', () => {
    const group = build(makePlan());
    expect(group.children.some(child => child.userData.planDesignScope === true)).toBe(false);
    expect(group.children.map(colorHex)).toContain(0x7fb3ff);
  });

  it('范围比场地大：角标落在壳体之外而不是被钳回边界', () => {
    const group = build(makePlan({ designScope: SCOPE }));
    const brackets = group.children.filter(child => child.userData.planDesignScopeRing === true) as unknown as Array<{
      geometry: { attributes: { instanceStart?: { data: { array: number[] } } } };
    }>;
    const xs: number[] = [];
    for (const bracket of brackets) {
      // Line2 的真实坐标在 instanceStart 的交错缓冲里（每段 6 个分量：起点 xyz + 终点 xyz）。
      const raw = bracket.geometry.attributes.instanceStart?.data.array ?? [];
      for (let index = 0; index < raw.length; index += 3) {
        if (index % 6 === 0) xs.push(raw[index]!);
      }
    }
    expect(xs.length).toBeGreaterThan(3);
    // 场地 20 m 铺满壳体，范围 60 m → 壳体里应出现负坐标与超过 20 的坐标
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(20);
  });
});
