import { describe, expect, it } from 'vitest';
import { matchesLocalOutdoorCommand } from './outdoor-local-commands';

describe('matchesLocalOutdoorCommand（未登录白名单）', () => {
  it('轮次 28 的两句实测原话都必须放行', () => {
    expect(matchesLocalOutdoorCommand('帮我分区', null)).toBe(true);
    expect(matchesLocalOutdoorCommand('200 人市集，签到靠近入口，留出通道', null)).toBe(true);
  });

  it('活动句要 event+人数同时在场才放行', () => {
    expect(matchesLocalOutdoorCommand('60人讲座', null)).toBe(true);
    expect(matchesLocalOutdoorCommand('300平米户外市集', null)).toBe(false);
    expect(matchesLocalOutdoorCommand('婚礼上的签到台往东挪两米', null)).toBe(false);
  });

  it('上一轮已知活动类型时，人数句可续上', () => {
    expect(matchesLocalOutdoorCommand('改成 150 人', '市集')).toBe(true);
    expect(matchesLocalOutdoorCommand('改成 150 人', null)).toBe(false);
  });

  it('排流线与自动分区放行', () => {
    expect(matchesLocalOutdoorCommand('排一下流线', null)).toBe(true);
    expect(matchesLocalOutdoorCommand('自动分区，按讲座配', null)).toBe(true);
  });

  it('模型需求、删除分区、物件微调不放行', () => {
    expect(matchesLocalOutdoorCommand('', null)).toBe(false);
    expect(matchesLocalOutdoorCommand('做个海报', null)).toBe(false);
    expect(matchesLocalOutdoorCommand('把分区删了', null)).toBe(false);
    expect(matchesLocalOutdoorCommand('先找IN77，核对活动区域', null)).toBe(false);
    expect(matchesLocalOutdoorCommand('取消', null)).toBe(false);
  });
});
