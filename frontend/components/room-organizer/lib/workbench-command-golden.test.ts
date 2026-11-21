import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMaterialRequest, parseRevisionRequest } from './workbench-agent';

/**
 * 文本→命令 golden set 驱动（docs/63 断点5）。
 * 表在 data/agent-corpus/command-golden.json：每条 utterance 必须解析出期望的 op 子集，
 * 或必须解析为 null。新增动词/句式不得绕过这张表——先加表条目，再改解析器。
 * docs/02 §1.2 的两个口头缺陷（缩放10%→0.2×、两盏只加1盏）由 scale-* / add-lamp-two 条目判决。
 */
interface GoldenCase {
  id: string;
  target: 'parseRevisionRequest' | 'parseMaterialRequest';
  utterance: string;
  expectOps?: Array<Record<string, unknown>>;
  expectBands?: Array<Record<string, unknown>>;
  expect?: Record<string, unknown>;
  expectNull?: boolean;
  note?: string;
}
const goldenPath = new URL('../../../../data/agent-corpus/command-golden.json', import.meta.url);
const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as { comment: string; cases: GoldenCase[] };

function expectSubset(expected: Record<string, unknown>, actual: Record<string, unknown>, label: string): void {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key], `${label} · 字段 ${key}`).toEqual(value);
  }
}

describe('文本→命令 golden set', () => {
  it('表本身健康：id 唯一、target 可识别', () => {
    const ids = golden.cases.map(c => c.id);
    expect(new Set(ids).size, 'golden case id 有重复').toBe(ids.length);
    for (const c of golden.cases) {
      expect(['parseRevisionRequest', 'parseMaterialRequest'], `${c.id} target 未知`).toContain(c.target);
      expect(c.expectNull || c.expectOps || c.expect, `${c.id} 既无期望也无反例`).toBeTruthy();
    }
  });

  it('parseRevisionRequest：正例出 op 子集，反例必须为 null', () => {
    for (const c of golden.cases.filter(c => c.target === 'parseRevisionRequest')) {
      const result = parseRevisionRequest(c.utterance);
      if (c.expectNull) {
        expect(result, `${c.id}「${c.utterance}」应解析为 null${c.note ? `（${c.note}）` : ''}`).toBeNull();
        continue;
      }
      expect(result, `${c.id}「${c.utterance}」不应为 null${c.note ? `（${c.note}）` : ''}`).not.toBeNull();
      const ops = result!.ops;
      for (const expected of c.expectOps ?? []) {
        const hit = ops.find(op => op.kind === expected.kind);
        expect(hit, `${c.id} 缺 ${expected.kind} op（实际 ${ops.map(op => op.kind).join('、') || '无'}）`).toBeTruthy();
        expectSubset(expected, hit as unknown as Record<string, unknown>, c.id);
      }
      if (c.expectBands) expect(result!.bands, `${c.id} bands`).toEqual(c.expectBands);
    }
  });

  it('parseMaterialRequest：正例出物料，目录外必须为 null', () => {
    for (const c of golden.cases.filter(c => c.target === 'parseMaterialRequest')) {
      const result = parseMaterialRequest(c.utterance);
      if (c.expectNull) {
        expect(result, `${c.id}「${c.utterance}」应解析为 null${c.note ? `（${c.note}）` : ''}`).toBeNull();
        continue;
      }
      expect(result, `${c.id}「${c.utterance}」不应为 null`).not.toBeNull();
      expectSubset(c.expect ?? {}, result as unknown as Record<string, unknown>, c.id);
    }
  });
});
