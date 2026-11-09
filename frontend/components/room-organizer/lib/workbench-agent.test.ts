import { describe, expect, it } from 'vitest';
import { checkDim, classifyFile, classifyLocalLayout, describeExtraction, hasBriefSignals, isBriefFactUtterance, isClientReviewCommand, isCopyDraftCommand, isEstimateCommand, isExportCommand, isGenerateCommand, isGenericMaterialRequest, isLayoutOnlyUtterance, isMaterialListCommand, isReviewCommand, isStopCommand, isVenueSizeOnly, isZoneCommand, layoutAnchors, layoutGenerateCommand, mentionsUnsupportedSeating, omitHandledLayoutActions, parseBriefSentence, parseMaterialRequest, pendingPlanOf, prepareAholoAsk, scaleOriginOf, suggestDimsFromArea, suggestDimsFromImageRatio, workingScale } from './workbench-agent';

describe('workbench agent v2.4', () => {
  it('shows a bounded server seating shortfall without calling an object limit venue capacity',()=>{
    for(const code of ['SEATING_SHORTFALL:30:0:no_placement','SHARED_SEATING_SHORTFALL:30:0:0:no_placement']){
      const text=pendingPlanOf([], [{code,ids:[]}], id=>id).seatingShortfall;
      expect(text).toContain('本次新增');expect(text).toContain('原场景物件未计入');expect(text).toContain('不代表场地最大容量');
      expect(text).toContain('尝试其他区域并核对桌椅规格');expect(text).toContain('你也可决定是否调整人数、共桌方式或场地');expect(text).toContain('仍需重新试排');
    }
    const limit=pendingPlanOf([], [{code:'SEATING_SHORTFALL:30:0:object_limit',ids:[]}], id=>id).seatingShortfall;
    expect(limit).toContain('核对当前物件数量和方案规模');expect(limit).not.toContain('换场地就能解决');
    expect(pendingPlanOf([], [{code:'SEATING_SHORTFALL:30:0:preset_unverified',ids:[]}], id=>id).seatingShortfall).toContain('核对场地预设、图纸和尺寸');
    expect(pendingPlanOf([], [{code:'SHARED_SEATING_SHORTFALL:30:0:0:scan_limit',ids:[]}], id=>id).seatingShortfall).toContain('分区试排');
    expect(pendingPlanOf([], [{code:'SHARED_SEATING_SHORTFALL:30:2:0:no_placement',ids:[]}], id=>id).seatingShortfall).toBeUndefined();
    const shared=pendingPlanOf([], [{code:'SHARED_SEATING_SHORTFALL:30:24:12:object_limit',ids:[]}], id=>id);
    expect(shared.seatingShortfall).toContain('24 / 30 人，12 桌，尚缺 6 人');
    expect(shared.seatingShortfall).toContain('不代表场地最大容量');
    for(const code of ['SHARED_SEATING_SHORTFALL:30:24:13:object_limit','SHARED_SEATING_SHORTFALL:30:30:15:object_limit','SHARED_SEATING_SHORTFALL:101:24:12:object_limit','SHARED_SEATING_SHORTFALL:30:24:12:fake'])
      expect(pendingPlanOf([], [{code,ids:[]}], id=>id).seatingShortfall).toBeUndefined();
    expect(pendingPlanOf([], [{code:'SHARED_SEATING_SHORTFALL:30:24:12:object_limit',ids:['unexpected']}], id=>id).seatingShortfall).toBeUndefined();
    const plan=pendingPlanOf([], [{code:'SEATING_SHORTFALL:30:24:object_limit',ids:[]}], id=>id);
    expect(plan.seatingShortfall).toContain('24 / 30 套');
    expect(plan.seatingShortfall).toContain('尚缺 6 套');
    expect(plan.seatingShortfall).toContain('不代表场地最大容量');
    for(const code of ['SEATING_SHORTFALL:30:31:object_limit','SEATING_SHORTFALL:101:1:object_limit','SEATING_SHORTFALL:30:24:fake']) {
      expect(pendingPlanOf([], [{code,ids:[]}], id=>id).seatingShortfall).toBeUndefined();
    }
    expect(pendingPlanOf([], [{code:'SEATING_SHORTFALL:30:24:object_limit',ids:['unexpected']}], id=>id).seatingShortfall).toBeUndefined();
  });
  it('validates length/width 1–500 m with handoff copy', () => {
    expect(checkDim('', '长度')).toEqual({ ok: false, empty: true });
    expect(checkDim('0', '长度')).toMatchObject({ message: '长度要大于 0' });
    expect(checkDim('-', '宽度')).toMatchObject({ message: '宽度要大于 0' });
    expect(checkDim('-3', '宽度')).toMatchObject({ message: '不能是负数' });
    expect(checkDim('0.5', '长度')).toMatchObject({ message: '至少 1 m' });
    expect(checkDim('800', '长度')).toMatchObject({ message: '最大 500 m，是不是填成了厘米？' });
    expect(checkDim('１０．５', '长度')).toEqual({ ok: true, value: 10.5 });
    expect(checkDim('500', '长度')).toEqual({ ok: true, value: 500 });
  });
  it('classifies dropped files (images only this round)', () => {
    expect(classifyFile({ name: 'a.PNG', size: 10 })).toBe('image');
    expect(classifyFile({ name: 'a.jpg', size: 21 * 1024 * 1024 })).toBe('tooLarge');
    expect(classifyFile({ name: 'a.dxf', size: 1 })).toBe('nonImage');
    expect(classifyFile({ name: 'a.dwg', size: 1 })).toBe('nonImage');
    expect(classifyFile({ name: 'a.heic', size: 1 })).toBe('unsupported');
    expect(classifyFile({ name: 'a.pdf', size: 1 })).toBe('nonImage');
  });
  it('treats the conversation as the only generate entry', () => {
    expect(isGenerateCommand('出方案')).toBe('first');
    expect(isGenerateCommand('为30人办室内讲座，场地长12米宽10米，采用课桌椅布局，生成方案')).toBe('first');
    expect(isGenerateCommand('生成方案')).toBe('first');
    expect(isGenerateCommand('先用假设探索')).toBe('first');
    expect(isGenerateCommand('先探索')).toBe('first');
    for(const text of ['不要先探索','如何先探索','先用假设探索吗？','探索不同活动的历史'])expect(isGenerateCommand(text)).toBe(null);
    expect(isGenerateCommand('30人，按一人一套课桌椅生成本地草案，不要签到')).toBe('first');
    for(const text of ['不要生成本地草案','如何生成本地草案','生成本地草案是什么意思','生成本地草案吗？'])expect(isGenerateCommand(text)).toBe(null);
    for(const text of ['不要生成方案','如何生成方案','能否生成方案？','生成方案是什么意思'])expect(isGenerateCommand(text)).toBe(null);
    expect(isGenerateCommand('就按这个出')).toBe('first');
    expect(isGenerateCommand('80 人发布会，室内 12×9')).toBe(null);
    expect(isGenerateCommand('再加两排桌子')).toBe(null);
    expect(isGenerateCommand('换一版')).toBe('again');
    expect(isGenerateCommand('换个方案')).toBe('again');
    expect(isGenerateCommand('舞台往左挪')).toBe(null);
    for (const text of ['你来布置吧', '帮我摆一下', '帮我布置一下']) expect(isGenerateCommand(text)).toBe('first');
    for (const text of ['换个摆法', '重新布置', '我的意思是你重新布置', '我的意思是你是重新布置', '室内12×9，围成一圈', '沙发围成一圈', '沙发围一圈']) expect(isGenerateCommand(text)).toBe('again');
    for (const text of ['不要换个摆法', '换个摆法吗？', '你来布置吧，加两把椅子', '怎么布置']) expect(isGenerateCommand(text)).toBeNull();
    expect(isLayoutOnlyUtterance('你来布置吧')).toBe(true);
    expect(isLayoutOnlyUtterance('帮我摆一下')).toBe(true);
    expect(isLayoutOnlyUtterance('30人，你来布置吧')).toBe(false);
    for (const text of ['圆桌', '改成圆桌', '课桌椅']) {
      expect(classifyLocalLayout(text), text).toBe('generate');
      expect(isGenerateCommand(text), text).toBe('first');
      expect(isLayoutOnlyUtterance(text), text).toBe(true);
    }
    for (const text of ['不要圆桌', '圆桌待定', '圆桌或站立', '我们有80套圆桌', '圆桌吗？']) expect(isGenerateCommand(text), text).toBeNull();
    expect(isBriefFactUtterance('80人')).toBe(true);
    expect(isBriefFactUtterance('室内 12×9')).toBe(true);
    expect(isBriefFactUtterance('80人，室内12×9，圆桌')).toBe(true);
    expect(isBriefFactUtterance('想把会场摆成围坐，80人，室内12×9，圆桌，松一点')).toBe(false);
    expect(isGenerateCommand('想把会场摆成围坐，80人，室内12×9，圆桌，松一点')).toBe('again');
    expect(isGenerateCommand('过道再宽一点')).toBe('again');
    expect(mentionsUnsupportedSeating('沙发围成一圈')).toBe(true);
    expect(mentionsUnsupportedSeating('我们有3个沙发')).toBe(false);
    expect(layoutGenerateCommand('换个摆法')).toBe('again');
    for (const text of ['摆好看一点', '能不能紧凑一点', '座位多留点过道', '再来一版', '按刚才说的摆', '不要课桌改沙发']) {
      expect(classifyLocalLayout(text), text).toBe('revise');
      expect(isGenerateCommand(text), text).toBe('again');
    }
    expect(classifyLocalLayout('先出一版看看')).toBe('generate');
    expect(isGenerateCommand('先出一版看看')).toBe('first');
    expect(classifyLocalLayout('请帮我办消防验收')).toBe('cannot');
    expect(isGenerateCommand('今天天气不错')).toBeNull();
    expect(mentionsUnsupportedSeating('不要课桌改沙发')).toBe(true);
    expect(omitHandledLayoutActions('你来布置吧', [{ kind: 'action', evidence: '你来布置吧' }, { kind: 'action', evidence: '删除椅子' }])).toEqual([{ kind: 'action', evidence: '删除椅子' }]);
    expect(isEstimateCommand('按图纸估')).toBe(true);
    expect(isEstimateCommand('按图纸比例估一下')).toBe(true);
    expect(isEstimateCommand('出方案')).toBe(false);
  });
  it('asks one question when the sentence carries nothing to build on', () => {
    expect(hasBriefSignals(parseBriefSentence('帮我看下这个场地'))).toBe(false);
    expect(hasBriefSignals(parseBriefSentence('80 人发布会'))).toBe(true);
    expect(hasBriefSignals(parseBriefSentence('12×9 的户外草坪'))).toBe(true);
  });
  it('recognises stop commands', () => {
    expect(isStopCommand('停一下')).toBe(true);
    expect(isStopCommand('停')).toBe(true);
    expect(isStopCommand('舞台往左挪')).toBe(false);
  });
});

describe('一句话开场解析', () => {
  it('reads headcount, venue, dims, event and time from one sentence', () => {
    expect(parseBriefSentence('100平米的室内场地，60人的品牌沙龙，晚上办')).toMatchObject({
      headcount: 60, areaM2: 100, venueIO: 'indoor', event: '沙龙', timeOfDay: 21,
    });
  });
  it('keeps area from being counted as headcount and prefers explicit LxW', () => {
    expect(parseBriefSentence('300平米户外市集')).toMatchObject({ areaM2: 300, headcount: null, venueIO: 'outdoor', event: '市集' });
    expect(parseBriefSentence('场地12x16米，80人发布会')).toMatchObject({ lengthM: 12, widthM: 16, areaM2: null, headcount: 80, event: '发布会' });
  });
  it('normalises full-width digits and × separators', () => {
    expect(parseBriefSentence('１２×１６米，５０人工作坊')).toMatchObject({ lengthM: 12, widthM: 16, headcount: 50, event: '工作坊' });
  });
  it('reads 酒会 as the event and leaves 宴会厅 as the room', () => {
    expect(parseBriefSentence('80 人室内酒会')).toMatchObject({ headcount: 80, venueIO: 'indoor', event: '酒会' });
    expect(parseBriefSentence('宴会厅 12×9')).toMatchObject({ event: null, venueIO: 'indoor', lengthM: 12, widthM: 9 });
  });
  it('returns all-null for sentences without any signal', () => {
    const empty = parseBriefSentence('帮我布置一下');
    expect(empty.event).toBeNull();
    expect(empty.headcount).toBeNull();
    expect(empty.areaM2).toBeNull();
    expect(empty.venueIO).toBeNull();
  });
  it('derives 4:3 dims from area and image-ratio dims for base plans', () => {
    expect(suggestDimsFromArea(120)).toEqual({ length: 12.5, width: 9.5 });
    const landscape = suggestDimsFromImageRatio(1600, 800, 100);
    expect(landscape.length).toBeGreaterThan(landscape.width);
    expect(Math.abs(landscape.length * landscape.width - 100)).toBeLessThanOrEqual(4);
  });
  it('recaps the scale as fact only when a human gave it', () => {
    const typed = describeExtraction(parseBriefSentence('60人的沙龙'), { length: 12, width: 8, origin: 'typed' });
    expect(typed).toContain('60 人');
    expect(typed).toContain('12 × 8 m');
    expect(typed).toContain('沙龙');
    const stated = describeExtraction(parseBriefSentence('12x8米，60人的沙龙'), { length: 12, width: 8, origin: 'stated' });
    expect(stated).toContain('12 × 8 m（96 ㎡）');
  });
  it('uses the standing venue size and still stays silent on a bare canvas', () => {
    const standing = workingScale(parseBriefSentence('60人的沙龙'), { width: 12, height: 9, venueUp: true }, 'canvas');
    expect(standing).toMatchObject({ length: 12, width: 9, origin: 'typed', fromVenue: true });
    expect(describeExtraction(parseBriefSentence('60人的沙龙'), standing)).toContain('12 × 9 m');
    const bare = workingScale(parseBriefSentence('60人的沙龙'), { width: 10, height: 8, venueUp: false }, 'canvas');
    expect(bare.origin).toBe('canvas');
    expect(bare.fromVenue).toBe(false);
    expect(describeExtraction(parseBriefSentence('60人的沙龙'), bare)).toContain('场地尺寸还没定');
  });
  it('names stage and check-in for a launch, and skips both for a classroom', () => {
    expect(layoutAnchors('80人发布会', '发布会', 'dining')).toEqual({ stage: false, checkin: false });
    expect(layoutAnchors('不要签到', '发布会', 'dining').checkin).toBe(false);
    expect(layoutAnchors('课桌配椅子', '教学', 'desk-chair')).toEqual({ stage: false, checkin: false });
  });
  it('prepares an Aholo sentence without treating a layout ask as a paid generate', () => {
    expect(prepareAholoAsk('生成一个竹林场景')).toEqual({ kind: 'world', prompt: '生成一个竹林场景', title: '场景' });
    expect(prepareAholoAsk('文生一张白桌')).toMatchObject({ kind: 'text', title: '物件' });
    expect(prepareAholoAsk('用群核做一个竹林场景')).toMatchObject({ kind: 'world', title: '场景' });
    expect(prepareAholoAsk('群核生成一把椅子')).toMatchObject({ kind: 'text', title: '物件' });
    expect(prepareAholoAsk('请用群核重建这块场地')).toMatchObject({ kind: 'recon', title: '场地' });
    expect(prepareAholoAsk('图生一把折叠椅')).toMatchObject({ kind: 'text', title: '图片物件' });
    expect(prepareAholoAsk('80 人发布会，出方案')).toBeNull();
    expect(prepareAholoAsk('加一个签到台')).toBeNull();
    expect(prepareAholoAsk('换个摆法')).toBeNull();
    expect(prepareAholoAsk('群核是什么')).toBeNull();
  });
  it('stays silent on metres before the scale is confirmed', () => {
    // 硬钉「确认前不报假米数」：画布当前那块空地不是场地真相，一个字米数都不能报。
    const text = describeExtraction(parseBriefSentence('60人的沙龙'), { length: 10, width: 8, origin: 'canvas' });
    expect(text).toContain('场地尺寸还没定');
    expect(text).not.toMatch(/\d+(\.\d+)?\s*×\s*\d+/);
    expect(text).not.toContain('㎡');
  });
  it('labels converted and estimated sizes as not yet confirmed', () => {
    const fromArea = describeExtraction(parseBriefSentence('100平米的展览'), { length: 11.5, width: 8.5, origin: 'area' });
    expect(fromArea).toContain('按 4:3 折算');
    expect(fromArea).toContain('你改过我才当准');
    const fromPlan = describeExtraction(parseBriefSentence('换个思路'), { length: 14, width: 7, origin: 'plan' });
    expect(fromPlan).toContain('等你确认');
  });
  it('tracks where the scale came from', () => {
    expect(scaleOriginOf(parseBriefSentence('场地12x16米，80人发布会'), 'canvas')).toBe('stated');
    expect(scaleOriginOf(parseBriefSentence('300平米户外市集'), 'canvas')).toBe('area');
    expect(scaleOriginOf(parseBriefSentence('再换个思路'), 'typed')).toBe('typed');
  });
  it('treats a bare size sentence as shell-only, anything else as a layout ask', () => {
    expect(isVenueSizeOnly(parseBriefSentence('改成 15×10'))).toBe(true);
    expect(isVenueSizeOnly(parseBriefSentence('改成 100 平米'))).toBe(true);
    expect(isVenueSizeOnly(parseBriefSentence('40 人，室内 12×9'))).toBe(false);
    // 室内外只说明场地本身，跟着壳走，不算「要一版布置」。
    expect(isVenueSizeOnly(parseBriefSentence('12×9 的户外草坪'))).toBe(true);
    expect(isVenueSizeOnly(parseBriefSentence('12×9 的户外市集'))).toBe(false);
    expect(isVenueSizeOnly(parseBriefSentence('晚上 12×9 的场地'))).toBe(false);
    expect(isVenueSizeOnly(parseBriefSentence('出方案'))).toBe(false);
  });
  it('reads a cloud proposal the same way as a local one', () => {
    const names: Record<string, string> = { a: '长条桌', b: '背景板', c: '落地花艺' };
    const plan = pendingPlanOf(
      [{ kind: 'added', locked: false }, { kind: 'added', locked: false }, { kind: 'removed', locked: false }, { kind: 'changed', locked: false }],
      [{ code: 'OVERLAP', ids: ['a', 'b'] }, { code: 'OUT_OF_BOUNDS', ids: ['a'] }],
      id => names[id] ?? '物件',
    );
    expect(plan).toMatchObject({ added: 2, removing: 1, changed: 1, overlapCount: 2 });
    expect(plan.overlapNames).toEqual(['长条桌', '背景板']);
  });
  it('counts locked items a proposal moved and ignores unrelated checks', () => {
    const plan = pendingPlanOf(
      [{ kind: 'changed', locked: true }, { kind: 'removed', locked: true }, { kind: 'added', locked: false }],
      [{ code: 'LOW_CONFIDENCE', ids: ['zz'] }],
      () => '不该出现',
    );
    expect(plan.lockedTouched).toBe(2);
    expect(plan.overlapCount).toBe(0);
    expect(plan.overlapNames).toEqual([]);
  });
  it('reports an empty proposal as nothing to confirm', () => {
    expect(pendingPlanOf([], [], () => '物件')).toMatchObject({ added: 0, removing: 0, changed: 0, lockedTouched: 0, overlapCount: 0 });
  });
  it('carries incomplete safety coverage to the main proposal card',()=>{
    expect(pendingPlanOf([{kind:'added',locked:false}],[{code:'SAFETY_CHECKS_UNKNOWN',ids:[]}],()=> '物件')).toMatchObject({safetyChecksUnknown:true});
  });
});

describe('对话改左栏那几件事（第 4 节：不再开第二套表单页）', () => {
  it('reads how many of which material to add, including Chinese counts', () => {
    expect(parseMaterialRequest('再加两把椅子')).toMatchObject({ materialId: 'chair', count: 2 });
    expect(parseMaterialRequest('加3张桌子')).toMatchObject({ materialId: 'table', count: 3 });
    expect(parseMaterialRequest('补二十个展架')).toMatchObject({ materialId: 'display', count: 20 });
    expect(parseMaterialRequest('再来两盆绿植')).toMatchObject({ materialId: 'decoration', count: 2 });
  });

  it('defaults to one when the measure word eats the number, and never goes past 50', () => {
    expect(parseMaterialRequest('加个背景板')).toMatchObject({ materialId: 'backdrop', count: 1 });
    expect(parseMaterialRequest('加100把椅子')).toMatchObject({ materialId: 'chair', count: 50 });
  });

  it('does not mistake moving an item for adding one', () => {
    expect(parseMaterialRequest('把桌子往左挪')).toBeNull();
    expect(parseMaterialRequest('加20人')).toBeNull();
  });

  it('routes list, draft, zone and vague add requests without a second form', () => {
    expect(isMaterialListCommand('出物料清单')).toBe(true);
    expect(isMaterialListCommand('现场用了哪些物料')).toBe(true);
    expect(isCopyDraftCommand('写段朋友圈文案')).toBe(true);
    expect(isCopyDraftCommand('来一句邀请语')).toBe(true);
    expect(isZoneCommand('换到A区')).toBe(true);
    expect(isZoneCommand('换个区')).toBe(true);
    expect(isGenericMaterialRequest('帮我加点物料')).toBe(true);
    expect(isGenericMaterialRequest('加20人')).toBe(false);
  });

  it('routes export intent to a preview card, never straight to a download', () => {
    expect(isExportCommand('导出给搭建方')).toBe(true);
    expect(isExportCommand('出交接')).toBe(true);
    expect(isExportCommand('导出物料')).toBe(true);
    expect(isExportCommand('出物料清单')).toBe(false);
    expect(isExportCommand('换一版')).toBe(false);
    expect(isExportCommand('再加两把椅子')).toBe(false);
  });

  it('routes a review request without stealing “换一版” or a material add', () => {
    expect(isReviewCommand('看看哪里有问题')).toBe(true);
    expect(isReviewCommand('检查一下动线顺不顺')).toBe(true);
    expect(isReviewCommand('太挤了，改一版')).toBe(true);
    expect(isReviewCommand('帮我优化一下')).toBe(true);
    expect(isReviewCommand('换一版')).toBe(false);
    expect(isReviewCommand('再加两把椅子')).toBe(false);
    expect(isReviewCommand('出物料清单')).toBe(false);
  });

  it('opens the customer review workspace only for explicit review intent', () => {
    expect(isClientReviewCommand('准备客户评审')).toBe(true);
    expect(isClientReviewCommand('给甲方看方案')).toBe(true);
    expect(isClientReviewCommand('发一版评审包')).toBe(true);
    expect(isClientReviewCommand('走一遍给客户看')).toBe(false);
    expect(isClientReviewCommand('客户评审做完了吗')).toBe(true);
    expect(isClientReviewCommand('加两把椅子')).toBe(false);
  });
});
