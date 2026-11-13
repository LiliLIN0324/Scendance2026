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
 * 2026-11-12 请求风暴修复：加上并发限流（maxInFlight，默认 16）。
 * 此前首帧一次把「当前级 + 四层祖先」的全部瓦片同时挂上网络（双层图源
 * 约 5×2×可见瓦片数 ≈ 770 个并发请求），天地图 CloudWAF 把这种突发当攻击
 * 流量整批 403（线上画布纯白、探针页却正常——后者只打一层 154 个）；
 * OSM 的瓦片用量政策同样禁止这种突发抓取。排队后按 FIFO 限流放行，
 * 画布渐进出图，对任何图源都友好。
 *
 * 这个模块不依赖 React，也不假设 `Image` 一定存在（服务端渲染时 `load` 直接视为失败），
 * 因此可以在单测里只测几何与缓存语义。
 */

export type TileLoadStatus = 'loading' | 'ready' | 'error';

interface TileEntry {
  img: HTMLImageElement;
  status: TileLoadStatus;
  listeners: (() => void)[];
  /** 2026-11-12：失败重试次数（OSM 会偶发断连/限流，错一次就永久空白太脆）。 */
  attempts: number;
  /** 下载超时定时器：境外源 TCP 挂起时 onload/onerror 都不触发，靠它兜底判失败结算。 */
  timer: ReturnType<typeof setTimeout> | null;
}

/** 单张瓦片最多尝试次数（首次 + 2 次重试）。 */
const MAX_TILE_ATTEMPTS = 3;

/** 单张瓦片下载超时（ms）：超时按失败结算，避免不可达源把在途计数永远占住、底图永久转圈。 */
const DEFAULT_TILE_TIMEOUT_MS = 9000;

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
  /** 同时挂在网上的请求数上限（限流，防瓦片风暴触发图源 WAF/限流）。 */
  private readonly maxInFlight: number;
  /** 排队等空位的加载动作（FIFO）：真正给 img.src 赋值。 */
  private readonly pendingQueue: (() => void)[] = [];
  private inFlight = 0;
  private readonly createImage: () => HTMLImageElement;
  private readonly timeoutMs: number;
  private readyCount = 0;
  private errorCount = 0;

  constructor(options?: { max?: number; maxInFlight?: number; createImage?: () => HTMLImageElement; timeoutMs?: number }) {
    this.max = options?.max ?? 900;
    this.maxInFlight = Math.max(1, options?.maxInFlight ?? 16);
    this.createImage =
      options?.createImage ?? (() => new Image() as HTMLImageElement);
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TILE_TIMEOUT_MS;
  }

  /** 清掉某条目挂起的超时定时器（若有）。 */
  private disarmTimer(entry: TileEntry): void {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  /** 放行下载后启动超时计时；排队期间不计时（排队不算网络挂起）。 */
  private armTimer(entry: TileEntry): void {
    this.disarmTimer(entry);
    if (this.timeoutMs <= 0 || typeof setTimeout === 'undefined') return;
    entry.timer = setTimeout(() => this.failEntry(entry), this.timeoutMs);
  }

  /** 把条目判为失败：清定时器、结算监听者并腾空位（onerror 与超时共用此路径）。 */
  private failEntry(entry: TileEntry): void {
    if (entry.status !== 'loading') return;
    this.disarmTimer(entry);
    entry.status = 'error';
    this.errorCount += 1;
    const listeners = entry.listeners;
    entry.listeners = [];
    for (const listener of listeners) listener();
    this.settle();
  }

  /** 有并发空位就按 FIFO 放行排队中的加载。 */
  private pump(): void {
    while (this.inFlight < this.maxInFlight && this.pendingQueue.length > 0) {
      const start = this.pendingQueue.shift();
      if (!start) break;
      this.inFlight += 1;
      start();
    }
  }

  /** 一个在途请求结算（无论成败），腾出空位放行下一个。 */
  private settle(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.pump();
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

  /** 该 URL 的加载状态；从未请求过则返回 null。 */
  status(url: string): TileLoadStatus | null {
    return this.entries.get(url)?.status ?? null;
  }

  /**
   * 请求一个瓦片。重复调用同一 URL 只会挂监听，不会重复发请求。
   * `onReady` 在图片就绪**或最终失败**时调用（失败时调用方查 `get()` 仍是 null，
   * 可以走祖先兜底或下一轮重试）——早先失败完全不回调，3D 的瓦片任务队列会永远等不到
   * 结算，`lodBusy` 卡死 → 之后再怎么放大都不再补高清瓦片（表现为「3D 地面一直糊」）。
   *
   * 新请求/重试先排队，`pump()` 按并发上限放行后才开始下载（限流见类注释）。
   */
  load(url: string, onReady: () => void): void {
    const existing = this.entries.get(url);
    if (existing) {
      if (existing.status === 'ready') { onReady(); return; }
      if (existing.status === 'loading') { existing.listeners.push(onReady); return; }
      // 已失败：有限次重试（下一次重绘/LOD 再要这张图时才重发，不会主动轰炸）。
      if (existing.attempts >= MAX_TILE_ATTEMPTS) return;
      existing.status = 'loading';
      existing.attempts += 1;
      existing.listeners.push(onReady);
      this.pendingQueue.push(() => { existing.img.src = url; this.armTimer(existing); });
      this.pump();
      return;
    }
    let img: HTMLImageElement;
    try {
      img = this.createImage();
    } catch {
      return;
    }
    const entry: TileEntry = { img, status: 'loading', listeners: [onReady], attempts: 1, timer: null };
    this.entries.set(url, entry);
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.disarmTimer(entry);
      entry.status = 'ready';
      this.readyCount += 1;
      const listeners = entry.listeners;
      entry.listeners = [];
      for (const listener of listeners) listener();
      this.settle();
    };
    img.onerror = () => this.failEntry(entry);
    this.pendingQueue.push(() => { img.src = url; this.armTimer(entry); });
    this.pump();
    this.trim();
  }

  /** 已缓存（就绪）数量。 */
  get size(): number {
    return this.entries.size;
  }

  get stats(): { entries: number; ready: number; errors: number } {
    return { entries: this.entries.size, ready: this.readyCount, errors: this.errorCount };
  }

  /**
   * 在途 + 排队的请求总数（限流器视角）。>0 表示底图正在补瓦片；
   * 成败都会经 settle() 结算，所以归零可靠，不会因失败瓦片永远卡住——
   * 这正是「加载中」提示该用的信号（paintBasemapTiles 的 pending 含失败格，不适合）。
   */
  get loadingCount(): number {
    return this.inFlight + this.pendingQueue.length;
  }

  /** 清空（切换图源时用，避免不同源的同坐标瓦片串味）。 */
  clear(): void {
    for (const entry of this.entries.values()) {
      entry.listeners = [];
      entry.img.onload = null;
      entry.img.onerror = null;
      this.disarmTimer(entry);
    }
    this.entries.clear();
    this.readyCount = 0;
    this.errorCount = 0;
    // 在途的图 handlers 已清空不会再结算；队列作废、空位归零。
    this.pendingQueue.length = 0;
    this.inFlight = 0;
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
        this.disarmTimer(entry);
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
  /**
   * 2026-11-12 用户「放大倍数不够」：允许视图 zoom 超过图源真实瓦片级别（overzoom）。
   * 传图源上限（如 OSM 19），超过部分把该级瓦片等比放大绘制——再往里就是模糊放大，
   * 但缩放/平移/标尺照常工作，不会卡在「已经不能再放大」。
   */
  tileZoom?: number;
  centerPx: number;
  centerPy: number;
  cssW: number;
  cssH: number;
  /** 瓦片边长（设备无关像素）。 */
  tileSize: number;
  /** 可见瓦片网格（按 tileZoom 级计算）。 */
  tiles: readonly { x: number; y: number }[];
  /** 取某层级瓦片在该坐标下的图源 URL 列表（天地图是底图 + 注记两层）。 */
  urlsFor: (zoom: number, x: number, y: number) => readonly string[];
  /** 有新瓦片就绪、需要重绘时调用（调用方自行 rAF 节流）。 */
  onDirty: () => void;
  /** 祖先兜底最多回溯层级，默认 4。 */
  fallbackDepth?: number;
  /** 优先加载的焦点（画布 CSS 像素）；缺省用视口中心。 */
  focusX?: number;
  focusY?: number;
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
  const focusX = spec.focusX ?? cssW / 2;
  const focusY = spec.focusY ?? cssH / 2;
  // overzoom：视图级别高于图源上限时，按上限取瓦片再等比放大（drawSize > tileSize）。
  const tileZoom = Math.min(zoom, spec.tileZoom ?? zoom);
  const drawSize = tileSize * 2 ** (zoom - tileZoom);

  const visible: { x: number; y: number; left: number; top: number }[] = [];
  for (const { x, y } of tiles) {
    const left = x * drawSize - centerPx + cssW / 2;
    const top = y * drawSize - centerPy + cssH / 2;
    if (left > cssW || top > cssH || left + drawSize < 0 || top + drawSize < 0) continue;
    visible.push({ x, y, left, top });
  }
  visible.sort((a, b) => {
    const da = (a.left + drawSize / 2 - focusX) ** 2 + (a.top + drawSize / 2 - focusY) ** 2;
    const db = (b.left + drawSize / 2 - focusX) ** 2 + (b.top + drawSize / 2 - focusY) ** 2;
    return da - db;
  });

  type Cell = { x: number; y: number; left: number; top: number; layers: readonly string[] };
  const cells: Cell[] = visible.map((tile) => ({ ...tile, layers: urlsFor(tileZoom, tile.x, tile.y) }));

  for (const cell of cells) {
    cell.layers.forEach((url) => {
      if (!cache.get(url)) cache.load(url, onDirty);
    });
  }
  for (const cell of cells) {
    cell.layers.forEach((url, layerIndex) => {
      const ready = cache.get(url);
      if (ready) {
        ctx.drawImage(ready, cell.left, cell.top, drawSize, drawSize);
        result.drawn += 1;
        return;
      }
      for (let depth = 1; depth <= fallbackDepth; depth += 1) {
        if (tileZoom - depth < 0) break;
        const crop = ancestorTileCrop(tileZoom, cell.x, cell.y, depth, tileSize);
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
          cell.left,
          cell.top,
          drawSize,
          drawSize,
        );
        result.fallback += 1;
        return;
      }
      // 2026-11-12 风暴修复：兜底只预取最近一级（depth=1）祖先。
      // 旧实现把 depth 1..4 全部排进队列，首帧一次打出「当前级+四层祖先」
      // （双层图源约 770 个请求）——天地图 CloudWAF 按攻击流量整批拦下，
      // 线上画布纯白；这也违背 OSM 的瓦片用量政策。更深的祖先只有「已缓存」
      // 才直接画（比如从上一视图继承下来的），不再预取。
      if (depth === 1) cache.load(ancestorUrl, onDirty);
    }
    result.pending += 1;
    });
  }

  return result;
}