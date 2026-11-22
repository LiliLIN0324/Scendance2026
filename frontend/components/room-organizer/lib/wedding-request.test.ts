import { describe, expect, it } from 'vitest';
import { authorizesAutonomousWedding, isWeddingEvent } from './wedding-request';

/**
 * 2026-11-22 幕景Agent Test S4/S5：
 * design-event 只产婚礼联合布置，入口必须先判断这轮是不是婚礼。
 * 修前用的是 `designBrief.event ?? message`——事件名一旦是「瑜伽疗愈」也照样进婚礼路径，
 * 分区用途卡被一张「这条联合布置工具当前用于婚礼」的反问卡顶掉。
 */
describe('design-event 入口的婚礼判定', () => {
  it('有明确事件名时只看事件名：瑜伽活动不会因为原话里提过婚礼就变成婚礼', () => {
    expect(isWeddingEvent('瑜伽疗愈活动', '我们之前聊过婚礼，这次是瑜伽')).toBe(false);
    expect(isWeddingEvent('户外市集', '')).toBe(false);
  });

  it('事件名是婚礼类就放行', () => {
    expect(isWeddingEvent('户外婚礼', '')).toBe(true);
    expect(isWeddingEvent('婚宴', '')).toBe(true);
  });

  it('事件名还没定时回退到原话，不把「按婚礼布置」误判成非婚礼', () => {
    expect(isWeddingEvent(undefined, '帮我按婚礼布置一版')).toBe(true);
    expect(isWeddingEvent('', '重新规划婚礼仪式区和宴席')).toBe(true);
    expect(isWeddingEvent('   ', '婚礼')).toBe(true);
  });

  it('事件名和原话都没有婚礼线索时一律不进婚礼路径', () => {
    expect(isWeddingEvent(undefined, '')).toBe(false);
    expect(isWeddingEvent(null, '签到、游园打卡、瑜伽和冥想')).toBe(false);
  });
});

/**
 * 2026-11-22 用户拍板：自主婚礼授权只看 brief.event，不看用户这句话。
 * 修前：「婚礼」出现在句子或活动名里就算，瑜伽活动里提一句婚礼案例也会被当成婚礼授权。
 */
describe('自主婚礼授权', () => {
  it('活动名是婚礼 + 继续执行 → 授权', () => {
    expect(authorizesAutonomousWedding('户外婚礼', '继续执行')).toBe(true);
    expect(authorizesAutonomousWedding('婚宴', '无需等待，先出一版')).toBe(true);
  });

  it('活动名不是婚礼时，句子里提过婚礼也不算授权', () => {
    expect(authorizesAutonomousWedding('瑜伽疗愈活动', '之前看过一个婚礼案例，继续执行')).toBe(false);
    expect(authorizesAutonomousWedding(undefined, '按婚礼布置，继续执行')).toBe(false);
    expect(authorizesAutonomousWedding('', '重新规划婚礼，自主规划就行')).toBe(false);
  });

  it('活动名是婚礼但用户没让继续执行 → 不授权', () => {
    expect(authorizesAutonomousWedding('户外婚礼', '这个场地能办吗')).toBe(false);
    expect(authorizesAutonomousWedding('户外婚礼', '')).toBe(false);
  });
});
