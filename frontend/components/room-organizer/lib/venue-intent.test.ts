import { describe, expect, it } from 'vitest';
import { matchVenueCommand } from './venue-intent';

describe('matchVenueCommand（V-1a 场地意图）', () => {
  it('用户主验收句：在潮乐之城去做设计 → 潮乐之城', () => {
    expect(matchVenueCommand('在潮乐之城去做设计')).toBe('潮乐之城');
  });

  it('常见变体：在/去/到 + 地名 + 动作壳', () => {
    expect(matchVenueCommand('在盐官古城-潮乐之城做一场发布会')).toBe('盐官古城-潮乐之城');
    expect(matchVenueCommand('去西湖办一场发布会')).toBe('西湖');
    expect(matchVenueCommand('到滨湖银泰in77做布置')).toBe('滨湖银泰in77');
    expect(matchVenueCommand('在西湖里规划一下')).toBe('西湖');
    expect(matchVenueCommand('帮我在潮乐之城做设计')).toBe('潮乐之城');
  });

  it('普通 brief（没有动词壳）不误抓，交给 brief 管线', () => {
    expect(matchVenueCommand('80 人发布会，室内 12×9')).toBeNull();
    expect(matchVenueCommand('我要一场婚礼')).toBeNull();
    expect(matchVenueCommand('把舞台往左挪两米')).toBeNull();
    expect(matchVenueCommand('')).toBeNull();
  });

  it('方向/时间词不是场地名：室内、周末、12月', () => {
    expect(matchVenueCommand('在室内做布置')).toBeNull();
    expect(matchVenueCommand('在周末做设计')).toBeNull();
    expect(matchVenueCommand('在12月做设计')).toBeNull();
    expect(matchVenueCommand('在现场布置一下')).toBeNull();
  });

  it('只有方位没有地名时回 ask，让 agent 反问', () => {
    expect(matchVenueCommand('在那边做一场活动')).toBe('ask');
    expect(matchVenueCommand('在哪个地方做设计')).toBe('ask');
  });

  it('没有动作动词壳不算场地意图（调研句仍归调研闸门）', () => {
    expect(matchVenueCommand('在潮乐之城逛了逛')).toBeNull();
    expect(matchVenueCommand('调研西湖')).toBeNull();
  });
});
