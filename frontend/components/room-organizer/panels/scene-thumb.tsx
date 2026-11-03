'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import type { Scene } from '../../../../supabase/functions/_shared/domain';
import { createPreviewObject, createPreviewStructure } from '../../business/scene-preview';
import { disposeOwnedModel } from '../three/glb-assets';

export interface SceneThumbProps {
  scene: Scene;
  /** CSS size; backing store uses devicePixelRatio. */
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
  /** Paint as soon as mounted instead of waiting for intersection. */
  eager?: boolean;
}

/**
 * 项目卡用的静态三维缩略图：只渲一帧 overview，不挂轨道控制、不拉 GLB。
 * 物料资产用色块占位，避免卡片墙一开就打几十个模型请求。
 */
export function SceneThumb({ scene, width = 320, height = 190, className, style, eager = false }: SceneThumbProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (visible) return undefined;
    const node = host.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '80px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const element = host.current;
    if (!element) return undefined;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); }
    catch { return undefined; }
    let disposed = false;
    const world = new THREE.Scene();
    world.background = new THREE.Color('#e8ebe3');
    const { width: roomW, depth, height: roomH } = scene.venue;
    const extent = Math.max(roomW, depth, roomH, 1);
    const camera = new THREE.PerspectiveCamera(42, width / Math.max(height, 1), .01, extent * 40);
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    element.appendChild(renderer.domElement);

    world.add(new THREE.HemisphereLight(scene.lighting === 'warm' ? '#fff3df' : scene.lighting === 'cool' ? '#dfeaff' : '#ffffff', '#9caca3', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(-extent, extent * 2, extent);
    world.add(sun);

    const points = scene.venue.polygon ?? [{ x: 0, z: 0 }, { x: roomW, z: 0 }, { x: roomW, z: depth }, { x: 0, z: depth }];
    const floor = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(points.map(point => new THREE.Vector2(point.x, -point.z)))),
      new THREE.MeshStandardMaterial({ color: scene.schemaVersion === 2 ? scene.finishes?.floorColor ?? '#deded5' : '#deded5', side: THREE.DoubleSide }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.005;
    world.add(floor);
    world.add(createPreviewStructure(scene));
    for (const object of scene.objects.slice(0, 120)) {
      if (object.materialId === 'asset') {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(object.size.width, object.size.height, object.size.depth),
          new THREE.MeshStandardMaterial({ color: object.color || '#88966f', roughness: .75 }),
        );
        box.position.set(object.position.x, (object.elevation ?? 0) + object.size.height / 2, object.position.z);
        box.rotation.y = -object.rotation * Math.PI / 180;
        world.add(box);
        continue;
      }
      world.add(createPreviewObject(object));
    }

    const target = new THREE.Vector3(roomW / 2, 0, depth / 2);
    const distance = extent * 1.35;
    camera.position.set(target.x + distance, distance * .85, target.z + distance);
    camera.lookAt(target);
    if (!disposed) renderer.render(world, camera);

    return () => {
      disposed = true;
      disposeOwnedModel(world);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [visible, scene, width, height]);

  return <div
    ref={host}
    className={className}
    style={{ width: '100%', height: '100%', minHeight: 0, background: '#e8ebe3', ...style }}
    aria-hidden="true"
  />;
}
