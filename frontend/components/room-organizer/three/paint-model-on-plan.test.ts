import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { paintModelOnPlan } from './paint-model-on-plan';
import { planPointToPixel, type PlanViewport } from '../lib/outdoor-plan-canvas';

it('projects the loaded model through the existing renderer and restores renderer state', () => {
  const renderer = {
    domElement: {}, getSize: () => new THREE.Vector2(900, 700), getClearColor: () => new THREE.Color('white'),
    getClearAlpha: () => 1, setClearColor: vi.fn(), setSize: vi.fn(),
  };
  const scene = new THREE.Scene();
  const background = new THREE.Color('gray'); scene.background = background;
  const ctx = { drawImage: vi.fn() };
  const viewport: PlanViewport = { lng: 120.001, lat: 30.001, anchorLng: 120, anchorLat: 30, zoom: 19, canvasW: 800, canvasH: 600, bearing: 0.7 };
  const paint = vi.fn((_renderer, _scene, camera: THREE.Camera) => {
    const point = new THREE.Vector3(10, 0, -20).project(camera);
    const expected = planPointToPixel({ x: 10, y: 20 }, viewport);
    expect((point.x + 1) * 400).toBeCloseTo(expected.x, 5);
    expect((1 - point.y) * 300).toBeCloseTo(expected.y, 5);
  });
  paintModelOnPlan({ ctx: ctx as unknown as CanvasRenderingContext2D, viewport,
    renderer: renderer as unknown as THREE.WebGLRenderer, scene, paint,
    toWorld: point => ({ x: point.x, z: -point.y }) });
  expect(paint.mock.calls[0][0]).toBe(renderer);
  expect(ctx.drawImage).toHaveBeenCalledWith(renderer.domElement, 0, 0, 800, 600);
  expect(scene.background).toBe(background);
  expect(renderer.setSize).toHaveBeenLastCalledWith(900, 700, false);
  expect(renderer.setClearColor).toHaveBeenLastCalledWith(new THREE.Color('white'), 1);
});
