import { describe, expect, it } from 'vitest';
import { drawSearchPin, OUTDOOR_RED, type PlanCanvasContext, type PlanViewport } from './outdoor-plan-canvas';

const view: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 18, canvasW: 1200, canvasH: 800 };

interface Capture {
  ctx: CanvasRenderingContext2D;
  fills: string[];
  strokes: string[];
  texts: string[];
}

/** 只记「填充时用的颜色」：断言按位置（谁最先被填）走，不按句子走。 */
function capture(): Capture {
  const cap: Capture = { fills: [], strokes: [], texts: [] } as unknown as Capture;
  let fillStyle = '';
  let strokeStyle = '';
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    arc: () => {},
    roundRect: () => {},
    fill: () => { cap.fills.push(String(fillStyle)); },
    stroke: () => { cap.strokes.push(String(strokeStyle)); },
    measureText: (text: string) => ({ width: text.length * 7 }),
    fillText: (text: string) => { cap.texts.push(text); },
  } as unknown as CanvasRenderingContext2D;
  for (const prop of ['fillStyle', 'strokeStyle'] as const) {
    Object.defineProperty(ctx, prop, {
      get: () => (prop === 'fillStyle' ? fillStyle : strokeStyle),
      set: (value: unknown) => { if (prop === 'fillStyle') fillStyle = String(value); else strokeStyle = String(value); },
    });
  }
  for (const prop of ['lineWidth', 'shadowColor', 'shadowBlur', 'shadowOffsetY', 'textAlign', 'textBaseline', 'font']) {
    Object.defineProperty(ctx, prop, { get: () => 0, set: () => {} });
  }
  cap.ctx = ctx;
  return cap;
}

function pin() {
  const cap = capture();
  drawSearchPin({ ctx: cap.ctx, viewport: view } as PlanCanvasContext, { point: { x: 0, y: 0 }, label: '青山湖水上森林' });
  return cap;
}

// 2026-11-28 用户：地图上的白点像残留物，点位一律红色。这条钉住「针身不许白」这一条位置，
// 只断言旧白针的填充色消失了不够——换别的浅色同样要挂。
describe('搜地点定位钉：红色，不再有白针', () => {
  it('针身第一笔填充就是红线色', () => {
    expect(pin().fills[0]).toBe(OUTDOOR_RED);
  });

  it('针身不再有白色填充，也没有旧的黑针心', () => {
    const cap = pin();
    expect(cap.fills).not.toContain('#ffffff');
    expect(cap.fills).not.toContain('#fff');
    expect(cap.fills).not.toContain('white');
    expect(cap.fills.slice(0, 1)).not.toContain('#141416');
  });

  it('红针带白色描边，暗底图上仍能看清', () => {
    expect(pin().strokes.some(stroke => stroke.includes('255, 255, 255'))).toBe(true);
  });

  it('名称标签照旧挂在针上', () => {
    expect(pin().texts).toContain('青山湖水上森林');
  });
});
