import { describe, expect, it } from 'vitest';
import {
  CHARACTER_STEPS,
  DEFAULT_CHARACTER_ANIMATIONS,
  characterStepIndex,
  nextCharacterStep,
  previousCharacterStep,
} from './character-flow';

describe('人物设计链步骤定义', () => {
  it('按 参考图 → 四视图 → 静态人形 → 绑骨 → 重定向 固定排序', () => {
    expect(CHARACTER_STEPS.map(step => step.id)).toEqual([
      'ref',
      'fourview',
      'model',
      'rig',
      'retarget',
    ]);
  });

  it('前两步产物是 2D 图，后三步产物是 GLB', () => {
    expect(CHARACTER_STEPS.map(step => step.output)).toEqual(['image', 'image', 'glb', 'glb', 'glb']);
  });

  it('next 逐步进位，最后一步返回 null', () => {
    expect(nextCharacterStep('ref')).toBe('fourview');
    expect(nextCharacterStep('fourview')).toBe('model');
    expect(nextCharacterStep('model')).toBe('rig');
    expect(nextCharacterStep('rig')).toBe('retarget');
    expect(nextCharacterStep('retarget')).toBeNull();
  });

  it('previous 逐步回退，第一步返回 null', () => {
    expect(previousCharacterStep('fourview')).toBe('ref');
    expect(previousCharacterStep('retarget')).toBe('rig');
    expect(previousCharacterStep('ref')).toBeNull();
  });

  it('index 与步骤表一致', () => {
    expect(characterStepIndex('ref')).toBe(0);
    expect(characterStepIndex('retarget')).toBe(4);
  });

  it('默认动作恰好包含漫游必需的 Idle 与 Walk', () => {
    expect(DEFAULT_CHARACTER_ANIMATIONS).toEqual(['Idle_Loop', 'Walk_Loop']);
  });
});
