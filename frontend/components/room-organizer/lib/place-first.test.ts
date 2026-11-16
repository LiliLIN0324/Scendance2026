import { describe, expect, it } from 'vitest';
import { isCompositeDesignBrief, looksLikeDesignInstruction, placeStillPending } from './place-first';

describe('地图优先：无地点设计句的本地守卫', () => {
  it('把布置 / 动线 / 分区句认成设计句', () => {
    for (const text of [
      '在场地中央摆一张 1.8 米圆桌，配 8 把椅子',
      '加两块 6 米背景板',
      '帮我做一块 3 米宽的签到背板',
      '把后勤动线改成车行',
      '排一下流线和出入口',
      '签到区放北侧',
      '散场支线也排一下',
    ]) expect(looksLikeDesignInstruction(text), text).toBe(true);
  });

  it('选址句一律放行，不在本地被拦', () => {
    for (const text of [
      '先找杭州 IN77，核对可用范围',
      '帮我找一个能办周末市集的户外场地',
      '在杭州西湖边找一块能办活动的场地',
      '这块场地在哪',
      '把范围改大一点',
    ]) expect(looksLikeDesignInstruction(text), text).toBe(false);
  });

  it('地名 + 设计的复合句不被地名吃掉', () => {
    const text = '在杭州植物园玉泉鱼跃周边做两日市集，六个摊位，签到集章放进摊区，园路留 4 米贯通。';
    expect(isCompositeDesignBrief(text, '杭州植物园玉泉鱼跃周边')).toBe(true);
    expect(isCompositeDesignBrief(text, null)).toBe(false);
    expect(isCompositeDesignBrief(text, 'ask')).toBe(false);
    expect(isCompositeDesignBrief('先找杭州 IN77，核对可用范围', '杭州 IN77')).toBe(false);
  });

  it('复合句仍然算设计句，只是不退回', () => {
    const text = '在杭州植物园玉泉鱼跃周边做两日市集，六个摊位，签到集章放进摊区';
    expect(looksLikeDesignInstruction(text)).toBe(true);
    expect(isCompositeDesignBrief(text, '杭州植物园玉泉鱼跃')).toBe(true);
  });

  it('活动简报和问候不算设计句', () => {
    for (const text of ['30 人圆桌晚宴，室内 15×10', '80 人发布会，室内 12×9', '你好', '']) {
      expect(looksLikeDesignInstruction(text), text).toBe(false);
    }
  });

  it('阶段判断：户外在 place、室内没立场地时都算未定', () => {
    expect(placeStillPending({ hasOutdoorPlan: true, stage: 'place', venueUp: false })).toBe(true);
    expect(placeStillPending({ hasOutdoorPlan: true, stage: 'scope', venueUp: false })).toBe(false);
    expect(placeStillPending({ hasOutdoorPlan: false, venueUp: false })).toBe(true);
    expect(placeStillPending({ hasOutdoorPlan: false, venueUp: true })).toBe(false);
  });

  it('空白活动 stage 还没初始化、范围也没确认时，仍算地点未定', () => {
    // 浏览器实测复现：旧条件要求 stage === 'place'，未初始化时永远不成立，
    // 设计句会被当成选址请求，最后卡在登录墙。
    expect(placeStillPending({ hasOutdoorPlan: true, stage: undefined, venueUp: true, rangeConfirmed: false })).toBe(true);
    expect(placeStillPending({ hasOutdoorPlan: true, stage: undefined, venueUp: true })).toBe(false);
    expect(placeStillPending({ hasOutdoorPlan: true, stage: 'scope', venueUp: true, rangeConfirmed: false })).toBe(true);
    expect(placeStillPending({ hasOutdoorPlan: true, stage: 'scope', venueUp: true, rangeConfirmed: true })).toBe(false);
  });

  it('室内分支不受范围参数影响', () => {
    expect(placeStillPending({ hasOutdoorPlan: false, venueUp: true, rangeConfirmed: false })).toBe(false);
  });
});
