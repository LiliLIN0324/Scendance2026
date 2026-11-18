/**
 * 复刻对比报告的离屏出图（国内案例报告页在用）。
 *
 * 三路图：
 * - `captureOfficialPlan`：官网侧平面（官网已描轮廓 + 官网拟设种子），只用官网自己的数据；
 * - `capturePlan2D`：我们的 2D 离线渲染（纸面底，五层）；
 * - `make3DCapturer`：我们的 3D 低模（buildPlanFootprint 同源管线，共享一个 WebGL context）。
 *
 * 官网那一幅是「按官网描图数据复现」，不是官网截图：官网平面叠在卫星瓦片上，
 * 离线导出的单文件报告不能带瓦片，所以底图去掉了，轮廓与拟设点位逐点照搬。
 */

import * as THREE from 'three';
import {
  drawAccessLayer,
  drawBoundaryLayer,
  drawFacilityLayer,
  drawRouteLayer,
  drawZoneLayer,
  enuToLngLat,
  type PlanViewport,
} from './outdoor-plan-canvas';
import type { ReplicaOfficialPlan } from './replica-kit';
import { reportFrameOf, type ReportFrame } from './replica-report-frame';
import { ringFrame } from '../three/plan-basemap-tiles';
import { buildPlanFootprint } from '../three/plan-footprint-builder';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

export const REPORT_W = 520;
export const REPORT_H = 340;

/** 离线画 2D 缩略：纸面底 + boundary/zone/facility/route/access 五层，返回 dataURL。
 *  `focus` = 官网轮廓：给了就按它取景（与左幅同口径），轮廓外内容自然出框。
 */
export function capturePlan2D(plan: SitePlanData, focus?: [number, number][] | null): string {
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_W * dpr;
  canvas.height = REPORT_H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#f5f6f7';
  ctx.fillRect(0, 0, REPORT_W, REPORT_H);

  const pts = [
    ...plan.boundary,
    ...plan.zones.flatMap(zone => zone.polygon),
    ...plan.facilities.map(f => f.position),
    ...plan.nodes.map(n => n.position),
  ];
  if (!pts.length) return '';
  const frame = focus?.length ? reportFrameOf(focus) : null;
  let spanM: number;
  let cxM: number;
  let cyM: number;
  if (frame) {
    spanM = frame.spanM;
    cxM = frame.cx;
    cyM = frame.cy;
  } else {
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));
    spanM = Math.max(maxX - minX, maxY - minY) * 1.18;
    cxM = (minX + maxX) / 2;
    cyM = (minY + maxY) / 2;
  }
  const anchor = plan.anchor;
  if (!anchor || spanM <= 0) return '';
  const mPerPx = spanM / Math.min(REPORT_W, REPORT_H);
  const zoom = Math.log2((40075016.686 * Math.cos((anchor.lat * Math.PI) / 180)) / (256 * mPerPx));
  const center = enuToLngLat(cxM, cyM, anchor.lng, anchor.lat);
  const viewport: PlanViewport = {
    lng: center.lng,
    lat: center.lat,
    zoom,
    canvasW: REPORT_W,
    canvasH: REPORT_H,
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

/**
 * 官网侧平面：轮廓实线填充 + 官网拟设区块虚线 + 拟设点位圆点。
 * 坐标与我们的平面同为 ENU 米，直接按包围盒铺满画布，不加任何我们的内容。
 */
export function captureOfficialPlan(official: ReplicaOfficialPlan): string {
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_W * dpr;
  canvas.height = REPORT_H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#eef1ec';
  ctx.fillRect(0, 0, REPORT_W, REPORT_H);

  const frame = reportFrameOf(official.areas[0]?.polygon ?? official.seeds.flatMap(s => s.points));
  if (!frame) return '';
  const span = frame.spanM;
  const scale = Math.min(REPORT_W, REPORT_H) / span;
  const ox = REPORT_W / 2 - frame.cx * scale;
  const oy = REPORT_H / 2 + frame.cy * scale;
  const px = (x: number) => ox + x * scale;
  const py = (y: number) => oy - y * scale;

  const trace = (ring: [number, number][]) => {
    ctx.beginPath();
    ring.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.closePath();
  };

  for (const area of official.areas) {
    trace(area.polygon);
    ctx.fillStyle = 'rgba(95, 107, 99, 0.16)';
    ctx.fill();
    ctx.strokeStyle = '#4c5a50';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const seed of official.seeds) {
    if (seed.points.length < 2) continue;
    if (seed.kind === 'area') {
      trace(seed.points);
      ctx.fillStyle = 'rgba(141, 155, 98, 0.22)';
      ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#7d8c4f';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.beginPath();
    seed.points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.strokeStyle = seed.kind === 'line' ? '#d9a12c' : '#8a6a52';
    ctx.lineWidth = seed.kind === 'line' ? 3 : 1.5;
    ctx.stroke();
  }

  for (const seed of official.seeds) {
    if (seed.kind !== 'item' && seed.kind !== 'label') continue;
    for (const [x, y] of seed.points) {
      ctx.beginPath();
      ctx.arc(px(x), py(y), seed.kind === 'label' ? 5 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = seed.kind === 'label' ? '#b4693d' : '#4c5a50';
      ctx.fill();
      if (seed.kind === 'label') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  return canvas.toDataURL('image/png');
}

/** 共享 three 场景顺序截 3D：每案重建场景（buildPlanFootprint 同源管线），返回 dataURL。
 *  传入 `frame` 时按官网轮廓取景（与 2D/左幅同口径），否则按场地包围盒。
 */
export function make3DCapturer(): (plan: SitePlanData, frame?: ReportFrame | null) => string {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(REPORT_W, REPORT_H);
  renderer.setPixelRatio(1);
  const camera = new THREE.PerspectiveCamera(45, REPORT_W / REPORT_H, 1, 50000);
  return function capture3D(plan: SitePlanData, frame?: ReportFrame | null): string {
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
    let siteFrame: ReturnType<typeof ringFrame> | null = null;
    if (plan.boundary.length >= 3) {
      siteFrame = ringFrame(plan.boundary);
      siteSpan = siteFrame.span;
      const ok = buildPlanFootprint(
        THREE,
        scene,
        plan,
        { width: siteFrame.width, depth: siteFrame.depth },
        { clampPoints: false },
      );
      if (ok) {
        const group = scene.getObjectByName('plan-footprint');
        if (group) group.position.set(siteFrame.cx, 0, -siteFrame.cy);
      }
    }
    // 取景只对 plan-footprint 组，且排除「框外白纱蒙版」（详见 replica-report 页注释）。
    const fpGroup = scene.getObjectByName('plan-footprint');
    const box = new THREE.Box3();
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
    let distance = (cappedDim / 2) / Math.tan((45 / 2) * Math.PI / 180) * 1.5;
    if (frame && siteFrame) {
      // 与 2D/左幅同一取景框：中心取轮廓中心，距离由官网轮廓边长决定，不看轮廓外多出来的东西。
      center.set(siteFrame.cx, 0, -siteFrame.cy);
      distance = ((frame.spanM * 1.35) / 2) / Math.tan((45 / 2) * Math.PI / 180) * 1.5;
    }
    camera.position.set(center.x + distance * 0.62, center.y + distance * 0.72, center.z + distance * 0.62);
    camera.lookAt(center.x, 0, center.z);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
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
