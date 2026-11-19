import { describe, expect, it } from 'vitest';
import { isGeneratedScanName, readableScanName, scanDayLabel, withScanNameOrdinal } from './scan-names';

const DAY = Date.UTC(2026, 10, 8); // 11/08

describe('实景扫描的显示名', () => {
  it('历史占位名换成日期名：来源前缀与资产号都不进界面', () => {
    for (const raw of ['本机高斯 48245ba8', '云端高斯 6645e211', '高斯 9587c51d', '本机高斯 48245ba8-8f0c']) {
      const name = readableScanName(raw, DAY);
      expect(name).not.toMatch(/本机|云端|高斯/);
      expect(name).toBe(`实景扫描 ${scanDayLabel(DAY)}`);
    }
  });

  it('用户自己起的名字一个字不改（前缀只在前接类别词时去掉）', () => {
    expect(readableScanName('西湖 0233 · 标准档', DAY)).toBe('西湖 0233 · 标准档');
    expect(readableScanName('云栖小镇入口', DAY)).toBe('云栖小镇入口');
    expect(readableScanName('云端高斯 西湖茶亭', DAY)).toBe('西湖茶亭');
  });

  it('没有名字也没有时间就只叫「实景扫描」，不编日期', () => {
    expect(readableScanName('', undefined)).toBe('实景扫描');
    expect(readableScanName('云端高斯 6645e211', undefined)).toBe('实景扫描');
    expect(scanDayLabel(Number.NaN)).toBe('');
  });

  it('同一天的占位名按出现顺序加序号，用户名字不参与', () => {
    const seen = new Map<string, number>();
    const first = withScanNameOrdinal('实景扫描 11/05', seen);
    const second = withScanNameOrdinal('实景扫描 11/05', seen);
    expect([first, second]).toEqual(['实景扫描 11/05', '实景扫描 11/05 · 2']);
    expect(isGeneratedScanName(first)).toBe(true);
    expect(isGeneratedScanName('西湖 0233 · 极速档')).toBe(false);
  });
});
