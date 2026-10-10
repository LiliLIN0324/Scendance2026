import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { calculateRoomFraming, DEFAULT_VIEWPORT_PADDING, type RoomFrameBounds } from './camera-framing';

const ROOM = { width: 18, depth: 9, height: 9 };
const VIEWS = [
  { name: 'iso', position: [10, 15, 10], target: [0, 4.5, 0] },
  { name: 'top', position: [0, 12, 0.001], target: [0, 4.5, 0] },
  { name: 'front', position: [0, 5, 14], target: [0, 3, 0] },
  { name: 'corner', position: [11, 6, -6], target: [0, 0, 0] },
  { name: 'current yaw', position: [-7, 11, 13], target: [0, 4.5, 0] },
  { name: 'panned center', position: [-3, 13, 19], target: [4, 6, 5] },
] as const;
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 896, height: 400 },
  { width: 545, height: 324 },
  { width: 390, height: 250 },
  { width: 227, height: 600 },
  { width: 1100, height: 140 },
];

function roomCorners(room: RoomFrameBounds): THREE.Vector3[] {
  const points = [];
  for (const x of [-room.width / 2, room.width / 2]) {
    for (const y of [0, room.height]) {
      for (const z of [-room.depth / 2, room.depth / 2]) points.push(new THREE.Vector3(x, y, z));
    }
  }
  return points;
}

function applyFrame(camera: THREE.PerspectiveCamera, frame: NonNullable<ReturnType<typeof calculateRoomFraming>>): void {
  camera.position.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion), frame.dollyOut);
  camera.far = frame.far;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function expectRoomVisible(camera: THREE.PerspectiveCamera, room: RoomFrameBounds, viewport: { width: number; height: number }): void {
  camera.updateMatrixWorld(true);
  for (const corner of roomCorners(room)) {
    const ndc = corner.project(camera);
    const pixelX = (ndc.x + 1) * viewport.width / 2;
    const pixelY = (1 - ndc.y) * viewport.height / 2;
    expect(pixelX).toBeGreaterThanOrEqual(DEFAULT_VIEWPORT_PADDING.left - 1e-6);
    expect(pixelX).toBeLessThanOrEqual(viewport.width - DEFAULT_VIEWPORT_PADDING.right + 1e-6);
    expect(pixelY).toBeGreaterThanOrEqual(DEFAULT_VIEWPORT_PADDING.top - 1e-6);
    expect(pixelY).toBeLessThanOrEqual(viewport.height - DEFAULT_VIEWPORT_PADDING.bottom + 1e-6);
    expect(ndc.z).toBeGreaterThanOrEqual(-1 - 1e-6);
    expect(ndc.z).toBeLessThanOrEqual(1 + 1e-6);
  }
}

describe('room framing against Three.js projection', () => {
  for (const view of VIEWS) {
    it.each(VIEWPORTS)(`${view.name}: keeps all eight room corners inside $width × $height`, viewport => {
      const camera = new THREE.PerspectiveCamera(75, viewport.width / viewport.height, 0.3, 20);
      const target = new THREE.Vector3(view.target[0], view.target[1], view.target[2]);
      camera.position.set(view.position[0], view.position[1], view.position[2]);
      camera.lookAt(target);
      const originalPosition = camera.position.clone();
      const originalOrientation = camera.quaternion.clone();
      const originalTarget = target.clone();
      const frame = calculateRoomFraming(camera, ROOM, { viewport, orbitTarget: target });
      expect(frame).not.toBeNull();
      expect(camera.position.equals(originalPosition)).toBe(true);
      applyFrame(camera, frame!);
      expectRoomVisible(camera, ROOM, viewport);
      expect(camera.quaternion.equals(originalOrientation)).toBe(true);
      expect(target.equals(originalTarget)).toBe(true);
      expect(camera.near).toBe(0.3);
      expect(calculateRoomFraming(camera, ROOM, { viewport })?.dollyOut).toBe(0);
    });
  }

  it.each([
    { width: 40, depth: 3, height: 3 },
    { width: 3, depth: 40, height: 3 },
    { width: 6, depth: 8, height: 36 },
  ])('fits rectangular floors and the complete stacked height: %j', room => {
    const viewport = { width: 227, height: 600 };
    const camera = new THREE.PerspectiveCamera(75, viewport.width / viewport.height, 0.3, 100);
    camera.position.set(8, 12, -5);
    camera.lookAt(0, room.height / 2, 0);
    const frame = calculateRoomFraming(camera, room, { viewport });
    expect(frame).not.toBeNull();
    applyFrame(camera, frame!);
    expectRoomVisible(camera, room, viewport);
  });

  it('does not zoom in when the usable viewport grows', () => {
    const viewport = { width: 227, height: 600 };
    const camera = new THREE.PerspectiveCamera(75, viewport.width / viewport.height, 0.3, 1000);
    camera.position.set(10, 13, 10);
    camera.lookAt(0, 4.5, 0);
    applyFrame(camera, calculateRoomFraming(camera, ROOM, { viewport })!);
    const originalPosition = camera.position.clone();
    const expanded = { width: 1200, height: 650 };
    camera.aspect = expanded.width / expanded.height;
    camera.updateProjectionMatrix();
    const frame = calculateRoomFraming(camera, ROOM, { viewport: expanded });
    expect(frame?.dollyOut).toBe(0);
    expect(camera.position.equals(originalPosition)).toBe(true);
    expectRoomVisible(camera, ROOM, expanded);
  });

  it('does not change an already visible room after an aspect change', () => {
    const viewport = { width: 1280, height: 720 };
    const camera = new THREE.PerspectiveCamera(75, viewport.width / viewport.height, 0.3, 1000);
    camera.position.set(100, 120, 100);
    camera.lookAt(0, 4.5, 0);
    expectRoomVisible(camera, ROOM, viewport);
    expect(calculateRoomFraming(camera, ROOM, { viewport })?.dollyOut).toBe(0);
    const resized = { width: 896, height: 644 };
    camera.aspect = resized.width / resized.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    expectRoomVisible(camera, ROOM, resized);
    expect(calculateRoomFraming(camera, ROOM, { viewport: resized })?.dollyOut).toBe(0);
  });

  it('uses the actual projection, including user zoom', () => {
    const viewport = { width: 390, height: 250 };
    const camera = new THREE.PerspectiveCamera(45, viewport.width / viewport.height, 0.3, 1000);
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    camera.position.set(10, 13, 10);
    camera.lookAt(0, 4.5, 0);
    applyFrame(camera, calculateRoomFraming(camera, ROOM, { viewport })!);
    expect(camera.zoom).toBe(2);
    expectRoomVisible(camera, ROOM, viewport);
  });

  it('moves only as far as needed to include the restrictive corner', () => {
    const viewport = { width: 227, height: 600 };
    const camera = new THREE.PerspectiveCamera(75, viewport.width / viewport.height, 0.3, 1000);
    camera.position.set(10, 13, 10);
    camera.lookAt(0, 4.5, 0);
    const frame = calculateRoomFraming(camera, ROOM, { viewport })!;
    applyFrame(camera, { ...frame, dollyOut: frame.dollyOut * 0.99 });
    const corners = roomCorners(ROOM).map(corner => corner.project(camera));
    expect(corners.some(corner => (corner.x + 1) * viewport.width / 2 < DEFAULT_VIEWPORT_PADDING.left
      || (corner.x + 1) * viewport.width / 2 > viewport.width - DEFAULT_VIEWPORT_PADDING.right)).toBe(true);
  });

  it('respects a finite orbit minimum without moving the target', () => {
    const viewport = { width: 1280, height: 720 };
    const target = new THREE.Vector3(2, 5, -3);
    const camera = new THREE.PerspectiveCamera(75, viewport.width / viewport.height, 0.3, 25);
    camera.position.set(12, 15, 7);
    camera.lookAt(target);
    const orientation = camera.quaternion.clone();
    applyFrame(camera, calculateRoomFraming(camera, ROOM, { viewport, orbitTarget: target, minDistance: 80 })!);
    expect(camera.position.distanceTo(target)).toBeGreaterThanOrEqual(80);
    expect(camera.quaternion.equals(orientation)).toBe(true);
    expect(target.toArray()).toEqual([2, 5, -3]);
    expectRoomVisible(camera, ROOM, viewport);
  });

  it('handles a camera inside the room and extends its far plane', () => {
    const viewport = { width: 390, height: 250 };
    const camera = new THREE.PerspectiveCamera(75, viewport.width / viewport.height, 1, 2);
    camera.position.set(0, 4.5, 0);
    camera.lookAt(0, 4.5, -1);
    const frame = calculateRoomFraming(camera, ROOM, { viewport })!;
    expect(Number.isFinite(frame.dollyOut)).toBe(true);
    expect(frame.far).toBeGreaterThan(2);
    applyFrame(camera, frame);
    expectRoomVisible(camera, ROOM, viewport);
  });

  it('keeps legacy callers without pixel dimensions finite', () => {
    const camera = new THREE.PerspectiveCamera(75, 0.3, 0.3, 1000);
    camera.position.set(10, 13, 10);
    camera.lookAt(0, 4.5, 0);
    applyFrame(camera, calculateRoomFraming(camera, ROOM)!);
    for (const corner of roomCorners(ROOM)) {
      const point = corner.project(camera);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(1);
    }
  });

  it.each([{ width: 0, height: 0 }, { width: 100, height: 60 }, { width: Number.NaN, height: 400 }])('ignores hidden or unusable viewports: %j', viewport => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.3, 1000);
    const originalPosition = camera.position.clone();
    expect(calculateRoomFraming(camera, ROOM, { viewport })).toBeNull();
    expect(camera.position.equals(originalPosition)).toBe(true);
  });

  it('rejects invalid bounds and a non-finite projection', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.3, 1000);
    expect(calculateRoomFraming(camera, { ...ROOM, width: Number.NaN })).toBeNull();
    camera.aspect = 0;
    camera.updateProjectionMatrix();
    expect(calculateRoomFraming(camera, ROOM)).toBeNull();
  });
});
