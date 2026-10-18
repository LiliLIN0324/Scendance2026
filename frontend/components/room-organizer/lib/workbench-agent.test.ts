import { describe, expect, it } from 'vitest';
import { canGenerate, checkDim, classifyFile, isStopCommand, sanitizeDimInput } from './workbench-agent';

describe('workbench agent v2.4', () => {
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
  it('keeps at most one decimal and digits only', () => {
    expect(sanitizeDimInput('12.345')).toBe('12.3');
    expect(sanitizeDimInput('1a0m')).toBe('10');
    expect(sanitizeDimInput('８')).toBe('8');
  });
  it('classifies dropped files (images only this round)', () => {
    expect(classifyFile({ name: 'a.PNG', size: 10 })).toBe('image');
    expect(classifyFile({ name: 'a.jpg', size: 21 * 1024 * 1024 })).toBe('tooLarge');
    expect(classifyFile({ name: 'a.dxf', size: 1 })).toBe('cad');
    expect(classifyFile({ name: 'a.dwg', size: 1 })).toBe('cad');
    expect(classifyFile({ name: 'a.heic', size: 1 })).toBe('unsupported');
    expect(classifyFile({ name: 'a.pdf', size: 1 })).toBe('unsupported');
  });
  it('enables the CTA only with valid dims once a base plan exists', () => {
    const ok = checkDim('10', '长度'), bad = checkDim('', '宽度');
    expect(canGenerate('empty', false, bad, bad)).toBe(true);
    expect(canGenerate('baseNoDims', true, ok, bad)).toBe(false);
    expect(canGenerate('baseReady', true, ok, ok)).toBe(true);
    expect(canGenerate('generating', false, ok, ok)).toBe(false);
  });
  it('recognises stop commands', () => {
    expect(isStopCommand('停一下')).toBe(true);
    expect(isStopCommand('停')).toBe(true);
    expect(isStopCommand('舞台往左挪')).toBe(false);
  });
});
