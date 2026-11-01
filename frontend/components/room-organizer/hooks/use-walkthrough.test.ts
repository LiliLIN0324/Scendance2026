import { describe, expect, it } from 'vitest';
import { clampToWalkBounds } from './use-walkthrough';

/**
 * 1:1 实景漫游的围栏只做水平夹取：人在点云真实范围里走，
 * 出了扫描边界就贴边停住，不会掉出场外。
 */
describe('1:1 实景漫游围栏', () => {
  const venue = { minX: -20, maxX: 20, minZ: -13, maxZ: 13 };

  it('场地板范围内不动它', () => {
    const position = { x: 3.2, z: -4.4 };
    clampToWalkBounds(position, venue);
    expect(position).toEqual({ x: 3.2, z: -4.4 });
  });

  it('走到扫描边缘外就贴边停住', () => {
    const position = { x: 99, z: -99 };
    clampToWalkBounds(position, venue);
    expect(position.x).toBeCloseTo(19.65);
    expect(position.z).toBeCloseTo(-12.65);
  });

  it('比墙厚还窄的扫描不会被夹成反向区间', () => {
    const position = { x: 1, z: 1 };
    clampToWalkBounds(position, { minX: 0, maxX: 0.2, minZ: 0, maxZ: 0.2 });
    expect(position).toEqual({ x: 1, z: 1 });
  });
});