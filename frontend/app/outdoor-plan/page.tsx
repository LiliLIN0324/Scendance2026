'use client';

/**
 * 户外 2D 规划满铺画布演示页（H2-a 验收入口 + H2-b 编辑演示 + H2-c 设施 + H2-d 动线/节点/人员）。
 *
 * 独立路由：不动主工作台（`/editor`）与探针页（`/tdt-probe`）。
 * 内置一份「平湖秋月市集」样例 SitePlanData（符合 site-plan 契约，样例动线
 * 已接端点节点引用），消费 OutdoorPlanCanvas 组件：OSM 真瓦片底图 + 六类业务图层 + 图层栈开关。
 *
 * H2-b：plan 状态提升到本页，编辑（画边界/拖顶点/画分区/改样式）经 onPlanChange
 * 回写；草稿按 schema 校验后存 localStorage——**刷新重开保留点列**（验收口径），
 * 「重置样例」一键回到初始样例。云端版本化存储接线仍归 H1-b/H2-c 后续卡。
 */

import { useEffect, useState } from 'react';
import OutdoorPlanCanvas, { type CanvasBasemapSource } from '@/components/room-organizer/components/outdoor-plan-canvas';
import { sitePlanDataSchema, type SitePlanData } from '../../../supabase/functions/_shared/site-plan';

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
      startNodeId: 'd4000000-0000-4000-8000-000000000002',
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
        <h1 style={{ fontSize: 15, margin: 0 }}>户外 2D 规划画布（H2-d）</h1>
        <small style={{ color: '#93a4bc' }}>三类动线 · 出入口节点 · 人员布点汇总 · 刷新保留草稿</small>
        <span style={{ color: '#7fb69a', fontSize: 12 }} data-testid="draft-saved">
          {savedAt ? `草稿已存 ${savedAt}` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
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
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <OutdoorPlanCanvas plan={plan} source={source} onPlanChange={setPlan} />
      </div>
    </main>
  );
}
