'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createCachedGlbModel, disposeOwnedModel, ensureGlbAsset } from '../room-organizer/three/glb-assets';
import type { Scene, SceneObject } from '../../../supabase/functions/_shared/domain';
import '@/app/share.css';

const EMPTY: Record<string, string> = {};

/** Pure meshes only: the public viewer never imports editor state or editing controls. */
export function createPreviewObject(object: SceneObject): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: object.color, roughness: .7 });
  const box = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z); group.add(mesh);
  };
  if (object.materialId === 'chair' || object.materialId === 'table') {
    const seat = object.materialId === 'chair' ? .5 : .94;
    box(1, .08, 1, 0, seat, 0);
    for (const x of [-.42, .42]) for (const z of [-.42, .42]) box(.09, seat, .09, x, seat / 2, z);
    if (object.materialId === 'chair') box(1, .46, .09, 0, .77, .455);
  } else if (object.materialId === 'display') {
    for (const x of [-.46, .46]) box(.08, 1, 1, x, .5, 0);
    for (const y of [.03, .34, .66, .97]) box(1, .06, 1, 0, y, 0);
  } else if (object.materialId === 'decoration') {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(.3, .22, .35, 16), material);
    pot.position.y = .175; group.add(pot);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(.5, 16, 12), material);
    crown.scale.y = .65; crown.position.y = .675; group.add(crown);
  } else box(1, 1, 1, 0, .5, 0);
  group.scale.set(object.size.width, object.size.height, object.size.depth);
  group.position.set(object.position.x, 0, object.position.z);
  // Backend positive angles rotate x towards +z; Three.js Y rotation has the opposite sign.
  group.rotation.y = -object.rotation * Math.PI / 180;
  return group;
}

export function ScenePreview({ scene, assetUrls = EMPTY, assetNames = EMPTY }: {
  scene: Scene; assetUrls?: Record<string, string>; assetNames?: Record<string, string>;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const changeView = useRef<(view: Scene['camera']) => void>(() => {});
  const [problem, setProblem] = useState('');
  const [pendingAssets, setPendingAssets] = useState(0);
  const [failedAssets, setFailedAssets] = useState<string[]>([]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setProblem(''); setFailedAssets([]); setPendingAssets(0);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setProblem('此设备暂时无法显示三维预览，仍可查看下方物料清单。'); return; }
    let disposed = false;
    const world = new THREE.Scene();
    world.background = new THREE.Color('#eef0e4');
    const { width, depth, height } = scene.venue;
    const extent = Math.max(width, depth, height, 1);
    const camera = new THREE.PerspectiveCamera(42, 1, .01, extent * 40);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', '只读三维场景，可拖动旋转和滚轮缩放');
    renderer.domElement.tabIndex = 0;
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(width / 2, 0, depth / 2);
    controls.maxDistance = extent * 5;
    controls.minDistance = extent * .05;
    controls.maxPolarAngle = Math.PI / 2 - .015;
    controls.listenToKeyEvents(renderer.domElement);
    const render = () => { if (!disposed) renderer.render(world, camera); };
    controls.addEventListener('change', render);
    world.add(new THREE.HemisphereLight(scene.lighting === 'warm' ? '#fff3df' : scene.lighting === 'cool' ? '#dfeaff' : '#ffffff', '#9caca3', 2.4));
    const sun = new THREE.DirectionalLight('#ffffff', 2.3);
    sun.position.set(-extent, extent * 2, extent); world.add(sun);
    const points = scene.venue.polygon ?? [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(points.map(point => new THREE.Vector2(point.x, -point.z)))), new THREE.MeshStandardMaterial({ color: '#deded5', side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.005; world.add(floor);
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(point.x, .002, point.z))), new THREE.LineBasicMaterial({ color: '#84938b' }));
    world.add(outline);
    for (const entrance of scene.venue.entrances) {
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(entrance.width / 2, entrance.width / 2, .018, 24), new THREE.MeshStandardMaterial({ color: '#6f8f52' }));
      marker.position.set(entrance.position.x, .009, entrance.position.z); world.add(marker);
    }
    const assets = scene.objects.filter(object => object.materialId === 'asset');
    setPendingAssets(assets.length);
    for (const object of scene.objects) {
      if (object.materialId !== 'asset') { world.add(createPreviewObject(object)); continue; }
      const assetId = object.assetId!;
      const placeholder = new THREE.Mesh(new THREE.BoxGeometry(object.size.width, object.size.height, object.size.depth), new THREE.MeshBasicMaterial({ color: '#88966f', wireframe: true }));
      placeholder.position.set(object.position.x, object.size.height / 2, object.position.z);
      placeholder.rotation.y = -object.rotation * Math.PI / 180; world.add(placeholder);
      const url = assetUrls[assetId];
      void (url ? ensureGlbAsset(assetId, url) : Promise.reject(new Error('Missing asset'))).then(() => {
        if (disposed) return;
        const model = createCachedGlbModel({ id: object.id, type: 'glb-asset', name: assetNames[assetId] ?? '模型', icon: '', assetId, color: object.color, ...object.size });
        if (!model) throw new Error('Missing model');
        model.position.set(object.position.x, 0, object.position.z);
        model.rotation.y = -object.rotation * Math.PI / 180;
        world.remove(placeholder); disposeOwnedModel(placeholder); world.add(model); render();
      }).catch(() => {
        if (!disposed) setFailedAssets(previous => [...new Set([...previous, assetNames[assetId] ?? '外部模型'])]);
      }).finally(() => { if (!disposed) setPendingAssets(previous => Math.max(0, previous - 1)); });
    }
    changeView.current = view => {
      controls.target.set(width / 2, 0, depth / 2);
      const target = controls.target;
      const distance = extent * Math.max(1, 1 / camera.aspect);
      if (view === 'top') camera.position.set(target.x, distance * 1.7, target.z + .001);
      else if (view === 'customer') camera.position.set(target.x, Math.max(1.7, distance * .15), target.z + distance * 1.1);
      else camera.position.set(target.x + distance, distance, target.z + distance);
      controls.update(); render();
    };
    const resize = () => {
      const rect = element.getBoundingClientRect();
      renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1));
      camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1); camera.updateProjectionMatrix(); render();
    };
    const observer = new ResizeObserver(resize); observer.observe(element);
    resize(); changeView.current(scene.camera);
    return () => {
      disposed = true; changeView.current = () => {}; observer.disconnect(); controls.dispose();
      disposeOwnedModel(world); outline.geometry.dispose(); (outline.material as THREE.Material).dispose();
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [scene, assetUrls, assetNames]);

  return <section className="sc-scene-preview" aria-label="方案三维预览">
    <div className="sc-preview-canvas" ref={host} />
    <div className="sc-preview-tools" role="group" aria-label="观察角度">
      <button type="button" onClick={() => changeView.current('overview')}>整体</button>
      <button type="button" onClick={() => changeView.current('top')}>俯视</button>
      <button type="button" onClick={() => changeView.current('customer')}>客户视角</button>
    </div>
    <p className="sc-preview-help">拖动旋转 · 滚轮或双指缩放 · 箭头键平移</p>
    {problem && <p className="sc-share-notice" role="alert">{problem}</p>}
    {pendingAssets > 0 && <p className="sc-share-notice" role="status">正在加载 {pendingAssets} 个模型…</p>}
    {failedAssets.length > 0 && <p className="sc-share-notice" role="alert">{failedAssets.join('、')}未能加载，仅显示线框占位。请刷新模型资源重试。</p>}
  </section>;
}
