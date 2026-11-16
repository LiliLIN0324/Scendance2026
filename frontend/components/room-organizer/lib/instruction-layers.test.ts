import { describe, expect, it } from 'vitest';
import { parseInstructionLayers } from './instruction-layers';

/**
 * 用例口径：用户做的是室外活动、集会/市集。
 * 早先那版拿「无室内，后续是造墙」当样板，那是转述压扁出来的句子，已废弃。
 */
describe('parseInstructionLayers（室外集会口径）', () => {
  it('「先摆摊位，最后再调通道」：现在摆摊位，通道留到后面', () => {
    const layers = parseInstructionLayers('先摆摊位，最后再调通道');
    expect(layers.deferred).toEqual(['最后再调通道']);
    expect(layers.immediate).toBe('先摆摊位');
    // 「室外」是这个产品的默认，句子里没提就不写口径。
    expect(layers.environment).toBeUndefined();
  });

  it('「室外市集，先摆 30 个摊位，等摆完再上围栏」：当前指令完整保留', () => {
    const layers = parseInstructionLayers('室外市集，先摆 30 个摊位，等摆完再上围栏');
    expect(layers.deferred).toEqual(['等摆完再上围栏']);
    expect(layers.immediate).toBe('室外市集，先摆 30 个摊位');
    expect(layers.environment).toBeUndefined();
  });

  it('用户真提到两边都有时才记 both', () => {
    const layers = parseInstructionLayers('室内外都有，后面再砌隔墙');
    expect(layers.environment).toBe('both');
    expect(layers.deferred).toEqual(['后面再砌隔墙']);
  });

  it('明说只做室外时记 outdoor', () => {
    expect(parseInstructionLayers('只做室外，室内不用管').environment).toBe('outdoor');
    expect(parseInstructionLayers('这场没有室内').environment).toBe('outdoor');
  });

  it('明说只做室内时记 indoor', () => {
    expect(parseInstructionLayers('没有室外，只做室内').environment).toBe('indoor');
  });

  it('没有后置、没有口径的普通句子原样返回，不编约束', () => {
    const layers = parseInstructionLayers('先划展览区和表演区');
    expect(layers.environment).toBeUndefined();
    expect(layers.deferred).toEqual([]);
    expect(layers.immediate).toBe('先划展览区和表演区');
  });

  it('整句都是后置动作时 immediate 为空，调用方据此不再追问', () => {
    const layers = parseInstructionLayers('最后再调通道');
    expect(layers.deferred).toEqual(['最后再调通道']);
    expect(layers.immediate).toBe('');
  });

  it('一句话里两件后置都能捞出来，且按出现顺序', () => {
    const layers = parseInstructionLayers('先摆摊位，最后再调通道，之后上围栏');
    expect(layers.deferred).toEqual(['最后再调通道', '之后上围栏']);
    expect(layers.immediate).toBe('先摆摊位');
  });

  it('空字符串不崩、不产生任何约束', () => {
    expect(parseInstructionLayers('')).toEqual({ deferred: [], immediate: '' });
    expect(parseInstructionLayers(undefined as unknown as string)).toEqual({ deferred: [], immediate: '' });
  });
});
