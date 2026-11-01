import { describe, expect, it } from 'vitest';
import { describeDiagnostics, mergeDiagnostics, rejectedDiagnostics, summarizeDiagnostics } from './diagnostics';

describe('diagnostics — 没放进去的件数按原因说清楚', () => {
  it('同因同名的件数合并，件数不丢', () => {
    const list = rejectedDiagnostics([
      { name: '餐椅', code: 'STRUCTURAL_COLLISION' },
      { name: '餐椅', code: 'STRUCTURAL_COLLISION' },
      { name: '餐桌', code: 'OUT_OF_BOUNDS' },
    ]);
    expect(list).toHaveLength(2);
    expect(list).toContainEqual({ severity: 'warning', code: 'STRUCTURAL_COLLISION', count: 2, names: ['餐椅'], message: '压墙或立柱' });
    expect(list).toContainEqual({ severity: 'warning', code: 'OUT_OF_BOUNDS', count: 1, names: ['餐桌'], message: '超出场地边界' });
  });

  it('分几步摆时同原因并成一条，不重复念', () => {
    const merged = mergeDiagnostics(
      [{ severity: 'warning', code: 'NO_SPOT', count: 1, names: ['椅子'], message: '附近没有空位' }],
      [
        { severity: 'warning', code: 'NO_SPOT', count: 2, names: ['桌子'], message: '附近没有空位' },
        { severity: 'warning', code: 'UNKNOWN_MATERIAL', count: 1, names: ['x'], message: '物料目录里没有这件' },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find(item => item.code === 'NO_SPOT')).toMatchObject({ count: 3, names: ['椅子', '桌子'] });
  });

  it('汇总给卡片用：总件数、按码分组', () => {
    const summary = summarizeDiagnostics([
      { severity: 'warning', code: 'NO_SPOT', count: 3, names: ['椅子'], message: '附近没有空位' },
      { severity: 'error', code: 'STRUCTURAL_COLLISION', count: 1, names: ['背景板'], message: '压墙或立柱' },
    ]);
    expect(summary).toEqual({
      pieces: 4, errors: 1, warnings: 3,
      byCode: { NO_SPOT: 3, STRUCTURAL_COLLISION: 1 },
    });
  });

  it('一句话：几件、哪些、为什么', () => {
    expect(describeDiagnostics([
      { severity: 'warning', code: 'STRUCTURAL_COLLISION', count: 2, names: ['餐椅'], message: '压墙或立柱' },
      { severity: 'warning', code: 'OUT_OF_BOUNDS', count: 1, names: ['餐桌'], message: '超出场地边界' },
    ])).toBe('3 件没放进去：餐椅、餐桌（压墙或立柱；超出场地边界）');
  });

  it('没有诊断就不说，让调用方走老文案', () => {
    expect(describeDiagnostics([])).toBeNull();
  });
});
