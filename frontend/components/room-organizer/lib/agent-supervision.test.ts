import { describe, expect, it } from 'vitest';
import {
  BULK_THRESHOLD,
  gateAction,
  normalizeSupervision,
  supervisionLabel,
  type SupervisionLevel,
} from './agent-supervision';

describe('监督档位读数', () => {
  it('认不出来的值回落到关键节点，不静默变成自动放行', () => {
    expect(normalizeSupervision('whatever')).toBe('key-points');
    expect(normalizeSupervision(null)).toBe('key-points');
    expect(normalizeSupervision('strict')).toBe('strict');
    expect(normalizeSupervision('auto')).toBe('auto');
  });

  it('档位名可直接给用户看', () => {
    expect(supervisionLabel('strict')).toBe('严格');
    expect(supervisionLabel('key-points')).toBe('关键节点');
    expect(supervisionLabel('auto')).toBe('自动');
  });
});

describe('gateAction 按动作性质判，不按档位一刀切', () => {
  it.each(['strict','key-points','auto'] as const)('%s 档不能代替付费、外发和不可恢复操作的单独确认',level=>{
    for(const kind of ['paid','external','irreversible'] as const)expect(gateAction(level,{kind,label:'提交任务'})).toMatchObject({required:true});
  });
  const cases: Array<{
    level: SupervisionLevel;
    kind: 'read' | 'write' | 'destructive' | 'bulk';
    count?: number;
    required: boolean;
    note: string;
  }> = [
    { level: 'strict', kind: 'read', required: false, note: '严格档也不问「能不能看一眼」' },
    { level: 'auto', kind: 'read', required: false, note: '自动档更不问只读' },
    { level: 'strict', kind: 'write', count: 3, required: true, note: '严格档普通写入也要问' },
    { level: 'key-points', kind: 'write', count: 3, required: false, note: '关键节点档放行小改动' },
    { level: 'key-points', kind: 'write', count: BULK_THRESHOLD + 1, required: true, note: '超阈值算大范围' },
    { level: 'key-points', kind: 'write', count: BULK_THRESHOLD, required: false, note: '恰好等于阈值不算大范围' },
    { level: 'key-points', kind: 'destructive', required: true, note: '清空/覆盖一律要问' },
    { level: 'auto', kind: 'destructive', required: false, note: '自动档不打断，但改动仍进留痕' },
    { level: 'auto', kind: 'bulk', count: 900, required: false, note: '自动档大范围也不打断' },
    { level: 'strict', kind: 'bulk', count: 900, required: true, note: '严格档大范围先问' },
  ];

  for (const testCase of cases) {
    it(`${testCase.level} · ${testCase.kind}${testCase.count !== undefined ? `(${testCase.count})` : ''} → ${testCase.required ? '要问' : '不问'}：${testCase.note}`, () => {
      const gate = gateAction(testCase.level, {
        kind: testCase.kind,
        ...(testCase.count !== undefined ? { affectedCount: testCase.count } : {}),
        label: '清空区域',
      });
      expect(gate.required).toBe(testCase.required);
      // 要问的时候必须给得出理由：不能让用户对着一个没有说明的问号点同意。
      if (testCase.required) expect(gate.why.length).toBeGreaterThan(0);
      else expect(gate.why).toBe('');
    });
  }

  it('拒绝理由里带上动作名和影响量，念出来能懂', () => {
    const gate = gateAction('key-points', { kind: 'write', affectedCount: 260, label: '铺设道路' });
    expect(gate.why).toContain('铺设道路');
    expect(gate.why).toContain('260');
  });

  it('件数未知的写入不当成大范围，但破坏性仍要问', () => {
    expect(gateAction('key-points', { kind: 'write' }).required).toBe(false);
    expect(gateAction('key-points', { kind: 'destructive' }).required).toBe(true);
  });
});
