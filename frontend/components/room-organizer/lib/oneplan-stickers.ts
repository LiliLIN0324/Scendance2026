/**
 * OnePlan 贴纸图标映射与 Canvas 绘制桥（H4-b）。
 *
 * 素材来源：`frontend/public/oneplan-icons/`（Lead 抓取的 OnePlan 贴纸，manifest.json 为 slug 权威表）：
 * - `icon/<slug>.svg`：24×24 单色线稿地图符号，适合点位（出入口/人员/动线/语义点）；
 * - `area/<slug>.svg`：人群区/通用区/停车区面域底形，适合分区语义；
 * - `scale-fg|scale-bg/<slug>.svg`：真实尺度前景线稿 + 底形，适合有占地的设施
 *   （画布按米制占地矩形拉伸，旋转与 drawFacilityLayer 同一套矩阵）。
 *
 * 口径：
 * - 映射是「实体语义 → 贴纸」的一等公民，未命中一律返回 null，由调用方回落现有 Lucide
 *   `planningIcon()`（见 components/outdoor-plan-icons.ts），绝不因缺文件白屏；
 * - 贴纸文件会随抓取管线陆续增加：命中与否只影响视觉，不影响数据/命中测试/交互；
 * - `drawOneplanSticker` 内部带 `Image` 缓存，图片 onload 后通过
 *   `subscribeOneplanStickerLoads` 通知画布重绘（首帧缺图不空白，加载完自动补画）；
 * - 纯 Node/SSR 环境没有 `Image`，所有绘制 helper 安全返回 false（测试不受影响）。
 *
 * 校验：`.temp/verify-oneplan-stickers.mjs` 会从本文件的映射表里抽出所有
 * `{ kind, slug }`，逐条核对 manifest.json 与磁盘文件是否存在。
 */

import type { PlanningIconName, PlanningRouteKind, PlanningZoneSemantic } from '@/lib/outdoor-plan-tokens';
import type { PlanNode } from '../../../../supabase/functions/_shared/site-plan';

/** OnePlan 素材种类（对应 public/oneplan-icons 下的三个子目录）。 */
export type OneplanStickerKind = 'icon' | 'area' | 'scale';

/** 一张贴纸的描述：kind + slug 定位文件，icon 是找不到文件时的 Lucide 回落名。 */
export interface OneplanStickerDescriptor {
  kind: OneplanStickerKind;
  /** manifest.json 的 slug（文件名去 .svg）；不要手拼文件名，以 manifest 为准。 */
  slug: string;
  /** 回落 Lucide 图标名（PLANNING_ICONS 登记范围内）。 */
  icon: PlanningIconName;
}

export const ONEOPLAN_STICKER_BASE = '/oneplan-icons';

/**
 * 这些 `icon/` 文件不是「深色圆底 + 白字形」结构（是图元/线型/占位底衬），
 * 画深色芯片会挡掉它们本身，所以芯片只给真正的符号用。
 */
const CHIPLESS_ICON_SLUGS = new Set([
  'circle',
  'transparent',
  'textbox',
  'overlayimage',
  'route-solid',
  'route-dash',
  'route-dot',
]);

/** 该贴纸是否该衬深色圆底（OnePlan 画布上符号的呈现方式：白字形 + 深色圆片）。 */
export function oneplanStickerUsesChip(sticker: OneplanStickerDescriptor | null | undefined): boolean {
  if (!sticker || sticker.kind !== 'icon') return false;
  return !CHIPLESS_ICON_SLUGS.has(sticker.slug);
}

/** 芯片填充色（与页面的深色卡片同族，底图上仍可读）。 */
export const ONEOPLAN_CHIP_FILL = 'rgba(24, 26, 32, 0.88)';

/** 贴纸的 `<img src>`：scale 用前景线稿（画布会另叠加底形）。 */
export function oneplanStickerSrc(sticker: OneplanStickerDescriptor): string {
  if (sticker.kind === 'icon') return `${ONEOPLAN_STICKER_BASE}/icon/${sticker.slug}.svg`;
  if (sticker.kind === 'area') return `${ONEOPLAN_STICKER_BASE}/area/${sticker.slug}.svg`;
  return `${ONEOPLAN_STICKER_BASE}/scale-fg/${sticker.slug}.svg`;
}

/** 真实尺度贴纸的前景/底形两张图（kind='scale' 时供画布成对绘制）。 */
export function oneplanScaleSrcs(slug: string): { fg: string; bg: string } {
  return {
    fg: `${ONEOPLAN_STICKER_BASE}/scale-fg/${slug}.svg`,
    bg: `${ONEOPLAN_STICKER_BASE}/scale-bg/${slug}.svg`,
  };
}

/* ------------------------------------------------------------------ */
/* 映射表：site-plan 实体 → OnePlan slug                                */
/* ------------------------------------------------------------------ */

/** 分区语义（契约 9 类）→ 贴纸：观众/停车用面域底形，其余用地图符号。 */
export const ZONE_STICKERS: Record<PlanningZoneSemantic, OneplanStickerDescriptor> = {
  stage: { kind: 'icon', slug: 'stage', icon: 'shapes' },
  audience: { kind: 'area', slug: 'crowd', icon: 'shapes' },
  parking: { kind: 'area', slug: 'parking', icon: 'shapes' },
  loading: { kind: 'icon', slug: 'load-zone', icon: 'shapes' },
  checkin: { kind: 'icon', slug: 'ticket-check', icon: 'shapes' },
  queue: { kind: 'icon', slug: 'queues', icon: 'shapes' },
  medical: { kind: 'icon', slug: 'first-aid-point', icon: 'shapes' },
  vip: { kind: 'icon', slug: 'vip', icon: 'shapes' },
  reserved: { kind: 'area', slug: 'generic', icon: 'shapes' },
  // 2026-11-14 用户指令「建筑给室内分区」：室内区域面域贴纸。
  indoor: { kind: 'area', slug: 'generic', icon: 'shapes' },
};

/** 设施模板（site-plan-facilities 的 8 个内置 templateId）→ 贴纸。 */
export const FACILITY_STICKERS: Record<string, OneplanStickerDescriptor> = {
  'booth-2x2': { kind: 'scale', slug: 'market-stall', icon: 'tent' },
  'tent-3x3': { kind: 'scale', slug: 'tent', icon: 'tent' },
  'food-truck-6x2.5': { kind: 'scale', slug: 'food-trailer', icon: 'truck' },
  'stage-platform-8x6': { kind: 'scale', slug: 'stage', icon: 'layout-grid' },
  'toilet-2.4x1.2': { kind: 'scale', slug: 'portable-toilet', icon: 'door-open' },
  'medical-tent-4x3': { kind: 'icon', slug: 'first-aid-point', icon: 'user-plus' },
  'security-post-1.5x1.5': { kind: 'icon', slug: 'security-checkpoint', icon: 'user-plus' },
  'trash-point-1.2x1.2': { kind: 'icon', slug: 'waste-and-recycling-point', icon: 'list' },
};

/** 出入口节点类型 → 贴纸。 */
export const NODE_STICKERS: Record<PlanNode['kind'], OneplanStickerDescriptor> = {
  entry: { kind: 'icon', slug: 'entry-gate', icon: 'door-open' },
  exit: { kind: 'icon', slug: 'exit-gate', icon: 'door-open' },
  both: { kind: 'icon', slug: 'turnstile', icon: 'door-open' },
};

/** 动线三类 → 贴纸（线本身仍按现实线条绘制，贴纸只做类型徽标）。 */
export const ROUTE_STICKERS: Record<PlanningRouteKind, OneplanStickerDescriptor> = {
  pedestrian: { kind: 'icon', slug: 'pedestrian-access', icon: 'route' },
  vehicle: { kind: 'icon', slug: 'vehicle-access', icon: 'route' },
  service: { kind: 'icon', slug: 'load-zone', icon: 'route' },
};

/** 人员岗位精确命中（样例「安保」「引导员」必须有）。 */
export const WORKER_ROLE_STICKERS: Record<string, OneplanStickerDescriptor> = {
  安保: { kind: 'icon', slug: 'police', icon: 'users' },
  保安: { kind: 'icon', slug: 'police', icon: 'users' },
  安保队长: { kind: 'icon', slug: 'security-checkpoint', icon: 'users' },
  引导员: { kind: 'icon', slug: 'information-point', icon: 'users' },
  志愿者: { kind: 'icon', slug: 'welfare-point', icon: 'users' },
  医疗: { kind: 'icon', slug: 'first-aid-point', icon: 'users' },
  医护: { kind: 'icon', slug: 'first-aid-point', icon: 'users' },
  检票: { kind: 'icon', slug: 'ticket-check', icon: 'users' },
  验票: { kind: 'icon', slug: 'ticket-check', icon: 'users' },
  保洁: { kind: 'icon', slug: 'waste-and-recycling-point', icon: 'users' },
  环卫: { kind: 'icon', slug: 'waste-and-recycling-point', icon: 'users' },
  消防: { kind: 'icon', slug: 'fire-extinguisher', icon: 'users' },
  技术: { kind: 'icon', slug: 'pa-speakers', icon: 'users' },
  音响: { kind: 'icon', slug: 'pa-speakers', icon: 'users' },
  摄像: { kind: 'icon', slug: 'camera-fixed', icon: 'users' },
  摄影: { kind: 'icon', slug: 'camera-fixed', icon: 'users' },
  停车: { kind: 'icon', slug: 'parking', icon: 'users' },
  调度: { kind: 'icon', slug: 'event-control', icon: 'users' },
};

/** 自定义岗位/设施名的关键词回落（契约里 role/templateId 都是自由字符串）。 */
const WORKER_ROLE_RULES: readonly { pattern: RegExp; sticker: OneplanStickerDescriptor }[] = [
  { pattern: /医|救|first.?aid|medic/i, sticker: { kind: 'icon', slug: 'first-aid-point', icon: 'users' } },
  { pattern: /安保|保安|护卫|警察|警|security|guard|police/i, sticker: { kind: 'icon', slug: 'police', icon: 'users' } },
  { pattern: /检票|验票|票务|ticket/i, sticker: { kind: 'icon', slug: 'ticket-check', icon: 'users' } },
  { pattern: /引导|问询|咨询|接待|志愿|information|steward|guide/i, sticker: { kind: 'icon', slug: 'information-point', icon: 'users' } },
  { pattern: /保洁|环卫|垃圾|清洁|clean|waste/i, sticker: { kind: 'icon', slug: 'waste-and-recycling-point', icon: 'users' } },
  { pattern: /消防|fire/i, sticker: { kind: 'icon', slug: 'fire-extinguisher', icon: 'users' } },
  { pattern: /技术|音响|扩声|audio|sound|pa\b/i, sticker: { kind: 'icon', slug: 'pa-speakers', icon: 'users' } },
  { pattern: /摄|photo|camera/i, sticker: { kind: 'icon', slug: 'camera-fixed', icon: 'users' } },
  { pattern: /停车|泊车|parking/i, sticker: { kind: 'icon', slug: 'parking', icon: 'users' } },
  { pattern: /调度|指挥|control|dispatch/i, sticker: { kind: 'icon', slug: 'event-control', icon: 'users' } },
];

/** 自定义设施 templateId 的关键词回落（例如 sample 里的 custom-gate-4x1）。 */
const FACILITY_TEMPLATE_RULES: readonly { pattern: RegExp; sticker: OneplanStickerDescriptor }[] = [
  { pattern: /gate|闸/i, sticker: { kind: 'icon', slug: 'entry-gate', icon: 'tent' } },
  { pattern: /toilet|wc|厕/i, sticker: { kind: 'scale', slug: 'portable-toilet', icon: 'door-open' } },
  { pattern: /stage|舞台/i, sticker: { kind: 'scale', slug: 'stage', icon: 'layout-grid' } },
  { pattern: /tent|帐篷|篷/i, sticker: { kind: 'scale', slug: 'tent', icon: 'tent' } },
  { pattern: /truck|餐车|货车|trailer/i, sticker: { kind: 'scale', slug: 'food-trailer', icon: 'truck' } },
  { pattern: /medical|医疗|急救/i, sticker: { kind: 'icon', slug: 'first-aid-point', icon: 'user-plus' } },
  { pattern: /security|安保|岗亭/i, sticker: { kind: 'icon', slug: 'security-checkpoint', icon: 'user-plus' } },
  { pattern: /trash|垃圾|waste/i, sticker: { kind: 'icon', slug: 'waste-and-recycling-point', icon: 'list' } },
  { pattern: /booth|摊|stall/i, sticker: { kind: 'scale', slug: 'market-stall', icon: 'tent' } },
];

/* ------------------------------------------------------------------ */
/* 解析函数                                                            */
/* ------------------------------------------------------------------ */

/** 分区语义 → 贴纸（契约枚举全覆盖，恒有值；调用方仍按可空处理以留回落路径）。 */
export function zoneSticker(semantic: PlanningZoneSemantic): OneplanStickerDescriptor | null {
  return ZONE_STICKERS[semantic] ?? null;
}

/** 设施模板 → 贴纸；内置模板精确命中，自定义 templateId 走关键词回落，仍不中返回 null。 */
export function facilitySticker(templateId: string): OneplanStickerDescriptor | null {
  const exact = FACILITY_STICKERS[templateId];
  if (exact) return exact;
  const key = templateId.trim();
  if (!key) return null;
  for (const rule of FACILITY_TEMPLATE_RULES) {
    if (rule.pattern.test(key)) return rule.sticker;
  }
  return null;
}

/** 出入口节点类型 → 贴纸。 */
export function nodeSticker(kind: PlanNode['kind']): OneplanStickerDescriptor | null {
  return NODE_STICKERS[kind] ?? null;
}

/** 人员岗位 → 贴纸；先精确命中再关键词回落，未知岗位返回 null（回落 Lucide users）。 */
export function workerSticker(role: string): OneplanStickerDescriptor | null {
  const key = role.trim();
  if (!key) return null;
  const exact = WORKER_ROLE_STICKERS[key];
  if (exact) return exact;
  for (const rule of WORKER_ROLE_RULES) {
    if (rule.pattern.test(key)) return rule.sticker;
  }
  return null;
}

/** 动线类型 → 贴纸。 */
export function routeSticker(kind: PlanningRouteKind): OneplanStickerDescriptor | null {
  return ROUTE_STICKERS[kind] ?? null;
}

/** 一屏规划里用到的全部贴纸（去重；预加载与校验共用）。 */
export function planStickerDescriptors(plan: {
  zones: readonly { semantic: PlanningZoneSemantic }[];
  facilities: readonly { templateId: string }[];
  routes: readonly { kind: PlanningRouteKind }[];
  nodes: readonly { kind: PlanNode['kind'] }[];
  workers: readonly { role: string }[];
}): OneplanStickerDescriptor[] {
  const seen = new Map<string, OneplanStickerDescriptor>();
  const add = (sticker: OneplanStickerDescriptor | null) => {
    if (!sticker) return;
    seen.set(`${sticker.kind}:${sticker.slug}`, sticker);
  };
  for (const zone of plan.zones) add(zoneSticker(zone.semantic));
  for (const facility of plan.facilities) add(facilitySticker(facility.templateId));
  for (const route of plan.routes) add(routeSticker(route.kind));
  for (const node of plan.nodes) add(nodeSticker(node.kind));
  for (const worker of plan.workers) add(workerSticker(worker.role));
  return [...seen.values()];
}

/* ------------------------------------------------------------------ */
/* Canvas 绘制桥（Image 缓存 + 加载完成回调）                            */
/* ------------------------------------------------------------------ */

type CachedImage = { status: 'loading' | 'ready' | 'error'; image: HTMLImageElement };

const imageCache = new Map<string, CachedImage>();
const loadListeners = new Set<() => void>();
let flushScheduled = false;

function flushLoadListeners(): void {
  flushScheduled = false;
  for (const listener of [...loadListeners]) {
    try {
      listener();
    } catch {
      // 单个监听器异常不能阻断其它重绘订阅（画布已卸载等）。
    }
  }
}

function scheduleLoadFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  // 一帧内多张贴纸返回只触发一次重绘。
  setTimeout(flushLoadListeners, 0);
}

/** 贴纸图片加载完成/失败后的重绘订阅（返回取消函数）。 */
export function subscribeOneplanStickerLoads(listener: () => void): () => void {
  loadListeners.add(listener);
  return () => {
    loadListeners.delete(listener);
  };
}

/** 预加载（只发请求，不阻塞首帧；加载完成仍走订阅重绘）。 */
export function preloadOneplanStickers(stickers: readonly (OneplanStickerDescriptor | null | undefined)[]): void {
  for (const sticker of stickers) {
    if (!sticker) continue;
    if (sticker.kind === 'scale') {
      const srcs = oneplanScaleSrcs(sticker.slug);
      loadImage(srcs.bg);
      loadImage(srcs.fg);
    } else {
      loadImage(oneplanStickerSrc(sticker));
    }
  }
}

/** 取缓存图片；未就绪/失败/无 DOM 环境返回 null（调用方跳过本帧绘制）。 */
function loadImage(src: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  const cached = imageCache.get(src);
  if (cached) return cached.status === 'ready' ? cached.image : null;
  const image = new Image();
  const entry: CachedImage = { status: 'loading', image };
  imageCache.set(src, entry);
  image.onload = () => {
    entry.status = 'ready';
    scheduleLoadFlush();
  };
  image.onerror = () => {
    entry.status = 'error';
    scheduleLoadFlush();
  };
  image.src = src;
  return null;
}

/**
 * 染色版底形缓存：scale-bg 文件绝大多数是烤死的静态灰（非 currentColor），
 * SVG 文本替换行不通，这里用离屏画布 source-in 合成把整张剪影染成物件色。
 * 键 = `src#颜色`；图片未就绪/无 DOM 返回 null（load 完成后的重绘订阅会补画）。
 */
const tintedCanvasCache = new Map<string, HTMLCanvasElement>();

/** 染色版贴纸画布（2D 底形与 3D 贴纸占位共用）；图片未就绪/无 DOM 返回 null。 */
export function getOneplanTintedStickerCanvas(src: string, color: string): HTMLCanvasElement | null {
  return getTintedStickerCanvas(src, color);
}

function getTintedStickerCanvas(src: string, color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = `${src}#${color}`;
  const cached = tintedCanvasCache.get(key);
  if (cached) return cached;
  const image = loadImage(src);
  if (!image) return null;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  tintedCanvasCache.set(key, canvas);
  return canvas;
}

/** 取已就绪的贴纸图片；未就绪/失败/无 DOM 返回 null。会触发后台加载。 */
export function getOneplanStickerImage(src: string): HTMLImageElement | null {
  return loadImage(src);
}

export interface OneplanStickerDrawOptions {
  /** 0–1，缺省 1；底图较亮时可降透明度让线稿更柔和。 */
  alpha?: number;
  /**
   * 2026-11-12 活动包物件主题色：icon 类替换深色芯片（OnePlan 同款彩色圆底），
   * scale 类把底形剪影染成该色。缺省维持既有深色芯片/灰底形（基建类目不受影响）。
   */
  color?: string;
}

function drawCachedImage(
  ctx: CanvasRenderingContext2D,
  src: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  alpha: number,
): boolean {
  const image = loadImage(src);
  if (!image) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, centerX - width / 2, centerY - height / 2, width, height);
  ctx.restore();
  return true;
}

/**
 * 在 Canvas 上画一张 OnePlan 符号（居中，size 为外接方框边长）。
 * 兼容 `drawOneplanSticker(ctx, 'tent', x, y, size)` 的字符串调用：默认按 `icon/` 解析。
 * 返回是否真正画上了（图片未就绪返回 false，调用方无需处理——onload 会触发重绘）。
 */
export function drawOneplanSticker(
  ctx: CanvasRenderingContext2D,
  sticker: OneplanStickerDescriptor | string,
  x: number,
  y: number,
  size: number,
  opts: OneplanStickerDrawOptions = {},
): boolean {
  const resolved: OneplanStickerDescriptor = typeof sticker === 'string'
    ? { kind: 'icon', slug: sticker, icon: 'shapes' }
    : sticker;
  const src = resolved.kind === 'scale' ? oneplanScaleSrcs(resolved.slug).fg : oneplanStickerSrc(resolved);
  const alpha = opts.alpha ?? 1;
  const image = loadImage(src);
  if (!image) return false;
  if (oneplanStickerUsesChip(resolved)) {
    // 符号是白色字形（自带白色外环），浅色底图上必须衬圆片，否则整块看不见。
    // 活动包物件用主题色圆底（OnePlan 同款），其余维持深色芯片。
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = opts.color ?? ONEOPLAN_CHIP_FILL;
    ctx.fill();
    ctx.restore();
  }
  return drawCachedImage(ctx, src, x, y, size, size, alpha);
}

/**
 * 按真实尺度画设施贴纸：底形（scale-bg）+ 前景线稿（scale-fg）成对拉伸到占地矩形，
 * 旋转矩阵与 drawFacilityLayer 一致（rotationDeg 以东为零、逆时针为正）。
 * 返回前景是否真正画上（图片未就绪返回 false）。
 */
export function drawOneplanScaleSticker(
  ctx: CanvasRenderingContext2D,
  slug: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDeg: number,
  opts: OneplanStickerDrawOptions = {},
): boolean {
  const srcs = oneplanScaleSrcs(slug);
  const bg = opts.color ? getTintedStickerCanvas(srcs.bg, opts.color) : loadImage(srcs.bg);
  const fg = loadImage(srcs.fg);
  if (!bg && !fg) return false;
  const alpha = opts.alpha ?? 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-rotationDeg * Math.PI / 180);
  if (bg) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.drawImage(bg, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
  if (fg) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(fg, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
  ctx.restore();
  return Boolean(fg);
}