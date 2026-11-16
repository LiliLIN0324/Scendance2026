import { describe, expect, it } from 'vitest';
import { parseInstructionLayers } from './instruction-layers';

describe('parseInstructionLayers', () => {
  it('「无室内，后续是造墙」拆成一条环境口径 + 一条后置', () => {
    const layers = parseInstructionLayers('无室内，后续是造墙');
    expect(layers.environment).toBe('outdoor');
    expect(layers.deferred).toEqual(['后续是造墙']);
    expect(layers.immediate).toBe('无室内');
  });

  it('「先把室外摆好，之后造墙」只拆后置，不把“先室外”当成“无室内”', () => {
    const layers = parseInstructionLayers('先把室外摆好，之后造墙');
    expect(layers.deferred).toEqual(['之后造墙']);
    expect(layers.immediate).toBe('先把室外摆好');
    // “先摆室外”是顺序，不是口径——不能顺手把环境锁成 outdoor。
    expect(layers.environment).toBeUndefined();
  });

  it('室内外都有时记 both，不误判成只用室外', () => {
    const layers = parseInstructionLayers('室内外都有，后面再砌隔墙');
    expect(layers.environment).toBe('both');
    expect(layers.deferred).toEqual(['后面再砌隔墙']);
  });

  it('只做室内的句子记 indoor', () => {
    expect(parseInstructionLayers('没有室外，只做室内').environment).toBe('indoor');
  });

  it('没提环境、没提后置的普通句子保持原样，不编约束', () => {
    const layers = parseInstructionLayers('先划展览区和表演区');
    expect(layers.environment).toBeUndefined();
    expect(layers.deferred).toEqual([]);
    expect(layers.immediate).toBe('先划展览区和表演区');
  });

  it('整句都是后置动作时 immediate 为空，调用方据此不再追问', () => {
    const layers = parseInstructionLayers('后续是造墙');
    expect(layers.deferred).toEqual(['后续是造墙']);
    expect(layers.immediate).toBe('');
  });

  it('一句话里两件后置都能捞出来，且按出现顺序', () => {
    const layers = parseInstructionLayers('无室内，后续是造墙，之后吊顶');
    expect(layers.deferred).toEqual(['后续是造墙', '之后吊顶']);
    expect(layers.environment).toBe('outdoor');
  });

  it('空字符串不崩、不产生任何约束', () => {
    expect(parseInstructionLayers('')).toEqual({ deferred: [], immediate: '' });
    expect(parseInstructionLayers(undefined as unknown as string)).toEqual({ deferred: [], immediate: '' });
  });

  it('「没有室内」这类否定也算室外口径', () => {
    expect(parseInstructionLayers('这场没有室内').environment).toBe('outdoor');
  });
});
