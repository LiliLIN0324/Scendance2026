/**
 * 底图瓦片缓存 + 逐级兜底绘制。
 *
 * 为什么需要它：画布每次 draw() 都会 clearRect 再按可见网格取瓦片。
 * 早先的实现每个瓦片都 `new Image()`（没有任何缓存），且只在 `onload` 里
 * `drawImage` —— 于是每次缩放/平移都会「先清空、再等网络图」，表现为一闪一闪；
 * 旧图的 onload 还会把瓦片画到过期坐标上（拖影）。用户实测反馈：
 * 「我在缩放的时候地图总是一闪一闪的」。
 *
 * 现在的口径：
 * - 同一 URL 只请求一次，结果留在缓存里；draw() 只同步画缓存命中的瓦片；
 * - 当前层级瓦片还没到位时，用**上一级已缓存的瓦片**裁出对应子区域放大兜底，
 *   画面永远是连续的（先糊、后清晰），不会出现白闪；
 * - 新瓦片到达通过 `onDirty` 合并成一次重绘（调用方用 rAF 节流）。
 *
 * 这个模块不依赖 React，也不假设 `Image` 一定存在（服务端渲染时 `load` 直接视为失败），
 * 因此可以在单测里只测几何与缓存语义。
 */

export type TileLoadStatus = 'loading' | 'ready' | 'error';

interface TileEntry {
  img: HTMLImageElement;
  status: TileLoadStatus;
  listeners: (() => void)[];
}

/** 上一级瓦片在「当前瓦片」里的裁剪区域（用于兜底放大）。 */
export interface AncestorTileCrop {
  /** 祖先层级。 */
  zoom: number;
  x: number;
  y: number;
  /** 祖先图片里要取的子区域像素原点与边长（图片坐标）。 */
  sx: number;
  sy: number;
  size: number;
}

/**
 * 把当前瓦片 (z, x, y) 映射到 d 级祖先瓦片里的裁剪区域。
 * 例：d=1 时祖先覆盖 2×2 个当前瓦片，裁剪边长是瓦片的一半。
 */
export function ancestorTileCrop(
  zoom: number,
  x: number,
  y: number,
  depth: number,
  tileSize: number,
): AncestorTileCrop {
  const d = Math.max(1, Math.trunc(depth));
  const zoomOut = Math.max(0, zoom - d);
  const span = 2 ** d;
  const ax = Math.floor(x / span);
  const ay = Math.floor(y / span);
  const offsetX = x - ax * span;
  const offsetY = y - ay * span;
  const size = tileSize / span;
  return { zoom: zoomOut, x: ax, y: ay, sx: offsetX * size, sy: offsetY * size, size };
}

/** 单例式瓦片缓存：同一 URL 只加载一次，超过上限按插入顺序淘汰最旧的。 */
export class BasemapTileCache {
  private readonly entries = new Map<string, TileEntry>();
  private readonly max: number;
  private readonly createImage: () => HTMLImageElement;
  private readyCount = 0;
  private errorCount = 0;

  constructor(options?: { max?: number; createImage?: () => HTMLImageElement }) {
    this.max = options?.max ?? 900;
    this.createImage =
      options?.createImage ?? (() => new Image() as HTMLImageElement);
  }

  /** 已就绪的图片；未就绪返回 null（不触发加载）。 */
  get(url: string): HTMLImageElement | null {
    const entry = this.entries.get(url);
    return entry && entry.status === 'ready' ? entry.img : null;
  }

  /** 是否已经发起过这个 URL 的加载（无论成功失败）。 */
  has(url: string): boolean {
    return this.entries.has(url);
  }

  /**
   * 请求一个瓦片。重复调用同一 URL 只会挂监听，不会重复发请求。
   * `onReady` 在图片就绪时调用；加载失败不回调（调用方继续用祖先兜底）。
   */
  load(url: string, onReady: () => void): void {
    const existing = this.entries.get(url);
    if (existing) {
      if (existing.status === 'ready') onReady();
      else if (existing.status === 'loading') existing.listeners.push(onReady);
      return;
    }
    let img: HTMLImageElement;
    try {
      img = this.createImage();
    } catch {
      return;
    }
    const entry: TileEntry = { img, status: 'loading', listeners: [onReady] };
    this.entries.set(url, entry);
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      entry.status = 'ready';
      this.readyCount += 1;
      const listeners = entry.listeners;
      entry.listeners = [];
      for (const listener of listeners) listener();
    };
    img.onerror = () => {
      entry.status = 'error';
      this.errorCount += 1;
      entry.listeners = [];
    };
    img.src = url;
    this.trim();
  }

  /** 已缓存（就绪）数量。 */
  get size(): number {
    return this.entries.size;
  }

  get stats(): { entries: number; ready: number; errors: number } {
    return { entries: this.entries.size, ready: this.readyCount, errors: this.errorCount };
  }

  /** 清空（切换图源时用，避免不同源的同坐标瓦片串味）。 */
  clear(): void {
    for (const entry of this.entries.values()) {
      entry.listeners = [];
      entry.img.onload = null;
      entry.img.onerror = null;
    }
    this.entries.clear();
    this.readyCount = 0;
    this.errorCount = 0;
  }

  private trim(): void {
    while (this.entries.size > this.max) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const entry = this.entries.get(oldestKey);
      if (entry) {
        entry.listeners = [];
        entry.img.onload = null;
        entry.img.onerror = null;
      }
      this.entries.delete(oldestKey);
    }
  }
}

export interface BasemapPaintSpec {
  ctx: CanvasRenderingContext2D;
  cache: BasemapTileCache;
  /** 当前层级与视口中心的世界像素坐标。 */
  zoom: number;
  centerPx: number;
  centerPy: number;
  cssW: number;
  cssH: number;
  /** 瓦片边长（设备无关像素）。 */
  tileSize: number;
  /** 可见瓦片网格。 */
  tiles: readonly { x: number; y: number }[];
  /** 取某层级瓦片在该坐标下的图源 URL 列表（天地图是底图 + 注记两层）。 */
  urlsFor: (zoom: number, x: number, y: number) => readonly string[];
  /** 有新瓦片就绪、需要重绘时调用（调用方自行 rAF 节流）。 */
  onDirty: () => void;
  /** 祖先兜底最多回溯层级，默认 4。 */
  fallbackDepth?: number;
}

export interface BasemapPaintResult {
  /** 本层瓦片直接命中缓存并画上的数量。 */
  drawn: number;
  /** 用祖先瓦片兜底画上的数量。 */
  fallback: number;
  /** 正在加载、这次没画上的数量。 */
  pending: number;
}

/**
 * 同步绘制一屏底图瓦片：优先当前层级缓存，缺失则用祖先瓦片裁剪放大兜底，
 * 同时把缺失的 URL 丢进加载队列（就绪后经 onDirty 触发重绘）。
 */
export function paintBasemapTiles(spec: BasemapPaintSpec): BasemapPaintResult {
  const {
    ctx,
    cache,
    zoom,
    centerPx,
    centerPy,
    cssW,
    cssH,
    tileSize,
    tiles,
    urlsFor,
    onDirty,
  } = spec;
  const fallbackDepth = spec.fallbackDepth ?? 4;
  const result: BasemapPaintResult = { drawn: 0, fallback: 0, pending: 0 };

  for (const { x, y } of tiles) {
    const left = x * tileSize - centerPx + cssW / 2;
    const top = y * tileSize - centerPy + cssH / 2;
    // 视口外的瓦片不画（网格本身有 1 格余量）。
    if (left > cssW || top > cssH || left + tileSize < 0 || top + tileSize < 0) continue;

    const layers = urlsFor(zoom, x, y);
    layers.forEach((url, layerIndex) => {
      const ready = cache.get(url);
      if (ready) {
        ctx.drawImage(ready, left, top, tileSize, tileSize);
        result.drawn += 1;
        return;
      }
      cache.load(url, onDirty);
      // 祖先兜底：拿上一级已缓存的瓦片，裁出本格对应的子区域放大。
      for (let depth = 1; depth <= fallbackDepth; depth += 1) {
        if (zoom - depth < 0) break;
        const crop = ancestorTileCrop(zoom, x, y, depth, tileSize);
        const ancestorUrl = urlsFor(crop.zoom, crop.x, crop.y)[layerIndex];
        if (!ancestorUrl) break;
        const ancestor = cache.get(ancestorUrl);
        if (ancestor) {
          ctx.drawImage(
            ancestor,
            crop.sx,
            crop.sy,
            crop.size,
            crop.size,
            left,
            top,
            tileSize,
            tileSize,
          );
          result.fallback += 1;
          return;
        }
        // 祖先也没加载过，顺手排队（下一帧就能用上）。
        cache.load(ancestorUrl, onDirty);
      }
      result.pending += 1;
    });
  }

  return result;
}