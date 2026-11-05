import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE_RATIO,
  MIN_SCALE_RATIO,
  ROTATE_SNAP_RAD,
  advanceTransformSession,
  createTransformSession,
} from './transform';
import type { FurnitureItem } from './types';

function item(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return {
    id: 'imported',
    type: 'glb-asset',
    name: '本机模型',
    width: 1,
    depth: 1,
    height: 0.8,
    color: '#cfc6b6',
    icon: 'view_in_ar',
    position: { x: 0, z: 0 },
    rotation: 0,
    ...overrides,
  } as FurnitureItem;
}

describe('导入模型的变换钳制边界', () => {
  it('缩放比例上限 5×：超出只钳到 5 倍并给出 max 提示', () => {
    const session = createTransformSession(item())!;
    advanceTransformSession(session, 1.5, 0, 'scale');
    advanceTransformSession(session, 10, 0, 'scale');
    expect(MAX_SCALE_RATIO).toBe(5);
    expect(session.width).toBe(5);
    expect(session.depth).toBe(5);
    expect(session.limit).toBe('max');
  });

  it('缩放比例下限 0.2×：不足只钳到 0.2 倍并给出 min 提示', () => {
    const session = createTransformSession(item())!;
    advanceTransformSession(session, 1.5, 0, 'scale');
    advanceTransformSession(session, 0.25, 0, 'scale');
    expect(MIN_SCALE_RATIO).toBe(0.2);
    expect(session.width).toBe(0.2);
    expect(session.depth).toBe(0.2);
    expect(session.limit).toBe('min');
  });

  it('缩放步进取 5 cm：1.03× 落在 1.05 m', () => {
    const session = createTransformSession(item())!;
    advanceTransformSession(session, 1, 0, 'scale');
    advanceTransformSession(session, 1.03, 0, 'scale');
    expect(session.width).toBe(1.05);
    expect(session.limit).toBeNull();
  });

  it('旋转吸附 15°：偏 10° 吸到 15°', () => {
    const session = createTransformSession(item())!;
    advanceTransformSession(session, 1, 0, 'rotate');
    const rad = Math.PI / 18; // 10°
    advanceTransformSession(session, Math.cos(rad), -Math.sin(rad), 'rotate');
    expect(ROTATE_SNAP_RAD).toBe(Math.PI / 12);
    expect(session.rotation).toBeCloseTo(Math.PI / 12, 6);
  });
});
