'use client';

/**
 * 复刻案例对比报告（内部验收页，不进导航）：OnePlan 原图 | 我们 2D 离线渲染 | 我们 3D 截图 三联。
 *
 * - 2D：`lib/outdoor-plan-canvas.ts` 的 draw* 纯函数离线画（纸面底，无瓦片/无网络）；
 * - 3D：`three/plan-footprint-builder.ts` `buildPlanFootprint` 同源管线（跳 GLB 模型层与瓦片），
 *   共享一个 WebGL renderer 顺序出图（44 案不能各开一个 context）；
 * - OnePlan 原图：`/_internal-learning/`（dev-only 目录，.gitignore，版权归属 OnePlan 不对外）。
 * 「导出静态 HTML」把三联全部内嵌 dataURL 下载成单文件 report.html。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import {
  drawAccessLayer,
  drawBoundaryLayer,
  drawFacilityLayer,
  drawRouteLayer,
  drawZoneLayer,
  enuToLngLat,
  type PlanViewport,
} from '@/components/room-organizer/lib/outdoor-plan-canvas';
import { REPLICA_CASES, type ReplicaCase } from '@/components/room-organizer/lib/replica-cases';
import { ringFrame } from '@/components/room-organizer/three/plan-basemap-tiles';
import { buildPlanFootprint } from '@/components/room-organizer/three/plan-footprint-builder';
import type { SitePlanData } from '../../../supabase/functions/_shared/site-plan';

const VIEW_W = 520;
const VIEW_H = 340;

/** 离线画 2D 缩略：纸面底 + boundary/zone/facility/route/access 五层，返回 dataURL。 */
function capture2D(plan: SitePlanData): string {
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = VIEW_W * dpr;
  canvas.height = VIEW_H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#f5f6f7';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 包围盒（zone 顶点 + 设施 + 节点 + 边界），外扩 24% 留边
  const pts = [
    ...plan.boundary,
    ...plan.zones.flatMap(zone => zone.polygon),
    ...plan.facilities.map(f => f.position),
    ...plan.nodes.map(n => n.position),
  ];
  if (!pts.length) return '';
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  const spanM = Math.max(maxX - minX, maxY - minY) * 1.24;
  const cxM = (minX + maxX) / 2;
  const cyM = (minY + maxY) / 2;
  const anchor = plan.anchor;
  if (!anchor) return '';
  const mPerPx = spanM / Math.min(VIEW_W, VIEW_H);
  const zoom = Math.log2(40075016.686 * Math.cos(anchor.lat * Math.PI / 180) / (256 * mPerPx));
  const center = enuToLngLat(cxM, cyM, anchor.lng, anchor.lat);
  const viewport: PlanViewport = {
    lng: center.lng,
    lat: center.lat,
    zoom,
    canvasW: VIEW_W,
    canvasH: VIEW_H,
    anchorLng: anchor.lng,
    anchorLat: anchor.lat,
  };
  const c = { ctx, viewport };
  drawBoundaryLayer(c, plan.boundary);
  drawZoneLayer(c, plan.zones);
  drawFacilityLayer(c, plan.facilities);
  drawRouteLayer(c, plan.routes);
  drawAccessLayer(c, plan.nodes);
  return canvas.toDataURL('image/png');
}

/** 共享 three 场景顺序截 3D：每案重建场景（buildPlanFootprint 同源管线），返回 dataURL。 */
function make3DCapturer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(VIEW_W, VIEW_H);
  renderer.setPixelRatio(1);
  const camera = new THREE.PerspectiveCamera(45, VIEW_W / VIEW_H, 1, 50000);
  return function capture3D(plan: SitePlanData): string {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e8ecf0');
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a9199', 1.05));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(120, 260, 160);
    scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 40000),
      new THREE.MeshBasicMaterial({ color: '#dfe3e7' }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    let siteSpan = 0;
    if (plan.boundary.length >= 3) {
      const siteFrame = ringFrame(plan.boundary);
      siteSpan = siteFrame.span;
      const ok = buildPlanFootprint(THREE, scene, plan, { width: siteFrame.width, depth: siteFrame.depth }, { clampPoints: false });
      if (ok) {
        const group = scene.getObjectByName('plan-footprint');
        if (group) group.position.set(siteFrame.cx, 0, -siteFrame.cy);
      }
    }
    // 取景只对 plan-footprint 组，且排除「框外白纱蒙版」：
    // 1）地面 40000×40000 平板若算进 Box3，maxDim=40000 会把相机推到 ~72km 外（far=50000 之外），
    //    整帧只剩背景灰（实测踩坑 1）；
    // 2）kit 给每案补 designScope 后，builder 的框外白纱按 60× 场距铺（整块 120×），
    //    同样把 Box3 撑爆——45 案实测 22 案超 far 全裁、23 案只见地面板（实测踩坑 2）。
    //    蒙版带 userData.planDesignScopeMask（plan-footprint-builder），取景时跳过、渲染保留。
    // 3）兕底：无论未来组里混进什么超大物，相机距离不允许超过场地 span×1.35 对应值。
    const fpGroup = scene.getObjectByName('plan-footprint');
    let box = new THREE.Box3();
    if (fpGroup) {
      fpGroup.traverse(obj => {
        if (obj.userData && obj.userData.planDesignScopeMask) return;
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) box.expandByObject(obj);
      });
    }
    if (box.isEmpty()) box.setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 10);
    const capDim = siteSpan > 0 ? Math.max(siteSpan * 1.35, 12) : maxDim;
    const cappedDim = Math.min(maxDim, capDim);
    const distance = (cappedDim / 2) / Math.tan((45 / 2) * Math.PI / 180) * 1.5;
    camera.position.set(center.x + distance * 0.62, center.y + distance * 0.72, center.z + distance * 0.62);
    camera.lookAt(center.x, 0, center.z);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    // 逐案清理几何与材质（WebGL 资源随用随弃）
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat?.dispose();
    });
    return url;
  };
}

/** 参考图（同源）取回后压到 720px 宽 JPEG dataURL。原图 3–6MB PNG，44 案全内嵌会把
 *  导出 HTML 撑到 ~230MB（实测）；压缩后整份 ~15MB。页面展示与导出共用这一份。 */
async function refImageToDataUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 720 / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return '';
  }
}

type Row = {
  replica: ReplicaCase;
  refUrl: string;
  url2d: string;
  url3d: string;
};

export default function ReplicaReportPage(): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const capture3D = make3DCapturer();
    void (async () => {
      const out: Row[] = [];
      for (const replica of REPLICA_CASES) {
        const plan = replica.buildPlan();
        const refUrl = await refImageToDataUrl(`/_internal-learning/${replica.refImage}`);
        const url2d = capture2D(plan);
        const url3d = capture3D(plan);
        out.push({ replica, refUrl, url2d, url3d });
        setRows([...out]);
        setProgress(out.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    })();
  }, []);

  const exportHtml = useCallback(() => {
    const sections = rows.map(row => `
  <section class="case">
    <h2>${row.replica.title} <small>(${row.replica.category} · ${row.replica.region})</small></h2>
    <div class="tri">
      <figure><figcaption>OnePlan 原图（版权归 OnePlan，仅内部学习）</figcaption>${row.refUrl ? `<img src="${row.refUrl}"/>` : '<p class="missing">参考图缺失</p>'}</figure>
      <figure><figcaption>我们 · 2D 离线渲染</figcaption><img src="${row.url2d}"/></figure>
      <figure><figcaption>我们 · 3D（buildPlanFootprint 低模）</figcaption><img src="${row.url3d}"/></figure>
    </div>
    <p class="loc"><a href="${row.replica.refLink}">案例页</a>${row.replica.locationNote ? ` · ${row.replica.locationNote}` : ''}</p>
  </section>`).join('\n');
    const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"/><title>OnePlan 复刻对比报告（${rows.length} 案）</title>
<style>
  body{font-family:system-ui,'Segoe UI',sans-serif;margin:24px;background:#f7f8f9;color:#23252c}
  h1{font-size:22px} h2{font-size:16px;margin:28px 0 8px} h2 small{color:#6b7280;font-weight:400}
  .tri{display:flex;gap:12px;flex-wrap:wrap}
  figure{margin:0;flex:1 1 300px;max-width:560px;background:#fff;padding:8px;border:1px solid #d9dde2;border-radius:8px}
  figcaption{font-size:12px;color:#6b7280;margin-bottom:6px}
  img{width:100%;display:block;border-radius:4px}
  .loc{font-size:12px;color:#6b7280}
  .missing{color:#c0392b;font-size:13px}
</style></head><body>
<h1>OnePlan 经典案例复刻对比报告 · ${rows.length} 案</h1>
<p>生成于 ${new Date().toLocaleString('zh-CN')} · 复刻锚点为真实案例地点（source=preset），布局按参考图整体观感近似。</p>
${sections}
</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'oneplan-replica-report.html';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [rows]);

  return <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', background: '#f7f8f9', minHeight: '100vh' }}>
    <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>OnePlan 经典案例复刻对比报告 · {REPLICA_CASES.length} 案</h1>
    <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 16px' }}>
      已生成 {progress}/{REPLICA_CASES.length} · 2D=离线纯函数渲染 · 3D=buildPlanFootprint 低模（无瓦片/无 GLB） ·
      参考图版权归 OnePlan，仅内部学习
      <button type="button" onClick={exportHtml} disabled={progress < REPLICA_CASES.length}
        style={{ marginLeft: 16, padding: '6px 14px', cursor: 'pointer' }}>导出静态 HTML</button>
    </p>
    {rows.map(row => <section key={row.replica.id} style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>
        {row.replica.title}
        <small style={{ color: '#6b7280', fontWeight: 400 }}>（{row.replica.category} · {row.replica.region}）</small>
      </h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <figure style={figureStyle}>
          <figcaption style={capStyle}>OnePlan 原图（版权归 OnePlan，仅内部学习）</figcaption>
          {row.refUrl ? <img src={row.refUrl} alt={`${row.replica.title} OnePlan 原图`} style={imgStyle}/> : <p style={{ color: '#c0392b', fontSize: 13 }}>参考图缺失</p>}
        </figure>
        <figure style={figureStyle}>
          <figcaption style={capStyle}>我们 · 2D 离线渲染</figcaption>
          <img src={row.url2d} alt={`${row.replica.title} 我们 2D`} style={imgStyle}/>
        </figure>
        <figure style={figureStyle}>
          <figcaption style={capStyle}>我们 · 3D（buildPlanFootprint 低模）</figcaption>
          <img src={row.url3d} alt={`${row.replica.title} 我们 3D`} style={imgStyle}/>
        </figure>
      </div>
      <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
        {row.replica.refLink}{row.replica.locationNote ? ` · ${row.replica.locationNote}` : ''}
      </p>
    </section>)}
  </div>;
}

const figureStyle: CSSProperties = { margin: 0, flex: '1 1 300px', maxWidth: 560, background: '#fff', padding: 8, border: '1px solid #d9dde2', borderRadius: 8 };
const capStyle: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 6 };
const imgStyle: CSSProperties = { width: '100%', display: 'block', borderRadius: 4 };
