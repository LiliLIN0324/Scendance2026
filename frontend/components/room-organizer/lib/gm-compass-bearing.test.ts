import * as THREE from 'three';
import { expect, it } from 'vitest';
import {
  BEARING_PUBLISH_EPSILON,
  BEARING_SAMPLE_MS,
  COMPASS_STEP,
  bearingAfterOrbit,
  bearingFromLook,
  bearingSeparation,
  coalesceAnimationFrame,
  roseRotationDeg,
  shouldPublishBearing,
  shouldSampleBearing,
  tileOverflowPad,
  uprightDelta,
} from './gm-compass-bearing';

it('keeps north-up pan unchanged', () => {
  expect(uprightDelta(12, -4, 0)).toEqual({ x: 12, y: -4 });
  expect(tileOverflowPad(800, 600, 0)).toBe(0);
});

it('reads walk look with the same sign as an orbit step', () => {
  expect(bearingFromLook(0, -1)).toBeCloseTo(0);
  expect(bearingFromLook(1, 0)).toBeCloseTo(Math.PI / 2);
  expect(bearingFromLook(0, 1)).toBeCloseTo(Math.PI);
  expect(bearingFromLook(-1, 0)).toBeCloseTo(-Math.PI / 2);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);
  const look = new THREE.Vector3();
  camera.getWorldDirection(look);
  const before = bearingFromLook(look.x, look.z);
  expect(before).toBeCloseTo(0);
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  euler.y += COMPASS_STEP;
  camera.quaternion.setFromEuler(euler);
  camera.getWorldDirection(look);
  expect(bearingFromLook(look.x, look.z)).toBeCloseTo(bearingAfterOrbit(before, COMPASS_STEP));
});

it('turns the rose clockwise when the left arrow orbits by +90°', () => {
  const next = bearingAfterOrbit(0, COMPASS_STEP);
  expect(next).toBeCloseTo(-Math.PI / 2);
  expect(roseRotationDeg(next)).toBeCloseTo(90);
  expect(roseRotationDeg(bearingAfterOrbit(0, -COMPASS_STEP))).toBeCloseTo(-90);
});

it('maps a screen drag back to north-up after a clockwise quarter turn', () => {
  const bearing = bearingAfterOrbit(0, COMPASS_STEP);
  const moved = uprightDelta(10, 0, bearing);
  expect(moved.x).toBeCloseTo(0);
  expect(moved.y).toBeCloseTo(-10);
});

it('skips bearing publishes for noise and for the ±π seam', () => {
  expect(bearingSeparation(Math.PI, -Math.PI)).toBe(0);
  expect(bearingSeparation(Math.PI - 0.001, -Math.PI + 0.001)).toBeCloseTo(0.002);
  expect(shouldPublishBearing(0, 0)).toBe(false);
  expect(shouldPublishBearing(1, 1 + BEARING_PUBLISH_EPSILON / 2)).toBe(false);
  expect(shouldPublishBearing(1, 1 + BEARING_PUBLISH_EPSILON * 2)).toBe(true);
  expect(shouldPublishBearing(Math.PI, -Math.PI + 0.001)).toBe(false);
  expect(shouldPublishBearing(0, Number.NaN)).toBe(false);
  expect(shouldSampleBearing(90, 0, BEARING_SAMPLE_MS)).toBe(true);
  expect(shouldSampleBearing(89, 0, BEARING_SAMPLE_MS)).toBe(false);
});

it('coalesces repeated bearing frames into one callback', () => {
  const queued: Array<() => void> = [];
  let pending = 0;
  const schedule = (callback: () => void): number => {
    queued.push(callback);
    pending = queued.length;
    return pending;
  };
  let draws = 0;
  pending = coalesceAnimationFrame(0, schedule, () => { draws += 1; });
  const again = coalesceAnimationFrame(pending, schedule, () => { draws += 1; });
  expect(again).toBe(pending);
  expect(queued).toHaveLength(1);
  queued[0]!();
  expect(draws).toBe(1);
});
