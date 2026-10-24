import { describe, expect, it } from 'vitest';
import { canGenerate, checkDim, classifyFile, describeExtraction, isStopCommand, parseBriefSentence, sanitizeDimInput, suggestDimsFromArea, suggestDimsFromImageRatio } from './workbench-agent';

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
    expect(classifyFile({ name: 'a.dxf', size: 1 })).toBe('nonImage');
    expect(classifyFile({ name: 'a.dwg', size: 1 })).toBe('nonImage');
    expect(classifyFile({ name: 'a.heic', size: 1 })).toBe('unsupported');
    expect(classifyFile({ name: 'a.pdf', size: 1 })).toBe('nonImage');
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
  it('recaps the extraction with fallback dims for missing size', () => {
    const text = describeExtraction(parseBriefSentence('60人的沙龙'), { length: 12, width: 8 });
    expect(text).toContain('60 人');
    expect(text).toContain('12 × 8 m');
    expect(text).toContain('沙龙');
  });
});
