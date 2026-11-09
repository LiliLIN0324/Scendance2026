'use client';

/**
 * 户外 2D 规划满铺画布演示页（H2-a 验收入口）。
 *
 * 独立路由：不动主工作台（`/editor`）与探针页（`/tdt-probe`）。
 * 内置一份「平湖秋月市集」样例 SitePlanData（符合 site-plan 契约），
 * 消费 OutdoorPlanCanvas 组件：OSM 真瓦片底图 + 六类业务图层 + 图层栈开关。
 */

import { useState } from 'react';
import OutdoorPlanCanvas, { type CanvasBasemapSource } from '@/components/room-organizer/components/outdoor-plan-canvas';
import type { SitePlanData } from '../../../supabase/functions/_shared/site-plan';

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

export default function OutdoorPlanPage() {
  const [source, setSource] = useState<CanvasBasemapSource>('osm');

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f1620', color: '#e7edf5', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#182230', borderBottom: '1px solid #24334a' }}>
        <h1 style={{ fontSize: 15, margin: 0 }}>户外 2D 规划画布（H2-a）</h1>
        <small style={{ color: '#93a4bc' }}>SitePlan 数据 · 六类图层栈 · 公开源真瓦片底图</small>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
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
        <OutdoorPlanCanvas plan={SAMPLE_PLAN} source={source} />
      </div>
    </main>
  );
}