import * as THREE from 'three';
import { expect, it } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { planShellWorldMatrix, planWorldMatrix } from './plan-world-frame';

it('places map metres in the same rotated and scaled frame as the model', () => {
  const layout = makeLayout({ sceneAnchor: { lng: 120, lat: 30, orientationDeg: 90, metersPerUnit: 2, source: 'manual' } });
  const point = new THREE.Vector3(12, 0, -5).applyMatrix4(planWorldMatrix(layout, { lng: 120, lat: 30, crs: 'gcj-02', source: 'manual' }));
  expect(point.x).toBeCloseTo(-2.5);
  expect(point.z).toBeCloseTo(-6);
});

it('undoes room compression for plan objects before putting them on the map', () => {
  const layout = makeLayout({ width: 20, height: 10 });
  const matrix = planShellWorldMatrix(layout, { lng: 120, lat: 30, crs: 'gcj-02', source: 'manual' }, [{ x: -100, y: -50 }, { x: 100, y: -50 }, { x: 100, y: 50 }]);
  const corner = new THREE.Vector3(10, 0, 5).applyMatrix4(matrix);
  expect(corner.x).toBeCloseTo(100);
  expect(corner.z).toBeCloseTo(50);
});
