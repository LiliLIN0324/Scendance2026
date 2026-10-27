/**
 * 投资人/合伙人报告生成器。
 * 纯 Canvas 2D：输入布局 + 简报 → 1672×941 品牌风 JPEG data URL。
 * 不依赖 html2canvas / puppeteer / 网络请求。
 */
import { render2DTopDown } from '../components/room-organizer/canvas-2d/render';
import type { FloorLayout, RoomLayout } from '../components/room-organizer/lib/types';

// ── 品牌色（与 docs/figures/stage-*.html 保持一致）─────────────────────────
const BRAND = {
  darkGreen: '#2C4A34',
  midGreen: '#3E6B45',
  lightGreen: '#6C9A63',
  textDark: '#14251A',
  textMid: '#24352A',
  textSoft: '#58624F',
  textFaint: '#7C8874',
  rule: '#C3CBB8',
  ruleLight: '#DADCCE',
  paperBg1: '#F9F6EF',
  paperBg2: '#F2EFE5',
  paperBg3: '#EDEADF',
  paperAccent: '#E4EBDD',
  windowShadow: 'rgba(26,42,30,.28)',
};

// ── 尺寸（与 stage 模板 1672×941 对齐）────────────────────────────────────
const W = 1672;
const H = 941;

export interface InvestorReportData {
  /** 活动名 — 简报里的或对话里收集的 */
  event: string;
  /** 人数 */
  headcount: number | null;
  /** 室内/户外 */
  venueIO: 'indoor' | 'outdoor' | null;
  /** 场地尺寸（米） */
  lengthM: number;
  widthM: number;
  /** 布局对象 — 用于 2D 平面渲染 + 物料汇总 */
  layout: RoomLayout;
  /** 当前楼层索引（默认 0） */
  floorIndex?: number;
  /** 对话收集的简报记忆（可选，用于更完整的文案） */
  briefNotes?: string | null;
  /** 物料汇总：名字 → 数量 */
  materialSummary: Array<{ name: string; count: number }>;
  /** 生成时间标签（不填就用当前时间） */
  generatedAt?: Date;
  /** 报告编号前缀 */
  reportPrefix?: string;
}

/** 生成纸纹 — 在一个小 canvas 上画噪点，再作为 pattern 贴上去。 */
function makePaperPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const cx = c.getContext('2d');
  if (!cx) return null;
  const img = cx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 245 + Math.floor(Math.random() * 18); // 暖色噪点
    img.data[i] = v; img.data[i + 1] = v - 4; img.data[i + 2] = v - 10; img.data[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  // 压暗一点做底纹
  cx.globalCompositeOperation = 'multiply';
  const grad = cx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size * 0.7);
  grad.addColorStop(0, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(180,170,140,0.35)');
  cx.fillStyle = grad;
  cx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  try { return ctx.createPattern(c, 'repeat'); } catch { return null; }
}

/** 画背景：径向渐变 + 纸纹。 */
function drawBackground(ctx: CanvasRenderingContext2D): void {
  // 主渐变（从 stage-03 的 158° 渐变简化成从上到下的柔和过渡）
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, BRAND.paperBg1);
  grad.addColorStop(0.58, BRAND.paperBg2);
  grad.addColorStop(1, BRAND.paperBg3);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // 右上角一点绿意
  const accent = ctx.createRadialGradient(W * 0.88, H * 0.12, 40, W * 0.88, H * 0.12, 600);
  accent.addColorStop(0, 'rgba(228,235,221,0.7)');
  accent.addColorStop(1, 'rgba(228,235,221,0)');
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, H);
  // 纸纹
  const paper = makePaperPattern(ctx);
  if (paper) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/** 三柱标（Scendance mark）。 */
function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const bars = [
    { h: 17, w: 8, c: BRAND.darkGreen, a: 0.55 },
    { h: 25, w: 8, c: BRAND.darkGreen, a: 1 },
    { h: 30, w: 8, c: BRAND.lightGreen, a: 1 },
  ];
  let cursor = x;
  for (const b of bars) {
    ctx.save();
    ctx.globalAlpha = b.a;
    ctx.fillStyle = b.c;
    roundRect(ctx, cursor, y - b.h, b.w, b.h, 4);
    ctx.fill();
    ctx.restore();
    cursor += b.w + 5;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** 在一个离屏 canvas 上渲染 2D 平面，返回该 canvas。 */
function renderFloorPlanCanvas(layout: RoomLayout, floor: FloorLayout, targetW: number, targetH: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = targetW;
  c.height = targetH;
  // CSS 尺寸 = 逻辑尺寸，render2DTopDown 用 clientWidth/clientHeight 算 scale
  Object.defineProperty(c, 'clientWidth', { value: targetW, configurable: true });
  Object.defineProperty(c, 'clientHeight', { value: targetH, configurable: true });
  render2DTopDown({
    canvas: c, layout, floor,
    selectedItemId: null,
    showMeasurements: false, showWiFiSignals: false, showHeatmap: false,
    showFloorPlan: true,
    hasCollision: () => false,
    padding: 40,
  });
  return c;
}

/** 物料中文名映射（从 agent-panel.tsx 借过来的，只处理最常见默认名）。 */
function localizeMaterial(name: string): string {
  const map: Record<string, string> = {
    'Dining Chair': '餐椅', 'Dining Table': '餐桌',
    'Armchair': '扶手椅', 'Coffee Table': '茶几', 'Side Table': '边桌',
    'Sofa': '沙发', 'Bench': '长椅',
    'Reception Desk': '签到台', 'Backdrop': '背景板',
    'Lectern': '演讲台', 'Podium': '讲台',
    'Plant': '绿植', 'Flower Pot': '花盆',
    'Carpet': '地毯', 'Rug': '地毯',
    'Laptop': '电脑', 'Projector Screen': '投影幕',
  };
  return map[name] ?? name;
}

// ── 主入口 ─────────────────────────────────────────────────────────────────

export async function generateInvestorReport(data: InvestorReportData): Promise<string> {
  if (typeof document === 'undefined') throw new Error('报告生成只能在浏览器里跑。');

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context 拿不到。');

  // 抗锯齿
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // ── 背景 ──
  drawBackground(ctx);

  // ── 品牌标 ──
  const BRAND_X = 96;
  const BRAND_Y = 66 + 30; // mark 底部对齐 y=66+30
  drawBrandMark(ctx, BRAND_X, BRAND_Y);
  ctx.fillStyle = BRAND.textDark;
  ctx.font = '800 26px "Noto SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('幕景 · Scendance', BRAND_X + 49, BRAND_Y - 15);
  ctx.fillStyle = BRAND.textFaint;
  ctx.font = '600 13px "Noto SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('VENUE · LAYOUT · INTELLIGENCE', BRAND_X + 49, BRAND_Y + 6);

  // ── EYEBROW ──
  const EYEBROW_Y = 196;
  ctx.fillStyle = BRAND.textFaint;
  ctx.font = '600 12.5px "Noto SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('方案简报   ·   投资人 / 合伙人', BRAND_X, EYEBROW_Y);

  // 细竖线
  ctx.fillStyle = BRAND.rule;
  ctx.fillRect(BRAND_X + 200, EYEBROW_Y - 6, 46, 1);

  // ── 主标题 ──
  const TITLE_Y = 236;
  ctx.fillStyle = BRAND.textDark;
  ctx.font = '900 80px "Noto SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'top';
  const title = data.event || '这场活动';
  // 标题太长就截断
  const maxTitleW = 400;
  const titleText = ctx.measureText(title).width > maxTitleW ? title.slice(0, 12) + '…' : title;
  ctx.fillText(titleText, BRAND_X, TITLE_Y);
  // 标题下的装饰竖条（stage 模板里标题是 80px，我们用一条 accent 色竖线代替 accent 字）
  ctx.fillStyle = BRAND.midGreen;
  ctx.fillRect(BRAND_X, TITLE_Y + 95, 60, 4);

  // ── LEDE（一句话描述）──
  const LEDE_Y = 494;
  ctx.fillStyle = BRAND.textSoft;
  ctx.font = '400 17px/1.95 "Noto SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'top';
  const io = data.venueIO === 'outdoor' ? '户外' : '室内';
  const area = data.lengthM * data.widthM;
  const headcountStr = data.headcount ? `${data.headcount} 人` : '人数待定';
  const lede = [
    `${io}场地，${data.lengthM} × ${data.widthM} m，`,
    `约 ${Math.round(area)} ㎡，按 ${headcountStr} 布置。`,
  ].join('');
  wrapText(ctx, lede, BRAND_X, LEDE_Y, 404, 33);

  // ── FACTS 四条 ──
  const FACTS_Y = 636;
  const FACTS_W = 404;
  const facts: Array<{ k: string; v: string; unit?: string }> = [
    { k: '活动类型', v: data.event || '未标注' },
    { k: '预计人数', v: data.headcount ? String(data.headcount) : '—', unit: '人' },
    { k: '场地尺寸', v: `${data.lengthM} × ${data.widthM}`, unit: '米' },
    { k: '布置面积', v: String(Math.round(area)), unit: '㎡' },
  ];
  ctx.textBaseline = 'alphabetic';
  facts.forEach((f, i) => {
    const y = FACTS_Y + i * 49;
    // 分隔线
    if (i > 0) { ctx.fillStyle = BRAND.ruleLight; ctx.fillRect(BRAND_X, y - 14, FACTS_W, 1); }
    // key
    ctx.fillStyle = BRAND.textFaint;
    ctx.font = '600 12px "Noto SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(f.k, BRAND_X, y);
    // value
    ctx.fillStyle = BRAND.textMid;
    ctx.font = '700 21px "Noto SC", "Microsoft YaHei", sans-serif';
    const v = f.unit ? `${f.v}  ${f.unit}` : f.v;
    ctx.fillText(v, BRAND_X + FACTS_W - ctx.measureText(v).width, y);
  });
  // 底部分隔线
  ctx.fillStyle = BRAND.ruleLight;
  ctx.fillRect(BRAND_X, FACTS_Y + facts.length * 49 - 14, FACTS_W, 1);

  // ── 物料清单 ──
  const MAT_Y = FACTS_Y + facts.length * 49 + 20;
  if (data.materialSummary.length) {
    ctx.fillStyle = BRAND.textFaint;
    ctx.font = '600 12px "Noto SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('主要物料', BRAND_X, MAT_Y);
    ctx.fillStyle = BRAND.rule;
    ctx.fillRect(BRAND_X, MAT_Y + 4, 36, 1);

    ctx.fillStyle = BRAND.textSoft;
    ctx.font = '500 13px "Noto SC", "Microsoft YaHei", sans-serif';
    const top = data.materialSummary.slice(0, 6).map(m => `${localizeMaterial(m.name)} ×${m.count}`).join('   ');
    wrapText(ctx, top, BRAND_X, MAT_Y + 18, FACTS_W, 20);
  }

  // ── FOOT ──
  const generatedAt = data.generatedAt ?? new Date();
  const dateLabel = `${generatedAt.getFullYear()}.${String(generatedAt.getMonth() + 1).padStart(2, '0')}.${String(generatedAt.getDate()).padStart(2, '0')}`;
  const prefix = data.reportPrefix ?? 'RPT';
  ctx.fillStyle = '#98A18F';
  ctx.font = '500 11.5px "Noto SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${prefix}-${dateLabel}-${String(Math.floor(Math.random() * 900) + 100)}`, BRAND_X, H - 46);
  ctx.fillStyle = '#C0C7B6';
  ctx.fillText('|', BRAND_X + 160, H - 46);
  ctx.fillStyle = '#98A18F';
  ctx.fillText('幕景 · Scendance  —  AI 原生活动布局', BRAND_X + 174, H - 46);

  // ── 右侧窗口：2D 平面 ──
  const WIN_X = 548;
  const WIN_Y = 130;
  const WIN_W = 1080;
  const WIN_H = 675;

  // 窗口阴影（画一个偏移的圆角黑色块模拟多层阴影）
  drawWindowShadow(ctx, WIN_X, WIN_Y, WIN_W, WIN_H);

  // 窗口底
  ctx.save();
  roundRect(ctx, WIN_X, WIN_Y, WIN_W, WIN_H, 18);
  ctx.clip();
  const floor = data.layout.floors[Math.min(data.floorIndex ?? 0, data.layout.floors.length - 1)]!;
  const planCanvas = renderFloorPlanCanvas(data.layout, floor, WIN_W, WIN_H);
  ctx.drawImage(planCanvas, WIN_X, WIN_Y);
  // 窗口内高光边
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  roundRect(ctx, WIN_X + 0.5, WIN_Y + 0.5, WIN_W - 1, WIN_H - 1, 18);
  ctx.stroke();
  ctx.restore();
  // 窗口外框
  ctx.strokeStyle = 'rgba(30,48,36,0.14)';
  ctx.lineWidth = 1;
  roundRect(ctx, WIN_X, WIN_Y, WIN_W, WIN_H, 18);
  ctx.stroke();

  // ── CAPTION ──
  ctx.fillStyle = BRAND.textFaint;
  ctx.font = '500 12.5px "Noto SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'alphabetic';
  const caption = `平面示意 · ${data.lengthM} × ${data.widthM} m · ${data.materialSummary.reduce((s, m) => s + m.count, 0)} 件物料`;
  const capW = ctx.measureText(caption).width;
  ctx.fillText(caption, W - 60 - capW, H - 52);
  ctx.fillStyle = '#B9C2AF';
  ctx.fillRect(W - 60 - capW - 36, H - 54, 26, 1);

  // 导出
  return canvas.toDataURL('image/jpeg', 0.92);
}

function drawWindowShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  // 大阴影
  ctx.shadowColor = 'rgba(26,42,30,0.42)';
  ctx.shadowBlur = 90;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 46;
  ctx.fillStyle = BRAND.paperBg2;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  // 上层浅阴影
  ctx.shadowColor = 'rgba(26,42,30,0.24)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 14;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.restore();
}

/** 文本换行（按像素宽度）。逐字符累积，超宽就换行。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const chars = text.split('');
  let line = '';
  let ly = y;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, ly);
      line = ch;
      ly += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, ly);
}

// ── 便捷函数：从 agent-panel 里能拿到的数据构造一份 report ─────────────────

export interface BuildReportFromAgentInput {
  layout: RoomLayout;
  event: string | null;
  headcount: number | null;
  venueIO: 'indoor' | 'outdoor' | null;
  materialSummary: Array<{ name: string; count: number }>;
  floorIndex?: number;
  briefNotes?: string | null;
}

/** 便捷入口：直接从 agent 面板能拿到的字段生成报告并触发下载。 */
export async function downloadInvestorReport(input: BuildReportFromAgentInput): Promise<void> {
  const area = input.layout.width * input.layout.height;
  const report: InvestorReportData = {
    event: input.event || '未命名活动',
    headcount: input.headcount,
    venueIO: input.venueIO,
    lengthM: Math.round(input.layout.width * 10) / 10,
    widthM: Math.round(input.layout.height * 10) / 10,
    layout: input.layout,
    materialSummary: input.materialSummary,
  };
  if (input.floorIndex !== undefined) report.floorIndex = input.floorIndex;
  if (input.briefNotes !== undefined) report.briefNotes = input.briefNotes;
  const dataUrl = await generateInvestorReport(report);
  const a = document.createElement('a');
  const safeName = (input.event || 'report').replace(/[\\/:*?"<>|]/g, '_');
  a.href = dataUrl;
  a.download = `Scendance-${safeName}-${Math.round(area)}sqm.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
