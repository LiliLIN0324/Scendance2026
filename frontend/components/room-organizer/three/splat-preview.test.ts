import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { fitSplatBox, frameSplatView, paintAsBackLayer, percentile, robustBox, rotatedBox, upAxisQuaternion } from './splat-preview';

const box = (min: [number, number, number], max: [number, number, number]) =>
  new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

describe('稳健包围盒', () => {
  it('分位数取的是排序后的位置，越界比例只夹到两端', () => {
    expect(percentile([5, 1, 3, 2, 4], 0)).toBe(1);
    expect(percentile([5, 1, 3, 2, 4], 1)).toBe(5);
    expect(percentile([1, 2], 1.5)).toBe(2);
    expect(percentile([], 0.5)).toBeUndefined();
  });

  it('离群 splat 不再把整个场地撑大', () => {
    const centers = Array.from({ length: 99 }, (_, i) => new THREE.Vector3(i % 10, 0, Math.floor(i / 10)))
      .concat(new THREE.Vector3(9000, 9000, 9000));
    const bounds = robustBox(centers, 0.02);
    expect(bounds).not.toBeNull();
    expect(bounds!.max.x).toBeLessThan(10);
    expect(bounds!.max.z).toBeLessThan(10);
    // 贴地的一片点云在 Y 上本来就是零厚度，那不是「没有盒子」。
    expect(bounds!.max.y).toBeLessThan(100);
  });

  it('一个点都采不到就没有包围盒可谈', () => {
    expect(robustBox([])).toBeNull();
  });
});

describe('朝向归正', () => {
  it('Z-up 的扫描转完才是 Y 朝上', () => {
    const zUp = rotatedBox(box([0, 0, 0], [4, 2, 6]), upAxisQuaternion('Z'));
    expect(zUp.min.x).toBeCloseTo(0);
    expect(zUp.max.x).toBeCloseTo(4);
    expect(zUp.max.y).toBeCloseTo(6);
    expect(zUp.min.z).toBeCloseTo(-2);
    expect(zUp.max.z).toBeCloseTo(0);
  });

  it('本来就是 Y-up 的不动它', () => {
    const yUp = rotatedBox(box([-1, 0, -2], [1, 3, 4]), upAxisQuaternion('Y'));
    expect([yUp.min.x, yUp.min.y, yUp.min.z, yUp.max.x, yUp.max.y, yUp.max.z]).toEqual([-1, 0, -2, 1, 3, 4]);
  });
});

describe('按场地尺寸落位', () => {
  it('最长水平边等于场地边长，底面贴 y=0，水平中心回到原点', () => {
    const fit = fitSplatBox(box([-2, 1, 0], [2, 5, 7]), 14);
    expect(fit.scale).toBeCloseTo(2);
    expect(fit.position.y).toBeCloseTo(-2);
    expect(fit.position.x).toBeCloseTo(0);
    expect(fit.position.z).toBeCloseTo(-7);
  });

  it('退化成一个点或尺寸不合法时不缩放，也不除出 Infinity', () => {
    expect(fitSplatBox(box([0, 0, 0], [0, 0, 0]), 10).scale).toBe(1);
    expect(fitSplatBox(box([0, 0, 0], [1, 1, 1]), 0).scale).toBe(1);
  });
});

describe('环境预览的渲染栈隔离', () => {  const part = (type: string, visible = true) => ({ userData: { type }, visible });

  it('先画点云那一条栈，再把布置场景叠上去', () => {
    const sky = new THREE.Color(0xdceefb);
    const back = { children: [], background: null } as unknown as THREE.Scene;
    const scene = { children: [], background: sky } as unknown as THREE.Scene;
    const render = vi.fn();

    paintAsBackLayer({ renderer: { autoClear: true, render } as unknown as THREE.WebGLRenderer, back, scene, camera: {} as THREE.Camera });

    expect(render.mock.calls.map(call => call[0])).toEqual([back, scene]);
    expect(scene.background).toBe(sky);
    expect(back.background).toBeNull();
  });

  it('壳体只在这两趟之间让位，画完连原本被剖掉的墙都按原值还回去', () => {
    const floor = part('floor');
    const cutawayWall = part('wall', false);
    const standingWall = part('wall');
    const chair = part('furniture');
    const outline = part('selection-outline');
    const scene = { children: [floor, cutawayWall, standingWall, chair, outline], background: null } as unknown as THREE.Scene;
    const renderer = { autoClear: true, render: vi.fn(() => {
      // 点云画那一趟：壳体必须已经消失，物料和选中框必须还在。
      expect([floor.visible, standingWall.visible, chair.visible, outline.visible]).toEqual([false, false, true, true]);
    }) } as unknown as THREE.WebGLRenderer;

    paintAsBackLayer({ renderer, back: { children: [], background: null } as unknown as THREE.Scene, scene, camera: {} as THREE.Camera });

    expect([floor.visible, cutawayWall.visible, standingWall.visible, chair.visible, outline.visible])
      .toEqual([true, false, true, true, true]);
  });
});

describe('预览机位站进场内', () => {
  it('站在点云里面、离地 1.6 m，视线落在场地中部', () => {
    const view = frameSplatView(box([-6, 0, -4], [6, 3.6, 4]));
    expect(view.position.y).toBeCloseTo(1.6);
    expect(view.target.y).toBeCloseTo(1.3);
    expect(view.position.x).toBeGreaterThan(-6);
    expect(view.position.x).toBeLessThan(6);
    expect(view.position.z).toBeGreaterThan(-4);
    expect(view.position.z).toBeLessThan(4);
  });

  it('又扁又矮的扫描也不会把相机顶到天花板外', () => {
    const view = frameSplatView(box([0, 0, 0], [40, 1.2, 30]));
    expect(view.position.y).toBeLessThanOrEqual(1.2);
    expect(view.position.y).toBeGreaterThan(0);
    expect(view.target.y).toBeLessThan(1.2);
  });
});
