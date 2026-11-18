import { describe, expect, it, beforeEach } from 'vitest';
import {
  getGenerationSheetState,
  resetGenerationSheetForTests,
} from './generation-sheet';
import {
  lux3dFacilityTarget,
  lux3dPromptFrom,
  openLux3dDialogGeneration,
  parseLux3dDialogIntent,
} from './lux3d-dialog-entry';

beforeEach(() => resetGenerationSheetForTests());

describe('对话里的 Aholo Lux3D 生成意图', () => {
  it('认出显式 Lux3D 句，并只把道具本身带进描述', () => {
    expect(parseLux3dDialogIntent('用 Lux3D 生成一个木质花箱摆到展览区')).toEqual({ prompt: '木质花箱' });
    expect(lux3dPromptFrom('用 Lux3D 生成一个木质花箱摆到展览区')).toBe('木质花箱');
  });

  it('「生成一个签到台」这类短句也进生成，不再只回一句去侧栏点设施', () => {
    expect(parseLux3dDialogIntent('生成一个签到台')).toEqual({ prompt: '签到台' });
    expect(parseLux3dDialogIntent('帮我做一个 2 米宽的签到台')).toEqual({ prompt: '2 米宽的签到台' });
    expect(parseLux3dDialogIntent('用群核生成一把椅子')).toEqual({ prompt: '椅子' });
  });

  it('只说了引擎和动作时打开面板但不预填空话', () => {
    expect(parseLux3dDialogIntent('用 Aholo Lux3D 生成')).toEqual({ prompt: '' });
    expect(parseLux3dDialogIntent('用 Lux3D 生成三维模型')).toEqual({ prompt: '' });
  });

  it('「摆/放」句是落位预览，不被静默改成收费生成', () => {
    expect(parseLux3dDialogIntent('摆一批折叠椅')).toBeNull();
    expect(parseLux3dDialogIntent('把折叠椅摆到展览区')).toBeNull();
    expect(parseLux3dDialogIntent('布置一个签到台')).toBeNull();
  });

  it('分区/场地/场景/方案类生成不归这个入口', () => {
    expect(parseLux3dDialogIntent('生成一个分区预览')).toBeNull();
    expect(parseLux3dDialogIntent('生成场地')).toBeNull();
    expect(parseLux3dDialogIntent('做一个场景')).toBeNull();
    expect(parseLux3dDialogIntent('生成一版方案')).toBeNull();
  });

  it('否定与取消句不打开面板', () => {
    expect(parseLux3dDialogIntent('不要生成花箱')).toBeNull();
    expect(parseLux3dDialogIntent('取消生成签到台')).toBeNull();
  });

  it('活动描述、过程句、主通道不会被当成生成道具', () => {
    expect(parseLux3dDialogIntent('做户外市集60人')).toBeNull();
    expect(parseLux3dDialogIntent('你在做')).toBeNull();
    expect(parseLux3dDialogIntent('生成主通道')).toBeNull();
    expect(parseLux3dDialogIntent('做一个签到台')).toEqual({ prompt: '签到台' });
  });
});

describe('生成结果回填目标', () => {
  const facilities = [
    { id: 'f-1', name: '签到台' },
    { id: 'f-2', name: '舞台' },
  ];

  it('画布选中优先', () => {
    expect(lux3dFacilityTarget(facilities, ['f-2'], '')).toEqual({ id: 'f-2', name: '舞台' });
  });

  it('没选中时用这句话唯一点名的设施', () => {
    expect(lux3dFacilityTarget(facilities, [], '给签到台生成一个木纹面板')).toEqual({ id: 'f-1', name: '签到台' });
  });

  it('没选中、也没唯一点名时不猜，结果进模型库', () => {
    expect(lux3dFacilityTarget(facilities, [], '生成一个木质花箱')).toBeNull();
    expect(lux3dFacilityTarget(facilities, [], '给签到台和舞台各生成一个')).toBeNull();
  });
});

describe('打开现成生成面板', () => {
  it('没有目标设施时进模型库来路，并预填描述', () => {
    openLux3dDialogGeneration({ prompt: '木质花箱' });
    const state = getGenerationSheetState();
    expect(state).toMatchObject({ open: true, task: 'model', scope: 'material', prompt: '木质花箱' });
  });

  it('有目标设施时回填该设施，不新建第二套生成 UI', () => {
    openLux3dDialogGeneration({ prompt: '木纹面板', facility: { id: 'f-1', name: '签到台' } });
    const state = getGenerationSheetState();
    expect(state).toMatchObject({
      open: true,
      task: 'model',
      scope: 'facility',
      facility: { id: 'f-1', name: '签到台' },
      prompt: '木纹面板',
    });
  });
});
