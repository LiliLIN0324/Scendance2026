import { describe, expect, it } from 'vitest';
import {
  isInteractableProp,
  personActionForInteraction,
  personActionUnavailableNote,
  propInteractionAvailability,
  propInteractionHint,
  propInteractionProfile,
  propInteractionRequirement,
  propInteractionSummary,
} from './prop-interactions';

function prop(name: string, ref = '') {
  return { id: name, name, ref, position: { x: 0, y: 0 } };
}

describe('propInteractionProfile', () => {
  it('把椅子、沙发、长椅判成可坐，并给出 sit 与坐下文案', () => {
    for (const name of ['木质餐椅', '三人沙发', '青绿色游客长椅', '可叠放座椅']) {
      const profile = propInteractionProfile(prop(name));
      expect(profile.kind, name).toBe('seat');
      expect(profile.interactions, name).toEqual(['sit']);
      expect(profile.personAction, name).toBe('sit');
      expect(profile.label, name).toBe(`坐下 · ${name}`);
      expect(isInteractableProp(profile), name).toBe(true);
    }
  });

  it('把桌子、柜台判成站立交谈，不落座', () => {
    for (const name of ['木制支架长桌', '模块会议桌', '服务柜台', '服务台']) {
      const profile = propInteractionProfile(prop(name));
      expect(profile.kind, name).toBe('table');
      expect(profile.interactions, name).toEqual(['talk']);
      expect(profile.personAction, name).toBe('talk');
      expect(profile.label, name).toBe(`交谈 · ${name}`);
    }
  });

  it('舞台优先于“台”字桌类，给挥手而不是交谈', () => {
    const profile = propInteractionProfile(prop('模块舞台地台'));
    expect(profile.kind).toBe('stage');
    expect(profile.interactions).toEqual(['wave', 'emote']);
    expect(profile.personAction).toBe('wave');
  });

  it('摊位、展柜可交谈；招牌里有“台”也不会误判成桌子', () => {
    const booth = propInteractionProfile(prop('遮棚展位', 'market-canopy-booth-46c6c10f'));
    expect(booth.kind).toBe('booth');
    expect(booth.interactions).toEqual(['talk']);

    const display = propInteractionProfile(prop('展柜'));
    expect(display.kind).toBe('display');
    expect(display.interactions).toEqual(['talk']);
  });

  it('岗亭不再误判为摊位；餐车按售卖摊位交谈', () => {
    const guard = propInteractionProfile(prop('安保岗亭', 'security-post-1.5x1.5'));
    expect(guard.kind).toBe('unknown');
    expect(guard.interactions).toEqual([]);

    const foodTruck = propInteractionProfile(prop('餐车', 'food-truck-6x2.5'));
    expect(foodTruck.kind).toBe('booth');
    expect(foodTruck.interactions).toEqual(['talk']);
  });

  it('围栏、绿植、垃圾桶、集装箱不注册交互', () => {
    const expected: Record<string, string> = {
      围栏: 'barrier',
      绿植: 'plant',
      户外垃圾桶: 'unknown',
      '20英尺集装箱': 'unknown',
    };
    for (const [name, kind] of Object.entries(expected)) {
      const profile = propInteractionProfile(prop(name));
      expect(profile.kind, name).toBe(kind);
      expect(profile.interactions, name).toEqual([]);
      expect(isInteractableProp(profile), name).toBe(false);
      expect(profile.personAction, name).toBeUndefined();
    }
  });

  it('给属性卡生成只读摘要，不可交互返回空串', () => {
    expect(propInteractionSummary(propInteractionProfile(prop('木质餐椅')))).toBe('可交互：坐下 · 木质餐椅');
    expect(propInteractionSummary(propInteractionProfile(prop('木制支架长桌')))).toBe('可交互：交谈 · 木制支架长桌');
    expect(propInteractionSummary(propInteractionProfile(prop('围栏')))).toBe('');
  });

  it('slug 与标签都能参与判定', () => {
    expect(propInteractionProfile({ id: 'a', name: '展陈物', ref: 'festival-stage-deck', position: { x: 0, y: 0 } }).kind).toBe('stage');
    expect(propInteractionProfile({ id: 'c', name: '物件', tags: ['展位'], position: { x: 0, y: 0 } }).kind).toBe('booth');
  });

  it('未知道具保持未知，不乱给动作', () => {
    const profile = propInteractionProfile(prop('无名称小件'));
    expect(profile.kind).toBe('unknown');
    expect(profile.interactions).toEqual([]);
  });

  it('落座后同一座位提示改成起身', () => {
    const profile = propInteractionProfile(prop('木质餐椅'));
    expect(propInteractionHint(profile, false)).toBe('坐下 · 木质餐椅');
    expect(propInteractionHint(profile, true)).toBe('起身 · 木质餐椅');
  });

  it('交互名只能映射到本道具允许的人物动作', () => {
    const seat = propInteractionProfile(prop('木质餐椅'));
    expect(personActionForInteraction(seat, 'sit')).toBe('sit');
    expect(personActionForInteraction(seat, 'talk')).toBeNull();
    const stage = propInteractionProfile(prop('舞台'));
    expect(personActionForInteraction(stage, 'wave')).toBe('wave');
    expect(personActionForInteraction(stage, 'emote')).toBe('emote');
  });

  it('缺片段提示说清缺哪种 clip，不用 idle 冒充交谈/挥手', () => {
    // 2026-11-16 E7c：crowd / 玩家 GLB 只有 Idle_Loop / Walk_Loop。
    expect(personActionUnavailableNote('talk')).toContain('交谈片段');
    expect(personActionUnavailableNote('talk')).toContain('Talk');
    expect(personActionUnavailableNote('wave')).toContain('挥手片段');
    expect(personActionUnavailableNote('wave')).toContain('Wave');
    expect(personActionUnavailableNote('sit')).toContain('坐姿片段');
    expect(personActionUnavailableNote('emote')).toBe('这个人物暂时没有该动作片段');
  });
});

describe('2026-11-17 基线审计三个真问题（防回归）', () => {
  it('场景名前缀不再替道具决定动作', () => {
    const cases = [
      { name: '线阵列音箱', ref: 'live-music-venue-and-festival-stage-line-array-speaker-7500d812' },
      { name: '移动厕所（两格）', ref: 'hot-air-balloon-festival-portable-toilet-block-82a4faf8' },
      { name: '双履带拖拉机', ref: 'arable-fields-and-farm-machinery-tracked-tractor-f59c2454' },
      { name: '打开的十四英寸笔记本电脑', ref: 'computers-and-desk-gadgets-laptop-open-14-ad4c2b1d' },
      { name: '带绳礼宾隔离柱', ref: 'nightclub-and-dj-booth-rope-barrier-post-with-rope-327c14d3' },
    ];
    for (const item of cases) {
      const profile = propInteractionProfile({ id: item.name, ...item, position: { x: 0, y: 0 } });
      expect(profile.interactions, item.name).toEqual([]);
      expect(['unknown', 'barrier', 'vehicle', 'plant'], item.name).toContain(profile.kind);
    }
  });

  it('桌椅套装单独一类，仍可坐但不是单椅', () => {
    const profile = propInteractionProfile({ id: 'set', name: '圆桌与椅', position: { x: 0, y: 0 }, width: 2, depth: 2 });
    expect(profile.kind).toBe('seat-set');
    expect(profile.interactions).toEqual(['sit']);
    expect(profile.personAction).toBe('sit');
  });

  it('缺 clip 的能力提前说清要什么人物，不等到按 E 才报错', () => {
    const seat = propInteractionProfile(prop('木质餐椅'));
    // 默认人物集已含坐姿（2026-11-17 补全），只带站/走的旧人物才需提示。
    expect(propInteractionRequirement(seat)).toBe('');
    expect(propInteractionRequirement(seat, ['Idle_Loop', 'Walk_Loop'])).toBe('需带 Sitting_Idle_Loop 的人物');

    const table = propInteractionProfile(prop('木制支架长桌'));
    expect(propInteractionAvailability(table).missing).toEqual(['Idle_Talking_Loop']);
    expect(propInteractionRequirement(table)).toContain('Idle_Talking_Loop');
  });
});
