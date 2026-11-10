'use client';

/**
 * 户外规划工作台（P2-a · 融壳版）：**拆掉独立页壳，融进主产品工作台**——
 * 复用主壳同款 DOM 与全局 CSS（sc-workbench / sc-header / sc-workspace /
 * sc-mode-rail grid 布局）：品牌钮、设置、保存态（rail-foot draftFoot 同款）、
 * 「项目」入口都在主产品左轨的原位，只有中央画布从 3D 场景换成 2D 地图规划。
 *
 * 与室内的关系（用户「一体两面」定位）：同一张工作台，场地在室内用平面图，
 * 在户外用地图。户外功能面板（规划信息/图层栈/设施模板）第一版仍由画布自带
 * （H3-c/H4-a，视觉上就在左栏位置）；P2-b 再把它们迁进左轨面板体系。
 *
 * 挂载点在 workspace-shell：户外项目不挂 RoomOrganizer（不初始化 three），
 * 判定见 lib/outdoor-project-store 的 resolveOutdoorProjectId。
 * 草稿按 projectId 落 localStorage（400ms 防抖，schema 校验），保存态如实标
 * 「本机草稿」——云端规划子资源表归 B 评审（评审稿 §7.1），接线后替换存储层。
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
import { WorkbenchBrandToggle } from '@/components/room-organizer/panels/workbench-brand-toggle';
import { SettingsMenu } from '@/components/room-organizer/panels/settings-menu';
import { ArrowLeft, FolderOpen } from '@/components/solid-icons';
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

/** 顶栏 ghost 钮：与主产品白底发丝线语言一致。 */
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
    <div className="sc-workbench" data-testid="outdoor-workbench">
      {/* 顶栏（主产品 sc-header 同款）：左=返回/活动名，右=引导/图源/导出/统计徽标。 */}
      <div className="sc-header" data-testid="outdoor-header">
        <button
          type="button"
          data-testid="outdoor-back"
          onClick={() => router.push('/projects')}
          title="返回项目列表"
          aria-label="返回项目列表"
          style={{ ...headerButtonStyle, border: 'none', paddingLeft: 6, paddingRight: 6 }}
        >
          <ArrowLeft size={16} aria-hidden="true" />
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
            color: 'var(--sc-ink, #141416)',
            border: '1px solid transparent',
            borderRadius: 8,
            padding: '4px 8px',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: 'inherit',
          }}
          onFocus={event => { event.currentTarget.style.borderColor = 'var(--sc-line, #e4e4e7)'; }}
          onBlur={event => { event.currentTarget.style.borderColor = 'transparent'; }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {guide.activeStep === null && (
            <button type="button" onClick={guide.restart} title="重看首次开图引导" style={headerButtonStyle}>
              重看引导
            </button>
          )}
          <select
            aria-label="底图图源"
            value={source}
            onChange={event => setSource(event.target.value as CanvasBasemapSource)}
            style={{ background: 'var(--sc-plane, #f4f5f7)', color: 'var(--sc-ink, #141416)', border: '1px solid var(--sc-line, #e4e4e7)', borderRadius: 10, padding: '5px 10px', fontSize: 13, fontFamily: 'inherit' }}
          >
            {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <ExportMenu enableExports onPick={pickExport} />
          {stats && (
            <span
              role="status"
              data-testid="plan-overview-stats"
              style={{ marginLeft: 4, padding: '2px 8px', borderRadius: 4, background: 'var(--sc-plane, #f4f5f7)', color: 'var(--sc-green, #4a7c59)', fontSize: 11, lineHeight: '18px', fontFamily: 'inherit' }}
            >
              场地 {Math.round(stats.boundaryAreaM2).toLocaleString('zh-CN')} m² · 分区 {stats.zoneCount} · 设施 {stats.facilityCount} · 动线 {formatLengthM(stats.routeLengthTotalM)} · 人员 {stats.workerTotalCount} 人 · <span data-testid="conflict-count" style={{ color: stats.conflictCount > 0 ? 'var(--sc-err, #b4443c)' : 'inherit' }}>冲突/缺失 {stats.conflictCount}</span>
            </span>
          )}
        </div>
      </div>
      {/* 主区（主产品 grid 同款）：左轨 + 中央画布。 */}
      <main data-nav="collapsed" className="sc-workspace is-docked-layout is-mode-rail">
        <div className="sc-mode-rail" id="sc-agent-rail" data-mobile-open="false">
          <div className="sc-rail-head">
            <WorkbenchBrandToggle expanded={false} onToggle={() => router.push('/projects')} />
          </div>
          {/* 户外能力面板（规划信息/图层栈/设施）第一版由画布自带（视觉上就在左栏位）；
              P2-b 迁进左轨面板体系后这里排「图层/设施/信息」钮。 */}
          <div className="sc-mode-rail-foot">
            <p role="status" className={`sc-rail-draft${saveState === 'saving' ? '' : ''}`} data-testid="outdoor-save-state" title="户外规划草稿保存在本机；云端规划表接线后自动同步">
              {saveState === 'saving' ? '保存中…' : savedAt ? `本机草稿 · 已存 ${savedAt}` : ''}
            </p>
            <button
              type="button"
              className="sc-rail-settings"
              aria-label="项目列表"
              data-tip="项目"
              onClick={() => router.push('/projects')}
            >
              <FolderOpen size={22} aria-hidden="true" />
            </button>
            <SettingsMenu />
          </div>
        </div>
        <div className="sc-canvas-stage" style={{ position: 'relative' }}>
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
      </main>
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
    </div>
  );
}
