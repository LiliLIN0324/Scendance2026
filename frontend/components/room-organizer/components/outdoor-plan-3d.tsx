'use client';

/**
 * 户外规划 3D 视角（P2-k 第一版）。
 *
 * 用户口径（m05067 / m05082）：**一进来先是 2D 地图，右侧「视角」钮才切 3D**；
 * 3D 先是「卫星底图的三维效果 + 低模草图」，细节以后改。所以这里刻意不复用室内
 * `RoomOrganizer` 那套 three 管线（splat/房间壳体/拖拽层都在室内语义里），只做一个
 * 独立的、可丢弃的低模视图：
 *
 * - 地面：按场地边界范围抓一块**卫星影像**（`/api/tdt-tiles?layer=img_w`，本机由
 *   3199 代理注入 TDT_KEY，线上由 Pages Function 注入），直接当贴图铺在地面上——
 *   这就是「卫星底图的三维效果」；拿不到瓦片时退回纸面底色 + 米制网格。
 * - 边界：沿 `plan.boundary` 立一圈矮墙，让人一眼看出场地轮廓。
 * - 分区：`plan.zones` 铺半透明色块；动线：`plan.routes` 画地面线；
 *   设施：`plan.facilities` 按 `size.width × size.depth × 高度` 堆低模盒子。
 * - 环绕/缩放用 OrbitControls；切回 2D 由外层按钮负责。
 *
 * 坐标系：站点 ENU（x 东、y 北，单位米）→ three（x, y 上, -y）。
 * 这样「北」朝屏幕里侧（-Z），与卫星影像上北下南一致。
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { enuToLngLat } from '@/components/room-organizer/lib/outdoor-plan-canvas';
import {
  planGroundTiles,
  zoomForGroundSpan,
  type PlanGroundBounds,
} from '@/components/room-organizer/lib/plan-ground-capture';
import { type PlanPoint, type PlanRing, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** 没锚点的场地（纯纸面规划）用的地面底色。 */
const PAPER_GROUND = '#efece4';
const GROUND_PAD = 0.14;
const WALL_HEIGHT_M = 1.1;
const WALL_THICK_M = 0.35;

interface SiteFrame {
  /** 边界在 ENU 里的包围盒中心（米）。 */
  cx: number;
  cy: number;
  width: number;
  depth: number;
  span: number;
}

function ringFrame(ring: PlanRing): SiteFrame {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ring.forEach((p: PlanPoint) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  if (!Number.isFinite(minX)) {
    return { cx: 0, cy: 0, width: 60, depth: 40, span: 60 };
  }
  const width = Math.max(4, maxX - minX);
  const depth = Math.max(4, maxY - minY);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width, depth, span: Math.max(width, depth) };
}

function paddedBounds(frame: SiteFrame, anchor: { lng: number; lat: number }): PlanGroundBounds {
  const halfW = (frame.width / 2) * (1 + 2 * GROUND_PAD);
  const halfD = (frame.depth / 2) * (1 + 2 * GROUND_PAD);
  const sw = enuToLngLat(frame.cx - halfW, frame.cy - halfD, anchor.lng, anchor.lat);
  const ne = enuToLngLat(frame.cx + halfW, frame.cy + halfD, anchor.lng, anchor.lat);
  return { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat };
}

/** 抓一块卫星影像当贴地贴图；一张瓦片都没回来就回 null（上层退回纸面）。 */
async function captureSatellite(bounds: PlanGroundBounds, size = 1024): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const latMid = (bounds.north + bounds.south) / 2;
  const widthM = Math.abs(bounds.east - bounds.west) * 111320 * Math.cos((latMid * Math.PI) / 180);
  const depthM = Math.abs(bounds.north - bounds.south) * 110574;
  const zoom = zoomForGroundSpan(widthM, depthM, size);
  const plan = planGroundTiles(bounds, size, zoom, (z, x, y) => `/api/tdt-tiles?layer=img_w&z=${z}&x=${x}&y=${y}`);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#12161b';
  ctx.fillRect(0, 0, size, size);
  let loaded = 0;
  await Promise.all(plan.placements.map((p) => new Promise<void>((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    const timer = setTimeout(() => resolve(), 8000);
    image.onload = () => {
      clearTimeout(timer);
      try {
        ctx.drawImage(image, p.x, p.y, p.w, p.h);
        loaded += 1;
      } catch {
        /* 单块失败不影响其它块。 */
      }
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    image.src = p.url;
  })));
  if (loaded === 0) return null;
  return canvas.toDataURL('image/jpeg', 0.86);
}

/** 低模高度：够看出体量差异即可，不做建筑级细节。 */
function propHeightM(templateId: string): number {
  const id = templateId.toLowerCase();
  if (id.includes('stage')) return 2.6;
  if (id.includes('tent') || id.includes('canopy') || id.includes('marquee')) return 2.7;
  if (id.includes('toilet') || id.includes('restroom') || id.includes('wc')) return 2.4;
  if (id.includes('truck') || id.includes('van') || id.includes('trailer')) return 2.3;
  if (id.includes('gate') || id.includes('check')) return 2.1;
  if (id.includes('bin') || id.includes('trash')) return 1.0;
  return 1.6;
}

function propColor(templateId: string, fallback?: string): string {
  if (fallback) return fallback;
  const id = templateId.toLowerCase();
  if (id.includes('stage')) return '#5b5f6b';
  if (id.includes('tent') || id.includes('canopy')) return '#d8d2c4';
  if (id.includes('toilet')) return '#b9c4c9';
  if (id.includes('truck') || id.includes('van')) return '#c9b7a4';
  return '#b9c2cc';
}

const ROUTE_COLORS: Record<string, string> = {
  pedestrian: '#3f7ad6',
  vehicle: '#d68b3f',
  service: '#8f5bd6',
};

export interface OutdoorPlan3DProps {
  plan: SitePlanData;
  /** 顶左角状态文案（切回 2D 由外层按钮负责，这里只报状态）。 */
  onReady?: () => void;
}

export default function OutdoorPlan3D({ plan, onReady }: OutdoorPlan3DProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [groundState, setGroundState] = useState<'loading' | 'satellite' | 'paper'>('loading');

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    const disposables: { dispose: () => void }[] = [];
    const anchor = plan.anchor ? { lng: plan.anchor.lng, lat: plan.anchor.lat } : null;
    const siteFrame = ringFrame(plan.boundary);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#d9e3ea');

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 40000);
    const span = Math.max(12, siteFrame.span);
    camera.position.set(siteFrame.cx + span * 0.55, span * 0.75, -siteFrame.cy + span * 0.95);
    camera.lookAt(siteFrame.cx, 0, -siteFrame.cy);

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setGroundState('paper');
      return undefined;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    scene.add(new THREE.HemisphereLight('#ffffff', '#6c757d', 1.05));
    const sun = new THREE.DirectionalLight('#fff6e6', 1.15);
    sun.position.set(siteFrame.cx + span, span * 1.4, -siteFrame.cy - span);
    scene.add(sun);

    const planeW = siteFrame.width * (1 + 2 * GROUND_PAD);
    const planeD = siteFrame.depth * (1 + 2 * GROUND_PAD);

    // 纸面/占位地面：卫星图没回来时也能看到场地与设施。
    const paperGeometry = new THREE.PlaneGeometry(planeW, planeD);
    const paperMaterial = new THREE.MeshBasicMaterial({ color: PAPER_GROUND });
    disposables.push(paperGeometry, paperMaterial);
    const paper = new THREE.Mesh(paperGeometry, paperMaterial);
    paper.rotation.x = -Math.PI / 2;
    paper.position.set(siteFrame.cx, -0.02, -siteFrame.cy);
    scene.add(paper);

    // 米制网格（纸面模式下的比例感；卫星图模式下淡化）。
    const gridSize = Math.ceil(span / 5) * 5;
    const grid = new THREE.GridHelper(gridSize, Math.max(2, Math.round(gridSize / 10)), '#c8c2b4', '#ded8ca');
    grid.position.set(siteFrame.cx, 0, -siteFrame.cy);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    disposables.push(grid);
    scene.add(grid);

    // 卫星贴图（异步）：有了就换掉纸面。
    if (anchor) {
      void captureSatellite(paddedBounds(siteFrame, anchor)).then((dataUrl) => {
        if (disposed || !dataUrl) {
          if (!disposed) setGroundState('paper');
          return;
        }
        const texture = new THREE.TextureLoader().load(dataUrl);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        const geometry = new THREE.PlaneGeometry(planeW, planeD);
        disposables.push(texture, material, geometry);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(siteFrame.cx, 0.01, -siteFrame.cy);
        scene.add(mesh);
        grid.visible = false;
        setGroundState('satellite');
        onReady?.();
      });
    } else {
      setGroundState('paper');
    }

    // 场地边界：矮墙 + 顶面描边。
    const wallMaterial = new THREE.MeshLambertMaterial({ color: '#f7f5ef' });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: '#2f3440' });
    disposables.push(wallMaterial, edgeMaterial);
    const ringPoints = plan.boundary.map((p) => new THREE.Vector3(p.x, 0, -p.y));
    plan.boundary.forEach((p, index) => {
      const next = plan.boundary[(index + 1) % plan.boundary.length];
      const ax = p.x;
      const az = -p.y;
      const bx = next.x;
      const bz = -next.y;
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (length < 0.001) return;
      const geometry = new THREE.BoxGeometry(length, WALL_HEIGHT_M, WALL_THICK_M);
      const mesh = new THREE.Mesh(geometry, wallMaterial);
      disposables.push(geometry);
      mesh.position.set((ax + bx) / 2, WALL_HEIGHT_M / 2, (az + bz) / 2);
      mesh.rotation.y = Math.atan2(-dz, dx);
      scene.add(mesh);
    });
    if (ringPoints.length > 1) {
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(ringPoints.concat([ringPoints[0]]));
      const outline = new THREE.Line(outlineGeometry, edgeMaterial);
      outline.position.y = WALL_HEIGHT_M + 0.01;
      disposables.push(outlineGeometry, outline);
      scene.add(outline);
    }

    // 分区：地面半透明色块。
    plan.zones.forEach((zone) => {
      if (zone.polygon.length < 3) return;
      const shape = new THREE.Shape(zone.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
      const geometry = new THREE.ShapeGeometry(shape);
      const color = zone.color ?? '#8fa1b3';
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: Math.max(0.18, Math.min(0.5, zone.opacity ?? 0.3)),
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      disposables.push(geometry, material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.06;
      scene.add(mesh);
    });

    // 动线：贴地折线。
    plan.routes.forEach((route) => {
      if (route.points.length < 2) return;
      const points = route.points.map((p) => new THREE.Vector3(p.x, 0.12, -p.y));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: ROUTE_COLORS[route.kind] ?? '#3f7ad6' });
      disposables.push(geometry, material);
      scene.add(new THREE.Line(geometry, material));
    });

    // 设施：低模盒子（宽 × 高 × 深，按 rotationDeg 摆向）。
    plan.facilities.forEach((facility) => {
      const height = propHeightM(facility.templateId);
      const geometry = new THREE.BoxGeometry(
        Math.max(0.4, facility.size.width),
        height,
        Math.max(0.4, facility.size.depth),
      );
      const material = new THREE.MeshLambertMaterial({ color: propColor(facility.templateId, facility.color) });
      disposables.push(geometry, material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(facility.position.x, height / 2, -facility.position.y);
      mesh.rotation.y = (facility.rotationDeg * Math.PI) / 180;
      scene.add(mesh);
    });

    // 出入口节点 / 人员点位：小立柱与矮圆柱。
    plan.nodes.forEach((node) => {
      const geometry = new THREE.CylinderGeometry(0.55, 0.55, 2.2, 10);
      const material = new THREE.MeshLambertMaterial({ color: '#2f3440' });
      disposables.push(geometry, material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(node.position.x, 1.1, -node.position.y);
      scene.add(mesh);
    });
    plan.workers.forEach((worker) => {
      const geometry = new THREE.CylinderGeometry(0.42, 0.42, 1.6, 10);
      const material = new THREE.MeshLambertMaterial({ color: worker.color ?? '#78889b' });
      disposables.push(geometry, material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(worker.position.x, 0.8, -worker.position.y);
      scene.add(mesh);
    });

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = Math.max(4, span * 0.12);
    controls.maxDistance = span * 8;
    controls.target.set(siteFrame.cx, 1, -siteFrame.cy);
    controls.update();

    function resize(): void {
      if (!renderer || !stage) return;
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width < 2 || height < 2) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    function loop(): void {
      frame = window.requestAnimationFrame(loop);
      controls?.update();
      renderer?.render(scene, camera);
    }
    loop();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls?.dispose();
      disposables.forEach((item) => {
        try {
          item.dispose();
        } catch {
          /* 单个资源释放失败不影响卸载。 */
        }
      });
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          const material = object.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose();
          object.geometry?.dispose();
        }
      });
      const canvas = renderer?.domElement;
      renderer?.dispose();
      if (canvas && canvas.parentNode === stage) stage.removeChild(canvas);
    };
    // 只按 plan 内容重建；视图切换由外层挂载/卸载控制。
  }, [plan, onReady]);

  return (
    <div
      ref={stageRef}
      data-testid="outdoor-plan-3d"
      style={{ position: 'absolute', inset: 0, background: '#d9e3ea', overflow: 'hidden' }}
    >
      {groundState === 'loading' && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            top: 16,
            zIndex: 2,
            padding: '4px 10px',
            borderRadius: 8,
            background: 'rgba(18, 20, 26, 0.72)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          正在取卫星底图…
        </div>
      )}
      {groundState === 'paper' && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            zIndex: 2,
            padding: '4px 10px',
            borderRadius: 8,
            background: 'rgba(18, 20, 26, 0.62)',
            color: '#fff',
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          卫星底图未取到，先用纸面网格（低模草图）
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          right: 16,
          bottom: 16,
          zIndex: 2,
          padding: '4px 10px',
          borderRadius: 8,
          background: 'rgba(18, 20, 26, 0.5)',
          color: '#fff',
          fontSize: 12,
          lineHeight: '18px',
        }}
      >
        拖拽环绕 · 滚轮缩放
      </div>
    </div>
  );
}