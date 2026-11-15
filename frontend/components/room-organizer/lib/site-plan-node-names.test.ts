import { describe, expect, it } from 'vitest';
import type { PlanNode } from '../../../../supabase/functions/_shared/site-plan';
import {
  autoNodeName,
  autoNodeNameNumber,
  isAutoNodeName,
  planNodeKindLabel,
  renamedNodeName,
} from './site-plan-node-names';

let seq = 0;
function node(name: string, kind: PlanNode['kind']): PlanNode {
  seq += 1;
  return {
    id: `d6000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    kind,
    name,
    position: { x: seq, y: 0 },
    notes: '',
  };
}

describe('出入口自动编号（三型各自从 1 起连续排）', () => {
  it('自动名形态：类型文案 + 数字，出入口排在入口/出口前面', () => {
    expect(isAutoNodeName('入口 1')).toBe(true);
    expect(isAutoNodeName('出入口 12')).toBe(true);
    expect(isAutoNodeName(' 出口 3 ')).toBe(true);
    expect(isAutoNodeName('西门')).toBe(false);
    expect(isAutoNodeName('入口临时')).toBe(false);
    expect(autoNodeNameNumber('出入口 7')).toBe(7);
    expect(autoNodeNameNumber('西门')).toBeNull();
    expect(planNodeKindLabel('entry')).toBe('入口');
    expect(planNodeKindLabel('exit')).toBe('出口');
    expect(planNodeKindLabel('both')).toBe('出入口');
  });

  it('三种类型各排各的号，都从 1 开始', () => {
    const nodes: PlanNode[] = [];
    expect(autoNodeName('entry', nodes)).toBe('入口 1');
    expect(autoNodeName('exit', nodes)).toBe('出口 1');
    expect(autoNodeName('both', nodes)).toBe('出入口 1');

    const withOneEach = [node('入口 1', 'entry'), node('出口 1', 'exit'), node('出入口 1', 'both')];
    expect(autoNodeName('entry', withOneEach)).toBe('入口 2');
    expect(autoNodeName('exit', withOneEach)).toBe('出口 2');
    expect(autoNodeName('both', withOneEach)).toBe('出入口 2');
  });

  it('删掉中间的号会补上，不留断号', () => {
    const nodes = [node('入口 1', 'entry'), node('入口 3', 'entry')];
    expect(autoNodeName('entry', nodes)).toBe('入口 2');
    expect(autoNodeName('exit', [node('出口 2', 'exit')])).toBe('出口 1');
  });

  it('入口 5 改成出口：按出口序列重新取号 → 出口 1（不把 5 带过去）', () => {
    const nodes = [node('入口 5', 'entry')];
    expect(renamedNodeName('入口 5', 'exit', nodes, nodes[0]!.id)).toBe('出口 1');
  });

  it('目标类型已有号时顺延，不会造出两个「出口 1」', () => {
    const nodes = [node('入口 1', 'entry'), node('出口 1', 'exit')];
    expect(renamedNodeName('入口 1', 'exit', nodes, nodes[0]!.id)).toBe('出口 2');
  });

  it('入口 1 改成出口（第一个出口）→ 出口 1；入口 → 双向同理', () => {
    const single = [node('入口 1', 'entry')];
    expect(renamedNodeName('入口 1', 'exit', single, single[0]!.id)).toBe('出口 1');

    const two = [node('入口 2', 'entry')];
    expect(renamedNodeName('入口 2', 'both', two, two[0]!.id)).toBe('出入口 1');
  });

  it('用户手改过的名字不覆盖', () => {
    const nodes = [node('西门', 'entry'), node('西侧临时口', 'both')];
    expect(renamedNodeName('西门', 'exit', nodes, nodes[0]!.id)).toBe('西门');
    expect(renamedNodeName('西侧临时口', 'entry', nodes, nodes[1]!.id)).toBe('西侧临时口');
  });

  it('改名算号时排除自己：唯一一个「入口 1」改成出口，不会被自己挤到出口 2', () => {
    const nodes = [node('入口 1', 'entry')];
    expect(renamedNodeName('入口 1', 'exit', nodes, nodes[0]!.id)).toBe('出口 1');
  });
});
