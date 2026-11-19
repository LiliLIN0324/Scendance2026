import * as THREE from 'three';
import { planPixelToPoint, type PlanViewport } from '../lib/outdoor-plan-canvas';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import type { SplatPaint } from './splat-preview';

/** Project the already loaded scene onto the map using its existing renderer. */
export function paintModelOnPlan({ ctx, viewport, renderer, scene, paint, toWorld }: {
  ctx: CanvasRenderingContext2D;
  viewport: PlanViewport;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  paint: SplatPaint;
  toWorld(point: PlanPoint): { x: number; z: number };
}): void {
  const center = toWorld(planPixelToPoint({ x: viewport.canvasW / 2, y: viewport.canvasH / 2 }, viewport));
  const right = toWorld(planPixelToPoint({ x: viewport.canvasW, y: viewport.canvasH / 2 }, viewport));
  const top = toWorld(planPixelToPoint({ x: viewport.canvasW / 2, y: 0 }, viewport));
  const halfWidth = Math.hypot(right.x - center.x, right.z - center.z);
  const halfHeight = Math.hypot(top.x - center.x, top.z - center.z);
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.01, 20000);
  camera.position.set(center.x, 10000, center.z);
  camera.up.set(top.x - center.x, 0, top.z - center.z).normalize();
  camera.lookAt(center.x, 0, center.z);
  camera.updateMatrixWorld();
  const previousSize = renderer.getSize(new THREE.Vector2());
  const previousColor = renderer.getClearColor(new THREE.Color());
  const previousAlpha = renderer.getClearAlpha();
  const background = scene.background;
  try {
    renderer.setSize(viewport.canvasW, viewport.canvasH, false);
    renderer.setClearColor(0, 0);
    scene.background = null;
    paint(renderer, scene, camera, { guides: false });
    ctx.drawImage(renderer.domElement, 0, 0, viewport.canvasW, viewport.canvasH);
  } finally {
    scene.background = background;
    renderer.setClearColor(previousColor, previousAlpha);
    renderer.setSize(previousSize.x, previousSize.y, false);
  }
}
