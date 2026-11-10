'use client';

/**
 * 户外规划工作台（Phase 2 · P2-a）：户外项目在主产品里的 2D 规划壳——
 * 顶栏「返回项目 / 活动名 / 保存态 / 导出」+ 满幅 OutdoorPlanCanvas。
 *
 * 挂载点在 workspace-shell（非 room-organizer 内部）：户外项目**完全不挂**
 * 室内 RoomOrganizer，不初始化 three 场景。判定逻辑见 lib/outdoor-project-store
 * 的 resolveOutdoorProjectId（?start=outdoor 硬跳 / 本机有该项目的户外草稿）。
 *
 * 草稿按 projectId 落 localStorage（400ms 防抖，schema 校验），保存态如实标
 * 「本机草稿」——云端规划子资源表归 B 评审（评审稿 §7.1），接线后替换存储层。
 * 交互与引导复用 H 批组件（OutdoorPlanCanvas / ExportMenu / ShareDialog /
 * GuideBubble），引导 key 与演示页共用（同一心智，看过不再弹）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import OutdoorPlanCanvas, { type CanvasBasemapSource } from '@/components/room-organizer/components/outdoor-plan-canvas';
import { ExportMenu, GuideBubble, ShareDialog, useGuide } from '@/components/room-organizer/components/outdoor-plan-interactions';
import { GUIDE_STEPS, shareDialogContent } from '@/components/room-organizer/lib/site-plan-guide';
import { formatLengthM, planOverviewStats } from '@/components/room-organizer/lib/site-plan-measure';
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
import type { BackendSession } from '@/lib/backend-session';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const SOURCES: { id: CanvasBasemapSource; label: string }[] = [
  { id: 'osm', label: 'OSM 街道' },
  { id: 'carto-light', label: 'Carto 浅色' },
  { id: 'carto-dark', label: 'Carto 深色' },
  { id: 'vec', label: '天地图矢量（待 key）' },
  { id: 'img', label: '天地图影像（待 key）' },
];

const AUTOSAVE_DEBOUNCE_MS = 400;
const GUIDE_STORAGE_KEY = 'outdoor-plan-guide-v1';

type SaveState = 'idle' | 'saving' | 'saved';

const buttonStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#141416',
  border: '1px solid #e4e4e7',
  borderRadius: 10,
  padding: '5px 10px',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: '20px',
};

export default function OutdoorPlanWorkspace({ projectId, controller }: { projectId: string; controller?: BackendSession }): JSX.Element {
  const router = useRouter();
  const [source, setSource] = useState<CanvasBasemapSource>('osm');
  const [plan, setPlan] = useState<SitePlanData | null>(null);
  const [name, setName] = useState('');
  const [cloudName, setCloudName] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [shareOpen, setShareOpen] = useState(false);
  // H4-b 引导与演示页共用一个 key：看过的人进工作台不再弹。
  const guide = useGuide(GUIDE_STORAGE_KEY);

  // 载入本机草稿：无记录（直链 start=outdoor 情形）用起步矩形，并补一条 meta。
  useEffect(() => {
    const record = readOutdoorProjectRecord(projectId);
    setPlan(record?.plan ?? createStarterOutdoorPlan());
    setName(record?.name ?? '');
    if (!record) {
      const now = new Date().toISOString();
      saveOutdoorProjectRecord({ v: 1, projectId, name: cloudName || '户外规划', createdAt: now, updatedAt: now, plan: null });
    }
    // cloudName 故意不在 deps：兜底名只在首次建记录时用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 云端项目名兜底（拿不到就静默用本机名/占位）。
  useEffect(() => {
    if (!controller) return;
    let active = true;
    void controller.getProject(projectId)
      .then(project => { if (active) setCloudName(project.name); })
      .catch(() => { /* 访客/离线：顶栏用本机名。 */ });
    return () => { active = false; };
  }, [controller, projectId]);

  // 保存管线：plan/名字变化 400ms 防抖落盘；卸载时把挂起的保存立即写掉。
  const planRef = useRef<SitePlanData | null>(plan);
  const nameRef = useRef(name);
  planRef.current = plan;
  nameRef.current = name;
  const pendingSaveRef = useRef<number | null>(null);
  const flushSave = useCallback(() => {
    const current = planRef.current;
    if (current == null) return;
    const record = readOutdoorProjectRecord(projectId);
    saveOutdoorProjectRecord({
      v: 1,
      projectId,
      name: nameRef.current.trim() || record?.name || '户外规划',
      createdAt: record?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: current,
    });
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    setSaveState('saved');
  }, [projectId]);
  useEffect(() => {
    if (plan == null) return; // 载入中不触发保存。
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      pendingSaveRef.current = null;
      flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    pendingSaveRef.current = timer;
    return () => { window.clearTimeout(timer); };
  }, [plan, name, flushSave]);
  useEffect(() => () => {
    if (pendingSaveRef.current !== null) flushSave();
  }, [flushSave]);

  const stats = plan ? planOverviewStats(plan) : null;
  const shareLink = plan
    ? buildShareLink(
      { planId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '99999999-9999-4999-8999-999999999999',
        projectId, revision: 1, updatedAt: new Date().toISOString(), data: plan },
      typeof window === 'undefined' ? '' : window.location.origin,
      '/plan-share',
    )
    : '';

  function pickExport(id: string): void {
    if (!plan) return;
    const stem = name.trim() || cloudName || 'outdoor-plan';
    if (id === 'share') { setShareOpen(true); return; }
    if (id === 'csv') { downloadPlanCsv(plan, stem); return; }
    if (id === 'geojson') { downloadPlanGeoJson(plan, stem); return; }
    if (id === 'png') {
      const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
      const planCanvas = canvases[canvases.length - 1];
      if (planCanvas) downloadPlanPng({ plan, planCanvas, revision: 1, dpi: 300 });
    }
  }

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#ffffff', color: '#141416', fontFamily: 'inherit' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#ffffff', borderBottom: '1px solid #e4e4e7' }}>
        <button
          type="button"
          data-testid="outdoor-back"
          onClick={() => router.push('/projects')}
          title="返回项目列表"
          aria-label="返回项目列表"
          style={{ ...buttonStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          返回项目
        </button>
        <input
          data-testid="outdoor-plan-name"
          value={name}
          maxLength={120}
          onChange={event => setName(event.target.value)}
          placeholder={cloudName || '户外活动名'}
          aria-label="活动名"
          style={{
            width: 220,
            background: 'transparent',
            color: '#141416',
            border: '1px solid transparent',
            borderRadius: 8,
            padding: '4px 8px',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: 'inherit',
          }}
          onFocus={event => { event.currentTarget.style.borderColor = '#e4e4e7'; }}
          onBlur={event => { event.currentTarget.style.borderColor = 'transparent'; }}
        />
        <span data-testid="outdoor-save-state" role="status" style={{ color: saveState === 'saved' ? '#55585f' : '#71767e', fontSize: 12 }}>
          {saveState === 'saving' ? '保存中…' : savedAt ? `本机草稿 · 已存 ${savedAt}` : ''}
        </span>
        {stats && (
          <span style={{ color: '#55585f', fontSize: 12 }} data-testid="plan-overview-stats">
            场地 {Math.round(stats.boundaryAreaM2).toLocaleString('zh-CN')} m² · 分区 {stats.zoneCount} · 设施 {stats.facilityCount} · 动线 {formatLengthM(stats.routeLengthTotalM)} · 人员 {stats.workerTotalCount} 人 · 测量 {stats.measurementCount} · <span data-testid="conflict-count" style={{ color: stats.conflictCount > 0 ? '#b4443c' : '#4a7c59' }}>冲突/缺失 {stats.conflictCount}</span>
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {guide.activeStep === null && (
            <button type="button" onClick={guide.restart} title="重看首次开图引导" style={buttonStyle}>
              重看引导
            </button>
          )}
          <select
            aria-label="底图图源"
            value={source}
            onChange={event => setSource(event.target.value as CanvasBasemapSource)}
            style={{ background: '#f4f5f7', color: '#141416', border: '1px solid #e4e4e7', borderRadius: 10, padding: '5px 10px', fontSize: 13, fontFamily: 'inherit' }}
          >
            {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <ExportMenu enableExports onPick={pickExport} />
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {guide.activeStep && (
          <GuideBubble
            step={guide.activeStep}
            stepIndex={GUIDE_STEPS.indexOf(guide.activeStep)}
            totalSteps={GUIDE_STEPS.length}
            onComplete={() => guide.complete(guide.activeStep as (typeof GUIDE_STEPS)[number])}
            onDismiss={guide.dismiss}
          />
        )}
        {plan && <OutdoorPlanCanvas plan={plan} source={source} onPlanChange={setPlan} />}
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
                projectId, revision: 1, updatedAt: new Date().toISOString(), data: plan },
              pngCanvas?.toDataURL('image/png'),
            );
          }}
        />
      )}
    </main>
  );
}
