import { describe, expect, it } from 'vitest';
import {
  drawSearchPin,
  matchCandidatePin,
  normalizePinName,
  OUTDOOR_RED,
  type PlanCanvasContext,
  type PlanViewport,
  type SearchCandidatePin,
} from './outdoor-plan-canvas';

const view: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 18, canvasW: 1200, canvasH: 800 };

interface Capture {
  ctx: CanvasRenderingContext2D;
  fills: string[];
  texts: string[];
}

function capture(): Capture {
  const cap: Capture = { fills: [], texts: [] } as unknown as Capture;
  let fillStyle = '';
  const ctx = {
    save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
    moveTo: () => {}, lineTo: () => {}, quadraticCurveTo: () => {}, arc: () => {}, roundRect: () => {},
    fill: () => { cap.fills.push(String(fillStyle)); },
    stroke: () => {},
    measureText: (text: string) => ({ width: text.length * 7 }),
    fillText: (text: string) => { cap.texts.push(text); },
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => fillStyle,
    set: (value: unknown) => { fillStyle = String(value); },
  });
  for (const prop of ['strokeStyle', 'lineWidth', 'shadowColor', 'shadowBlur', 'shadowOffsetY', 'textAlign', 'textBaseline', 'font']) {
    Object.defineProperty(ctx, prop, { get: () => 0, set: () => {} });
  }
  cap.ctx = ctx;
  return cap;
}

const point = { x: 0, y: 0 };
const draw = (pin: { point: typeof point; label: string; index?: number }) => {
  const cap = capture();
  drawSearchPin({ ctx: cap.ctx, viewport: view } as PlanCanvasContext, pin as never);
  return cap;
};

const candidates: SearchCandidatePin[] = [
  { index: 0, lng: 120.1, lat: 30.2, name: '青山湖水上森林' },
  { index: 1, lng: 120.3, lat: 30.4, name: '水上森林设计师度假别墅(杭州临安店)' },
];

// 2026-11-28 用户：「这个还是可以服从123的逻辑啊」——列表写第几条，地图上的钉就得是几号，
// 不能是一枚无从对号的裸钉。断言按「钉身里有没有那个数字」钉住，不钉颜色/尺寸。
describe('搜地点定位钉服从列表编号', () => {
  it('带序号时，钉身上画出与列表同一个号（白字）', () => {
    const cap = draw({ point, label: '青山湖水上森林', index: 0 });
    expect(cap.texts).toContain('1');
    expect(cap.fills[0]).toBe(OUTDOOR_RED);
  });

  it('序号 2 画「2」，不写死成「1」', () => {
    expect(draw({ point, label: '第二候选', index: 1 }).texts).toContain('2');
  });

  it('带序号的钉照样挂名称胶囊', () => {
    const cap = draw({ point, label: '青山湖水上森林', index: 0 });
    expect(cap.texts).toContain('青山湖水上森林');
  });

  it('没有序号时才退回纯红钉，不编一个号出来', () => {
    const cap = draw({ point, label: '某个坐标' });
    expect(cap.texts.some(text => /^\d+$/.test(text))).toBe(false);
    expect(cap.fills[0]).toBe(OUTDOOR_RED);
  });
});

describe('选中点与候选对号', () => {
  it('坐标一致就算第 0 个', () => {
    expect(matchCandidatePin(candidates, { lng: 120.1, lat: 30.2 })).toBe(0);
  });

  it('吸附后坐标略偏，靠名字仍认得是同一个候选（不另长一枚裸钉）', () => {
    expect(matchCandidatePin(candidates, { lng: 120.112, lat: 30.208, label: '青山湖水上森林' })).toBe(0);
  });

  it('括号全半角差异不影响对号', () => {
    expect(matchCandidatePin(candidates, { lng: 0, lat: 0, label: '水上森林设计师度假别墅（杭州临安店）' })).toBe(1);
  });

  it('不在候选里就返 -1', () => {
    expect(matchCandidatePin(candidates, { lng: 0, lat: 0, label: '别的地方' })).toBe(-1);
    expect(matchCandidatePin(candidates, null)).toBe(-1);
  });

  it('归一不改动名字本体的空白语义之外的内容', () => {
    expect(normalizePinName(' 青山湖 水上森林 ')).toBe('青山湖水上森林');
  });
});
