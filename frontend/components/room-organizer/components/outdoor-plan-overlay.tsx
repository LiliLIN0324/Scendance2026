'use client';

/**
 * 户外 2D 规划覆盖层（P2-c · 同页视图 + P2-d 面板融栏）：室内工作台**同一个页面**
 * 里的户外面——左轨「户外规划」钮开关，满幅盖在 3D 画布上方，关掉即回 3D。
 *
 * 布局对齐主产品心智（用户指示「顶部的东西和右侧按钮打通、右侧浮窗和左侧分栏打通」）：
 * - 顶条只留：返回 3D / 标题 / 保存态；
 * - 右侧工具竖条：图源（循环钮）/ 导出 / 引导——从顶条挪过来，同主产品右栏按钮语言；
 * - 左栏分栏：图层栈与编辑 / 规划信息两张卡片，由左轨「图层」「信息」钮切换
 *   （activePanel），画布浮窗经 panelsHostId portal 进来，左栏收起时浮窗自动回落画布。
 *
 * 与户外项目工作台（outdoor-plan-workspace，纯 2D 项目直进）的区别：
 * 这里挂在室内 RoomOrganizer 的 sc-canvas-stage 内，活动名/项目身份继承室内
 * 活动；底图定位继承活动点位（sceneAnchor/mapLngLat，AMap 选址语义 GCJ-02），
 * 不虚构锚点——plan.anchor 仍以用户在 2D 里落边界/锚点为准，起步不带。
 * 草稿按 layout.id 复用 outdoor-project-store 存本机（与户外项目同一套存储）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ArrowLeft } from '@/components/solid-icons';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** 图源循环顺序（右竖条一枚钮循环切换；label 是给 aria 与 tooltip 的短名）。 */
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

type SaveState = 'idle' | 'saving' | 'saved';

export type OutdoorPanelKind = 'layers' | 'info';

const headerButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--sc-ink, #141416)',
  border: '1px solid var(--sc-line, #e4e4e7)',
  borderRadius: 10,
  padding: '5px 10px',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: '20px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontFamily: 'inherit',
};

/** 右侧工具竖条圆钮：主产品右栏按钮语言（白底/发丝线/disc 圆钮/小字标签）。 */
const sideButtonStyle: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  width: 44,
  padding: '6px 0',
  borderRadius: 10,
  color: 'var(--sc-ink, #141416)',
  fontSize: 10,
  lineHeight: '12px',
  textAlign: 'center',
};

export interface OutdoorPlanOverlayProps {
  /** 草稿归属：layout.id（云项目 id 或本地活动 uuid）；null 落固定兜底槽。 */
  projectId: string | null;
  /** 活动点位（sceneAnchor/mapLngLat，GCJ-02）：仅用于底图初始定位，不写进 plan.anchor。 */
  anchor?: { lng: number; lat: number } | null;
  activityName?: string | null;
  /** 左栏当前卡片（左轨「图层/信息」钮控制；null = 左栏收起，浮窗回落画布内）。 */
  activePanel?: OutdoorPanelKind | null;
  onClose(): void;
}

export default function OutdoorPlanOverlay({ projectId, anchor, activityName, activePanel, onClose }: OutdoorPlanOverlayProps): JSX.Element {
  const slotId = projectId || LOCAL_DRAFT_SLOT;
  const [source, setSource] = useState<CanvasBasemapSource>('osm');
  const [plan, setPlan] = useState<SitePlanData | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [shareOpen, setShareOpen] = useState(false);
  const guide = useGuide(GUIDE_STORAGE_KEY);

  // 载入本机草稿：室内活动第一次开户外面用起步矩形（同户外项目口径）。
  useEffect(() => {
    const record = readOutdoorProjectRecord(slotId);
    setPlan(record?.plan ?? createStarterOutdoorPlan());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId]);

  // 保存管线：同户外项目工作台（400ms 防抖 + 卸载 flush），名字不在此层维护
  // （活动名以室内 layout.name 为准），信封 name 用活动名兜底。
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

  const stats = plan ? planOverviewStats(plan) : null;
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
      style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', flexDirection: 'column', background: 'var(--sc-surface, #ffffff)', color: 'var(--sc-ink, #141416)' }}
    >
      {/* 顶条（瘦身后）：只留返回 / 标题 / 保存态；工具与面板按主产品心智分居右竖条与左栏。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--sc-line, #e4e4e7)', background: 'var(--sc-surface, #ffffff)', flexShrink: 0 }}>
        <button
          type="button"
          data-testid="outdoor-overlay-back"
          onClick={onClose}
          title="返回 3D 场景"
          aria-label="返回 3D 场景"
          style={headerButtonStyle}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          返回 3D
        </button>
        <strong style={{ fontSize: 15, fontWeight: 600 }}>户外规划{activityName?.trim() ? ` · ${activityName.trim()}` : ''}</strong>
        <span role="status" data-testid="outdoor-save-state" style={{ color: 'var(--sc-text-secondary, #55585f)', fontSize: 12 }}>
          {saveState === 'saving' ? '保存中…' : savedAt ? `本机草稿 · 已存 ${savedAt}` : ''}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        {/* 左栏分栏：图层栈与编辑 / 规划信息两张卡片（左轨钮切换显隐；画布浮窗 portal 进对应宿主，
            隐藏卡片用 display:none 保活——切回来编辑状态不丢）。 */}
        <aside
          data-testid="outdoor-panel-rail"
          aria-label="户外规划面板"
          style={{ width: 288, flexShrink: 0, borderRight: '1px solid var(--sc-line, #e4e4e7)', background: 'var(--sc-surface, #ffffff)', display: activePanel ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}
        >
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--sc-line, #e4e4e7)', fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
            {activePanel === 'layers' ? '图层栈与编辑' : activePanel === 'info' ? '规划信息' : ''}
          </div>
          <div
            id="outdoor-panel-host-layers"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative', padding: 10, display: 'flex', flexDirection: 'column', gap: 10, ...(activePanel === 'layers' ? {} : { display: 'none' }) }}
          />
          <div
            id="outdoor-panel-host-info"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative', padding: 10, display: 'flex', flexDirection: 'column', gap: 10, ...(activePanel === 'info' ? {} : { display: 'none' }) }}
          />
        </aside>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
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
              {...(activePanel ? { panelsHostId: 'outdoor-panel-host-layers', infoPanelHostId: 'outdoor-panel-host-info' } : {})}
              {...(anchor ? { initialView: { lng: anchor.lng, lat: anchor.lat } } : {})}
            />
          )}
        </div>
        {/* 右侧工具竖条：图源 / 导出 / 引导（从顶条挪来，主产品右栏按钮语言）。 */}
        <aside
          data-testid="outdoor-side-tools"
          aria-label="户外规划工具"
          style={{ width: 56, flexShrink: 0, borderLeft: '1px solid var(--sc-line, #e4e4e7)', background: 'var(--sc-surface, #ffffff)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 6px', overflowY: 'auto' }}
        >
          <button
            type="button"
            style={{ ...sideButtonStyle, color: 'var(--sc-green, #4a7c59)' }}
            aria-label={`底图图源：${currentSource.label}（点击切换）`}
            data-testid="outdoor-source-cycle"
            title={`底图图源：${currentSource.label}（点击切换）`}
            onClick={cycleSource}
          >
            <span style={{ fontSize: 11, fontWeight: 600, width: 32 }}>{currentSource.short}</span>
            <span>图源</span>
          </button>
          <ExportMenu enableExports onPick={pickExport} />
          {guide.activeStep === null && (
            <button type="button" style={sideButtonStyle} onClick={guide.restart} title="重看首次开图引导" aria-label="重看首次开图引导">
              <span style={{ fontSize: 14 }}>?</span>
              <span>引导</span>
            </button>
          )}
        </aside>
      </div>
      {plan && stats && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          content={shareDialogContent({
            revision: 1,
            updatedAt: savedAt ?? new Date().toLocaleString('zh-CN', { hour12: false }),
            counts: { zones: stats.zoneCount, facilities: stats.facilityCount, routes: plan.routes.length, workers: stats.workerTotalCount },
          })}
          shareLink={shareLink}
          onPrintDeck={() => {
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
