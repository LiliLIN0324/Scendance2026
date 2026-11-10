'use client';

/**
 * 户外 2D 规划满铺画布演示页（H2-a 验收入口 + H2-b 编辑演示 + H2-c 设施 + H2-d 动线/节点/人员 + H3-a 测量/派生统计 + H3-b 冲突规则 + H3-c 规划信息面板/图例 + H4-a 视觉复刻）。
 *
 * 独立路由：不动主工作台（`/editor`）与探针页（`/tdt-probe`）。
 * 内置一份「平湖秋月市集」样例 SitePlanData（符合 site-plan 契约，样例动线
 * 已接端点节点引用），消费 OutdoorPlanCanvas 组件：OSM 真瓦片底图 + 业务图层 + 图层栈开关。
 *
 * H2-b：plan 状态提升到本页，编辑经 onPlanChange 回写；草稿按 schema 校验后存
 * localStorage——**刷新重开保留点列**（验收口径），「重置样例」一键回到初始样例。
 *
 * H3-b：冲突与缺失规则（人车交叉/越界/容量/缺宽度）随编辑实时跑——可定位标记
 * 直接画在画布上（红=冲突、橙=缺宽度、灰=容量待核实），单击标记定位到关联动线；
 * 样例自带一组人车交叉 + 一条缺宽度的后勤动线 + 观众区容量估算（规划假设，待核实）。
 *
 * H3-a：顶栏常驻派生统计（场地面积/分区/设施/动线全长/人员/固定测量，planOverviewStats
 * 现算，隐藏图层不改变统计）；测量在画布「测量」模式内进行（临时读数 + 固定测量落盘）。
 *
 * H3-c：画布左栏「规划信息」面板（总览/清单/问题/图例四页签）：清单支持
 * 类型 × 所属区 × 只看问题筛选，点行/问题条定位地图、点地图对象同步聚焦清单；
 * 图例由 site-plan-legend 生成器按实体类型自动生成（图标+名称+数量）。
 */

import { useEffect, useState } from 'react';
import OutdoorPlanCanvas, { type CanvasBasemapSource } from '@/components/room-organizer/components/outdoor-plan-canvas';
import { sitePlanDataSchema, type SitePlanData } from '../../../supabase/functions/_shared/site-plan';
import { formatLengthM, planOverviewStats } from '@/components/room-organizer/lib/site-plan-measure';
import { ExportMenu, GuideBubble, ShareDialog, useGuide } from '@/components/room-organizer/components/outdoor-plan-interactions';
import { GUIDE_STEPS, shareDialogContent } from '@/components/room-organizer/lib/site-plan-guide';
import { downloadPlanCsv } from '@/components/room-organizer/lib/site-plan-csv';
import { downloadPlanPng, composePlanPng } from '@/components/room-organizer/lib/site-plan-png';
import { buildShareLink } from '@/components/room-organizer/lib/site-plan-share';
import { printPlanDeck } from '@/components/room-organizer/lib/site-plan-pdf';
import { downloadPlanGeoJson } from '@/components/room-organizer/lib/site-plan-geojson';

/** 样例：平湖秋月周边 200×120 m 市集（锚点 GCJ-02，来自既有 XIHU_LOCAL_CENTER）。 */
const SAMPLE_PLAN: SitePlanData = {
  schemaVersion: 1,
  anchor: { lng: 120.1460368, lat: 30.2521924, crs: 'gcj-02', source: 'picker' },
  boundary: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 120 },
    { x: 0, y: 120 },
  ],
  zones: [
    {
      id: 'a1000000-0000-4000-8000-000000000001',
      semantic: 'audience',
      name: '观众区',
      polygon: [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 90, y: 55 },
        { x: 10, y: 55 },
      ],
      color: '#7fb69a',
      notes: '',
    },
    {
      id: 'a1000000-0000-4000-8000-000000000002',
      semantic: 'stage',
      name: '舞台区',
      polygon: [
        { x: 110, y: 12 },
        { x: 150, y: 12 },
        { x: 150, y: 42 },
        { x: 110, y: 42 },
      ],
      color: '#c98a2c',
      notes: '',
    },
    {
      id: 'a1000000-0000-4000-8000-000000000003',
      semantic: 'queue',
      name: '排队区',
      polygon: [
        { x: 12, y: 70 },
        { x: 42, y: 70 },
        { x: 42, y: 108 },
        { x: 12, y: 108 },
      ],
      notes: '',
    },
  ],
  facilities: [
    {
      id: 'b2000000-0000-4000-8000-000000000001',
      templateId: 'booth-2x2',
      name: '市集摊位 A',
      position: { x: 60, y: 80 },
      rotationDeg: 0,
      size: { width: 2, depth: 2 },
      zoneId: 'a1000000-0000-4000-8000-000000000003',
      notes: '',
    },
    {
      id: 'b2000000-0000-4000-8000-000000000002',
      templateId: 'booth-2x2',
      name: '市集摊位 B',
      position: { x: 68, y: 80 },
      rotationDeg: 0,
      size: { width: 2, depth: 2 },
      zoneId: 'a1000000-0000-4000-8000-000000000003',
      notes: '',
    },
    {
      id: 'b2000000-0000-4000-8000-000000000003',
      templateId: 'tent-3x3',
      name: '后勤帐篷',
      position: { x: 180, y: 100 },
      rotationDeg: 15,
      size: { width: 3, depth: 3 },
      notes: '',
    },
  ],
  routes: [
    {
      id: 'c3000000-0000-4000-8000-000000000001',
      kind: 'pedestrian',
      name: '入场动线',
      points: [
        { x: 0, y: 60 },
        { x: 55, y: 60 },
        { x: 55, y: 30 },
      ],
      oneWay: true,
      startNodeId: 'd4000000-0000-4000-8000-000000000001',
      notes: '',
    },
    {
      id: 'c3000000-0000-4000-8000-000000000002',
      kind: 'vehicle',
      name: '装卸动线',
      points: [
        { x: 200, y: 60 },
        { x: 160, y: 60 },
        { x: 160, y: 95 },
      ],
      oneWay: false,
      widthM: 4,
      startNodeId: 'd4000000-0000-4000-8000-000000000002',
      notes: '',
    },
    {
      id: 'c3000000-0000-4000-8000-000000000003',
      kind: 'service',
      name: '后勤电瓶车动线',
      points: [
        { x: 20, y: 10 },
        { x: 70, y: 70 },
      ],
      oneWay: false,
      notes: '',
    },
  ],
  nodes: [
    {
      id: 'd4000000-0000-4000-8000-000000000001',
      kind: 'entry',
      name: '西门',
      position: { x: 0, y: 60 },
      notes: '',
    },
    {
      id: 'd4000000-0000-4000-8000-000000000002',
      kind: 'exit',
      name: '东出口',
      position: { x: 200, y: 60 },
      notes: '',
    },
  ],
  workers: [
    {
      id: 'e5000000-0000-4000-8000-000000000001',
      role: '安保',
      count: 2,
      position: { x: 3, y: 57 },
      zoneId: 'a1000000-0000-4000-8000-000000000003',
      notes: '',
    },
    {
      id: 'e5000000-0000-4000-8000-000000000002',
      role: '引导员',
      count: 1,
      position: { x: 195, y: 97 },
      notes: '',
    },
  ],
};

const SOURCES: { id: CanvasBasemapSource; label: string }[] = [
  { id: 'osm', label: 'OSM 街道' },
  { id: 'carto-light', label: 'Carto 浅色' },
  { id: 'carto-dark', label: 'Carto 深色' },
  { id: 'vec', label: '天地图矢量（待 key）' },
  { id: 'img', label: '天地图影像（待 key）' },
];

const DRAFT_STORAGE_KEY = 'outdoor-plan-h2b-draft-v1';

/** 载入本地草稿：schema 校验失败/无草稿时回落样例（旧草稿结构不兼容不硬崩）。 */
function loadDraftPlan(): SitePlanData {
  if (typeof window === 'undefined') return SAMPLE_PLAN;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return SAMPLE_PLAN;
    const parsed = sitePlanDataSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : SAMPLE_PLAN;
  } catch {
    return SAMPLE_PLAN;
  }
}


export default function OutdoorPlanPage() {
  const [source, setSource] = useState<CanvasBasemapSource>('osm');
  const [plan, setPlan] = useState<SitePlanData>(loadDraftPlan);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // H5-b：本地分享链接（快照 base64url 进 hash；生产接线归 B 换 token）。
  const shareLink = buildShareLink(
    { planId: '99999999-9999-4999-8999-999999999999', projectId: '88888888-8888-4888-8888-888888888888', revision: 1, updatedAt: new Date().toISOString(), data: plan },
    typeof window === 'undefined' ? '' : window.location.origin,
    '/plan-share',
  );
  // H4-b：首次开图渐进引导（localStorage 持久化，跳过/完成后二刷不打扰）。
  const guide = useGuide('outdoor-plan-guide-v1');
  // H3-a：全案派生统计（现算不落盘；隐藏图层不改变这里的数字）。
  const stats = planOverviewStats(plan);

  // 刷新重开保留点列：每次编辑后把整份 plan 落 localStorage（带 schema 校验回读）。
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(plan));
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch {
      // 存储满/隐私模式：演示页静默降级，编辑仍可用（刷新后回样例）。
    }
  }, [plan]);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f1620', color: '#e7edf5', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#182230', borderBottom: '1px solid #24334a' }}>
        <h1 style={{ fontSize: 15, margin: 0 }}>户外 2D 规划画布（H4-b）</h1>
        <small style={{ color: '#93a4bc' }}>交互复刻 · 渐进引导 · 导出菜单 · 毛玻璃分享</small>
        <span style={{ color: '#7fb69a', fontSize: 12 }} data-testid="plan-overview-stats">
          场地 {Math.round(stats.boundaryAreaM2).toLocaleString('zh-CN')} m² · 分区 {stats.zoneCount} · 设施 {stats.facilityCount} · 动线 {formatLengthM(stats.routeLengthTotalM)} · 人员 {stats.workerTotalCount} 人 · 测量 {stats.measurementCount} · <span data-testid="conflict-count" style={{ color: stats.conflictCount > 0 ? '#e8a3a3' : '#7fb69a' }}>冲突/缺失 {stats.conflictCount}</span>
        </span>
        <span style={{ color: '#7fb69a', fontSize: 12 }} data-testid="draft-saved">
          {savedAt ? `草稿已存 ${savedAt}` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {guide.activeStep === null && (
            <button
              type="button"
              onClick={guide.restart}
              title="重看首次开图引导"
              style={{ background: '#24334a', color: '#e7edf5', border: '1px solid #35485f', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
            >
              重看引导
            </button>
          )}
          <button
            type="button"
            onClick={() => setPlan(SAMPLE_PLAN)}
            style={{ background: '#24334a', color: '#e7edf5', border: '1px solid #35485f', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
          >
            重置样例
          </button>
          <select
            aria-label="底图图源"
            value={source}
            onChange={event => setSource(event.target.value as CanvasBasemapSource)}
            style={{ background: '#24334a', color: '#e7edf5', border: '1px solid #35485f', borderRadius: 6, padding: '5px 10px' }}
          >
            {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <ExportMenu
            enableExports
            onPick={id => {
              if (id === 'share') { setShareOpen(true); return; }
              if (id === 'csv') { downloadPlanCsv(plan, 'pinghu-market'); return; }
              if (id === 'geojson') { downloadPlanGeoJson(plan, 'pinghu-market'); return; }
              if (id === 'png') {
                // PNG 快照复用画布当前渲染的业务层 canvas（画布组件第二个 canvas）。
                const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
                const planCanvas = canvases[canvases.length - 1];
                if (planCanvas) downloadPlanPng({ plan, planCanvas, revision: 1, dpi: 300 });
              }
            }}
          />
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
        <OutdoorPlanCanvas plan={plan} source={source} onPlanChange={setPlan} />
      </div>
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
          // PDF 演示稿：合成快照图（72 DPI 嵌封面）+ 打印管线（另存为 PDF 本地下载）。
          const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
          const planCanvas = canvases[canvases.length - 1];
          const pngCanvas = planCanvas
            ? composePlanPng({ plan, planCanvas, revision: 1, dpi: 72 })
            : undefined;
          printPlanDeck(
            { planId: '99999999-9999-4999-8999-999999999999', projectId: '88888888-8888-4888-8888-888888888888', revision: 1, updatedAt: new Date().toISOString(), data: plan },
            pngCanvas?.toDataURL('image/png'),
          );
        }}
      />
    </main>
  );
}








