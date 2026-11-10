'use client';

/**
 * 户外 2D 规划覆盖层（P2-e · 融进 3D 页面框架）：**本组件只负责画布本体**——
 * 满幅 OutdoorPlanCanvas + 引导 + 分享弹窗，再无任何自造按钮/顶条/侧栏。
 * 其余功能全部 portal 进主产品 3D 页面**现有的框架锚点**（由 room-organizer 渲染）：
 * - `#outdoor-panel-host-layers` / `#outdoor-panel-host-info`：主产品左栏卡片里的两个
 *   卡片宿主（图层栈与编辑 / 规划信息，画布浮窗经 PanelPortal 进去）；
 * - `#outdoor-tools-dock`：主产品右侧工具排位置（sc-editor-dock 内，同款
 *   sc-view-tools/sc-canvas-rail 框架），挂图源循环 / 导出 / 引导三枚钮。
 * 开关由左轨「户外规划」钮 toggle；活动名/保存态归主产品原位（左栏活动卡/左轨 foot）。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import OutdoorPlanCanvas, {
  type CanvasBasemapSource,
  type OutdoorPlanCanvasHandle,
} from '@/components/room-organizer/components/outdoor-plan-canvas';
import { ExportMenu, GuideBubble, ShareDialog, useGuide } from '@/components/room-organizer/components/outdoor-plan-interactions';
import { GUIDE_STEPS, shareDialogContent } from '@/components/room-organizer/lib/site-plan-guide';
import { planOverviewStats } from '@/components/room-organizer/lib/site-plan-measure';
import { writePlanGroundSource } from '@/components/room-organizer/lib/plan-basemap-source';
import { downloadPlanCsv } from '@/components/room-organizer/lib/site-plan-csv';
import { downloadPlanPng, composePlanPng } from '@/components/room-organizer/lib/site-plan-png';
import { buildShareLink } from '@/components/room-organizer/lib/site-plan-share';
import { printPlanDeck } from '@/components/room-organizer/lib/site-plan-pdf';
import { downloadPlanGeoJson } from '@/components/room-organizer/lib/site-plan-geojson';
import { PLANNING_SURFACE } from '@/lib/outdoor-plan-tokens';
import {
  createStarterOutdoorPlan,
  readOutdoorProjectRecord,
  saveOutdoorProjectRecord,
} from '@/components/room-organizer/lib/outdoor-project-store';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** 图源循环顺序（右侧工具排一枚钮循环切换）。 */
const SOURCE_CYCLE: { id: CanvasBasemapSource; short: string; label: string }[] = [
  { id: 'osm', short: 'OSM', label: 'OSM 街道' },
  { id: 'carto-light', short: 'C浅', label: 'Carto 浅色' },
  { id: 'carto-dark', short: 'C深', label: 'Carto 深色' },
  { id: 'vec', short: '天矢', label: '天地图矢量' },
  { id: 'img', short: '天影', label: '天地图影像' },
];

const AUTOSAVE_DEBOUNCE_MS = 400;
const GUIDE_STORAGE_KEY = 'outdoor-plan-guide-v1';
/** 本地活动没有稳定 id 时的兜底草稿槽（单草稿；云项目 id 恒走按项目隔离）。 */
const LOCAL_DRAFT_SLOT = 'local-draft';

export type OutdoorSaveState = { state: 'idle' | 'saving' | 'saved'; savedAt: string | null } | null;

export interface OutdoorPlanOverlayProps {
  /** 草稿归属：layout.id（云项目 id 或本地活动 uuid）；null 落固定兜底槽。 */
  projectId: string | null;
  /** 活动点位（sceneAnchor/mapLngLat，GCJ-02）：仅用于底图初始定位，不写进 plan.anchor。 */
  anchor?: { lng: number; lat: number } | null;
  activityName?: string | null;
  /** 保存态上报：room-organizer 据此在左轨 foot（主产品保存态原位）显示户外草稿状态。 */
  onSaveStateChange?: (next: OutdoorSaveState) => void;
  /** P2-g：undo/redo 可用态上报（室内工具排撤销/重做钮启用态）。 */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  /** P2-g：计划变更上报（2D 边界 → 3D 场地壳体联动用；含初次载入的那一帧）。 */
  onPlanChange?: (plan: SitePlanData) => void;
  /**
   * P4-c：交付簇里的「发布」槽位。发布卡片由 room-organizer 传进来（ShareMenu variant="canvas"），
   * 卡片本体只实现一次——用户反馈「导出 分享 发布 应该是一起的」。
   */
  deliverySlot?: ReactNode;
  /**
   * P2-g 反向播种：3D 已圈好的场地（`layout.backendVenue`）投影成的起步平面。
   * 只在**该槽位还没有户外草稿**时使用；有草稿时草稿优先（用户自己画过的东西不覆盖）。
   */
  seedPlan?: SitePlanData | null;
}

/** P2-g：覆盖层对外命令句柄（room-organizer 的室内工具排通用钮转发到这里）。 */
export interface OutdoorPlanOverlayHandle {
  /** 缩放一档（与滚轮同源）。 */
  zoomBy(direction: 1 | -1): void;
  /** 业务层画布截图 dataURL（无画布时 null）。 */
  captureImage(): string | null;
  /** 按当前 plan 导出 PNG（与右侧导出菜单的 PNG 同一口径）；无 plan 时返回 false。 */
  exportPng(): boolean;
  undo(): void;
  redo(): void;
}

const OutdoorPlanOverlay = forwardRef<OutdoorPlanOverlayHandle, OutdoorPlanOverlayProps>(function OutdoorPlanOverlay({
  projectId,
  anchor,
  activityName,
  onSaveStateChange,
  onHistoryChange,
  onPlanChange,
  deliverySlot,
  seedPlan,
}: OutdoorPlanOverlayProps, ref): JSX.Element {
  const canvasApiRef = useRef<OutdoorPlanCanvasHandle | null>(null);
  const slotId = projectId || LOCAL_DRAFT_SLOT;
  const [source, setSource] = useState<CanvasBasemapSource>('osm');
  const [plan, setPlan] = useState<SitePlanData | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [shareOpen, setShareOpen] = useState(false);
  const guide = useGuide(GUIDE_STORAGE_KEY);
  // 底图选择面板：对齐 OnePlan 的 Select a map —— 画布右下角一枚「底图」钮 + 弹出列表，
  // 不再把「OSM」这种图源缩写塞进室内工具排里让人猜。
  const [mapPickerOpen, setMapPickerOpen] = useState(false);

  // P4-d：把平面选的底图记成「三维地面也用这张」的偏好，切图源时同步。
  useEffect(() => {
    writePlanGroundSource(source);
  }, [source]);

  // 载入本机草稿：室内活动第一次开户外面用起步矩形（同户外项目口径）。
  // P2-g：没有草稿但有 3D 场地时，按 3D 壳体的轮廓起稿（同一个场地的两个视图）。
  const seedPlanRef = useRef<SitePlanData | null | undefined>(seedPlan);
  seedPlanRef.current = seedPlan;
  useEffect(() => {
    const record = readOutdoorProjectRecord(slotId);
    setPlan(record?.plan ?? seedPlanRef.current ?? createStarterOutdoorPlan());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId]);

  // 保存管线：同户外项目工作台（400ms 防抖 + 卸载 flush）；状态经 onSaveStateChange
  // 上报给 room-organizer，在左轨 foot（主产品保存态原位）显示。
  const planRef = useRef<SitePlanData | null>(plan);
  planRef.current = plan;
  const pendingSaveRef = useRef<number | null>(null);
  const flushSave = useCallback(() => {
    const current = planRef.current;
    if (current == null) return;
    const record = readOutdoorProjectRecord(slotId);
    saveOutdoorProjectRecord({
      v: 1,
      projectId: slotId,
      name: activityName?.trim() || record?.name || '户外规划',
      createdAt: record?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: current,
    });
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    setSaveState('saved');
  }, [slotId, activityName]);
  useEffect(() => {
    if (plan == null) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      pendingSaveRef.current = null;
      flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    pendingSaveRef.current = timer;
    return () => { window.clearTimeout(timer); };
  }, [plan, flushSave]);
  useEffect(() => () => {
    if (pendingSaveRef.current !== null) flushSave();
  }, [flushSave]);
  useEffect(() => {
    onSaveStateChange?.({ state: saveState, savedAt });
  }, [saveState, savedAt, onSaveStateChange]);

  const shareLink = plan
    ? buildShareLink(
      { planId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '99999999-9999-4999-8999-999999999999',
        projectId: slotId === LOCAL_DRAFT_SLOT ? '88888888-8888-4888-8888-888888888888' : slotId,
        revision: 1, updatedAt: new Date().toISOString(), data: plan },
      typeof window === 'undefined' ? '' : window.location.origin,
      '/plan-share',
    )
    : '';

  function exportPlanPng(): boolean {
    const current = planRef.current;
    if (!current) return false;
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
    const planCanvas = canvases[canvases.length - 1];
    if (!planCanvas) return false;
    downloadPlanPng({ plan: current, planCanvas, revision: 1, dpi: 300 });
    return true;
  }

  // P2-g：对外命令句柄（室内工具排的撤销/重做/缩放/导出转发到这里）。
  // 不写依赖数组：每帧重建，句柄永远拿到当帧闭包（内部读的都是 ref/最新 state）。
  useImperativeHandle(ref, () => ({
    zoomBy: (direction: 1 | -1) => canvasApiRef.current?.zoomBy(direction),
    captureImage: () => canvasApiRef.current?.captureImage() ?? null,
    exportPng: () => exportPlanPng(),
    undo: () => canvasApiRef.current?.undo(),
    redo: () => canvasApiRef.current?.redo(),
  }));

  // P2-g：计划变更上报（2D 边界 → 3D 场地壳体联动的入口；初次载入也报一次）。
  useEffect(() => {
    if (plan) onPlanChange?.(plan);
  }, [plan, onPlanChange]);

  function pickExport(id: string): void {
    if (!plan) return;
    const stem = activityName?.trim() || 'outdoor-plan';
    if (id === 'share') { setShareOpen(true); return; }
    if (id === 'csv') { downloadPlanCsv(plan, stem); return; }
    if (id === 'geojson') { downloadPlanGeoJson(plan, stem); return; }
    if (id === 'png') {
      exportPlanPng();
    }
  }

  const currentSource = SOURCE_CYCLE.find(s => s.id === source) ?? SOURCE_CYCLE[0];

  return (
    <div
      data-testid="outdoor-overlay"
      style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'var(--sc-surface, #ffffff)', color: 'var(--sc-ink, #141416)' }}
    >
      {guide.activeStep && (
        <GuideBubble
          step={guide.activeStep}
          stepIndex={GUIDE_STEPS.indexOf(guide.activeStep)}
          totalSteps={GUIDE_STEPS.length}
          onComplete={() => guide.complete(guide.activeStep as (typeof GUIDE_STEPS)[number])}
          onDismiss={guide.dismiss}
        />
      )}
      {plan && (
        <OutdoorPlanCanvas
          ref={canvasApiRef}
          plan={plan}
          source={source}
          // P4-b：有地理锚点就是真地图；没有锚点（室内房间/模板场景）走纸面平面底，
          // 室内「标注区」与户外地图从此共用同一张画布。
          base={plan.anchor ? 'map' : 'floor'}
          onPlanChange={setPlan}
          {...(onHistoryChange ? { onHistoryChange } : {})}
          panelsHostId="outdoor-panel-host-layers"
          infoPanelHostId="outdoor-panel-host-info"
          libraryPanelHostId="outdoor-panel-host-library"
          {...(anchor ? { initialView: { lng: anchor.lng, lat: anchor.lat } } : {})}
        />
      )}
      {/* 右上：分享 + 导出（对齐 OnePlan 画布右上交付区）；这两枚钮不再挂在室内工具排上。
          纵向让开 3D 顶右角的楼层切换芯片（sc-floor-switcher，占 top 12–64），否则点击会被它吃掉。 */}
      <div
        data-testid="outdoor-canvas-actions"
        style={{ position: 'absolute', right: 80, top: 80, zIndex: 2, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <span data-testid="outdoor-export-host" style={{ display: 'inline-flex' }}>
          <ExportMenu variant="canvas" enableExports onPick={pickExport} />
        </span>
        <button
          type="button"
          id="tool-outdoor-share"
          data-testid="outdoor-share"
          aria-label="分享这张平面图"
          data-tip="分享平面图"
          onClick={() => setShareOpen(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 34,
            padding: '0 16px',
            borderRadius: 999,
            border: '1px solid transparent',
            background: PLANNING_SURFACE.panelText,
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(20, 20, 22, 0.16)',
            fontFamily: 'inherit',
          }}
        >
          分享
        </button>
        {/* P4-c：发布卡片由 room-organizer 传进来，和导出/分享同排同位置。 */}
        {deliverySlot}
      </div>
      {/* 右下：底图选择（OnePlan 的 Select a map）+ 重看引导。 */}
      <div
        style={{ position: 'absolute', right: 80, bottom: 16, zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}
      >
        {mapPickerOpen && (
          <div
            data-testid="outdoor-map-picker-panel"
            role="radiogroup"
            aria-label="选择底图"
            style={{
              width: 252,
              borderRadius: 14,
              background: PLANNING_SURFACE.panelBg,
              border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
              boxShadow: '0 12px 32px rgba(20, 20, 22, 0.18)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontFamily: 'inherit',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: PLANNING_SURFACE.panelText, padding: '2px 4px 4px' }}>选择底图</div>
            {SOURCE_CYCLE.map(option => {
              const active = option.id === source;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`map-source-${option.id}`}
                  onClick={() => { setSource(option.id); setMapPickerOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '7px 9px',
                    borderRadius: 9,
                    border: `1px solid ${active ? PLANNING_SURFACE.selectedBorder : 'transparent'}`,
                    background: active ? PLANNING_SURFACE.selectedBg : 'transparent',
                    color: PLANNING_SURFACE.panelText,
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <span>{option.label}</span>
                  <span style={{ fontSize: 11, opacity: active ? 0.85 : 0.5 }}>{active ? '当前' : option.short}</span>
                </button>
              );
            })}
            <div style={{ fontSize: 11, lineHeight: 1.4, opacity: 0.62, color: PLANNING_SURFACE.panelText, padding: '2px 4px 0' }}>
              天地图两档由服务端注入 key（TDT_KEY）；本机未配时瓦片回落灰色占位，可先切 OSM 街道。
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {guide.activeStep === null && (
            <button
              type="button"
              id="tool-outdoor-guide"
              aria-label="重看首次开图引导"
              data-tip="重看引导"
              onClick={guide.restart}
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
                background: PLANNING_SURFACE.panelBg,
                color: PLANNING_SURFACE.panelText,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(20, 20, 22, 0.10)',
                fontFamily: 'inherit',
              }}
            >
              ?
            </button>
          )}
          <button
            type="button"
            id="tool-outdoor-source"
            data-testid="outdoor-source-cycle"
            aria-label={`底图：${currentSource.label}（点选切换）`}
            aria-expanded={mapPickerOpen}
            aria-haspopup="dialog"
            data-tip={`底图：${currentSource.label}`}
            onClick={() => setMapPickerOpen(value => !value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 34,
              padding: '0 14px',
              borderRadius: 999,
              border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
              background: PLANNING_SURFACE.panelBg,
              color: PLANNING_SURFACE.panelText,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(20, 20, 22, 0.10)',
              fontFamily: 'inherit',
            }}
          >
            <span aria-hidden style={{ opacity: 0.7 }}>◱</span>
            底图 · {currentSource.label}
          </button>
        </div>
      </div>
      {plan && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          content={shareDialogContent({
            revision: 1,
            updatedAt: savedAt ?? new Date().toLocaleString('zh-CN', { hour12: false }),
            counts: (() => { const s = planOverviewStats(plan); return { zones: s.zoneCount, facilities: s.facilityCount, routes: plan.routes.length, workers: s.workerTotalCount }; })(),
          })}
        shareLink={shareLink}
        onPrintDeck={() => {
          if (!plan) return;
          const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
          const planCanvas = canvases[canvases.length - 1];
          const pngCanvas = planCanvas ? composePlanPng({ plan, planCanvas, revision: 1, dpi: 72 }) : undefined;
          printPlanDeck(
            { planId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '99999999-9999-4999-8999-999999999999',
              projectId: slotId === LOCAL_DRAFT_SLOT ? '88888888-8888-4888-8888-888888888888' : slotId,
              revision: 1, updatedAt: new Date().toISOString(), data: plan },
            pngCanvas?.toDataURL('image/png'),
          );
        }}
        />
      )}
    </div>
  );
});

export default OutdoorPlanOverlay;

