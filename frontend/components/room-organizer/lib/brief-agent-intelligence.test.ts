import { describe, expect, it } from 'vitest';
import { cloudBriefMessage, initialBriefMemory, memoryExtraction, parseBriefTurn, summarizeMemory } from './brief-agent';
import { parseBriefSentence } from './workbench-agent';

/** 画布上还没立场地、也没拖图纸的默认语境。 */
const bare = { venueUp: false, scaleTyped: false, hasBase: false, command: null as null | 'again' | 'first' };
/** 场地已经立起来的语境（壳体/模板都算）。 */
const venueUp = { ...bare, venueUp: true };

describe('parseBriefTurn — 记忆槽位跨句累积，失配不再退回开场白', () => {
  it('接受用户明确的待定，回显已知人数并说明库存没有保存', () => {
    const raw='为长者办一场室内讲座，预计30人，现有80把椅子；是否签到还没决定。';
    const turn=parseBriefTurn(raw,initialBriefMemory(),bare,{...parseBriefSentence(raw),activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'是否签到还没决定'}]});
    expect(turn.memory.headcount).toBe(30);
    expect(turn.memory.zoneNeeds.checkin).toBeNull();
    expect(turn.memory.unresolvedActivityNeeds).toContain('checkin');
    expect(turn.text).toContain('30 人');
    expect(turn.text).toContain('待定');
    expect(turn.text).toContain('暂未计入库存');
    expect(turn.text).not.toContain('请告诉我是否需要');
    const deferred=parseBriefTurn('待定',turn.memory,bare);
    expect(deferred.memory.zoneNeeds.checkin).toBeNull();
    expect(deferred.text).not.toContain('请告诉我是否需要');
  });
  it('明确延期后继续收集需求并允许探索，决定仍保持未知',()=>{
    const first=parseBriefTurn('签到尚未决定',initialBriefMemory(),bare);
    expect(first.memory.deferredActivityNeeds).toEqual(['checkin']);
    const second=parseBriefTurn('预计30人，室内',first.memory,bare);
    expect(second.memory.headcount).toBe(30);
    expect(second.text).not.toContain('请告诉我是否需要');
    const third=parseBriefTurn('场地12×10米，采用课桌椅',second.memory,bare);
    expect(third.kind).toBe('generate');
    expect(third.memory.unresolvedActivityNeeds).toContain('checkin');
    expect(third.memory.zoneNeeds.checkin).toBeNull();
    expect(cloudBriefMessage('生成预览',third.memory)).toContain('签到区需求尚未确定');
    const resolved=parseBriefTurn('不需要',third.memory,bare);
    expect(resolved.memory.unresolvedActivityNeeds).not.toContain('checkin');
    expect(resolved.memory.deferredActivityNeeds??[]).not.toContain('checkin');
    expect(resolved.memory.zoneNeeds.checkin).toBe(false);
    const explicit=parseBriefTurn('需要签到',third.memory,bare);
    expect(explicit.memory.zoneNeeds.checkin).toBe(true);
    expect(explicit.memory.unresolvedActivityNeeds).not.toContain('checkin');
    expect(explicit.memory.deferredActivityNeeds??[]).not.toContain('checkin');
  });
  it('延期前的旧选择不进入新方案，普通含糊问题仍需明确',()=>{
    const previous={...initialBriefMemory(),zoneNeeds:{checkin:false,rest:null,stage:null}};
    const deferred=parseBriefTurn('签到还没决定',previous,bare);
    expect(deferred.memory.zoneNeeds.checkin).toBeNull();
    expect(cloudBriefMessage('出方案',deferred.memory)).not.toContain('不需要签到区');
    const ambiguous=parseBriefTurn('可能需要签到',initialBriefMemory(),bare,{...parseBriefSentence('可能需要签到'),activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'可能需要签到'}]});
    expect(ambiguous.memory.deferredActivityNeeds??[]).not.toContain('checkin');
    expect(parseBriefTurn('30人室内',ambiguous.memory,bare).text).toContain('签到区');
  });
  it('只把当前追问的一项标为延期，不放过其他未决项',()=>{
    const previous={...initialBriefMemory(),unresolvedActivityNeeds:['checkin','stage'] as const};
    const deferred=parseBriefTurn('待定',{...previous,unresolvedActivityNeeds:[...previous.unresolvedActivityNeeds]},bare);
    expect(deferred.memory.deferredActivityNeeds).toEqual(['checkin']);
    expect(deferred.memory.unresolvedActivityNeeds).toEqual(['checkin','stage']);
    expect(deferred.text).toContain('舞台');
    const resolved=parseBriefTurn('不需要',deferred.memory,bare);
    expect(resolved.memory.zoneNeeds.stage).toBe(false);
    expect(resolved.memory.unresolvedActivityNeeds).toEqual(['checkin']);
    expect(resolved.memory.deferredActivityNeeds).toEqual(['checkin']);
  });
  it('确认其他需求后只追问未延期项，后续答案对应所问内容',()=>{
    const previous={...initialBriefMemory(),unresolvedActivityNeeds:['checkin' as const,'rest' as const],deferredActivityNeeds:['checkin' as const],pendingActivityNeeds:[{kind:'stage' as const,value:true,evidence:'需要舞台'}]};
    const confirmed=parseBriefTurn('确认',previous,bare);
    expect(confirmed.text).toContain('休息区是否需要');
    expect(confirmed.text).not.toContain('签到区是否需要');
    const answered=parseBriefTurn('不要',confirmed.memory,bare);
    expect(answered.memory.zoneNeeds.rest).toBe(false);
    expect(answered.memory.zoneNeeds.checkin).toBeNull();
    expect(answered.memory.unresolvedActivityNeeds).toEqual(['checkin']);
  });
  it.each(['并非需要舞台', '不排除需要舞台', '未必需要舞台', '不一定需要舞台'])('不把「%s」当成明确需要', text => {
    expect(parseBriefTurn(text, initialBriefMemory(), venueUp).memory.zoneNeeds.stage).toBeNull();
  });
  it('用户否定已有课桌椅后须明确替代方式才能生成', () => {
    const previous = { ...initialBriefMemory(), headcount: 30, layoutMode: 'desk-chair' as const };
    const denied = parseBriefTurn('不要课桌椅', previous, venueUp);
    expect(denied.kind).toBe('ask');
    expect(denied.memory.layoutModeUnresolved).toBe(true);
    expect(parseBriefTurn('出方案', denied.memory, { ...venueUp, command: 'first' }).kind).toBe('ask');
    const alternate = parseBriefTurn('改成圆桌', denied.memory, venueUp);
    expect(alternate.memory.layoutMode).toBe('dining');
    expect(alternate.memory.layoutModeUnresolved).toBe(false);
    expect(parseBriefTurn('出方案', alternate.memory, { ...venueUp, command: 'first' }).kind).toBe('generate');
  });
  it('超出处理人数时明确提示，不把 20000 偷改成 10000', () => {
    const previous = { ...initialBriefMemory(), headcount: 80 };
    const turn = parseBriefTurn('20000人', previous, venueUp);
    expect(turn.kind).toBe('ask');
    expect(turn.text).toContain('20000');
    expect(turn.text).toContain('10000');
    expect(turn.memory.headcount).toBe(80);
    expect(turn.extraction.headcount).toBeNull();
  });
  it('不把必须参加的人数推断为必须人人有座，并记住明确说出的入座要求', () => {
    const first = parseBriefTurn('必须 80 人，有课桌', initialBriefMemory(), venueUp);
    expect(first.memory.allGuestsSeated).toBeNull();
    const second = parseBriefTurn('每人都有座位', first.memory, venueUp);
    expect(second.memory.allGuestsSeated).toBe(true);
    const third = parseBriefTurn('不要求人人入座', second.memory, venueUp);
    expect(third.memory.allGuestsSeated).toBe(false);
    expect(parseBriefTurn('是否每人都有座位？', first.memory, venueUp).memory.allGuestsSeated).toBeNull();
  });
  it('背景板不是舞台需求', () => {
    expect(parseBriefTurn('需要背景板', initialBriefMemory(), venueUp).memory.zoneNeeds.stage).toBeNull();
  });
  it('记住明确的区域取舍并允许后续修改，不因下一句丢失', () => {
    const first = parseBriefTurn('不需要签到，需要休息区', initialBriefMemory(), venueUp);
    expect(first.memory.zoneNeeds).toEqual({ checkin: false, rest: true, stage: null });
    expect(first.text).toContain('不设签到区');
    expect(first.text).toContain('休息区');
    const second = parseBriefTurn('换一版', first.memory, { ...venueUp, command: 'again' });
    expect(second.memory.zoneNeeds).toEqual({ checkin: false, rest: true, stage: null });
    const third = parseBriefTurn('改成需要签到', second.memory, venueUp);
    expect(third.memory.zoneNeeds.checkin).toBe(true);
  });

  it.each(['可能需要签到', '要不要签到', '不确定要不要签到', '需要签到吗？', '休息区要不要设置'])('不会把模糊问句「%s」记成已确认需求', (text) => {
    const turn = parseBriefTurn(text, initialBriefMemory(), venueUp);
    expect(turn.memory.zoneNeeds).toEqual({ checkin: null, rest: null, stage: null });
  });
  it('开场未指定布置方式时先追问，记忆仍保留', () => {
    const turn = parseBriefTurn('80 人，室内 12×9', initialBriefMemory(), bare);
    expect(turn.kind).toBe('ask');
    expect(turn.text).toContain('布置方式');
    expect(turn.memory.headcount).toBe(80);
    expect(turn.memory.venueIO).toBe('indoor');
    expect(turn.memory.lengthM).toBe(12);
    expect(parseBriefTurn('圆桌', turn.memory, bare).kind).toBe('generate');
  });

  it('刚问完多少人，答「80」裸数字也落进人数槽，不再重复问一遍', () => {
    const first = parseBriefTurn('我需要给小学老师上课', initialBriefMemory(), bare);
    expect(first.kind).toBe('ask');
    expect(first.text).toContain('教学');
    const second = parseBriefTurn('80', first.memory, bare);
    expect(second.kind).toBe('ask');
    expect(second.memory.headcount).toBe(80);
    expect(second.text).toContain('80 人');
    expect(second.text).not.toContain('这场大概多少人');
  });

  it('追问答完尺寸后仍需确定布置方式，不走「只改尺寸」分支', () => {
    const asked = parseBriefTurn('80 人', initialBriefMemory(), bare);
    expect(asked.kind).toBe('ask');
    const answer = parseBriefTurn('39×20', asked.memory, bare);
    expect(answer.kind).toBe('ask');
    expect(answer.filledScaleAsk).toBe(true);
  });

  it('「小朋友是要一张课桌配一个椅子的啊」：接住课桌椅形态，场地已立就直接出方案', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, lengthM: 39, widthM: 20 };
    const turn = parseBriefTurn('小朋友是要一张课桌配一个椅子的啊', memory, venueUp);
    expect(turn.kind).toBe('generate');
    expect(turn.memory.layoutMode).toBe('desk-chair');
    expect(turn.memory.event).toBe('教学');
  });

  it('「是一张桌子配一个椅子 要80套」：记下布置方式，但不把套数当人数', () => {
    const turn = parseBriefTurn('是一张桌子配一个椅子 要80套', initialBriefMemory(), venueUp);
    expect(turn.kind).toBe('ask');
    expect(turn.memory.layoutMode).toBe('desk-chair');
    expect(turn.memory.headcount).toBeNull();
  });

  it('没接住的话不装失忆：复述已记下的要素，而不是把开场白再说一遍', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, lengthM: 39, widthM: 20, venueIO: 'indoor' as const };
    const turn = parseBriefTurn('就这样吧嗯嗯', memory, venueUp);
    expect(turn.kind).toBe('ack');
    expect(turn.text).toContain('已记下');
    expect(turn.text).toContain('80 人');
    // 尺度也是人给过的事实：复述里吞掉它，下一句就得重新报一遍尺寸。
    expect(turn.text).toContain('39 × 20 m');
    expect(turn.text).not.toContain('这场大概多少人');
  });

  it('什么都不知道时没接住：如实说，给一个能照抄的例子', () => {
    const turn = parseBriefTurn('嗯嗯', initialBriefMemory(), bare);
    expect(turn.kind).toBe('none');
    expect(turn.text).toContain('这场活动怎么坐');
  });

  it('追问过尺寸还没听到：换一种说法，不重复同一句', () => {
    const first = parseBriefTurn('80 人', initialBriefMemory(), bare);
    expect(first.kind).toBe('ask');
    const again = parseBriefTurn('你猜', first.memory, bare);
    expect(again.kind).toBe('ask');
    expect(again.text).not.toBe(first.text);
    expect(again.text).toContain('长宽');
  });

  it('课桌椅形态记住后，「换一版」仍按一人一套重排', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, lengthM: 39, widthM: 20, layoutMode: 'desk-chair' as const, layoutModeConfirmed: true };
    const turn = parseBriefTurn('换一版', memory, { ...venueUp, command: 'again' });
    expect(turn.kind).toBe('generate');
    expect(turn.memory.layoutMode).toBe('desk-chair');
  });

  it('「改成 15×10」仍然只动场地壳：不出方案标记（由面板按 filledScaleAsk=false 判定）', () => {
    const turn = parseBriefTurn('改成 15×10', { ...initialBriefMemory(), headcount: 80 }, venueUp);
    expect(turn.kind).toBe('ask');
    expect(turn.filledScaleAsk).toBe(false);
    expect(turn.memory.lengthM).toBe(15);
  });
});

describe('audience 主动建议 — 模型 proactiveReply 优先，正则兜底，三档语义防回潮', () => {
  // 已有规模基础上「补人话」的语境：headcount/长宽/venueIO 都齐了，venueUp=true。
  // 关键：句子本身不能被 parseBriefSentence 命中任何硬槽（event/headcount/venueIO/...），
  // 否则会被 `(command || saidSomething) && scaleKnown` 直接走 generate，到不了 audience ack 分支。
  const elderlyMemory = { ...initialBriefMemory(), headcount: 120, lengthM: 30, widthM: 18, venueIO: 'indoor' as const };

  it('【档位 2 防回潮】只说「老年长辈」不提轮椅：正则兜底文案不得含「轮椅」二字，必须含确认式问句和 1.2m', () => {
    const turn = parseBriefTurn('我们是老年长辈参加的活动', elderlyMemory, venueUp);
    expect(turn.kind).toBe('ack');
    // 红线：elderly ≠ mobilityAssistance，不能直接替用户断言轮椅通道
    expect(turn.text).not.toContain('轮椅');
    expect(turn.text).toContain('？');
    expect(turn.text).toContain('通行或休息需求');
    expect(turn.text).not.toContain('1.2m');
  });

  it('【档位 1 防回潮】「腿脚不便要轮椅」：正则兜底文案必须给 1.5m 硬建议', () => {
    const turn = parseBriefTurn('我们这边有腿脚不便要轮椅的', elderlyMemory, venueUp);
    expect(turn.kind).toBe('ack');
    expect(turn.text).toContain('行动辅助');
    expect(turn.text).not.toContain('1.5m');
  });

  it('【档位 3 防回潮】family 场文案禁止出现「轮椅」二字', () => {
    const turn = parseBriefTurn('我们是亲子带小孩来的', elderlyMemory, venueUp);
    expect(turn.kind).toBe('ack');
    expect(turn.text).not.toContain('轮椅');
    expect(turn.text).toContain('如何入场、就座和交流');
  });

  it('【档位 3 防回潮】business 场文案禁止出现「轮椅」二字', () => {
    const turn = parseBriefTurn('我们这边都是重要客户', elderlyMemory, venueUp);
    expect(turn.kind).toBe('ack');
    expect(turn.text).not.toContain('轮椅');
    expect(turn.text).toContain('如何入场、就座和交流');
    expect(turn.text).not.toContain('圆桌');
  });

  it('未核实的模型自由文本不会直接变成圈区或安全结论', () => {
    const pre = {
      event: null,
      headcount: null,
      areaM2: null,
      lengthM: null,
      widthM: null,
      venueIO: null,
      timeOfDay: null,
      audienceTags: ['elderly' as const],
      mobilityAssistance: true,
      proactiveReply: '咱这有行动不便的客人，主通道按 1.5m 留，签到前空 2m。要不要我直接在 2D 上帮你把签到区和休息区圈出来？',
    };
    const turn = parseBriefTurn('我们是老年长辈参加的活动', elderlyMemory, venueUp, pre);
    expect(turn.kind).toBe('ack');
    expect(turn.text).toContain('行动辅助');
    expect(turn.text).not.toContain('1.5m');
    expect(turn.text).not.toContain('圈出来');
  });

  it('【模型 null 回退】模型 proactiveReply=null 且 mobilityAssistance=true：回退正则档位 1，给 1.5m', () => {
    const pre = {
      event: null,
      headcount: null,
      areaM2: null,
      lengthM: null,
      widthM: null,
      venueIO: null,
      timeOfDay: null,
      audienceTags: ['elderly' as const],
      mobilityAssistance: true,
      proactiveReply: null,
    };
    const turn = parseBriefTurn('我们是老年长辈参加的活动', elderlyMemory, venueUp, pre);
    expect(turn.kind).toBe('ack');
    expect(turn.text).toContain('行动辅助');
  });

  it('【模型空串回退】模型 proactiveReply 是空白字符串：按回退处理，走正则档位 2', () => {
    const pre = {
      event: null,
      headcount: null,
      areaM2: null,
      lengthM: null,
      widthM: null,
      venueIO: null,
      timeOfDay: null,
      proactiveReply: '   ',
    };
    const turn = parseBriefTurn('我们是老年长辈参加的活动', elderlyMemory, venueUp, pre);
    expect(turn.kind).toBe('ack');
    expect(turn.text).not.toContain('轮椅');
    expect(turn.text).toContain('通行或休息需求');
    expect(turn.text).not.toContain('1.2m');
  });

  it('【合规承诺红线】正则兜底文案不得出现「保证通行合规/无障碍达标/确保通过消防验收」类兜底承诺', () => {
    const samples = [
      parseBriefTurn('我们是老年长辈参加的活动', elderlyMemory, venueUp).text,
      parseBriefTurn('我们这边有腿脚不便要轮椅的', elderlyMemory, venueUp).text,
      parseBriefTurn('我们是亲子带小孩来的', elderlyMemory, venueUp).text,
      parseBriefTurn('我们这边都是重要客户', elderlyMemory, venueUp).text,
    ];
    for (const text of samples) {
      expect(text).not.toContain('保证通行');
      expect(text).not.toContain('无障碍达标');
      expect(text).not.toContain('确保通过');
      expect(text).not.toContain('消防验收');
      expect(text).not.toContain('保证过审');
      expect(text).not.toContain('一定符合');
      // 深度评审新增禁词
      expect(text).not.toContain('消防已批准');
      expect(text).not.toContain('门扇已核验');
      expect(text).not.toContain('已核验');
      expect(text).not.toContain('已批准');
      expect(text).not.toContain('GB 55019');
      expect(text).not.toContain('GB 55037');
    }
  });
});

describe('summarizeMemory / memoryExtraction', () => {
  it('云端重排收到已记录的取舍，未知字段不会变成虚构事实', () => {
    const memory = { ...initialBriefMemory(), event: '讲座', headcount: 80, headcountMode: 'must' as const,
      areaM2: 120, zoneNeeds: { checkin: false, rest: true, stage: null } };
    const prompt = cloudBriefMessage('换一版', memory);
    expect(prompt).toContain('人数：80（必须）');
    expect(prompt).toContain('不需要签到区');
    expect(prompt).toContain('需要休息区');
    expect(prompt).toContain('长宽未确认');
    expect(prompt).not.toContain('场地：室内');
    expect(prompt).not.toContain('尺寸：');
  });
  it('记忆复述按 人数 · 室内外 · 尺度 · 形态 · 类型 拼', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, venueIO: 'indoor' as const, layoutMode: 'desk-chair' as const, layoutModeConfirmed:true, event: '教学' };
    expect(summarizeMemory({...memory,layoutModeConfirmed:false})).not.toContain('一人一套');
    expect(summarizeMemory(memory)).toBe('80 人 · 室内 · 课桌椅（每桌人数待定） · 教学');
    expect(summarizeMemory({...memory,localSeatingAllocation:{status:'one_per_desk',peoplePerDesk:1,evidence:'每人一桌'}})).toContain('一人一套课桌椅');
    expect(summarizeMemory({ ...memory, lengthM: 12, widthM: 9 })).toBe('80 人 · 室内 · 12 × 9 m · 课桌椅（每桌人数待定） · 教学');
    // 只报过面积：复述就报面积，不替人编一个长宽。
    expect(summarizeMemory({ ...memory, areaM2: 300 })).toBe('80 人 · 室内 · 300 ㎡ · 课桌椅（每桌人数待定） · 教学');
  });

  it('记忆折回 extraction：scaleFrom 与左栏同步还吃老形状', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, lengthM: 39, widthM: 20 };
    const extraction = memoryExtraction(memory);
    expect(extraction.headcount).toBe(80);
    expect(extraction.lengthM).toBe(39);
    expect(extraction.timeOfDay).toBeNull();
  });
});
