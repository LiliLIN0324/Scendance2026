import { describe, expect, it } from 'vitest';
import { formatGapList, formatNextGap, missingEvidence, missingRows, nextGap } from './outdoor-release-gaps';
import { defaultLedger, ledgerFromEvidence, type CaseLedgerRow } from './outdoor-release-status-card';

/**
 * 待补清单（轮次 86）：把“还差什么”写成一条一行，且不允许把“没算”说成“齐了”。
 */

const row = (id: number, fixedData: boolean, browser: 'pass' | 'partial' | 'none', cloud: 'pass' | 'partial' | 'none'): CaseLedgerRow => ({
  id,
  fixedData,
  browser,
  cloud,
});

describe('待补清单', () => {
  it('全未验时 11 条都在清单里，缺的是浏览器与云端（固定数据已有文件）', () => {
    const gaps = missingEvidence(defaultLedger());
    expect(gaps).toHaveLength(11);
    expect(gaps[0].id).toBe(1);
    expect(gaps[0].missing).toEqual(['browser', 'cloud']);
    expect(gaps[0].line).toContain('#1');
    expect(gaps[0].line).toContain('缺：浏览器、云端');
  });

  it('浏览器看过但云端没声明：只缺云端，不重复列已过的', () => {
    const ledger = ledgerFromEvidence([2, 5], { seen: { 2: 'pass' } }, []);
    const gaps = missingEvidence(ledger);
    const case2 = gaps.find((gap) => gap.id === 2);
    expect(case2?.missing).toEqual(['cloud']);
    // 标题取自 `ACCEPTANCE_RULES`，不在这里再拄一份（拄错就会把清单写歪）。
    expect(case2?.line).toBe(`#2 ${case2?.title} —— 缺：云端`);
    expect(case2?.line.startsWith('#2 ')).toBe(true);
  });

  it('三类全绿的行不进清单；清单按编号升序', () => {
    const ledger = [
      row(5, true, 'pass', 'pass'),
      row(3, true, 'partial', 'none'),
      row(2, true, 'pass', 'none'),
    ];
    const gaps = missingEvidence(ledger);
    expect(gaps.map((gap) => gap.id)).toEqual([2, 3]);
    expect(gaps[1].missing).toEqual(['browser', 'cloud']);
  });

  it('末行只报待补与全绿条数，不写“可发布”', () => {
    const text = formatGapList(defaultLedger());
    const last = text.split('\n').slice(-1)[0];
    expect(last).toBe('共 11 条待补 · 台账 11 条 · 三类全绿 0 条（缺口未补前不可发布）');
    expect(text).not.toContain('可发布（');
  });

  it('空台账写“没有台账”，不许写成“无缺口”', () => {
    const text = formatGapList([]);
    expect(text).toContain('没有台账');
    expect(text).not.toContain('无缺口');
    expect(missingEvidence([])).toEqual([]);
  });

  it('台账缺行时可单独查出少了哪几个号', () => {
    expect(missingRows(defaultLedger().filter((row) => row.id !== 5 && row.id !== 9))).toEqual([5, 9]);
    expect(missingRows(defaultLedger())).toEqual([]);
  });
});

describe("下一步干哪条（轮次 99）", () => {
  it("挑号最小的待补用例，并说清先补哪个信号", () => {
    const ledger = defaultLedger();
    const next = nextGap(ledger);
    expect(next?.id).toBe(1);
    const line = formatNextGap(ledger);
    expect(line.startsWith("下一步：#1 ")).toBe(true);
    expect(line).toMatch(/先(去补固定数据用例|去真实浏览器里跑一遍|去云端核实一次)/);
    expect(line).not.toContain("可发布");
  });

  it("空台账不冒充“没活儿”", () => {
    expect(nextGap([])).toBeNull();
    expect(formatNextGap([])).toContain("没有台账");
    expect(formatNextGap([])).not.toContain("无缺口");
  });

  it("全齐时只说“都补齐了”，能不能发仍以状态卡为准", () => {
    const green: CaseLedgerRow[] = [
      { id: 1, fixedData: true, browser: "pass", cloud: "pass" },
    ];
    expect(nextGap(green)).toBeNull();
    const line = formatNextGap(green);
    expect(line).toContain("都补齐了");
    expect(line).toContain("仍以状态卡为准");
  });

  it("下一句与待补清单同源：清单首条就是它", () => {
    const ledger = defaultLedger();
    const first = missingEvidence(ledger)[0];
    expect(formatNextGap(ledger)).toContain(`#${first?.id} ${first?.title}`);
  });
});
