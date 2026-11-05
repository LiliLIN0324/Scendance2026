import { describe, expect, it } from 'vitest';
import {
  canvasToWorld,
  get2DViewTransform,
  worldToScreen,
} from './render';

/**
 * 第 10 批：标注覆盖层与 2D 渲染器共用同一套世界↔屏幕映射。
 * 这里往返断言 worldToScreen ∘ canvasToWorld = identity，
 * 保证 PlanOverlay 画的框 / 线与家具 / 网格严格重合。
 */
const layout = { width: 12, height: 8 };

describe('2D view transform 往返', () => {
  it('get2DViewTransform 在给定画布尺寸下给出可复现的 scale / offset', () => {
    const t = get2DViewTransform(800, 600, layout, 60);
    // scale = min((800-120)/12, (600-120)/8) = min(56.67, 60) = 56.667
    expect(t.scale).toBeCloseTo((800 - 120) / 12, 3);
    // offsetX = (800 - 12*scale)/2
    const expectedOffsetX = (800 - layout.width * t.scale) / 2;
    expect(t.offsetX).toBeCloseTo(expectedOffsetX, 3);
  });

  it('worldToScreen → canvasToWorld 对任意世界点往返不变', () => {
    const t = get2DViewTransform(800, 600, layout, 60);
    const samples = [
      { x: -5.5, z: -3.5 },
      { x: 0, z: 0 },
      { x: 5.9, z: 3.9 },
      { x: -0.3, z: 2.7 },
    ];
    for (const w of samples) {
      const s = worldToScreen(w.x, w.z, t, layout);
      const back = canvasToWorld(s.px, s.py, t, layout);
      expect(back.x).toBeCloseTo(w.x, 6);
      expect(back.z).toBeCloseTo(w.z, 6);
    }
  });

  it('canvasToWorld → worldToScreen 对任意屏幕点往返不变', () => {
    const t = get2DViewTransform(1024, 768, layout, 60);
    const samples = [
      { px: 0, py: 0 },
      { px: 512, py: 384 },
      { px: 100, py: 200 },
      { px: 900, py: 700 },
    ];
    for (const s of samples) {
      const w = canvasToWorld(s.px, s.py, t, layout);
      const back = worldToScreen(w.x, w.z, t, layout);
      expect(back.px).toBeCloseTo(s.px, 6);
      expect(back.py).toBeCloseTo(s.py, 6);
    }
  });

  it('房间中心 (0,0) 投影到画布几何中心', () => {
    const t = get2DViewTransform(800, 600, layout, 60);
    const s = worldToScreen(0, 0, t, layout);
    expect(s.px).toBeCloseTo(400, 3);
    expect(s.py).toBeCloseTo(300, 3);
  });

  it('房间角点 (-w/2, -h/2) 投影到画布内缩后的左上角', () => {
    const t = get2DViewTransform(800, 600, layout, 60);
    const s = worldToScreen(-layout.width / 2, -layout.height / 2, t, layout);
    expect(s.px).toBeCloseTo(t.offsetX, 3);
    expect(s.py).toBeCloseTo(t.offsetY, 3);
  });
});
