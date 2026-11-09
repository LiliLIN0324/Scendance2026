'use client';

import { useEffect, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Info,
  Maximize2,
  Move,
  RotateCw,
} from 'lucide-react';
import type { AlignEdge, DistributeAxis } from '../lib/alignment';
import { CATALOG_DRAG_MIME } from '../lib/catalog-drag';
import { MAX_CUSTOM_SET_NAME_LENGTH } from '../lib/custom-sets';
import { WALK_CANVAS_ID } from '../lib/walk-engage';
import { Icon, iconForItem } from '../plotcraft/icon';
import { ChipButton, ChipNameField } from './chip-controls';
import { Minimap } from './minimap';
import type { WalkthroughPhase } from '../hooks/use-walkthrough';
import type { GizmoMode } from '../lib/transform';
import type { FurnitureItem, RoomLayout } from '../lib/types';
import type { FloorLayout } from '../lib/types';

export interface HoverState {
  item: FurnitureItem;
  clientX: number;
  clientY: number;
}

export interface ViewportProps {
  isReady: boolean;
  error: string | null;
  view2D: boolean;
  layout: RoomLayout;
  activeFloor: FloorLayout;
  selectedItem: FurnitureItem | null;
  selectionCount?: number;
  /** Copy the current multi-selection to the furniture clipboard (#153). */
  onCopySelection?(): void;
  /** The selection is exactly one persistent group (#154) — the chip says so. */
  selectionGrouped?: boolean;
  /** Group the selection; absent when it is already one whole group (#154). */
  onGroupSelection?: (() => void) | undefined;
  /** Ungroup the selection; absent when nothing in it is grouped (#154). */
  onUngroupSelection?: (() => void) | undefined;
  /** Save the selection as a reusable custom set under `name` (#302); true when saved. */
  onSaveSelectionAsSet?(name: string): boolean;
  /** Active transform tool for a single selection (#P0-3). */
  gizmoMode?: GizmoMode;
  onGizmoModeChange?(mode: GizmoMode): void;
  /** Align / distribute a multi-selection (#P0-3). */
  onAlignSelection?(edge: AlignEdge): void;
  onDistributeSelection?(axis: DistributeAxis): void;
  showMeasurements: boolean;
  showMinimap: boolean;
  walkthroughActive?: boolean;
  /** Pointer-lock progress for the eye-level walk hint. */
  walkthroughPhase?: WalkthroughPhase;
  /** Sample / World gaussian is the backdrop; the hint says walk stays at eye height. */
  walkthroughInEnvironment?: boolean;
  /** The backdrop is metric: the walker roams the scanned bounds 1:1, not the plate. */
  walkthroughMetric?: boolean;
  /** 近前可坐的坐具名；漫游里显示「按 F 坐下」。 */
  walkthroughSeat?: string | null;
  /** 正坐在坐具上：提示换成「按 F 起身」。 */
  walkthroughSeated?: boolean;
  hover?: HoverState | null;
  measurementDistance?: number | null;
  /** Points placed with the distance tool; absent while the tool is off. */
  measurementPointsPlaced?: number;
  /** When set, a HUD chip shows the current wall-drawing status. */
  wallDrawStatus?: {
    hasAnchor: boolean;
    snapKind?: 'vertex' | 'on-wall' | 'right-angle' | 'none';
    currentLength?: number | null;
  } | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  canvas2DRef: React.RefObject<HTMLCanvasElement>;
  onCatalogDrop?(clientX: number, clientY: number, type: string): void;
}

export function Viewport(props: ViewportProps): JSX.Element {
  const showLoading = !props.isReady && !props.error;
  const showError = Boolean(props.error);

  // Foreign-drag guard (#166): only the app's own catalog payload is accepted.
  // Without the types check, dragover preventDefault advertised a drop target
  // to ANY drag (files, text, images), showing a fake copy affordance.
  const handleDragOver = (event: React.DragEvent<HTMLCanvasElement>) => {
    if (!props.onCatalogDrop) return;
    if (!event.dataTransfer.types.includes(CATALOG_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const handleDrop = (event: React.DragEvent<HTMLCanvasElement>) => {
    if (!props.onCatalogDrop) return;
    const type = event.dataTransfer.getData(CATALOG_DRAG_MIME);
    if (!type) return;
    event.preventDefault();
    props.onCatalogDrop(event.clientX, event.clientY, type);
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/*
         * Both canvases are mounted at all times so that useThreeScene
         * can attach its renderer before isReady becomes true. The
         * inactive canvas is hidden, not unmounted.
         */}
        {/*
         * No fixed width/height attributes: the 2D backing store is sized to
         * clientWidth/clientHeight × devicePixelRatio by a ResizeObserver in
         * use-scene-effects, so the canvas stays crisp on retina and its aspect
         * ratio matches the container (circles stay circular). CSS stretches the
         * element to fill the viewport.
         */}
        {/*
         * The 2D plan takes the same catalog drops as the 3D canvas (#166) and
         * pointer select/drag via use-canvas-2d-interaction (#219); touchAction
         * none, as on the 3D canvas, so touch drags aren't eaten by scrolling.
         */}
        <canvas
          ref={props.canvas2DRef}
          className={props.view2D ? '' : 'hidden'}
          style={{
            width: '100%',
            height: '100%',
            display: props.view2D ? 'block' : 'none',
            background: 'var(--pc-grass)',
            touchAction: 'none',
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
        <canvas
          ref={props.canvasRef}
          id={WALK_CANVAS_ID}
          className={props.view2D ? 'hidden' : ''}
          style={{
            width: '100%',
            height: '100%',
            display: props.view2D ? 'none' : 'block',
            touchAction: 'none',
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />

        {showLoading && <LoadingOverlay />}
        {showError && <ErrorOverlay message={props.error ?? ''} />}

        {props.isReady && !showError && <ViewportOverlays {...props} />}
      </div>
    </div>
  );
}

function LoadingOverlay(): JSX.Element {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: 'var(--sc-canvas)' }}
      role="status"
      aria-live="polite"
    >
      <div className="sc-canvas-loading">
        <span className="sc-canvas-loading-cap">正在准备活动场地</span>
        <p className="sc-canvas-loading-copy">载入三维编辑器，请稍候。</p>
      </div>
    </div>
  );
}

function ErrorOverlay({ message }: { message: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(
        message || '三维画布未能初始化，未捕获到具体错误信息。',
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: 'var(--sc-canvas)' }}
      role="alert"
    >
      <div className="sc-canvas-error">
        <span className="sc-canvas-error-icon" aria-hidden>
          <Icon name="demolish" size={24} />
        </span>
        <h3 className="sc-canvas-error-title">三维画布没能启动</h3>
        <p className="sc-canvas-error-copy">
          通常是浏览器关闭了硬件加速。动作不会丢，打开加速再重新加载就能继续。
        </p>
        <div className="sc-canvas-error-acts">
          <button
            type="button"
            className="sc-canvas-error-primary"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
          <button
            type="button"
            className="sc-canvas-error-ghost"
            onClick={copyDiagnostics}
          >
            {copied ? '已复制诊断信息' : '复制诊断信息'}
          </button>
        </div>
        <details className="sc-canvas-error-detail">
          <summary>技术细节</summary>
          <p>{message || '未捕获到具体错误信息。'}</p>
          <ul>
            <li>在浏览器设置里打开「使用硬件加速」</li>
            <li>更新显卡驱动后重开浏览器</li>
            <li>换用 Chrome / Edge / Firefox 的最新版</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
interface HoverTooltipProps {
  hover: HoverState;
  containerRef: React.RefObject<HTMLCanvasElement>;
}

function HoverTooltip({ hover, containerRef }: HoverTooltipProps): JSX.Element | null {
  const canvas = containerRef.current;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(8, Math.min(rect.width - 220, hover.clientX - rect.left + 14));
  const y = Math.max(8, Math.min(rect.height - 70, hover.clientY - rect.top + 14));

  return (
    <div
      className="pointer-events-none pc-glass pc-glass--dark"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        padding: '8px 12px',
        borderRadius: 12,
        minWidth: 140,
      }}
    >
      <p
        style={{
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 700,
          fontSize: 12,
          color: 'var(--pc-paper)',
        }}
      >
        <Icon name={iconForItem(hover.item.type, hover.item.category)} size={14} />
        {hover.item.name}
      </p>

      <p
        className="pc-blurb"
        style={{
          margin: '2px 0 0',
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {hover.item.width.toFixed(2)}m × {hover.item.depth.toFixed(2)}m
      </p>
    </div>
  );
}

function StatusChip({
  children,
  intent = 'normal',
}: {
  children: React.ReactNode;
  intent?: 'normal' | 'accent' | 'success' | 'info';
}): JSX.Element {
  const tones: Record<string, React.CSSProperties> = {
    normal:  { color: 'var(--pc-paper)' },
    accent:  { color: 'var(--pc-cyan-glow)' },
    success: { color: 'var(--pc-confirm-green)' },
    info:    { color: 'var(--pc-sky)' },
  };
  return (
    <div
      className="pc-glass pc-glass--dark"
      style={{
        padding: '6px 12px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: 999,
        fontFamily: 'var(--pc-font-display)',
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: '0.02em',
        ...tones[intent],
      }}
    >
      {children}
    </div>
  );
}

function walkHint(phase: WalkthroughPhase | undefined, inEnvironment: boolean | undefined, metric?: boolean): string {
  const metricPrefix = metric ? '1:1 实景 · ' : '';
  // 退出只在上方那颗胶囊里说一次，这里只教怎么走、怎么看。
  if (phase === 'locked') {
    return inEnvironment
      ? `${metricPrefix}眼高走进环境 · WASD 走动 · 鼠标环顾 · Shift 加速`
      : 'WASD 走动 · 鼠标环顾 · Shift 加速';
  }
  if (phase === 'unlocked') {
    return inEnvironment
      ? '按住左键拖动转头 · WASD 走动 · 点一下画面上锁鼠标'
      : '按住左键拖动转头 · WASD 走动 · Shift 加速 · 点一下画面上锁鼠标';
  }
  if (phase === 'drag') {
    // The browser refused pointer lock in this environment, so the cursor
    // stays visible and looking is a drag — never promise a lock click (#351).
    return inEnvironment
      ? '眼高走进环境 · 按住左键拖动转头 · WASD 走动'
      : '按住左键拖动转头 · WASD 走动 · Shift 加速';
  }
  return '正在进入第一人称…';
}

const WALK_HINT_VISIBLE_MS = 7000;

/** 走动提示只在进入或换阶段时露一会儿，之后把画面还给场景。 */
function useWalkHintVisible(active: boolean | undefined, phase: WalkthroughPhase | undefined): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return undefined;
    }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), WALK_HINT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, phase]);
  return visible;
}

function ViewportOverlays(props: ViewportProps): JSX.Element {
  const walkHintVisible = useWalkHintVisible(props.walkthroughActive, props.walkthroughPhase);
  return (
    <>
      {!props.view2D && props.showMinimap && (
        <Minimap
          layout={props.layout}
          floor={props.activeFloor}
          selectedItemId={props.selectedItem?.id ?? null}
        />
      )}

      {props.selectionCount !== undefined && props.selectionCount > 1 && (
        <SelectionChip {...props} selectionCount={props.selectionCount} />
      )}

      {props.selectedItem && !props.walkthroughActive && props.onGizmoModeChange && (
        <TransformChip
          mode={props.gizmoMode ?? 'move'}
          onChange={props.onGizmoModeChange}
        />
      )}

      {props.walkthroughActive && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2"
            style={{
              transform: 'translate(-50%, -50%)',
              height: 10,
              width: 10,
              borderRadius: 999,
              background: 'var(--pc-cyan-glow)',
              boxShadow: 'var(--pc-halo-cyan)',
            }}
          />
          {walkHintVisible && (
            <div
              className="pointer-events-none absolute bottom-4 left-1/2"
              style={{ transform: 'translateX(-50%)' }}
            >
              <StatusChip intent="accent">
                <Icon name="live" size={14} />
                {walkHint(props.walkthroughPhase, props.walkthroughInEnvironment, props.walkthroughMetric)}
              </StatusChip>
            </div>
          )}
          {(props.walkthroughSeated || props.walkthroughSeat) && (
            <div
              className="pointer-events-none absolute bottom-28 left-1/2"
              style={{ transform: 'translateX(-50%)' }}
            >
              <StatusChip intent="accent">
                {props.walkthroughSeated
                  ? '已坐下 · F 或方向键起身'
                  : `按 F 坐下${props.walkthroughSeat ? ` · ${props.walkthroughSeat}` : ''}`}
              </StatusChip>
            </div>
          )}
        </>
      )}

      {props.measurementPointsPlaced !== undefined && (
          // Top-centre under the header: the top-right corner is the floor
          // and wall pills, which covered this chip (#341).
          <div className="pc-top-chip absolute left-1/2" style={{ top: 104, transform: 'translateX(-50%)', zIndex: 31 }}>
            <StatusChip intent="info">
              <Icon name="ruler" size={14} />
              {props.measurementPointsPlaced === 0
                ? 'Click a floor point to measure from · Esc to stop'
                : props.measurementPointsPlaced === 1
                ? 'Click a second point…'
                : `Distance: ${(props.measurementDistance ?? 0).toFixed(2)} m`}
            </StatusChip>
          </div>
        )}

      {props.wallDrawStatus && (
        <div
          // Top-centre like the other tool chips: the top-right corner is the
          // floor and wall pills, which covered it (#473).
          className="pc-top-chip absolute left-1/2 pc-glass pc-glass--dark"
          style={{
            top: 104,
            transform: 'translateX(-50%)',
            zIndex: 31,
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 200,
          }}
        >
          {props.wallDrawStatus.hasAnchor ? (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'var(--pc-font-display)',
                  fontWeight: 700,
                  fontSize: 11,
                  color: 'var(--pc-paper)',
                }}
              >
                <Icon name="brick" size={14} />
                Click to extend · Esc to stop
              </div>
              {props.wallDrawStatus.currentLength !== undefined &&
                props.wallDrawStatus.currentLength !== null && (
                  <div
                    className="pc-blurb"
                    style={{
                      fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                      paddingLeft: 20,
                    }}
                  >
                    {props.wallDrawStatus.currentLength.toFixed(2)} m
                  </div>
                )}
              {props.wallDrawStatus.snapKind === 'vertex' && (
                <div
                  style={{
                    fontFamily: 'var(--pc-font-display)',
                    fontWeight: 600,
                    fontSize: 11,
                    color: 'var(--pc-confirm-green)',
                    paddingLeft: 20,
                  }}
                >
                  ⊙ Snapping to vertex
                </div>
              )}
              {props.wallDrawStatus.snapKind === 'on-wall' && (
                <div
                  style={{
                    fontFamily: 'var(--pc-font-display)',
                    fontWeight: 600,
                    fontSize: 11,
                    color: 'var(--pc-confirm-green)',
                    paddingLeft: 20,
                  }}
                >
                  ⊥ Snapping onto wall
                </div>
              )}
              {props.wallDrawStatus.snapKind === 'right-angle' && (
                <div
                  style={{
                    fontFamily: 'var(--pc-font-display)',
                    fontWeight: 600,
                    fontSize: 11,
                    color: 'var(--pc-cyan-glow)',
                    paddingLeft: 20,
                  }}
                >
                  ⟂ Right-angle snap
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--pc-font-display)',
                fontWeight: 700,
                fontSize: 11,
                color: 'var(--pc-paper)',
              }}
            >
              <Icon name="brick" size={14} />
              Click to place the first wall point
            </div>
          )}
        </div>
      )}

      {props.hover && props.hover.item.id !== props.selectedItem?.id && (
        <HoverTooltip hover={props.hover} containerRef={props.canvasRef} />
      )}
    </>
  );
}

/**
 * Single-selection transform tool (#P0-3): move / rotate / scale icons plus
 * one ⓘ button that holds the whole shortcut table. Nothing else is written
 * on screen — the panel stays a three-icon chip.
 */
const GIZMO_MODES: Array<{ mode: GizmoMode; label: string; Icon: typeof Move }> = [
  { mode: 'move', label: '移动：拖动物料', Icon: Move },
  { mode: 'rotate', label: '旋转：拖动转盘，R 键转 90°', Icon: RotateCw },
  { mode: 'scale', label: '缩放：拖动放大缩小', Icon: Maximize2 },
];

const SHORTCUT_ROWS: Array<[string, string]> = [
  ['变换模式', 'Q 移动 · E 旋转 · S 缩放'],
  ['移动', '拖动物料 · 方向键微调 0.1 m'],
  ['旋转', '拖动转盘 · R 90° · Shift+R 15°'],
  ['缩放', '拖动放大缩小 · 属性面板输入尺寸'],
  ['多选', 'Shift/Ctrl 点选 · 空白处框选'],
  ['复制 / 删除', 'Ctrl+D · Ctrl+C/V · Delete'],
  ['撤销 / 重做', 'Ctrl+Z · Ctrl+Y'],
  ['吸附', '网格与物件边缘 · G 切换'],
];

function TransformChip({ mode, onChange }: { mode: GizmoMode; onChange(mode: GizmoMode): void }): JSX.Element {
  const [hintOpen, setHintOpen] = useState(false);
  return (
    <div
      className="pc-top-chip absolute left-1/2"
      style={{ top: 104, transform: 'translateX(-50%)', zIndex: 31 }}
      onMouseLeave={() => setHintOpen(false)}
    >
      <StatusChip intent={mode === 'move' ? 'normal' : 'success'}>
        {GIZMO_MODES.map(({ mode: value, label, Icon: Glyph }) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={mode === value}
            title={label}
            onClick={() => onChange(value)}
            style={{
              width: 22,
              height: 22,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 7,
              background: 'transparent',
              color: 'inherit',
              border: mode === value ? '1.5px solid var(--pc-confirm-green)' : '1.5px solid transparent',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <Glyph size={14} strokeWidth={1.75} aria-hidden />
          </button>
        ))}
        <button
          type="button"
          aria-label="快捷键说明"
          aria-expanded={hintOpen}
          title="快捷键说明"
          onClick={() => setHintOpen(open => !open)}
          style={{
            width: 22,
            height: 22,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 7,
            background: 'transparent',
            color: 'inherit',
            border: '1.5px solid transparent',
            cursor: 'pointer',
            padding: 0,
            opacity: 0.7,
          }}
        >
          <Info size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </StatusChip>
      {hintOpen && (
        <div
          className="pc-glass pc-glass--dark"
          role="dialog"
          aria-label="快捷键"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 250,
            padding: '8px 10px',
            borderRadius: 'var(--r-md)',
            display: 'grid',
            gap: 4,
            fontSize: 10.5,
            color: 'var(--pc-paper)',
            fontFamily: 'var(--pc-font-display)',
            zIndex: 40,
          }}
        >
          {SHORTCUT_ROWS.map(([key, value]) => (
            <div key={key} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <strong style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{key}</strong>
              <span style={{ opacity: 0.72, textAlign: 'right' }}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact icon control inside the dark chips (1.5 px green ring when on). */
function ChipIconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?(): void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 22,
        height: 22,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 7,
        background: 'transparent',
        color: 'inherit',
        border: active ? '1.5px solid var(--pc-confirm-green)' : '1.5px solid transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 0.9,
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

/**
 * The multi-select chip. Save as set names the set right here (#374): the
 * button turns into a name field, in place of a blocking prompt.
 */
function SelectionChip(props: ViewportProps & { selectionCount: number }): JSX.Element {
  const [namingSet, setNamingSet] = useState(false);
  const onSaveSet = props.onSaveSelectionAsSet;
  return (
    <div
      className="pc-top-chip absolute left-1/2"
      // Below the header stats box, which can wrap to two lines at
      // narrow desktop widths and covered a top-16 chip (#299, #154).
      style={{ top: 104, transform: 'translateX(-50%)', zIndex: 31, maxWidth: 'calc(100vw - 32px)' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
      <StatusChip intent="accent">
        <Icon name="copy" size={14} />
        {namingSet && onSaveSet ? (
          <>
            将 {props.selectionCount} 件存为组合
            <ChipNameField
              label="组合名称"
              initialValue={`${props.selectedItem?.name ?? '我的'}组合`}
              submitLabel="保存"
              maxLength={MAX_CUSTOM_SET_NAME_LENGTH}
              onSubmit={(name) => {
                // A failed save (storage full) keeps the field open; the
                // status toast says why.
                if (onSaveSet(name)) setNamingSet(false);
              }}
              onCancel={() => setNamingSet(false)}
            />
          </>
        ) : (
          <>
            {props.selectionCount} 件
            {props.selectionGrouped ? ' · 已成组 · 点任意一件全选' : ' · 已选中 · 拖动即整体移动'}
            {props.onCopySelection && (
              <ChipButton
                onClick={props.onCopySelection}
                title="复制所选（Ctrl+C），Ctrl+V 可贴到本层或其他层"
              >
                复制
              </ChipButton>
            )}
            {props.onGroupSelection && (
              <ChipButton
                onClick={props.onGroupSelection}
                title="把这些物料编成一组：点任意一件即全选，Alt+点击只选一件"
              >
                成组
              </ChipButton>
            )}
            {props.onUngroupSelection && (
              <ChipButton onClick={props.onUngroupSelection} title="取消这一组">
                解组
              </ChipButton>
            )}
            {onSaveSet && (
              <ChipButton
                onClick={() => setNamingSet(true)}
                title="把当前摆法存成一个组合"
              >
                存为组合
              </ChipButton>
            )}
          </>
        )}
      </StatusChip>
      {!namingSet && props.onAlignSelection && (
        <StatusChip intent="normal">
          <ChipIconButton label="左对齐" onClick={() => props.onAlignSelection?.('min-x')}>
            <AlignLeft size={13} strokeWidth={1.75} aria-hidden />
          </ChipIconButton>
          <ChipIconButton label="水平居中" onClick={() => props.onAlignSelection?.('center-x')}>
            <AlignCenterHorizontal size={13} strokeWidth={1.75} aria-hidden />
          </ChipIconButton>
          <ChipIconButton label="右对齐" onClick={() => props.onAlignSelection?.('max-x')}>
            <AlignRight size={13} strokeWidth={1.75} aria-hidden />
          </ChipIconButton>
          <ChipIconButton
            label={props.selectionCount < 3 ? '水平等距（至少三件）' : '水平等距分布'}
            disabled={props.selectionCount < 3}
            onClick={() => props.onDistributeSelection?.('x')}
          >
            <AlignHorizontalDistributeCenter size={13} strokeWidth={1.75} aria-hidden />
          </ChipIconButton>
          <span aria-hidden style={{ width: 1, height: 14, background: 'currentColor', opacity: 0.25 }} />
          <ChipIconButton label="上对齐" onClick={() => props.onAlignSelection?.('min-z')}>
            <AlignStartVertical size={13} strokeWidth={1.75} aria-hidden />
          </ChipIconButton>
          <ChipIconButton label="垂直居中" onClick={() => props.onAlignSelection?.('center-z')}>
            <AlignCenterVertical size={13} strokeWidth={1.75} aria-hidden />
          </ChipIconButton>
          <ChipIconButton label="下对齐" onClick={() => props.onAlignSelection?.('max-z')}>
            <AlignEndVertical size={13} strokeWidth={1.75} aria-hidden />
          </ChipIconButton>
          <ChipIconButton
            label={props.selectionCount < 3 ? '垂直等距（至少三件）' : '垂直等距分布'}
            disabled={props.selectionCount < 3}
            onClick={() => props.onDistributeSelection?.('z')}
          >
            <AlignVerticalDistributeCenter size={13} strokeWidth={1.75} aria-hidden />
          </ChipIconButton>
        </StatusChip>
      )}
      </div>
    </div>
  );
}
