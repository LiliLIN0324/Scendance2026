import { describe, expect, it } from 'vitest';
import { boxCollider } from './walk-collision';
import { clearCameraDistance } from './walk-camera-clearance';

/** 玩家世界系：x 东、z = −北。帐篷 3×3 m，中心在玩家正后方 2 m（z = +2，即南侧）。 */
function tentBehind(): ReturnType<typeof boxCollider> {
  return boxCollider(0, 2, 3, 3, 0, false);
}

describe('clearCameraDistance', () => {
  it('leaves the rig distance alone on an empty field', () => {
    expect(clearCameraDistance([], { x: 0, z: 0 }, { x: 0, z: 1 }, 4, 0.25)).toBe(4);
  });

  it('stops the camera at the tent face minus the camera radius', () => {
    // 帐篷近面 z = 0.5；相机半径 0.25 → 最远 0.25，再留 0.02 表面余量。
    const allowed = clearCameraDistance([tentBehind()], { x: 0, z: 0 }, { x: 0, z: 1 }, 4, 0.25);
    expect(allowed).toBeCloseTo(0.5 - 0.25 - 0.02, 6);
    expect(allowed).toBeLessThan(4);
  });

  it('keeps the full distance when the tent is off to the side', () => {
    // 帐篷挪到东侧 6 m：正后方这条射线不碰它。
    const side = boxCollider(6, 2, 3, 3, 0, false);
    expect(clearCameraDistance([side], { x: 0, z: 0 }, { x: 0, z: 1 }, 4, 0.25)).toBe(4);
  });

  it('honours the rotation of the box', () => {
    // 3×3 正方形转 45°：正后方射线先碰到更近的斜角。
    const turned = boxCollider(0, 2, 3, 3, Math.PI / 4, false);
    const straight = clearCameraDistance([tentBehind()], { x: 0, z: 0 }, { x: 0, z: 1 }, 4, 0.25);
    const rotated = clearCameraDistance([turned], { x: 0, z: 0 }, { x: 0, z: 1 }, 4, 0.25);
    expect(rotated).toBeLessThan(straight);
  });

  it('returns zero when the anchor is already inside a box', () => {
    expect(clearCameraDistance([tentBehind()], { x: 0, z: 2 }, { x: 0, z: 1 }, 4, 0.25)).toBe(0);
  });

  it('normalises a non-unit direction', () => {
    const unit = clearCameraDistance([tentBehind()], { x: 0, z: 0 }, { x: 0, z: 1 }, 4, 0.25);
    const scaled = clearCameraDistance([tentBehind()], { x: 0, z: 0 }, { x: 0, z: 5 }, 4, 0.25);
    expect(scaled).toBeCloseTo(unit, 6);
  });
});
