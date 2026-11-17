import { describe, expect, it } from 'vitest';
import { materialScopeLabel, parseMaterialCommand } from './material-command';

describe('材质语言命令', () => {
  it('选中集：把这几个改成金属', () => {
    expect(parseMaterialCommand('把这几个改成金属')).toEqual({ preset: 'metal', scope: 'selection', typeWord: null });
  });

  it('全案：全部换深木', () => {
    expect(parseMaterialCommand('全部换深木')).toEqual({ preset: 'walnut', scope: 'all', typeWord: null });
  });

  it('按类型：所有椅子改浅木', () => {
    expect(parseMaterialCommand('所有椅子改浅木')).toEqual({ preset: 'oak', scope: 'type', typeWord: '椅' });
  });

  it('支持恢复原样', () => {
    expect(parseMaterialCommand('全部恢复原样')?.preset).toBe('original');
  });

  it('没有材质词或没有改动语气时不出命令', () => {
    expect(parseMaterialCommand('30 人观礼要能坐')).toBeNull();
    expect(parseMaterialCommand('金属')).toBeNull();
  });

  it('两者都有时按材质命令处理', () => {
    expect(parseMaterialCommand('把椅子都换成金属')).toMatchObject({ preset: 'metal', scope: 'type' });
  });
});

describe('作用域文案', () => {
  it('三种作用域都能说清楚', () => {
    expect(materialScopeLabel({ preset: 'metal', scope: 'selection', typeWord: null })).toBe('选中物件');
    expect(materialScopeLabel({ preset: 'metal', scope: 'all', typeWord: null })).toBe('全案');
    expect(materialScopeLabel({ preset: 'oak', scope: 'type', typeWord: '椅' })).toBe('所有椅物件');
  });
});
