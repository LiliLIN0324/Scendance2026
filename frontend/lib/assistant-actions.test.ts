import { describe, expect, it } from 'vitest';
import { assistantAction } from './assistant-actions';

describe('assistant capability routing', () => {
  it.each([
    ['生成 12 人沙龙场景', 'scene'],
    ['帮我生成一把绿色藤编椅', 'model'],
    ['生成一个 3D 模型，独立灯具', 'model'],
    ['生成一个 3D 场景', 'scene'],
    ['生成场景并生成一件模型', 'choose-action'],
    ['怎么生成模型？', 'help'],
    ['不要生成模型', 'help'],
    ['你好', 'help'],
    ['有哪些预设？', 'choose-preset'],
  ])('routes %s without invoking a service', (message, kind) => {
    expect(assistantAction(message, 'auto').kind).toBe(kind);
  });
  it('supports explicit modes and identifies only available presets', () => {
    expect(assistantAction('绿色藤编椅', 'model')).toEqual({ kind: 'model', prompt: '绿色藤编椅' });
    expect(assistantAction('载入体育馆黑客松预设', 'auto')).toEqual({ kind: 'preset', key: 'gym' });
    expect(assistantAction('使用香氛快闪模板', 'auto')).toEqual({ kind: 'preset', key: 'popup' });
    expect(assistantAction('生成场景并生成一件模型', 'scene')).toEqual({ kind: 'scene' });
  });
});
