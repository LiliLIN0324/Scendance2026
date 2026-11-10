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

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import OutdoorPlanCanvas, { type CanvasBasemapSource } from '@/components/room-organizer/components/outdoor-plan-canvas';
import { ExportMenu, GuideBubble, ShareDialog, useGuide } from '@/components/room-organizer/components/outdoor-plan-interactions';
import { GUIDE_STEPS, shareDialogContent } from '@/components/room-organizer/lib/site-plan-guide';
import { planOverviewStats } from '@/components/room-organizer/lib/site-plan-measure';
import { downloadPlanCsv } from '@/components/room-organizer/lib/site-plan-csv';
import { downloadPlanPng, composePlanPng } from '@/components/room-organizer/lib/site-plan-png';
import { buildShareLink } from '@/components/room-organizer/lib/site-plan-share';
import { printPlanDeck } from '@/components/room-organizer/lib/site-plan-pdf';
import { downloadPlanGeoJson } from '@/components/room-organizer/lib/site-plan-geojson';
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
  { id: 'vec', short: '天矢', label: '天地图矢量（待 key）' },
  { id: 'img', short: '天影', label: '天地图影像（待 key）' },
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
}

export default function OutdoorPlanOverlay({ projectId, anchor, activityName, onSaveStateChange }: OutdoorPlanOverlayProps): JSX.Element {
  const slotId = projectId || LOCAL_DRAFT_SLOT;
  const [source, setSource] = useState<CanvasBasemapSource>('osm');
  const [plan, setPlan] = useState<SitePlanData | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [shareOpen, setShareOpen] = useState(false);
  const [toolsDock, setToolsDock] = useState<HTMLElement | null>(null);
  const guide = useGuide(GUIDE_STORAGE_KEY);

  // 主产品室内工具排容器（room-organizer 的 #tool-column）：户外钮段追加在其尾部，
  // 与撤销/缩放/截图等室内通用钮同排共存（P2-f：功能兼容、不隐藏）。
  useEffect(() => {
    setToolsDock(document.getElementById('tool-column'));
    return () => setToolsDock(null);
  }, []);

  // 载入本机草稿：室内活动第一次开户外面用起步矩形（同户外项目口径）。
  useEffect(() => {
    const record = readOutdoorProjectRecord(slotId);
    setPlan(record?.plan ?? createStarterOutdoorPlan());
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

  function pickExport(id: string): void {
    if (!plan) return;
    const stem = activityName?.trim() || 'outdoor-plan';
    if (id === 'share') { setShareOpen(true); return; }
    if (id === 'csv') { downloadPlanCsv(plan, stem); return; }
    if (id === 'geojson') { downloadPlanGeoJson(plan, stem); return; }
    if (id === 'png') {
      const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
      const planCanvas = canvases[canvases.length - 1];
      if (planCanvas) downloadPlanPng({ plan, planCanvas, revision: 1, dpi: 300 });
    }
  }

  function cycleSource(): void {
    const idx = SOURCE_CYCLE.findIndex(s => s.id === source);
    setSource(SOURCE_CYCLE[(idx + 1) % SOURCE_CYCLE.length].id);
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
          plan={plan}
          source={source}
          onPlanChange={setPlan}
          panelsHostId="outdoor-panel-host-layers"
          infoPanelHostId="outdoor-panel-host-info"
          {...(anchor ? { initialView: { lng: anchor.lng, lat: anchor.lat } } : {})}
        />
      )}
      {/* 右侧工具段：portal 进主产品室内工具排尾部（#tool-column）——通用钮共存，户外钮舒展并入。 */}
      {toolsDock && createPortal(
        <>
          <button
            type="button"
            id="tool-outdoor-source"
            className="sc-tool-outdoor"
            aria-label={`底图图源：${currentSource.label}（点击切换）`}
            data-tip={`图源：${currentSource.label}`}
            data-testid="outdoor-source-cycle"
            onClick={cycleSource}
            style={{ color: 'var(--sc-green, #4a7c59)', fontWeight: 600, fontSize: 12 }}
          >
            {currentSource.short}
          </button>
          <span className="sc-tool-sep" aria-hidden="true" />
          <span data-testid="outdoor-export-host" style={{ display: 'inline-flex' }}>
            <ExportMenu variant="toolbar" enableExports onPick={pickExport} />
          </span>
          {guide.activeStep === null && (
            <button
              type="button"
              id="tool-outdoor-guide"
              className="sc-tool-outdoor"
              aria-label="重看首次开图引导"
              data-tip="重看引导"
              onClick={guide.restart}
            >
              ?
            </button>
          )}
        </>,
        toolsDock,
      )}
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
}

