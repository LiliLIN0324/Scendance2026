/**
 * 左栏双面板堆栈的排版状态（2026-11-12 泛化：任意两张可见卡共用同一套交互）。
 *
 * 2026-11-11 用户要求：两个面板同开时
 *   1. 中间要有清晰的分隔；
 *   2. 可以上下换序；
 *   3. 可以拖动改高度（一个高另一个就矮）；
 *   4. 可以把其中一个抓出来变成独立小窗（还能收回去）。
 * 2026-11-12 用户确认：这套「半卡片」交互推广到左栏所有卡片（拍摄场地、成员私聊
 *   也参与；收起下限不变，默认一半一半）。
 *
 * 这里只放纯函数与本地持久化，DOM 与指针逻辑留在 room-organizer.tsx。
 */

/** 左栏堆栈成员：户外规划卡 / Bingo 会话卡 / 拍摄场地卡 / 成员私聊卡。 */
export type LeftStackPanelId = 'outdoor' | 'bingo' | 'capture' | 'chat';
export type LeftStackDetached = LeftStackPanelId | null;

export interface LeftStackRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LeftStackState {
  /** 堆栈时摆在上面（DOM 视觉顺序在前）的那张卡。 */
  first: LeftStackPanelId;
  /** 共存时第一张卡占的高度比例（0..1），第二张吃剩下的。 */
  ratio: number;
  /** 抓出来变成独立小窗的面板（同一时间只允许一个）。 */
  detached: LeftStackDetached;
  rects: Record<LeftStackPanelId, LeftStackRect>;
}

export const LEFT_STACK_STORAGE_KEY = 'scendance-left-stack-v1';
export const LEFT_STACK_RATIO_MIN = 0.22;
export const LEFT_STACK_RATIO_MAX = 0.78;
export const LEFT_STACK_FLOAT_MIN_WIDTH = 280;
export const LEFT_STACK_FLOAT_MIN_HEIGHT = 240;
/** 独立小窗离视口边缘至少要留的空隙。 */
export const LEFT_STACK_FLOAT_MARGIN = 8;

const FALLBACK_VIEWPORT = { width: 1280, height: 800 };

const PANEL_IDS: readonly LeftStackPanelId[] = ['outdoor', 'bingo', 'capture', 'chat'];

/** 各卡独立小窗的默认落位：户外/会话沿用原位，拍摄场地与私聊卡居中偏右一点。 */
export function defaultFloatRect(panel: LeftStackPanelId, viewport: { width: number; height: number } = FALLBACK_VIEWPORT): LeftStackRect {
  const width = Math.max(LEFT_STACK_FLOAT_MIN_WIDTH, Math.min(480, Math.round(viewport.width * 0.4)));
  const height = Math.max(LEFT_STACK_FLOAT_MIN_HEIGHT, Math.min(720, Math.round(viewport.height * 0.66)));
  const shift = panel === 'outdoor' ? -24 : panel === 'bingo' ? 0 : panel === 'capture' ? 24 : 48;
  const x = Math.max(LEFT_STACK_FLOAT_MARGIN, Math.round(viewport.width / 2 - width - 24 + shift));
  return { x, y: 72, width, height };
}

/** 流程默认：第一张卡在上、各半（用户确认的「一半一半」）。 */
export function defaultLeftStackState(viewport: { width: number; height: number } = FALLBACK_VIEWPORT): LeftStackState {
  return {
    first: 'outdoor',
    ratio: 0.5,
    detached: null,
    rects: {
      outdoor: defaultFloatRect('outdoor', viewport),
      bingo: defaultFloatRect('bingo', viewport),
      capture: defaultFloatRect('capture', viewport),
      chat: defaultFloatRect('chat', viewport),
    },
  };
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(LEFT_STACK_RATIO_MAX, Math.max(LEFT_STACK_RATIO_MIN, value));
}

/**
 * 把独立小窗夹回视口内：先保尺寸（不小于最小值），再挪位置，
 * 保证标题条始终能抓到、右下角 resize 手柄不出屏。
 */
export function clampFloatRect(rect: LeftStackRect, viewport: { width: number; height: number }): LeftStackRect {
  const maxWidth = Math.max(LEFT_STACK_FLOAT_MIN_WIDTH, viewport.width - LEFT_STACK_FLOAT_MARGIN * 2);
  const maxHeight = Math.max(LEFT_STACK_FLOAT_MIN_HEIGHT, viewport.height - LEFT_STACK_FLOAT_MARGIN * 2);
  const width = Math.min(maxWidth, Math.max(LEFT_STACK_FLOAT_MIN_WIDTH, Math.round(rect.width)));
  const height = Math.min(maxHeight, Math.max(LEFT_STACK_FLOAT_MIN_HEIGHT, Math.round(rect.height)));
  const maxX = Math.max(LEFT_STACK_FLOAT_MARGIN, viewport.width - width - LEFT_STACK_FLOAT_MARGIN);
  const maxY = Math.max(LEFT_STACK_FLOAT_MARGIN, viewport.height - height - LEFT_STACK_FLOAT_MARGIN);
  const x = Math.min(maxX, Math.max(LEFT_STACK_FLOAT_MARGIN, Math.round(rect.x)));
  const y = Math.min(maxY, Math.max(LEFT_STACK_FLOAT_MARGIN, Math.round(rect.y)));
  return { x, y, width, height };
}

function isPanelId(value: unknown): value is LeftStackPanelId {
  return typeof value === 'string' && (PANEL_IDS as readonly string[]).includes(value);
}

function isRect(value: unknown): value is LeftStackRect {
  if (!value || typeof value !== 'object') return false;
  const rect = value as Partial<LeftStackRect>;
  return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height);
}

/**
 * 读盘进来的东西可能是老版本/手改的，一律容错回默认值。
 * 旧版 `order: 'outdoor-first' | 'bingo-first'` 映射成 `first: 'outdoor' | 'bingo'`；
 * 旧版 rects 只有户外/会话两键，拍摄场地与私聊卡补默认值。
 */
export function normalizeLeftStackState(input: unknown, viewport?: { width: number; height: number }): LeftStackState {
  const fallback = defaultLeftStackState(viewport);
  if (!input || typeof input !== 'object') return fallback;
  const raw = input as Record<string, unknown> & Partial<LeftStackState> & { order?: unknown };
  const detached: LeftStackDetached = isPanelId(raw.detached) ? raw.detached : null;
  const first = isPanelId(raw.first)
    ? raw.first
    : raw.order === 'bingo-first' ? 'bingo' : raw.order === 'outdoor-first' ? 'outdoor' : fallback.first;
  const rects = raw.rects && typeof raw.rects === 'object' ? (raw.rects as Partial<Record<LeftStackPanelId, LeftStackRect>>) : {};
  return {
    first,
    ratio: typeof raw.ratio === 'number' ? clampRatio(raw.ratio) : fallback.ratio,
    detached,
    rects: {
      outdoor: isRect(rects.outdoor) ? clampFloatRect(rects.outdoor, viewport ?? FALLBACK_VIEWPORT) : fallback.rects.outdoor,
      bingo: isRect(rects.bingo) ? clampFloatRect(rects.bingo, viewport ?? FALLBACK_VIEWPORT) : fallback.rects.bingo,
      capture: isRect(rects.capture) ? clampFloatRect(rects.capture, viewport ?? FALLBACK_VIEWPORT) : fallback.rects.capture,
      chat: isRect(rects.chat) ? clampFloatRect(rects.chat, viewport ?? FALLBACK_VIEWPORT) : fallback.rects.chat,
    },
  };
}

type ReadableStorage = Pick<Storage, 'getItem'>;

export function readLeftStackState(storage?: ReadableStorage | null, viewport?: { width: number; height: number }): LeftStackState {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return defaultLeftStackState(viewport);
  try {
    const raw = store.getItem(LEFT_STACK_STORAGE_KEY);
    if (!raw) return defaultLeftStackState(viewport);
    return normalizeLeftStackState(JSON.parse(raw), viewport);
  } catch {
    return defaultLeftStackState(viewport);
  }
}

type WritableStorage = Pick<Storage, 'setItem'>;

export function writeLeftStackState(state: LeftStackState, storage?: WritableStorage | null): void {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return;
  try {
    store.setItem(LEFT_STACK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式/配额满：排版偏好丢了不影响使用 */
  }
}

/** 换序：把「现在在上面」让给另一张卡（两张卡 id 都来自当前可见对）。 */
export function swapLeftStackOrder(state: LeftStackState, other: LeftStackPanelId): LeftStackState {
  if (state.first === other) return state;
  return { ...state, first: other };
}

export function withLeftStackRatio(state: LeftStackState, ratio: number): LeftStackState {
  const next = clampRatio(ratio);
  if (Math.abs(next - state.ratio) < 0.001) return state;
  return { ...state, ratio: next };
}

export function withLeftStackDetached(state: LeftStackState, panel: LeftStackDetached): LeftStackState {
  if (state.detached === panel) return state;
  return { ...state, detached: panel };
}

export function withLeftStackRect(state: LeftStackState, panel: LeftStackPanelId, rect: LeftStackRect): LeftStackState {
  return { ...state, rects: { ...state.rects, [panel]: rect } };
}

/**
 * 分隔条拖动量 → 第一张卡（永远在上）的占比：指针往下第一张就变高。
 */
export function ratioFromPointer(pointerY: number, stackTop: number, stackHeight: number): number {
  if (!Number.isFinite(pointerY) || !Number.isFinite(stackTop) || stackHeight <= 0) return 0.5;
  return clampRatio((pointerY - stackTop) / stackHeight);
}
