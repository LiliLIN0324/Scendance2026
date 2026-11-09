import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  canvasToWorld,
  get2DViewTransform,
  worldToScreen,
} from './render';
import { PlanOverlay } from './plan-overlay';
import type { PlanAnnotation } from '../../../lib/plan-annotation';

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

describe('PlanOverlay 门洞：不推断开门方向', () => {
  const t = get2DViewTransform(800, 600, layout, 60);
  const realDoor: PlanAnnotation = {
    id: 'door-real',
    kind: 'door',
    label: '用户真画的门',
    stageNo: 1,
    geometry: { kind: 'door', wall: 'south', position: 0, widthM: 0.9 },
  };
  const inferredDoor: PlanAnnotation = {
    id: 'door-inferred',
    kind: 'door',
    label: '推测南门',
    stageNo: 1,
    geometry: { kind: 'door', wall: 'south', position: 0, widthM: 0.9, inferred: true },
  };

  function renderMarkup(anns: readonly PlanAnnotation[]): string {
    return renderToStaticMarkup(
      <PlanOverlay annotations={anns} transform={t} layout={layout} visible />,
    );
  }

  it('同时渲染两扇门：每扇都有 data-door-inferred 标记', () => {
    const html = renderMarkup([realDoor, inferredDoor]);
    expect(html).toContain('data-door-inferred="false"');
    expect(html).toContain('data-door-inferred="true"');
  });

  it('推测门只画虚线门洞和两端标记，不画铰链与开门弧', () => {
    const html = renderMarkup([inferredDoor]);
    const dashCount = (html.match(/stroke-dasharray/g) ?? []).length;
    expect(dashCount).toBe(1);
    expect(html).toContain('stroke-dasharray="6 4"');
    expect((html.match(/<line/g) ?? []).length).toBe(3);
    expect(html).not.toContain('<path');
    expect(html).not.toContain('<circle');
  });

  it('一般门洞记录不画未确认的铰链或开门弧', () => {
    const html = renderMarkup([realDoor]);
    expect(html).not.toContain('stroke-dasharray');
    expect(html).not.toContain('<path');
    expect(html).not.toContain('<circle');
  });

  it('所有门洞均显示待核验说明，推测与其他记录可区分', () => {
    const inferredHtml = renderMarkup([inferredDoor]);
    expect(inferredHtml).toContain('推测门洞位置、宽度与开向待核验');
    expect(inferredHtml).toContain('font-size="11"');
    expect(inferredHtml).toContain('#6b7280');
    const realHtml = renderMarkup([realDoor]);
    expect(realHtml).toContain('门洞位置、宽度与开向待核验');
  });

  it.each(['north', 'south', 'east', 'west'] as const)('%s 墙的门洞跨度仍按原尺寸投影', (wall) => {
    const door: PlanAnnotation = { ...realDoor, geometry: { kind: 'door', wall, position: 0, widthM: 0.9 } };
    const html = renderMarkup([door]);
    const firstLine = /<line x1="([\d.\-]+)" y1="([\d.\-]+)" x2="([\d.\-]+)" y2="([\d.\-]+)"/.exec(html);
    expect(firstLine).not.toBeNull();
    const [, x1, y1, x2, y2] = firstLine!;
    expect(Math.hypot(Number(x2) - Number(x1), Number(y2) - Number(y1))).toBeCloseTo(0.9 * t.scale, 4);
    expect(html).not.toContain('<path');
  });

  it.each(['north', 'south', 'east', 'west'] as const)('%s 墙宽度未知时只画中心符号，不生成门洞跨度', (wall) => {
    const door: PlanAnnotation = { ...realDoor, geometry: { kind: 'door', wall, position: 1.25, widthM: null } };
    const html = renderMarkup([door]);
    expect(html).toContain('data-door-width="unknown"');
    expect(html).toContain('门中心、宽度与开向待核验');
    expect((html.match(/<line/g) ?? []).length).toBe(2);
    expect(html).not.toContain('<path');
    expect(html).not.toContain('NaN');
    const expected = wall === 'north' ? { x: 1.25, z: -layout.height / 2 }
      : wall === 'south' ? { x: 1.25, z: layout.height / 2 }
        : wall === 'east' ? { x: layout.width / 2, z: 1.25 } : { x: -layout.width / 2, z: 1.25 };
    const center = worldToScreen(expected.x, expected.z, t, layout);
    const firstLine = /<line x1="([\d.\-]+)" y1="([\d.\-]+)" x2="([\d.\-]+)" y2="([\d.\-]+)"/.exec(html)!;
    expect((Number(firstLine[1]) + Number(firstLine[3])) / 2).toBeCloseTo(center.px, 5);
    expect((Number(firstLine[2]) + Number(firstLine[4])) / 2).toBeCloseTo(center.py, 5);
  });
});
