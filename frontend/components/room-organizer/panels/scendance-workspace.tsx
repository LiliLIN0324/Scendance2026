'use client';

import { Boxes, ChevronUp, X } from '@/components/solid-icons';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useRoomEditor, useSelection } from '../contexts';
import { listMyItems, subscribeMyItems } from '../lib/my-items';
import { EDITOR_ITEM_LIMIT } from '../lib/item-limits';
import { materialCount } from '../lib/structural-layout';
import { LocalGlbImport } from './local-glb-import';
import { MaterialSymbol } from './material-symbol';
import { OUTDOOR_TOOL_ICONS } from '../components/outdoor-tool-icons';
import { OnlineModelLibrary } from './online-model-library';
import { ShareMenu, type ShareMenuActions } from './share-menu';
import type { CatalogPlacementBatchGuard, CatalogPlacementGuard, CatalogPlacementResult } from '../lib/catalog-placement-guard';
import type { CameraPreset, CatalogItem, FurnitureItem } from '../lib/types';
import type { SplatDisplayMode } from '../three/splat-preview';
import type { BackendSession } from '@/lib/backend-session';
import './workbench-shelf.css';

interface LibraryProps {
  controller?: BackendSession;
  onClose?(): void;
  capturePlacement?(): CatalogPlacementGuard;
  capturePlacementBatch?(): CatalogPlacementBatchGuard;
  placeCatalogItem(item: CatalogItem, position?: { x: number; z: number }): string;
  placeCatalogItemResult?(item: CatalogItem): CatalogPlacementResult;
  /** 2026-11-12 统一放置流程：点物料进「待放置」（点哪放哪，同户外），不再直接落正中。 */
  onArmCatalogItem?(item: CatalogItem, sourceSlug?: string, stickerSlug?: string): void;
  /** 3D 接管态：卡片左下角规划图标压淡到 0.4，悬停/聚焦恢复。 */
  dimPlanIcons?: boolean;
}

export function MaterialGlyph({ materialId, color = 'currentColor' }: { materialId?: string | undefined; color?: string }): JSX.Element {
  return <svg viewBox="0 0 72 58" width="72" height="58" fill="none" aria-hidden="true" style={{ color }}>
    {materialId === 'chair' ? <><path d="M23 9h26v23H23z" fill="currentColor" opacity=".3"/><path d="M23 9h26v23H23zM21 33h30v8H21zM25 41v11m22-11v11M25 24v9m22-9v9" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/></> :
      materialId === 'table' || materialId === 'reception' ? <><path d="M11 19h50v15H11z" fill="currentColor" opacity=".25"/><path d="M11 19h50v15H11zM16 34v18m40-18v18" stroke="currentColor" strokeWidth="2.4"/>{materialId === 'reception' && <path d="M19 35h34v14H19z" fill="currentColor" opacity=".3"/>}</> :
      materialId === 'decoration' ? <><path d="M27 37h20l-4 16H31z" fill="currentColor" opacity=".3"/><path d="M36 37V12m0 15C16 25 18 12 19 10c12 0 17 8 17 17Zm0 4c16 0 21-11 17-18-10 0-16 9-17 18ZM27 37h20l-4 16H31z" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round"/></> :
      materialId === 'carpet' ? <><path d="m9 34 34-18 21 13-34 20Z" fill="currentColor" opacity=".28"/><path d="m9 34 34-18 21 13-34 20Z" stroke="currentColor" strokeWidth="2.4"/><path d="m19 34 24-12 11 7-24 13Z" stroke="currentColor" strokeWidth="1.4"/></> :
      <><path d="M15 9h42v36H15z" fill="currentColor" opacity=".24"/><path d="M15 9h42v36H15zM22 45v8m28-8v8" stroke="currentColor" strokeWidth="2.4"/>{materialId === 'display' && <path d="M15 21h42M15 33h42" stroke="currentColor" strokeWidth="2"/>}{materialId === 'partition' && <path d="M29 9v36M43 9v36" stroke="currentColor" strokeWidth="1.5"/>}</>}
  </svg>;
}

const SHELF_HEIGHT_KEY = 'scendance-shelf-height';

function shelfBounds() {
  const compact = window.innerHeight < 580 || window.innerWidth <= 640;
  // 一排卡片的高度：标签条 + 缩略图 + 名字。拖高只是让图更大。
  return { min: compact ? 132 : 156, default: compact ? 140 : 180, max: Math.max(compact ? 262 : 288, Math.round(window.innerHeight * 0.62)) };
}

function clampShelfHeight(value: number): number {
  const { min, max } = shelfBounds();
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * The drawer is a grid row sized by `--sc-shelf-height`, and the stage itself
 * declares that variable, so the drag has to paint on the stage rather than here.
 */
function paintShelfHeight(host: HTMLElement, grip: HTMLElement | null, px: number): void {
  host.style.setProperty('--sc-shelf-height', `${px}px`);
  grip?.setAttribute('aria-valuetext', `物料库高度 ${px} 像素`);
}

export function ShelfGrip({ shelfRef, label = '调整物料库高度' }: { shelfRef: RefObject<HTMLElement | null>; label?: string }): JSX.Element {
  const [height, setHeight] = useState(0);
  const gripRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; from: number; live: number } | null>(null);
  const host = useCallback(() => shelfRef.current?.closest<HTMLElement>('.sc-canvas-stage') ?? document.documentElement, [shelfRef]);

  useEffect(() => {
    const stored = window.localStorage.getItem(SHELF_HEIGHT_KEY);
    const parsed = stored ? Number(stored) : NaN;
    setHeight(clampShelfHeight(Number.isFinite(parsed) ? parsed : shelfBounds().default));
  }, []);
  useEffect(() => { if (height) paintShelfHeight(host(), gripRef.current, height); }, [height, host]);
  useEffect(() => {
    const onResize = () => setHeight(current => (current ? clampShelfHeight(current) : current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const settle = (next: number) => {
    setHeight(next);
    window.localStorage.setItem(SHELF_HEIGHT_KEY, String(next));
  };
  const { min, max } = height ? shelfBounds() : { min: 156, max: 156 };

  return <div
    ref={gripRef}
    className="sc-shelf-grip"
    role="separator"
    aria-orientation="horizontal"
    aria-label={label}
    tabIndex={0}
    aria-valuenow={height || min}
    aria-valuemin={min}
    aria-valuemax={max}
    onPointerDown={event => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { y: event.clientY, from: height || min, live: height || min };
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      drag.current.live = clampShelfHeight(drag.current.from - (event.clientY - drag.current.y));
      paintShelfHeight(host(), gripRef.current, drag.current.live);
    }}
    onPointerUp={() => { if (drag.current) { settle(drag.current.live); drag.current = null; } }}
    onPointerCancel={() => { if (drag.current) { setHeight(drag.current.live); drag.current = null; } }}
    onDoubleClick={() => settle(shelfBounds().default)}
    onKeyDown={event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        settle(clampShelfHeight((height || min) + (event.key === 'ArrowUp' ? 24 : -24)));
      } else if (event.key === 'Home') { event.preventDefault(); settle(min); }
      else if (event.key === 'End') { event.preventDefault(); settle(max); }
    }}
  ><span aria-hidden="true"/></div>;
}

export function ScendanceLibrary({ placeCatalogItem, placeCatalogItemResult, onArmCatalogItem, controller, onClose, capturePlacement, capturePlacementBatch, variant = 'shelf', dimPlanIcons = false, walkRoles = [] }: LibraryProps & {
  /** shelf = 画布底部抽屉；card = 嵌进 Agent 面板，不要拖拽条。 */
  variant?: 'shelf' | 'card';
  /** 左侧只负责选角色；进出漫游统一走右侧 `tool-walk`。 */
  walkRoles?: readonly { id: string; name: string; image: string; walkable: boolean; note?: string; crowdType?: string; selected: boolean; onSelect(): void }[];
}): JSX.Element {
  const { layout, activeFloor, actions, history } = useRoomEditor();
  const { selectOnly } = useSelection();
  const hostRef = useRef<HTMLElement>(null);
  const atLimit = materialCount(activeFloor.items) >= EDITOR_ITEM_LIMIT;
  const card = variant === 'card';

  const addMaterial = (item: CatalogItem):CatalogPlacementResult => {
    if (atLimit) return {status:'failed',message:'当前场景物料已满，请先腾出位置。'};
    // 放置只选中、不掀属性面板：要看尺寸/颜色得双击画面里那件物料。
    const result = placeCatalogItemResult?.(item) ?? (()=>{const id=placeCatalogItem(item);return id?{status:'placed' as const,id}:{status:'pending' as const};})();
    if (result.status==='placed') selectOnly(result.id, { keepPanel: true });
    return result;
  };

  // 风格套整组一次落盘：一次提交、一次撤销，不按件走放置动画。
  const addStyleSet = (items: FurnitureItem[]) => {
    if (atLimit || items.length === 0) return;
    if (materialCount(activeFloor.items) + items.length > EDITOR_ITEM_LIMIT) return;
    history.commitNow();
    actions.addItems(items);
    const first = items[0];
    if (first) selectOnly(first.id, { keepPanel: true });
  };

  // 本机 GLB：桌面上能拖到这一格，手机上点同一格选文件；导入后自动选中并落进画布。
  const importSlot = <LocalGlbImport variant={card ? 'card' : 'tile'} disabled={atLimit} onAdd={addMaterial}/>;

  // 本会话导入的 GLB：先从「我的物品」里再放一件，刷新即失效。
  const myItems = useSyncExternalStore(subscribeMyItems, listMyItems, listMyItems);
  const mySlot = myItems.length ? <div className="sc-my-items" aria-label="我的物品">
    <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: '#5b6067' }}>我的物品 · 本会话</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {myItems.map(item => (
        <button
          key={item.glbUrl}
          type="button"
          title="再放一件"
          onClick={() => addMaterial(item)}
          style={{ height: 26, padding: '0 9px', border: '1px solid #e4e4e7', borderRadius: 7, background: '#fff', fontSize: 11, color: '#141416', cursor: 'pointer', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >{item.name}</button>
      ))}
    </div>
  </div> : null;

  return <aside ref={hostRef} className={`sc-library sc-compact-shelf${card ? ' is-card' : ''}`} aria-label="物料库">
    {!card && <div className="sc-shelf-top">
      <ShelfGrip shelfRef={hostRef}/>
      {onClose && <button type="button" className="sc-library-rail-close" aria-label="关闭物料库" title="关闭" onClick={onClose}><X size={16} aria-hidden="true"/></button>}
    </div>}
    <div className="sc-library-body">
      {card
        ? <div className="sc-library-content">
          <div className="sc-library-materials">
            {mySlot}
            <OnlineModelLibrary cardMode {...(controller ? { controller } : {})} {...(capturePlacement ? { capturePlacement } : {})} {...(capturePlacementBatch ? { capturePlacementBatch } : {})} renderedLayout={layout} {...(atLimit ? { limitMessage: `已达到 ${EDITOR_ITEM_LIMIT} 件物料上限，请先删除部分物料。` } : {})} disabled={atLimit} onAdd={addMaterial} onAddSet={addStyleSet} {...(onArmCatalogItem ? { onArmCatalogItem } : {})} importSlot={importSlot} dimPlanIcons={dimPlanIcons} roomSize={{ width: layout.width, depth: layout.height }}

              walkRoles={walkRoles}/>
          </div>
        </div>
        : <div className="sc-library-content">
          <div className="sc-library-materials">
            {mySlot}
            <OnlineModelLibrary {...(controller ? { controller } : {})} {...(capturePlacement ? { capturePlacement } : {})} {...(capturePlacementBatch ? { capturePlacementBatch } : {})} renderedLayout={layout} {...(atLimit ? { limitMessage: `已达到 ${EDITOR_ITEM_LIMIT} 件物料上限，请先删除部分物料。` } : {})} disabled={atLimit} onAdd={addMaterial} importSlot={importSlot} dimPlanIcons={dimPlanIcons}/>
          </div>
        </div>}
    </div>
  </aside>;
}

export function NumberField({ label, value, min = 0.01, max = 50, step = 0.1, disabled = false, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; disabled?: boolean; onChange(value: number): void }): JSX.Element {
  return <label className="sc-field">{label}<input type="number" aria-label={label} min={min} max={max} step={step} value={Math.round(value * 1000) / 1000} disabled={disabled} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next) && next >= min && next <= max) onChange(next); }}/></label>;
}

interface ViewToolsProps {
  materialsOpen?: boolean;
  onToggleMaterials?(): void;
  materialsButtonRef?: RefObject<HTMLButtonElement>;
  /** Gaussian scenes can be moved as one unit, separately from item selection. */
  sceneMoveEnabled?: boolean;
  sceneMoveMode?: 'off' | 'gizmo' | 'numeric';
  onSceneMoveModeChange?(mode: 'off' | 'gizmo' | 'numeric'): void;
  environmentView?: SplatDisplayMode;
  environmentViewEnabled?: boolean;
  onEnvironmentViewChange?(mode: SplatDisplayMode): void;
  onZoom(direction: '+' | '-'): void;
  /**
   * Exports the current view as a PNG. In 3D the chosen preset frame and
   * resolution multiplier are applied for the capture only; in 2D the plan is
   * exported at its current resolution.
   */
  onExportImage?(options: { view: 'current' | CameraPreset; scale: number }): Promise<boolean> | void;
  /** 导出前的同一帧预览；返回 PNG data URL，编码不出来给 null。 */
  onCaptureImage?(options: { view: 'current' | CameraPreset; scale: number }): Promise<string | null>;
  /** 机位册：顺序导出全部预设机位与离线图册 HTML。2D 视图不提供。 */
  onExportAlbum?(options: { scale: number }): Promise<{ ok: boolean; count: number } | void> | void;
  /** 评审 / 执行不撤销、不重做布置。 */
  layoutLocked?: boolean;
  /** 工具轨唯一分享入口。不传时菜单仍可打开，动作提示未接入。 */
  shareActions?: ShareMenuActions;
  /**
   * 后端会话（2026-11-20 集成接通）：透传给 ShareMenu 撑起「案例」维护页签。
   * 不传（旧宿主/测试）时案例页签不出现，行为与之前一致。
   */
  controller?: BackendSession | null;
  /** 旧评审入口改道时递增。 */
  shareOpenRequest?: number;
  /**
   * P4-c 交付簇合并：户外平面画布打开时，发布钮已经和「导出/分享」一起摆在画布右上，
   * 工具轨这一份隐藏，避免同一个动作两个入口（用户反馈「导出 分享 发布 应该是一起的」）。
   */
  publishHidden?: boolean;
  /** 回到框选场地边界（右下回选址靶心）；不传时钮禁用。 */
  onFocusVenue?(): void;
  /**
   * 2026-11-16 用户指令：这颗钮的说法跟着目标变——圈了设计范围就叫「定位到设计范围」，
   * 没圈范围仍是「回到框选场地」。不传时两者均按后者。
   */
  focusVenueTip?: string | undefined;
  /** 干净看图模式：隐藏浮动工具簇（右下眼睛钮自身保留可切回）。 */
  chromeHidden?: boolean;
  onToggleChrome?(): void;
  /**
   * P2-g 户外 2D 画布接管：非空时，撤销/重做/缩放/导出四组通用钮改由户外画布执行
   * （室内 3D 的布局历史与相机原样保活，关掉户外即恢复）。null/缺省＝纯室内行为。
   */
  outdoorActions?: {
    canUndo: boolean;
    canRedo: boolean;
    undo(): void;
    redo(): void;
    zoomBy(direction: 1 | -1): void;
    /** 导出 PNG：户外走 2D 规划快照（不抓 3D 帧），无 plan 时返回 false。 */
    exportPng?(): boolean;
    /** 2026-11-12 三张卡拆开：测量 / 标注 / 属性 各自一张卡，这里给出各自的展开态（右轨按下态）。 */
    inspectorTabs?: Record<'measure' | 'annotate' | 'selection', boolean>;
    setInspector?(tab: 'measure' | 'annotate' | 'selection'): void;
    /** 2026-11-12 B1 选择工具：2D 画布浏览/选择模式（「选择」钮按下态与切换；S/H 快捷键同源）。 */
    canvasMode?: 'view' | 'select';
    setCanvasMode?(mode: 'view' | 'select'): void;
    /** 2026-11-15 测量直进：measure 绘制激活态、当前模式、进入/退出与切模式（2026-11-17 路径入口下线）。 */
    measureActive?: boolean;
    measureKind?: 'distance' | 'area';
    setMeasureKind?(kind: 'distance' | 'area'): void;
    enterMeasure?(): void;
    exitMeasure?(): void;
    snapOn?: boolean;
    setSnapOn?(on: boolean): void;
    /**
     * 2026-11-13 一期户外第一人称漫游：独立于室内 `walkthroughMode` 的启用信号。
     * `walkIn3D` 仅在户外 3D 接管视图为真（2D 平面仍禁用）；`toggleWalk` 在按钮手势内收口。
     */
    walkActive?: boolean;
    walkIn3D?: boolean;
    toggleWalk?(on: boolean): void;
    /** 户外当前视图：2d 平面 / 3d 接管；单枚圆钮按此报按下态。 */
    view?: '2d' | '3d';
    /** 户外 2D/3D 单枚圆钮：点按在两态间互换。 */
    onToggleView?(): void;
    /** 回到框选场地边界（回选址靶心）。 */
    focusVenue?(): void;
    /** 指北针：3D 相机回正正北；2D 复位视图到场地边界。 */
    resetNorth?(): void;
    /** 3D 相机当前水平方位（弧度，0 = 正北）；大罗盘指针实时读数。 */
    bearingRad?(): number;
    /** 大罗盘左右拖动：按弧度增量绕目标旋转 3D 相机。 */
    orbitByDelta?(deltaTheta: number): void;
  } | null;
  /**
   * GeoGround（2026-11-12）：主画布 3D 地面由户外计划的地理瓦片接管时置真。
   * 此时「地图切换」直接切瓦片图源，与户外 2D 底图同一份偏好联动。
   * （#38 之后卫星贴地钮已删，这一段只管 `tool-ground-source` 那颗。）
   */
  geoGroundActive?: boolean;
}

// 抓手浏览：直手窄掌（四指竖直、掌心弧收窄），路径内联、不另装图标包；与右轨线性描边同族 1.8px。
function HandStopIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5"/>
      <path d="M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5"/>
      <path d="M14 5.5a1.5 1.5 0 0 1 3 0v6.5"/>
      <path d="M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47"/>
    </svg>
  );
}
// Needle geometry adapted from MapLibre GL JS NavigationControl (BSD-3-Clause):
// https://github.com/maplibre/maplibre-gl-js/blob/main/src/css/svg/maplibregl-ctrl-compass.svg
// 指针放大并改成红/灰双色；交互沿用 MapLibre 的「拖动旋转 + 点击回正北」。
// 2026-11-16：两侧转向箭头的弧度和箭头头部仍未达到 Google 1:1，先全局关闭，
// 保留 Canvas 绘制代码供后续 agent 重做；交接见 docs/COMPASS_TURN_ARROWS_PLAN.md。
const SHOW_COMPASS_TURN_ARROWS = false;

// 罗盘改用 Canvas：圆弧的角度、半径、起始角/结束角直接按数值绘制，不再靠
// SVG 贝塞尔控制点试。画布按 4 倍像素渲染，显示尺寸仍是 44px。
function CompassDial({ size = 44, rotationDeg = 0, showTurns = false }: { size?: number; rotationDeg?: number; showTurns?: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas?.getContext('2d') ?? null;
    } catch {
      // jsdom 等无 Canvas 实现的环境直接跳过绘制，不影响交互与测试。
      return;
    }
    if (!canvas || !ctx) return;
    const resolution = 4;
    const base = 44;
    const scale = size / base;
    const pixels = size * resolution;
    canvas.width = pixels;
    canvas.height = pixels;
    // 指针几何按 44 基准坐标绘制，再整体缩放到目标直径；64px 罗盘也保持清晰。
    ctx.setTransform(resolution * scale, 0, 0, resolution * scale, 0, 0);
    ctx.clearRect(0, 0, base, base);

    // 外圈与内盘：只保留极轻的层次，避免看起来像靶心。
    ctx.beginPath();
    ctx.arc(22, 22, 21, 0, Math.PI * 2);
    ctx.fillStyle = '#252220';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(22, 22, 17, 0, Math.PI * 2);
    ctx.fillStyle = '#2d2926';
    ctx.fill();

    // 指针：红上白下的细长菱形，绕 (22,22) 旋转。
    ctx.save();
    ctx.translate(22, 22);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.translate(-22, -22);
    ctx.beginPath();
    ctx.moveTo(22, 9.2);
    ctx.lineTo(27.2, 24.8);
    ctx.lineTo(16.8, 24.8);
    ctx.closePath();
    ctx.fillStyle = '#D02B1E';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(22, 34.8);
    ctx.lineTo(27.2, 24.8);
    ctx.lineTo(16.8, 24.8);
    ctx.closePath();
    ctx.fillStyle = '#DCD9D4';
    ctx.fill();
    ctx.restore();

    if (showTurns) {
      // 左侧转向箭头：接近四分之一椭圆的浅弧（横半径 11.8、纵半径 9.2），
      // 从针尖旁 (13.5,16.5) 起笔，向外鼓到 x≈6.9，再落到 (8.2,32.4)。
      // 底部独立三角头指向左下方；右侧整体镜像。
      const drawTurn = (): void => {
        ctx.beginPath();
        ctx.ellipse(18.7, 25.5, 11.8, 9.2, 0, (245.8 * Math.PI) / 180, (138.6 * Math.PI) / 180, true);
        ctx.strokeStyle = '#CFCCC7';
        ctx.lineWidth = 1.45;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(5.2, 36.2);
        ctx.lineTo(3.4, 31.3);
        ctx.lineTo(10.5, 31.7);
        ctx.closePath();
        ctx.fillStyle = '#CFCCC7';
        ctx.fill();
      };
      drawTurn();
      ctx.save();
      ctx.translate(44, 0);
      ctx.scale(-1, 1);
      drawTurn();
      ctx.restore();
    }
  }, [size, rotationDeg, showTurns]);

  return (
    <canvas
      ref={canvasRef}
      className="oc-gm-compass-canvas"
      width={size * 4}
      height={size * 4}
      aria-hidden="true"
    />
  );
}
// 第一人称漫游：复刻 Google Maps Pegman——黄圆头、橙领巾、直立小人；悬停时由 CSS 上浮微倾。
function PegmanIcon({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <g fill="#FBBF0A">
        <circle cx="12" cy="5" r="2.6" />
        <rect x="9" y="8.4" width="6" height="5.4" rx="2.2" />
        <rect x="6.6" y="9.4" width="1.8" height="4.8" rx="0.9" transform="rotate(12 7.5 9.4)" />
        <rect x="15.6" y="9.4" width="1.8" height="4.8" rx="0.9" transform="rotate(-12 16.5 9.4)" />
        <rect x="9.7" y="13.6" width="1.9" height="6.6" rx="0.95" />
        <rect x="12.4" y="13.6" width="1.9" height="6.6" rx="0.95" />
      </g>
    </svg>
  );
}
// 定位钮：Google 网页版的准星——细圆环 + 实心点 + 四向短刻线，
// 不用 center_focus_strong 的"对焦框"四角，避免一眼看出不是同一套图标。
function MyLocationIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <circle cx="12" cy="12" r="6.3" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path d="M12 2.4v3.1M12 18.5v3.1M2.4 12h3.1M18.5 12h3.1" />
    </svg>
  );
}
// 网格吸附：井字轮廓两态同构，开启时在右下象限压一颗落点块；状态由按钮 is-active 底色/字色承接。
function GridSnapIcon({ active }: { active: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 8.8 H18.5 M5.5 15.2 H18.5 M8.8 5.5 V18.5 M15.2 5.5 V18.5" />
      {active && <rect x="12.7" y="12.7" width="4.6" height="4.6" rx="1" fill="currentColor" stroke="none" />}
    </svg>
  );
}

/** 场地多边形形心（GCJ-02）：三维菜单缩略图跟着场地取景；没有多边形返回 null（回落手绘示意）。 */

/** Design: canvas-right vertical 14-key circular column (v2.4). */
export function ScendanceViewTools({ shareActions, shareOpenRequest = 0, chromeHidden = false, onToggleChrome, onFocusVenue, focusVenueTip, outdoorActions = null, controller }: ViewToolsProps): JSX.Element {
  // 2026-11-25 S6 收尾：室内右轨整簇（楼层切换/分享/选择菜单/2D-3D/网格/图源/撤销重做/
  // 缩放/导出菜单）已删。生产只有 mode=outdoor 一条路径，那里 `outdoor` 恒非空，
  // 这一簇在现行路由下从未渲染过；对应能力由户外四角簇与底部工具岛原样承担。
  const outdoor = outdoorActions;
  const { view, layout } = useRoomEditor();
  const outdoorEditing = outdoor != null;
  // 一期户外漫游：只有户外 3D 接管视图可进；2D 平面保持旧禁用行为。按下态读独立信号，
  // 不翻室内 view.walkthroughMode。
  const outdoorWalkOn = outdoor?.walkActive ?? false;
  const walkPressed = outdoorEditing && outdoorWalkOn;
  // 2026-11-16 用户定稿「就是我的设计场地里面随便走」：漫游钮不再按室内/户外、2D/3D 分档置灰，
  // 一律可点；点下去由 toggleWalk 自己把视图切到能走的那台相机（户外 2D 会先接管 3D 场地再进第一人称）。
  // 2026-11-13 定稿：户外 2D/3D 胶囊挪到画布左下动作簇（room-organizer 独立挂载），右轨不再放户外切换钮；
  // 这里只剩纯室内场景的平面/立体兜底切换。
  // 2026-11-15 测量直进：图标右下小标展开 距离/面积/路径。
  const [measureMenuOpen, setMeasureMenuOpen] = useState(false);
  // 2026-11-16 用户指令：底部只留一颗薄把手，规划工具收进可展开的「隐藏工具栏」；
  // 初始收起，让 Google Maps 控制列与地图本身保持干净。
  // 2026-11-17 用户：浮层工具栏不因点外部收起；只认末尾 × / Esc / 自身按钮。
  const [dockOpen, setDockOpen] = useState(false);
  // 2026-11-16 罗盘改用 MapLibre NavigationControl 的成熟交互：拖动旋转、点击回正北。
  const [compassBearing, setCompassBearing] = useState(0);
  const [compassDragging, setCompassDragging] = useState(false);
  const compassDragRef = useRef<{ pointerId: number; centerX: number; centerY: number; lastAngle: number; travel: number; dragging: boolean } | null>(null);
  const suppressCompassClick = useRef(false);
  const outdoorRef = useRef(outdoor);
  outdoorRef.current = outdoor;
  /** 显式收起底条：标注浮卡挂在底条按钮上，一并关掉，避免留下无锚点的空卡。 */
  const closeToolDock = useCallback(() => {
    setDockOpen(false);
    if (outdoorRef.current?.inspectorTabs?.annotate) outdoorRef.current.setInspector?.('annotate');
  }, []);
  /** 展开底条；下一帧再通知画布重算标注卡锚点（按钮刚挂上时还拿不到 rect）。 */
  const openToolDock = useCallback(() => {
    setDockOpen(true);
    window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('scendance:outdoor-dock-opened')));
  }, []);
  useEffect(() => {
    const onOpenDock = () => openToolDock();
    window.addEventListener('scendance:open-outdoor-dock', onOpenDock);
    return () => window.removeEventListener('scendance:open-outdoor-dock', onOpenDock);
  }, [openToolDock]);
  // 2026-11-16 用户指令「2D 的时候罗盘也要能转」：罗盘在 2D/3D 都可拖转+点击回正北
  // （2D 走画布 bearing，3D 走相机方位；漫游态除外）。compassDraggable 取代旧 compassIs3D 门。
  const compassDraggable = !walkPressed && Boolean(outdoor?.orbitByDelta);

  useEffect(() => {
    if (!outdoor?.view || !outdoor.bearingRad) {
      setCompassBearing(0);
      return undefined;
    }
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 90) {
        // 相机方位角顺时针为正；屏幕上的指北针要反向转，才是真正的北。
        const next = -(outdoorRef.current?.bearingRad?.() ?? 0);
        setCompassBearing(prev => (Math.abs(prev - next) > 0.004 ? next : prev));
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // 只跟随 2D/3D 切换启停；实时值走 outdoorRef，避免父级对象每次渲染重启 rAF。
  }, [outdoor?.view]);

  useEffect(() => {
    if (!dockOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeToolDock();
    };
    // 成熟浮层工具栏：点外部不收起；只认末尾 × 和 Esc。
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dockOpen, closeToolDock]);

  const handleCompassPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!compassDraggable) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    compassDragRef.current = { pointerId: event.pointerId, centerX, centerY, lastAngle: angle, travel: 0, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleCompassPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const state = compassDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const angle = Math.atan2(event.clientY - state.centerY, event.clientX - state.centerX);
    let delta = angle - state.lastAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    state.lastAngle = angle;
    state.travel += Math.abs(delta);
    if (!state.dragging && state.travel > 0.12) {
      state.dragging = true;
      setCompassDragging(true);
    }
    if (!state.dragging) return;
    // 指针顺时针拖，针顺时针转；相机方位角反向变化，因此读数取反后仍与手指同向。
    outdoor?.orbitByDelta?.(delta);
    setCompassBearing(prev => prev + delta);
  };
  // 保留给 `SHOW_COMPASS_TURN_ARROWS` 打开时使用；当前按钮隐藏，不影响点击回正北。
  const turnCompass = (turn: 'left' | 'right'): void => {
    if (!compassDraggable) return;
    if (turn === 'left') {
      outdoor?.orbitByDelta?.(Math.PI / 2);
      setCompassBearing(prev => prev + Math.PI / 2);
    } else {
      outdoor?.orbitByDelta?.(-Math.PI / 2);
      setCompassBearing(prev => prev - Math.PI / 2);
    }
  };
  const finishCompassDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    const state = compassDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dragged = state.dragging;
    compassDragRef.current = null;
    setCompassDragging(false);
    suppressCompassClick.current = true;
    window.setTimeout(() => { suppressCompassClick.current = false; }, 0);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 指针已释放。 */ }
    if (!cancelled && !dragged) {
      // 转向箭头暂停后，点击罗盘统一回正北；任意角度仍可拖动。
      outdoor?.resetNorth?.();
      setCompassBearing(0);
    }
  };
  const handleCompassClick = (): void => {
    if (suppressCompassClick.current) { suppressCompassClick.current = false; return; }
    outdoor?.resetNorth?.();
    setCompassBearing(0);
  };
  const compassTip = compassDraggable
    ? '罗盘：拖动旋转 · 点击回正北'
    : '罗盘：点击回正北';
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const measureMenuRef = useRef<HTMLDivElement>(null);
  const [shareClose] = useState(0);
  // 2026-11-12 B2：户外态的抓手/选择走 2D 画布的 canvasMode（outdoor 转发）。
  const outdoorSelectOn = outdoor?.canvasMode === 'select';
  const canvasSelectOn = outdoorSelectOn ?? false;
  const selectActive = canvasSelectOn;
  const canvasToolState = outdoorSelectOn ? '选择设施' : '抓手浏览';
  const canvasToolTip = canvasSelectOn ? `${canvasToolState} · 切到抓手` : `${canvasToolState} · 切到选择`;
  const canvasToolLabel = canvasSelectOn ? '选择工具' : '抓手工具';
  // 测量弹层是右轨唯一还带二级菜单的入口：点外部或 Esc 收起。
  useEffect(() => {
    if (!measureMenuOpen) return undefined;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (measureMenuRef.current && !measureMenuRef.current.contains(target)) setMeasureMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMeasureMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [measureMenuOpen]);

  return (
    /* 圆钮贴在画布右上角。所有工具都是一级钮，没有省略号菜单；只有导出还带一层选项弹层。 */
    <nav id="tool-column" className={`sc-view-tools sc-canvas-rail sc-tool-column${outdoorEditing ? ' is-outdoor' : ''}${chromeHidden ? ' is-chrome-hidden' : ''}`} aria-label="工具" onWheel={event => event.stopPropagation()}>
      {/* 2026-11-13 M1：户外地图接管后楼层是室内结构概念，右轨楼层钮隐藏；户外方案层（levels）切换走画布自身的图层面板。 */}
      {outdoorEditing && (<>
        {/* 方案 A 定稿四角簇：右上＝分享单枚（oc-cluster--bare：按用户要求不设外框，只留按钮自身那层线稿框）；右下＝罗盘·2D/3D·定位框选·缩放一体条·漫游·眼睛；底中＝工具‖开关‖历史；左下＝账号·地图切换。 */}
        <div className="oc-cluster oc-tr oc-cluster--bare" aria-label="右上工具簇">
          <div className="oc-share"><ShareMenu {...(shareActions ? { actions: shareActions } : {})} layout={layout} lengthUnit={view.lengthUnit} openRequest={shareOpenRequest} closeSignal={shareClose} controller={controller ?? null}/></div>
        </div>
        {/* 2026-11-16 用户指令：右下角一比一复刻 Google Maps 竖向控制列——
            罗盘 → 2D/3D → 定位 → 连体缩放 → Pegman，最后隔一条发丝线放宽图眼睛。
            视觉口径：44px 控件、64px 罗盘、44×88 连体缩放；漫游钮与其余控件同轴同尺寸。 */}
        <div className="oc-cluster oc-br oc-gmaps" role="group" aria-label="地图控制">
          <div className="oc-gm-compass-wrap" role="group" aria-label="罗盘与转向">
            {SHOW_COMPASS_TURN_ARROWS && compassDraggable && (
              <button
                type="button"
                className="oc-gm-turn is-left"
                aria-label="向左旋转 90 度"
                title="向左旋转 90°"
                onClick={event => { event.stopPropagation(); turnCompass('left'); }}
              />
            )}
            <button
              type="button"
              id="tool-compass"
              className={`oc-gm-round oc-gm-compass${compassDraggable ? ' is-interactive' : ''}${compassDragging ? ' is-dragging' : ''}`}
              data-tip={compassTip}
              aria-label={compassTip}
              onClick={handleCompassClick}
              onPointerDown={handleCompassPointerDown}
              onPointerMove={handleCompassPointerMove}
              onPointerUp={event => finishCompassDrag(event, false)}
              onPointerCancel={event => finishCompassDrag(event, true)}
            >
              <CompassDial size={64} rotationDeg={(compassBearing * 180) / Math.PI} showTurns={SHOW_COMPASS_TURN_ARROWS && compassDraggable} />
            </button>
            {SHOW_COMPASS_TURN_ARROWS && compassDraggable && (
              <button
                type="button"
                className="oc-gm-turn is-right"
                aria-label="向右旋转 90 度"
                title="向右旋转 90°"
                onClick={event => { event.stopPropagation(); turnCompass('right'); }}
              />
            )}
          </div>
          <button type="button" id="tool-view-toggle" className="oc-gm-round oc-gm-mode" data-tip={outdoor?.view === '3d' ? '当前 3D · 切回 2D 平面' : '当前 2D 平面 · 切到 3D 场景'} aria-label={outdoor?.view === '3d' ? '当前 3D 场景，点击切回 2D 平面' : '当前 2D 平面，点击切到 3D 场景'} aria-pressed={outdoor?.view === '3d'} onClick={() => outdoor?.onToggleView?.()}>
            <span className="oc-gm-mode-text">{outdoor?.view === '3d' ? '3D' : '2D'}</span>
          </button>
          <button type="button" id="tool-focus" className="oc-gm-round" data-tip={focusVenueTip ?? '回到框选场地'} aria-label={focusVenueTip ?? '回到框选场地'} disabled={!onFocusVenue} onClick={() => onFocusVenue?.()}>
            <MyLocationIcon size={18} />
          </button>
          <div className="oc-gm-zoom" role="group" aria-label="缩放">
            <button type="button" id="tool-zoom-in" className="oc-gm-zoom-btn" data-tip="放大" aria-label="放大" onClick={() => outdoor!.zoomBy(1)}>
              <MaterialSymbol name="add" size={20} />
            </button>
            <button type="button" id="tool-zoom-out" className="oc-gm-zoom-btn" data-tip="缩小" aria-label="缩小" onClick={() => outdoor!.zoomBy(-1)}>
              <MaterialSymbol name="remove" size={20} />
            </button>
          </div>
          <button type="button" id="tool-walk" data-tip={walkPressed ? '退出漫游' : '第一人称漫游'} aria-label={walkPressed ? '退出漫游' : '第一人称漫游'} aria-pressed={walkPressed} className={`oc-gm-round oc-gm-walk is-walk${walkPressed ? ' is-active' : ''}`} onClick={() => outdoor?.toggleWalk?.(!outdoorWalkOn)}>
            <PegmanIcon size={20} />
          </button>
          <span className="oc-gm-divider" aria-hidden="true" />
          <button type="button" id="tool-opacity" className={`oc-gm-round oc-gm-eye${chromeHidden ? ' is-active' : ''}`} data-tip={chromeHidden ? '退出干净看图' : '干净看图'} aria-label={chromeHidden ? '退出干净看图' : '干净看图：隐藏全部浮层'} aria-pressed={chromeHidden} onClick={() => onToggleChrome?.()}>
            <MaterialSymbol name="visibility" size={18} />
          </button>
        </div>
        {/* 2026-11-16 我们自己的工具栏：贴底一条。
            Google 控制列只放地图语义钮，规划工具（选择/测量/标注/吸附/历史）全部收进这里。
            2026-11-20 灵动岛化：不再是「一颗把手 + 一条另起的工具条」，收成一颗岛——
            收起是小圆钮，悬停露出「工具」，点开横向长成整条工具胶囊；岛始终是同一个元素。 */}
        <div className={`oc-dock${dockOpen ? ' is-open' : ''}`}>
          {/* 2026-11-28 用户反馈收起态点击范围太小：整颗岛都是展开钮——点「工具」二字或胶囊任意处都展开；展开态仍只认岛核 ⌄ 收起。 */}
          <div id="oc-tool-dock" className="oc-cluster oc-bb oc-island" aria-label="底部工具条" onClick={dockOpen ? undefined : openToolDock}>
            {/* 岛核：收起时只留 ⌃，展开后翻成 ⌄＝收起。 */}
            <button
              type="button"
              className="oc-island-toggle"
              aria-expanded={dockOpen}
              aria-controls="oc-tool-dock"
              aria-label={dockOpen ? '收起工具条（Esc）' : '展开工具条'}
              title={dockOpen ? '收起工具条（Esc）' : '展开工具条'}
              onClick={() => (dockOpen ? closeToolDock() : openToolDock())}
            >
              <MaterialSymbol name={dockOpen ? 'keyboard_arrow_down' : 'keyboard_arrow_up'} size={18} />
            </button>
            <span className="oc-island-label" aria-hidden="true">工具</span>
            {/* 工具行常驻 DOM：收起时靠 visibility 藏起来，展开不必重新挂载；
                收起时同时对读屏器隐身，键盘与读屏都碰不到收起的工具。 */}
            <div className="oc-island-tools" aria-hidden={dockOpen ? undefined : true}>
          {/* 2026-11-15 直切：户外选择/抓手不再弹二级菜单，点钮在 抓手⇄选择 之间直切；图标随当前态，H/S 快捷键保留。 */}
          <button type="button" id="tool-select" data-tip={canvasToolTip} aria-label={canvasToolLabel} aria-pressed={selectActive} className={selectActive ? 'is-active' : canvasSelectOn ? '' : 'is-off'} onClick={() => outdoor?.setCanvasMode?.(canvasSelectOn ? 'view' : 'select')}>
            {canvasSelectOn ? <MaterialSymbol name="near_me" /> : <HandStopIcon size={20} />}
          </button>
          {outdoor?.enterMeasure && (
            <div className="sc-tool-menu sc-measure-menu" ref={measureMenuRef}>
            <div className={`sc-measure-combo${outdoor.measureActive ? ' is-active' : ''}`}>
              <button type="button" id="tool-measure" className="sc-measure-main" data-tip={outdoor.measureActive ? '测量中 · 点按退出' : '测量：点按开始测距'} aria-label="测量" aria-pressed={!!outdoor.measureActive} onClick={() => { if (outdoor.measureActive) outdoor.exitMeasure?.(); else outdoor.enterMeasure?.(); }}>
                <MaterialSymbol name={OUTDOOR_TOOL_ICONS.measure} />
              </button>
              <button type="button" className="sc-measure-caret" aria-label="测量模式：距离 / 面积" aria-haspopup="menu" aria-expanded={measureMenuOpen} onClick={(event) => { event.stopPropagation(); setMeasureMenuOpen(open => !open); }}>
                <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
              </button>
            </div>
              {measureMenuOpen && (
                <div id="tool-measure-panel" className="sc-tool-pop sc-measure-pop" role="menu" aria-label="测量模式">
                  {([['distance', '距离', 'straighten'], ['area', '面积', 'crop_square']] as const).map(([kind, label, icon]) => {
                    const active = outdoor.measureKind === kind;
                    return (
                      <button key={kind} type="button" role="menuitemradio" aria-checked={active} className={`sc-canvas-tool-row${active ? ' is-active' : ''}`} onClick={() => { outdoor.setMeasureKind?.(kind); if (!outdoor.measureActive) outdoor.enterMeasure?.(); setMeasureMenuOpen(false); }}>
                        <MaterialSymbol name={icon} size={16} />
                        <span className="sc-measure-row-label">{label}</span>
                        <span className="sc-measure-check-slot" aria-hidden="true">
                          {active && <Check size={14} strokeWidth={2.5} className="sc-tool-check" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {outdoor?.setInspector && <button type="button" id="tool-annotate" data-tip="标注" aria-label="标注" aria-pressed={outdoor.inspectorTabs?.annotate === true} className={outdoor.inspectorTabs?.annotate === true ? 'is-active' : ''} onClick={() => outdoor.setInspector?.('annotate')}>
            <MaterialSymbol name={OUTDOOR_TOOL_ICONS.annotate} />
          </button>}
          <span className="oc-sep" aria-hidden="true" />
          {outdoor?.setInspector && <button type="button" id="tool-selection" data-tip="属性" aria-label="属性" aria-pressed={outdoor.inspectorTabs?.selection === true} className={outdoor.inspectorTabs?.selection === true ? 'is-active' : ''} onClick={() => outdoor.setInspector?.('selection')}>
            <MaterialSymbol name={OUTDOOR_TOOL_ICONS.selection} />
          </button>}
          {outdoor?.setSnapOn && <button type="button" id="tool-snap" data-tip={outdoor.snapOn === false ? '网格吸附 · 已关闭，点按开启' : '网格吸附 · 开启，点按关闭'} aria-label="网格吸附" aria-pressed={outdoor.snapOn !== false} className={outdoor.snapOn !== false ? 'is-active' : ''} onClick={() => outdoor.setSnapOn?.(outdoor.snapOn === false)}>
            <GridSnapIcon active={outdoor.snapOn !== false} />
          </button>}
          <span className="oc-sep" aria-hidden="true" />
          <button type="button" id="tool-undo" data-tip="撤销（平面编辑）" aria-label="撤销" disabled={!outdoor!.canUndo} onClick={() => outdoor!.undo()}>
            <MaterialSymbol name="undo" />
          </button>
          <button type="button" id="tool-redo" data-tip="重做（平面编辑）" aria-label="重做" disabled={!outdoor!.canRedo} onClick={() => outdoor!.redo()}>
            <MaterialSymbol name="redo" />
          </button>
            </div>
          </div>
        </div>
      </>)}
    </nav>
  );
}

/** Design: bottom full-width MATERIALS handle (reference 04-final-flat) — a hairline bar, not a floating pill. */
export function MaterialDrawerHandle({ open, onToggle, buttonRef }: { open: boolean; onToggle(): void; buttonRef?: RefObject<HTMLButtonElement> }): JSX.Element {
  return (
    <div className={`sc-material-drawer-bar${open ? ' is-open' : ''}`}>
      <button
        type="button"
        ref={buttonRef}
        id="material-drawer-handle"
        className={`sc-material-drawer-handle${open ? ' is-active' : ''}`}
        title={open ? '收起物料库' : '展开物料库'}
        data-tip={open ? '收起物料库' : '展开物料库'}
        aria-label={open ? '收起物料库' : '展开物料库'}
        aria-expanded={open}
        aria-controls="workbench-material-shelf"
        onClick={onToggle}
      >
        <Boxes size={20} aria-hidden="true"/>
        <ChevronUp className="sc-materials-chevron" size={16} aria-hidden="true"/>
      </button>
    </div>
  );
}
