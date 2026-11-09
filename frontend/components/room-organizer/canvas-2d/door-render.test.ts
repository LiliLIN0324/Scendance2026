import { describe, expect, it } from 'vitest';
import { doorRenderStyle, type DoorGeometry } from './door-render';

/**
 * doorRenderStyle 纯函数单测：区分来源，同时始终提醒开向未知。
 * 不依赖 canvas / DOM，jsdom 里也能跑。
 */
const realDoor: DoorGeometry = {
  kind: 'door',
  wall: 'south',
  position: 0,
  widthM: 0.9,
};

describe('doorRenderStyle（门标注样式决策）', () => {
  it('一般门洞记录标出位置与开向需核验', () => {
    expect(doorRenderStyle(realDoor)).toEqual({ dashed: false, label: '门洞位置、宽度与开向待核验' });
  });

  it('真实门显式 inferred:false：仍按实线处理', () => {
    expect(doorRenderStyle({ ...realDoor, inferred: false })).toEqual({ dashed: false, label: '门洞位置、宽度与开向待核验' });
  });

  it('推测门（inferred:true，withDefaultDoor 合成）：门弧虚线 + 「门未确认」小字', () => {
    expect(doorRenderStyle({ ...realDoor, inferred: true })).toEqual({
      dashed: true,
      label: '推测门洞位置、宽度与开向待核验',
    });
  });

  it('其他墙（north/east/west）的推测门同样出虚线 + 小字', () => {
    for (const wall of ['north', 'east', 'west'] as const) {
      expect(doorRenderStyle({ kind: 'door', wall, position: 0, widthM: 0.9, inferred: true }))
        .toEqual({ dashed: true, label: '推测门洞位置、宽度与开向待核验' });
    }
  });

  it('场景记录与默认推测显示不同来源，均不声称开向已确认', () => {
    expect(doorRenderStyle({ ...realDoor, inferred: true, source: 'scene' })).toEqual({
      dashed: true, label: '场景门洞位置、宽度与开向待核验',
    });
  });

  it('未知或无效宽度只表明门中心，不声称已有门洞尺寸', () => {
    for (const widthM of [null, 0, -1, NaN, Infinity]) {
      expect(doorRenderStyle({ ...realDoor, widthM })).toEqual({ dashed: false, label: '门中心、宽度与开向待核验' });
    }
    expect(doorRenderStyle({ ...realDoor, widthM: null, inferred: true })).toEqual({
      dashed: true, label: '推测门中心、宽度与开向待核验',
    });
  });
});
