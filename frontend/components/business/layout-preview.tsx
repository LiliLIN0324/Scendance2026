'use client';

/**
 * 只读 3D 渲染器，给 /view 的 URL 快照模式用。
 *
 * 它只消费分享快照里的 RoomLayout，只画家具物件本身；
 * 旧室内户型的墙体与地面已不再绘制（场地改由地图底图承担）。
 * 不接入任何编辑状态：没有选中、没有操作面板、没有射线拾取，只有 OrbitControls。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createFurnitureModel } from '../room-organizer/three/furniture-builders';
import { glbAssetKey, getGlbAssetState, ensureGlbAsset, subscribeGlbAssets } from '../room-organizer/three/glb-assets';
import { disposeObject } from '../room-organizer/three/builder-utils';
import { buildingHeight, floorElevation, itemForStorey, storeyHeight } from '../room-organizer/lib/storeys';
import { applyRendererLook, DEFAULT_EVENT_LIGHTING, makeBackdropTexture, placeAccentLight, placeKeyLight, placeWashLights, resolveLook, SHADOW_LOOK } from '../room-organizer/three/render-look';
import type { RoomLayout } from '../room-organizer/lib/types';
import { SHARE_VIEW_LABELS, SHARE_VIEW_PRESETS, shareShotFilename, type ShareViewPreset } from '../../lib/share-snapshot';
import { MaterialSymbol } from '../room-organizer/panels/material-symbol';
import { acquireWebGLSurface } from '../room-organizer/lib/webgl-context';

/** Mirrors the canvas presets of the retired `use-camera-presets` (2026-11-25 S1) so the stills match the editor angles. */
const VIEWS: Record<ShareViewPreset, (size: number) => { position: [number, number, number]; target: [number, number, number] }> = {
  front: size => ({ position: [0, size * 0.4, size * 1.4], target: [0, size * 0.3, 0] }),
  iso: size => ({ position: [size * 0.8, size * 0.9, size * 0.8], target: [0, 0, 0] }),
  top: size => ({ position: [0, size * 1.6, 0.001], target: [0, 0, 0] }),
};

interface ShotInfo {
  preset: ShareViewPreset;
  filename: string;
  dataUrl: string;
  width: number;
  height: number;
}

interface PreviewApi {
  apply(preset: ShareViewPreset): void;
  shoot(): ShotInfo[];
}

export function LayoutPreview({ layout, assetUrls, name, initialView = 'iso' }: {
  layout: RoomLayout;
  /** assetId (or bare glbUrl) → public model URL, taken from the snapshot. */
  assetUrls: Record<string, string>;
  name: string;
  initialView?: ShareViewPreset;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<PreviewApi | null>(null);
  const [assetProblems, setAssetProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busyExport, setBusyExport] = useState(false);
  // 2026-11-17：没 WebGL 时以前会直接抛错（连 try 都没有，整块预览变白屏），
  // 现在先探一次，拿不到就只出一句话，导出钮置灰。
  const [webglMissing, setWebglMissing] = useState(false);

  const modelUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const floor of layout.floors) {
      for (const item of floor.items) {
        const key = glbAssetKey(item);
        if (!key) continue;
        const url = item.glbUrl ?? (item.assetId ? assetUrls[item.assetId] : undefined) ?? assetUrls[key];
        if (url) map.set(key, url);
      }
    }
    return map;
  }, [layout, assetUrls]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let disposed = false;
    let rebuildQueued = false;
    let unsubscribe: () => void = () => undefined;
    const width = Math.max(layout.width, 0.5);
    const depth = Math.max(layout.height, 0.5);
    const reach = Math.max(width, depth, buildingHeight(layout.floors), 2);

    host.dataset.ready = 'false';
    host.dataset.assetsPending = String(modelUrls.size);
    setAssetProblems([]);
    setWebglMissing(false);

    // 与编辑器同一份光照档案（three/render-look.ts）：同一套色调映射、
    // 曝光、渐变背景、环境强度与阴影，所以查看器与导出图不再比编辑器发灰。
    const look = resolveLook(layout.backendLighting ?? DEFAULT_EVENT_LIGHTING);
    const storey = layout.floors[0];
    const ceiling = Math.max(2, Math.min(storey ? storeyHeight(storey) : 3, 12));

    const world = new THREE.Scene();
    const backdrop = makeBackdropTexture(THREE, look.skyZenith, look.background);
    world.background = backdrop;
    let renderer: THREE.WebGLRenderer;
    const surface = acquireWebGLSurface({ antialias: true, preserveDrawingBuffer: true });
    if (!surface) { setWebglMissing(true); return undefined; }
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: surface.canvas,
        context: surface.context,
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setWebglMissing(true);
      return undefined;
    }
    applyRendererLook(THREE, renderer);
    renderer.toneMappingExposure = look.exposure;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.setAttribute('aria-label', `${name} 的只读三维方案`);
    renderer.domElement.setAttribute('role', 'img');
    host.appendChild(renderer.domElement);

    const envGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = envGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    envGenerator.dispose();
    world.environment = envTexture;
    world.environmentIntensity = look.environment;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, reach * 40);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 0.6;
    controls.maxDistance = reach * 12;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.set(0, Math.min(buildingHeight(layout.floors) * 0.5, 2.4), 0);

    const hemi = new THREE.HemisphereLight(look.sky, look.ground, look.hemisphere);
    const ambient = new THREE.AmbientLight(look.ambientColor, look.ambient);
    const sun = new THREE.DirectionalLight(look.keyColor, look.key);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_LOOK.mapSize, SHADOW_LOOK.mapSize);
    sun.shadow.bias = SHADOW_LOOK.bias;
    sun.shadow.normalBias = SHADOW_LOOK.normalBias;
    sun.shadow.camera.near = 0.1;
    placeKeyLight(sun, width, depth, ceiling);
    const spots = [new THREE.SpotLight(), new THREE.SpotLight()] as const;
    for (const [index, light] of spots.entries()) {
      light.angle = Math.PI / 3.1;
      light.penumbra = 0.8;
      light.decay = 2;
      light.color.setHex(look.spotColors[index] ?? look.spotColors[0]);
      light.intensity = look.spotStrength * ceiling * ceiling;
    }
    placeWashLights(spots, width, depth, ceiling);
    const accent = new THREE.PointLight(look.accentColor, look.accentStrength * ceiling * ceiling, Math.max(width, depth, ceiling) * 1.5, 2);
    placeAccentLight(accent, width, depth, ceiling);
    world.add(hemi, ambient, sun, sun.target, accent);
    for (const light of spots) world.add(light, light.target);

    const furniture = new THREE.Group();
    furniture.userData.type = 'viewer-furniture';
    world.add(furniture);

    const renderFrame = () => {
      if (disposed) return;
      renderer.render(world, camera);
    };

    const fit = () => {
      const canvas = renderer.domElement;
      const w = Math.max(canvas.clientWidth, 1);
      const h = Math.max(canvas.clientHeight, 1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderFrame();
    };

    const apply = (preset: ShareViewPreset) => {
      const view = VIEWS[preset](reach);
      camera.position.set(...view.position);
      controls.target.set(...view.target);
      controls.update();
      renderFrame();
    };

    // 2026-11-18：分享页不再搭旧室内户型的墙体与地面（buildRoom / 剖切墙显隐）。
    // 场地改由地图底图承担，这里只把物件放到它的真实位置上。

    const buildFurniture = () => {
      for (const child of [...furniture.children]) {
        furniture.remove(child);
        disposeObject(child);
      }
      const failed: string[] = [];
      layout.floors.forEach((floor, index) => {
        const y = floorElevation(layout.floors, index);
        for (const item of floor.items) {
          if (item.structuralColumnId || item.structuralOpeningId || item.venueEntranceId) continue;
          const model = createFurnitureModel(THREE, itemForStorey(item, floor), false);
          model.position.set(item.position?.x ?? 0, y, item.position?.z ?? 0);
          model.rotation.y = item.rotation ?? 0;
          if (item.mirrored) model.scale.x *= -1;
          furniture.add(model);
          const key = glbAssetKey(item);
          if (key) {
            const state = getGlbAssetState(key);
            if (state.status === 'error' || (state.status === 'idle' && !modelUrls.has(key))) failed.push(item.name);
          }
        }
      });
      if (!disposed) setAssetProblems([...new Set(failed)]);
    };

    const scheduleRebuild = () => {
      if (rebuildQueued || disposed) return;
      rebuildQueued = true;
      requestAnimationFrame(() => {
        rebuildQueued = false;
        buildFurniture();
        renderFrame();
      });
    };

    let pending = 0;
    for (const [key, url] of modelUrls) {
      const state = getGlbAssetState(key);
      if (state.status === 'ready') continue;
      pending += 1;
      host.dataset.assetsPending = String(pending);
      void ensureGlbAsset(key, url)
        .catch(() => undefined)
        .finally(() => {
          pending = Math.max(0, pending - 1);
          host.dataset.assetsPending = String(pending);
          scheduleRebuild();
        });
    }
    host.dataset.assetsPending = String(pending);

    buildFurniture();
    unsubscribe = subscribeGlbAssets(scheduleRebuild);
    controls.addEventListener('change', renderFrame);

    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    apply(initialView);
    host.dataset.ready = 'true';

    apiRef.current = {
      apply,
      shoot: () => {
        const shots: ShotInfo[] = [];
        for (const preset of SHARE_VIEW_PRESETS) {
          apply(preset);
          renderer.render(world, camera);
          const dataUrl = renderer.domElement.toDataURL('image/png');
          shots.push({
            preset,
            filename: shareShotFilename(name, preset),
            dataUrl,
            width: renderer.domElement.width,
            height: renderer.domElement.height,
          });
        }
        apply(initialView);
        return shots;
      },
    };

    return () => {
      disposed = true;
      if (apiRef.current) apiRef.current = null;
      unsubscribe();
      controls.removeEventListener('change', renderFrame);
      observer.disconnect();
      controls.dispose();
      for (const child of [...world.children]) {
        world.remove(child);
        disposeObject(child);
      }
      world.background = null;
      backdrop.dispose();
      world.environment = null;
      envTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [layout, modelUrls, name, initialView]);

  const exportShots = async () => {
    const api = apiRef.current;
    if (!api || busyExport) return;
    setBusyExport(true);
    setNotice('');
    try {
      const shots = api.shoot();
      shots.forEach((shot, index) => {
        window.setTimeout(() => {
          const anchor = document.createElement('a');
          anchor.href = shot.dataUrl;
          anchor.download = shot.filename;
          anchor.rel = 'noopener';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        }, index * 80);
      });
      const host = hostRef.current;
      if (host) {
        host.dataset.exportInfo = JSON.stringify(shots.map(shot => ({
          filename: shot.filename,
          bytes: shot.dataUrl.length,
          width: shot.width,
          height: shot.height,
        })));
      }
      setNotice(`已导出 ${shots.length} 张：${SHARE_VIEW_PRESETS.map(preset => SHARE_VIEW_LABELS[preset]).join(' / ')}。`);
    } catch {
      setNotice('导出效果图失败，请刷新页面后重试。');
    } finally {
      setBusyExport(false);
    }
  };

  return <div className="sc-preview-shell" ref={hostRef} data-share-preview="layout">
    <div className="sc-preview-tools" role="group" aria-label="观察角度与导出">
      {SHARE_VIEW_PRESETS.map(preset => <button key={preset} type="button" aria-label={SHARE_VIEW_LABELS[preset]} title={SHARE_VIEW_LABELS[preset]} onClick={() => apiRef.current?.apply(preset)}>
        <MaterialSymbol name={preset === 'front' ? 'view_agenda' : preset === 'top' ? 'grid_view' : '3d_rotation'}/>
      </button>)}
      <span className="sc-preview-tools-sep" aria-hidden="true"/>
      <button type="button" aria-label="导出三张效果图" title={webglMissing ? '这台设备无法渲染三维效果图' : '导出三张效果图'} disabled={busyExport || webglMissing} onClick={() => { void exportShots(); }}>
        <MaterialSymbol name="download"/>
      </button>
    </div>
    {notice && <p className="sc-preview-note" role="status">{notice}</p>}
    {webglMissing && <p className="sc-preview-note is-warning" role="status">
      这台设备暂时无法渲染三维方案（浏览器没给 WebGL），物料与平面信息不受影响。
    </p>}
    {assetProblems.length > 0 && <p className="sc-preview-note is-warning" role="status">
      有 {assetProblems.length} 个模型未能载入，已用占位显示：{assetProblems.slice(0, 4).join('、')}{assetProblems.length > 4 ? '…' : ''}
    </p>}
    <p className="sc-preview-hint">拖动旋转 · 滚轮缩放 · 右键平移</p>
  </div>;
}
