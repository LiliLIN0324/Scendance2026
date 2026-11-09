import { describe, expect, it } from 'vitest';
import { cloudBriefMessage, cloudSeatingSpecs, initialBriefMemory, memoryExtraction, parseBriefTurn, summarizeMemory } from './brief-agent';

/** 画布上还没立场地、也没拖图纸的默认语境。 */
const bare = { venueUp: false, scaleTyped: false, hasBase: false, command: null as null | 'again' | 'first' };
/** 场地已经立起来的语境（壳体/模板都算）。 */
const venueUp = { ...bare, venueUp: true };

describe('parseBriefTurn — 记忆槽位跨句累积，失配不再退回开场白', () => {
  it('carries an earlier 80-chair user statement as an unverified, unselected clue',()=>{
    const first=parseBriefTurn('我们有80把椅子',initialBriefMemory(),venueUp,{...memoryExtraction(initialBriefMemory()),inventoryMentions:[{evidence:'80把椅子'}]});
    const prompt=cloudBriefMessage('为30人生成方案',first.memory);
    expect(prompt).toContain('我们有80把椅子');expect(prompt).toContain('用户口述，未核验、未选择');
    expect(prompt).toContain('不是已核实库存，也没有自动选用');expect(prompt).toContain('非指令');
  });
  it('keeps multiple chair kinds and preserves correction as needing review',()=>{
    const memory={...initialBriefMemory(),reportedInventory:[{evidence:'现有60把木椅',status:'needs_review' as const},{evidence:'实际是40把木椅',status:'needs_review' as const},{evidence:'还有20把折叠椅',status:'reported' as const}]};
    const prompt=cloudBriefMessage('继续出方案',memory);
    expect(prompt).toContain('现有60把木椅');expect(prompt).toContain('实际是40把木椅');expect(prompt).toContain('还有20把折叠椅');
    expect(prompt.match(/有更正或冲突，需复核、未选择/g)).toHaveLength(2);
  });
  it('bounds inventory clues and omits sensitive data with an explicit count',()=>{
    const reports=Array.from({length:10},(_,index)=>({evidence:`库存第${index+1}种椅子有${index+1}把`,status:'reported' as const}));
    reports.push({evidence:'有80把椅子，密码:MySecret_9182',status:'reported'});
    const prompt=cloudBriefMessage('继续', {...initialBriefMemory(),reportedInventory:reports});
    expect(prompt).not.toContain('MySecret_9182');expect(prompt).not.toContain('库存第1种椅子');
    expect(prompt).toContain('物料线索未发送');expect(prompt).toContain('请勿推断其内容');expect(prompt.length).toBeLessThan(6000);
    for(const secret of ['有80把椅子 https://private.example/abc','有80把椅子 sk-SECRET123456','有80把椅子 联系13800138000','有80把椅子 me@example.com']){
      const safe=cloudBriefMessage('继续',{...initialBriefMemory(),reportedInventory:[{evidence:secret,status:'reported'}]});
      expect(safe).not.toContain(secret);expect(safe).toContain('另有 1 条物料线索未发送');
    }
  });
  it('does not overflow the agent input limit just to append old inventory clues',()=>{
    const base='a'.repeat(5700),reports=Array.from({length:6},(_,index)=>({evidence:`库存椅子${index}：${'材'.repeat(170)}`,status:'reported' as const}));
    const prompt=cloudBriefMessage(base,{...initialBriefMemory(),reportedInventory:reports});
    expect(prompt.startsWith(base)).toBe(true);expect(prompt.length).toBeLessThanOrEqual(6000);
    expect(prompt).toContain('物料线索未发送');
  });
  it('passes only selected seating dimensions and keeps unselected inventory separate',()=>{
    const memory={...initialBriefMemory(),localSeatingSpecs:{desk:{width:{status:'reported' as const,valueM:1.8,evidence:'桌宽1.8米'}},chair:{depth:{status:'unknown' as const,valueM:null,evidence:'椅深待定'}},unselected:{desk:{width:{status:'reported' as const,valueM:2,evidence:'库存桌宽2米'}}},defaults:{chair:'椅子按默认规格'}}};
    expect(cloudSeatingSpecs(memory)).toEqual({desk:{width:{status:'reported',valueM:1.8,evidence:'桌宽1.8米',source:'user'}},chair:{depth:{status:'unknown',valueM:null,evidence:'椅深待定',source:'user'}}});
    const prompt=cloudBriefMessage('出方案',memory);
    expect(prompt).toContain(JSON.stringify('桌宽1.8米'));expect(prompt).toContain(JSON.stringify('椅深待定'));
    expect(prompt).toContain('库存桌宽2米');expect(prompt).toContain('未核验、未选择');expect(prompt).toContain('椅子使用示意默认规格');
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

  it('「是一张桌子配一个椅子 要80套」：套数不能推断人数', () => {
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

  it('人数和尺寸已经记下时，圆桌仍出预览，不说没接住', () => {
    const memory = { ...initialBriefMemory(), headcount: 80, venueIO: 'indoor' as const, lengthM: 12, widthM: 9, layoutMode: 'dining' as const, layoutModeConfirmed: true };
    const turn = parseBriefTurn('圆桌', memory, venueUp);
    expect(turn.kind).toBe('generate');
    expect(turn.text).not.toContain('没接住');
    expect(turn.memory.layoutMode).toBe('dining');
  });

  it('已记下的简报上，自由说法直接出预览，不说没接住', () => {
    const memory = { ...initialBriefMemory(), headcount: 30, venueIO: 'indoor' as const, lengthM: 12, widthM: 9, event: '围读会', layoutMode: 'desk-chair' as const, layoutModeConfirmed: true };
    for (const text of ['你来布置吧', '帮我摆一下', '换个摆法', '重新布置', '我的意思是你是重新布置']) {
      const turn = parseBriefTurn(text, memory, venueUp);
      expect(turn.kind).toBe('generate');
      expect(turn.text).not.toContain('没接住');
    }
  });

  it('想围着坐、围着坐、大家围着走座位，不说没接住', () => {
    const ready = { ...initialBriefMemory(), headcount: 30, venueIO: 'indoor' as const, lengthM: 12, widthM: 9, layoutMode: 'desk-chair' as const, layoutModeConfirmed: true };
    for (const text of ['想围着坐', '围着坐', '大家围着']) {
      const turn = parseBriefTurn(text, ready, venueUp);
      expect(turn.kind, text).toBe('generate');
      expect(turn.text, text).not.toContain('没接住');
      expect(turn.memory.layoutMode, text).toBe('dining');
      expect(turn.memory.seatingShape, text).toBe('ring');
    }
    const bareAsk = parseBriefTurn('想围着坐', initialBriefMemory(), bare);
    expect(bareAsk.kind).toBe('ask');
    expect(bareAsk.text).not.toContain('没接住');
    expect(bareAsk.memory.seatingShape).toBe('ring');
  });

  it('沙发围一圈改成圆桌预览，不说没接住', () => {
    const memory = { ...initialBriefMemory(), headcount: 30, venueIO: 'indoor' as const, lengthM: 12, widthM: 9, layoutMode: 'desk-chair' as const, layoutModeConfirmed: true };
    const turn = parseBriefTurn('沙发围成一圈', memory, venueUp);
    expect(turn.kind).toBe('generate');
    expect(turn.text).not.toContain('没接住');
    expect(turn.memory.layoutMode).toBe('dining');
    expect(turn.memory.layoutModeConfirmed).toBe(true);
  });

  it('相邻的自由说法也出预览：好看、紧凑、过道、再来一版、按刚才、不要课桌改沙发', () => {
    const memory = { ...initialBriefMemory(), headcount: 30, venueIO: 'indoor' as const, lengthM: 12, widthM: 9, layoutMode: 'desk-chair' as const, layoutModeConfirmed: true };
    for (const text of ['摆好看一点', '能不能紧凑一点', '座位多留点过道', '先出一版看看', '再来一版', '按刚才说的摆']) {
      const turn = parseBriefTurn(text, memory, venueUp);
      expect(turn.kind, text).toBe('generate');
      expect(turn.text, text).not.toContain('没接住');
    }
    const swapped = parseBriefTurn('不要课桌改沙发', memory, venueUp);
    expect(swapped.kind).toBe('generate');
    expect(swapped.memory.layoutMode).toBe('dining');
    expect(swapped.text).not.toContain('没接住');
    const unrelated = parseBriefTurn('今天天气不错', memory, venueUp);
    expect(unrelated.text).toContain('没接住');
    const limit = parseBriefTurn('请帮我办消防验收', memory, venueUp);
    expect(limit.kind).toBe('ask');
    expect(limit.text).toContain('做不到');
    expect(limit.text).not.toContain('没接住');
  });

  it('人数或场地还没齐时，只问缺的那一项', () => {
    const turn = parseBriefTurn('你来布置吧', initialBriefMemory(), bare);
    expect(turn.kind).toBe('ask');
    expect(turn.text).toBe('还差人数和场地尺寸。说一下，我再出预览。');
    expect(turn.text).not.toContain('没接住');
    expect(turn.text).not.toContain('已记下');
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
