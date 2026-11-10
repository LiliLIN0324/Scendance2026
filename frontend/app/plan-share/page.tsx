'use client';

/**
 * 只读分享页（H5-b）——接收方视角。
 *
 * 口径（评审稿 §11）：链接绑定一份快照（r{revision}），接收方只读——
 * 不可编辑、无编辑工具、无草稿落盘；「撤销即失效」由发布方撤回分享实现，
 * 本页在快照缺失/非法时如实展示「分享不存在或已失效」。
 *
 * 本地演示：快照经 URL `#snapshot=<base64url JSON>` 传递（无后端的形态验证）；
 * 生产接线归 B（快照表+token），本页消费接口与生产一致（SitePlanSnapshot）。
 */

import { useMemo, useState } from 'react';
import type { SitePlanSnapshot } from '../../../supabase/functions/_shared/site-plan';
import OutdoorPlanCanvas, { type CanvasBasemapSource } from '@/components/room-organizer/components/outdoor-plan-canvas';
import { formatLengthM, planOverviewStats } from '@/components/room-organizer/lib/site-plan-measure';
import { buildPlanLegend } from '@/components/room-organizer/lib/site-plan-legend';

import { readSnapshotFromHash } from '@/components/room-organizer/lib/site-plan-share';

const SOURCES: { id: CanvasBasemapSource; label: string }[] = [
  { id: 'osm', label: 'OSM 街道' },
  { id: 'carto-light', label: 'Carto 浅色' },
  { id: 'carto-dark', label: 'Carto 深色' },
];

/** 演示用样例快照（发布方入口 /outdoor-plan 生成链接；此处兜底展示）。 */
const DEMO_SNAPSHOT: SitePlanSnapshot = {
  planId: '99999999-9999-4999-8999-999999999999',
  projectId: '88888888-8888-4888-8888-888888888888',
  revision: 1,
  updatedAt: '2026-11-10T14:00:00.000Z',
  data: {
    schemaVersion: 1,
    anchor: { lng: 120.1460368, lat: 30.2521924, crs: 'gcj-02', source: 'picker' },
    boundary: [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 },
    ],
    zones: [
      {
        id: 'a1000000-0000-4000-8000-000000000001', semantic: 'audience', name: '观众区',
        polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }],
        color: '#7fb69a', notes: '',
      },
      {
        id: 'a1000000-0000-4000-8000-000000000002', semantic: 'stage', name: '舞台区',
        polygon: [{ x: 110, y: 12 }, { x: 150, y: 12 }, { x: 150, y: 42 }, { x: 110, y: 42 }],
        color: '#c98a2c', notes: '',
      },
    ],
    facilities: [
      { id: 'b2000000-0000-4000-8000-000000000001', templateId: 'booth-2x2', name: '市集摊位', position: { x: 60, y: 80 }, rotationDeg: 0, size: { width: 2, depth: 2 }, notes: '' },
    ],
    routes: [
      { id: 'c3000000-0000-4000-8000-000000000001', kind: 'pedestrian', name: '入场动线', points: [{ x: 0, y: 60 }, { x: 55, y: 60 }, { x: 55, y: 30 }], oneWay: true, notes: '' },
    ],
    nodes: [
      { id: 'd4000000-0000-4000-8000-000000000001', kind: 'entry', name: '西门', position: { x: 0, y: 60 }, notes: '' },
    ],
    workers: [
      { id: 'e5000000-0000-4000-8000-000000000001', role: '安保', count: 2, position: { x: 3, y: 57 }, notes: '' },
    ],
    measurements: [],
  },
};

export default function PlanSharePage() {
  const [source, setSource] = useState<CanvasBasemapSource>('osm');
  // hash 快照在 SSR 无 window——首帧后读取；非法/缺失回落演示快照并如实标注。
  const [snapshot] = useState<SitePlanSnapshot | null>(() =>
    typeof window === 'undefined' ? null : (readSnapshotFromHash(window.location.hash) ?? DEMO_SNAPSHOT));
  const [isDemo] = useState(() =>
    typeof window === 'undefined' ? true : readSnapshotFromHash(window.location.hash) === null);

  const stats = useMemo(() => (snapshot ? planOverviewStats(snapshot.data) : null), [snapshot]);
  const legend = useMemo(() => (snapshot ? buildPlanLegend(snapshot.data) : []), [snapshot]);

  if (!snapshot || !stats) {
    return (
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#ffffff', color: '#141416', fontFamily: 'inherit' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 18 }}>分享不存在或已失效</h1>
          <p style={{ color: '#71767e', fontSize: 13 }}>快照缺失或校验未通过。链接可能已被发布方撤销。</p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#ffffff', color: '#141416', fontFamily: 'inherit' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#ffffff', borderBottom: '1px solid #e4e4e7' }}>
        <h1 style={{ fontSize: 15, margin: 0 }}>只读规划分享</h1>
        <small style={{ color: '#71767e' }}>
          快照 r{snapshot.revision} · {new Date(snapshot.updatedAt).toLocaleString('zh-CN', { hour12: false })}
          {isDemo && ' · 演示快照'}
        </small>
        <span style={{ color: '#55585f', fontSize: 12 }}>
          场地 {Math.round(stats.boundaryAreaM2).toLocaleString('zh-CN')} m² · 分区 {stats.zoneCount} · 设施 {stats.facilityCount} · 动线 {formatLengthM(stats.routeLengthTotalM)} · 人员 {stats.workerTotalCount} 人
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <select
            aria-label="底图图源"
            value={source}
            onChange={event => setSource(event.target.value as CanvasBasemapSource)}
            style={{ background: '#f4f5f7', color: '#141416', border: '1px solid #e4e4e7', borderRadius: 10, padding: '5px 10px' }}
          >
            {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* 只读：不传 onPlanChange——画布无编辑入口；图层面板仍可用（查看需要）。 */}
        <OutdoorPlanCanvas plan={snapshot.data} source={source} />
      </div>
      <footer style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '8px 14px', background: '#ffffff', borderTop: '1px solid #e4e4e7', fontSize: 12, color: '#71767e', flexWrap: 'wrap' }}>
        {legend.map(group => (
          <span key={group.title} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {group.entries.map(entry => (
              <span key={entry.label} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 8 }}>
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: entry.swatch, display: 'inline-block' }} />
                {entry.label}×{entry.count}
              </span>
            ))}
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }}>接收方只读 · 底图 © OpenStreetMap contributors</span>
      </footer>
    </main>
  );
}




