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
  setGenerationModelSource,
  subscribeGenerationSheet,
} from './generation-sheet';

/**
 * 统一生成面板的状态契约：面板只有一个，入口只差「来路（scope）」与「带不带设施」。
 * 创作首层是三张卡片，不再列「生成新场景」；导入也不从创作进来。
 */
describe('generation-sheet 状态', () => {
  beforeEach(() => { resetGenerationSheetForTests(); });

  it('创作入口：先停在卡片，标题叫「创作」，首层不再列生成新场景或生成模型', () => {
    openGenerationSheet({ scope: 'venue' });
    const state = getGenerationSheetState();
    expect(state.open).toBe(true);
    expect(state.task).toBe('choose');
    expect(state.scope).toBe('venue');
    expect(state.source).toBe('text');
    expect(state.facility).toBeNull();
    expect(generationScopeTitle(state.scope)).toBe('创作');
    expect(generationSheetTitle(state)).toBe('创作');
    expect(generationTaskList('venue')).toEqual(['scene-recon']);
    expect(generationTaskList('venue')).not.toContain('scene-new');
    expect(generationTaskList('venue')).not.toContain('model');
  });

  it('场地卡片切到图生后再进入模型表单，来路仍是场地，返回还是卡片', () => {
    openGenerationSheet({ scope: 'venue' });
    setGenerationModelSource('image');
    expect(getGenerationSheetState().task).toBe('choose');
    chooseGenerationTask('model');
    const entered = getGenerationSheetState();
    expect(entered.task).toBe('model');
    expect(entered.scope).toBe('venue');
    expect(entered.source).toBe('image');
    expect(generationSheetTitle(entered)).toBe('图生 3D');
    expect(generationTargetLabel(entered.facility)).toBe('保存到「我的生成」');
    backToGenerationChooser();
    expect(getGenerationSheetState().task).toBe('choose');
    expect(getGenerationSheetState().scope).toBe('venue');
    expect(getGenerationSheetState().source).toBe('image');
  });

  it('场地来路不接受导入，避免和文生 / 图生并列', () => {
    openGenerationSheet({ scope: 'venue', source: 'import' });
    expect(getGenerationSheetState().source).toBe('text');
    setGenerationModelSource('import');
    expect(getGenerationSheetState().source).toBe('text');
  });

  it('属性卡入口：直接进模型表单，标题「生成模型」并带上设施', () => {
    openGenerationSheet({ task: 'model', scope: 'facility', facility: { id: 'f-1', name: '沙滩椅' } });
    const state = getGenerationSheetState();
    expect(state.task).toBe('model');
    expect(state.scope).toBe('facility');
    expect(generationScopeTitle(state.scope)).toBe('生成模型');
    expect(generationTargetLabel(state.facility)).toBe('用于「沙滩椅」');
  });

  it('物料星入口：直接进模型表单，标题「生成物料」，结果进我的生成', () => {
    openGenerationSheet({ task: 'model', scope: 'material' });
    const state = getGenerationSheetState();
    expect(state.facility).toBeNull();
    expect(generationScopeTitle(state.scope)).toBe('生成物料');
    expect(generationTargetLabel(null)).toBe('保存到「我的生成」');
  });

  it('不传 scope 时按来路推：带设施=设施、模型任务=物料、其余=场地', () => {
    openGenerationSheet({});
    expect(getGenerationSheetState().scope).toBe('venue');
    openGenerationSheet({ task: 'model' });
    expect(getGenerationSheetState().scope).toBe('material');
    openGenerationSheet({ task: 'model', facility: { id: 'f-2', name: '遮阳伞' } });
    expect(getGenerationSheetState().scope).toBe('facility');
  });

  it('物料首层只剩模型；从场地模型返回不改来路', () => {
    expect(generationTaskList('material')).toEqual(['model']);
    openGenerationSheet({ task: 'model', scope: 'material' });
    backToGenerationChooser();
    expect(getGenerationSheetState().task).toBe('choose');
    expect(getGenerationSheetState().scope).toBe('material');
    chooseGenerationTask('model');
    expect(generationSheetTitle(getGenerationSheetState())).toBe('生成物料');
  });

  it('关闭复位，并通知订阅者', () => {
    const seen: string[] = [];
    const off = subscribeGenerationSheet(() => seen.push(`${getGenerationSheetState().open}:${getGenerationSheetState().task}`));
    openGenerationSheet({ task: 'scene-recon', scope: 'venue' });
    closeGenerationSheet();
    off();
    openGenerationSheet({ task: 'model', scope: 'material' });
    expect(seen).toEqual(['true:scene-recon', 'false:choose']);
    expect(getGenerationSheetState().task).toBe('model');
  });

  it('带进来的描述只在开面板时带一次，换任务不丢、关掉清空', () => {
    openGenerationSheet({ task: 'model', scope: 'material', prompt: '  一把藤编躺椅  ' });
    expect(getGenerationSheetState().prompt).toBe('一把藤编躺椅');
    chooseGenerationTask('model');
    expect(getGenerationSheetState().prompt).toBe('一把藤编躺椅');
    closeGenerationSheet();
    expect(getGenerationSheetState().prompt).toBe('');
    openGenerationSheet({ task: 'model', scope: 'material' });
    expect(getGenerationSheetState().prompt).toBe('');
  });

  it('主按钮文案与扣额度确认随操作变：导入和重建入口都不扣费', () => {
    expect(generationPrimaryLabel('scene-recon')).toBe('拍摄现场');
    expect(generationPrimaryLabel('model', 'text')).toBe('生成');
    expect(generationPrimaryLabel('model', 'image')).toBe('生成');
    expect(generationPrimaryLabel('model', 'import')).toBe('导入');
    expect(generationNeedsCredit('model', 'import')).toBe(false);
    expect(generationNeedsCredit('model', 'text')).toBe(true);
    expect(generationNeedsCredit('scene-recon')).toBe(false);
    expect(generationNeedsCredit('choose')).toBe(false);
  });
});
