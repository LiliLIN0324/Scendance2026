import { describe, expect, it } from 'vitest';
import { doorRenderStyle, type DoorGeometry } from './door-render';

/**
 * doorRenderStyle 纯函数单测：inferred 决定虚线 + 「门未确认」小字。
 * 不依赖 canvas / DOM，jsdom 里也能跑。
 */
const realDoor: DoorGeometry = {
  kind: 'door',
  wall: 'south',
  position: 0,
  widthM: 0.9,
};

describe('doorRenderStyle（门标注样式决策）', () => {
  it('真实门（inferred 缺省）：实线弧，不加「门未确认」小字', () => {
    expect(doorRenderStyle(realDoor)).toEqual({ dashed: false });
  });

  it('真实门显式 inferred:false：仍按实线处理', () => {
    expect(doorRenderStyle({ ...realDoor, inferred: false })).toEqual({ dashed: false });
  });

  it('推测门（inferred:true，withDefaultDoor 合成）：门弧虚线 + 「门未确认」小字', () => {
    expect(doorRenderStyle({ ...realDoor, inferred: true })).toEqual({
      dashed: true,
      label: '门未确认',
    });
  });

  it('其他墙（north/east/west）的推测门同样出虚线 + 小字', () => {
    for (const wall of ['north', 'east', 'west'] as const) {
      expect(doorRenderStyle({ kind: 'door', wall, position: 0, widthM: 0.9, inferred: true }))
        .toEqual({ dashed: true, label: '门未确认' });
    }
  });
});
