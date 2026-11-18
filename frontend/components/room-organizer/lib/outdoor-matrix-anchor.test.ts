import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessAcceptance } from './outdoor-acceptance-selfcheck';
import type { SessionReport } from './outdoor-session-report';
import type { TraceExportRow } from './turn-trace-log';
import { defaultLedger, statusCardSnapshot } from './outdoor-release-status-card';

/**
 * 对照表 §0 的「当前状态快照（锚点）」必须与代码算出来的东西逐字一致（轮次 70）。
 *
 * 锚点是给人看、给下一轮 diff 的；它一旦和代码脱节，就会变成下一个过期基线。
 * 所以不靠人比，由这条用例把文档里的 JSON 与 `statusCardSnapshot()` 对起来。
 */

const AT = 0;

function report(rows: TraceExportRow[] = [], mapCalls = 0): SessionReport {
  return {
    version: 1,
    exportedAt: AT,
    traces: { version: 1, exportedAt: AT, rows, text: '' },
    metrics: {
      totals: {
        turns: rows.length,
        modelCalls: 0,
        mapCalls,
        confirmations: 0,
        appliedCount: 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: null,
        applyAvgMs: null,
      },
      rows: [],
      text: `turns=${rows.length} model=0 map=${mapCalls} confirm=0 applied=0`,
    },
    text: `turns=${rows.length} model=0 map=${mapCalls} confirm=0 applied=0`,
  };
}

/** 取 §0 里第一段 ```json 代码块并解析。 */
function readAnchor(): unknown {
  const file = path.join(
    process.cwd(),
    '..',
    'docs',
    'plans',
    '2026-11-16-outdoor-evidence-matrix.md',
  );
  const text = readFileSync(file, 'utf8');
  const section = text.split('## 0. 当前状态快照')[1];
  expect(section, '对照表里找不到 §0 当前状态快照').toBeTruthy();
  const block = /```json\s*\n([\s\S]*?)\n```/.exec(section!.split('## 1.')[0]!);
  expect(block, '§0 里找不到 ```json 代码块').toBeTruthy();
  return JSON.parse(block![1]!);
}

describe('对照表锚点与代码一致', () => {
  it('§0 的 JSON 就是 statusCardSnapshot(默认台账) 的输出', () => {
    const snapshot = statusCardSnapshot({
      rows: assessAcceptance(report()),
      metrics: report().metrics,
      ledger: defaultLedger(),
    });
    expect(readAnchor()).toEqual(JSON.parse(JSON.stringify(snapshot)));
  });

  it('锚点里 allGreen 仍是 0（没证据就不许有全绿）', () => {
    expect((readAnchor() as { allGreen: number }).allGreen).toBe(0);
  });
});
