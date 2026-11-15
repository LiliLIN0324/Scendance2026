import { beforeEach, describe, expect, it } from 'vitest';
import {
  backToGenerationChooser,
  chooseGenerationTask,
  closeGenerationSheet,
  generationNeedsCredit,
  generationPrimaryLabel,
  generationScopeTitle,
  generationSheetTitle,
  generationTargetLabel,
  generationTaskList,
  getGenerationSheetState,
  openGenerationSheet,
  resetGenerationSheetForTests,
  subscribeGenerationSheet,
} from './generation-sheet';

/**
 * 统一生成面板的状态契约：面板只有一个，入口只差「来路（scope）」与「带不带设施」。
 * scope 决定卡片标题与首层选项，防止以后又在各个库里各长一张生成表单。
 */
describe('generation-sheet 状态', () => {
  beforeEach(() => { resetGenerationSheetForTests(); });

  it('场地入口：先问做什么，标题叫「场地」，只列场地两项', () => {
    openGenerationSheet({ scope: 'venue' });
    const state = getGenerationSheetState();
    expect(state.open).toBe(true);
    expect(state.task).toBe('choose');
    expect(state.scope).toBe('venue');
    expect(state.facility).toBeNull();
    expect(generationScopeTitle(state.scope)).toBe('场地');
    expect(generationTaskList('venue')).toEqual(['scene-recon', 'scene-new', 'model']);
  });

  it('属性卡入口：直接进模型表单，标题「生成模型」并带上设施', () => {
    openGenerationSheet({ task: 'model', scope: 'facility', facility: { id: 'f-1', name: '沙滩椅' } });
    const state = getGenerationSheetState();
    expect(state.task).toBe('model');
    expect(state.scope).toBe('facility');
    expect(generationScopeTitle(state.scope)).toBe('生成模型');
    // 目标必须在面板里写出来，否则用户不知道这炉给谁。
    expect(generationTargetLabel(state.facility)).toBe('用于「沙滩椅」');
  });

  it('物料星入口：直接进模型表单，标题「生成物料」，结果进模型库', () => {
    openGenerationSheet({ task: 'model', scope: 'material' });
    const state = getGenerationSheetState();
    expect(state.facility).toBeNull();
    expect(generationScopeTitle(state.scope)).toBe('生成物料');
    expect(generationTargetLabel(null)).toBe('保存到模型库');
  });

  it('不传 scope 时按来路推：带设施=设施、模型任务=物料、其余=场地', () => {
    openGenerationSheet({});
    expect(getGenerationSheetState().scope).toBe('venue');
    openGenerationSheet({ task: 'model' });
    expect(getGenerationSheetState().scope).toBe('material');
    openGenerationSheet({ task: 'model', facility: { id: 'f-2', name: '遮阳伞' } });
    expect(getGenerationSheetState().scope).toBe('facility');
  });

  it('三个任务都在同一张卡里；换任务只退回首层，不丢来路', () => {
    expect(generationTaskList('material')).toEqual(['model', 'scene-recon', 'scene-new']);
    openGenerationSheet({ task: 'model', scope: 'material' });
    backToGenerationChooser();
    expect(getGenerationSheetState().task).toBe('choose');
    expect(getGenerationSheetState().scope).toBe('material');
    // 从物料卡换到场景：目标设施清掉，来路改成场地，标题跟着这件事走。
    chooseGenerationTask('scene-new');
    expect(getGenerationSheetState().scope).toBe('venue');
    expect(generationSheetTitle(getGenerationSheetState())).toBe('生成新场景');
    // 再到模型：没设施就是「生成物料」。
    chooseGenerationTask('model');
    expect(generationSheetTitle(getGenerationSheetState())).toBe('生成物料');
  });

  it('关闭复位，并通知订阅者', () => {
    const seen: string[] = [];
    const off = subscribeGenerationSheet(() => seen.push(`${getGenerationSheetState().open}:${getGenerationSheetState().task}`));
    openGenerationSheet({ task: 'scene-new', scope: 'venue' });
    closeGenerationSheet();
    off();
    openGenerationSheet({ task: 'model', scope: 'material' });
    expect(seen).toEqual(['true:scene-new', 'false:choose']);
    expect(getGenerationSheetState().task).toBe('model');
  });

  it('带进来的描述只在开面板时带一次，换任务不丢、关掉清空', () => {
    // 活动对话点名「生成一把藤椅」时，原话要落进描述框；用户随后换了任务也仍是那句话。
    openGenerationSheet({ task: 'model', scope: 'material', prompt: '  一把藤编躺椅  ' });
    expect(getGenerationSheetState().prompt).toBe('一把藤编躺椅');
    chooseGenerationTask('model');
    expect(getGenerationSheetState().prompt).toBe('一把藤编躺椅');
    closeGenerationSheet();
    expect(getGenerationSheetState().prompt).toBe('');
    openGenerationSheet({ task: 'model', scope: 'material' });
    expect(getGenerationSheetState().prompt).toBe('');
  });

  it('主按钮文案与扣额度确认随操作变：导入不扣费', () => {
    expect(generationPrimaryLabel('scene-recon')).toBe('开始重建');
    expect(generationPrimaryLabel('scene-new')).toBe('生成');
    expect(generationPrimaryLabel('model', 'text')).toBe('生成');
    expect(generationPrimaryLabel('model', 'image')).toBe('生成');
    expect(generationPrimaryLabel('model', 'import')).toBe('导入');
    expect(generationNeedsCredit('model', 'import')).toBe(false);
    expect(generationNeedsCredit('model', 'text')).toBe(true);
    expect(generationNeedsCredit('scene-recon')).toBe(true);
    expect(generationNeedsCredit('choose')).toBe(false);
  });
});
