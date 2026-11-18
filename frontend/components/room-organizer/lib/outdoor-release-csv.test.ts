import { describe, expect, it } from 'vitest';
import { LEDGER_CSV_HEADER, downloadLedgerCsv, ledgerCsvName, ledgerToCsv } from './outdoor-release-csv';
import { defaultLedger, ledgerFromEvidence, type CaseLedgerRow } from './outdoor-release-status-card';

/**
 * 台账 CSV（轮次 87）：只翻译，不下结论；没有“结论”列。
 */

const row = (
  id: number,
  fixedData: boolean,
  browser: 'pass' | 'partial' | 'none',
  cloud: 'pass' | 'partial' | 'none',
): CaseLedgerRow => ({ id, fixedData, browser, cloud });

describe('台账 CSV', () => {
  it('表头固定五列，且没有“结论”列', () => {
    const lines = ledgerToCsv(defaultLedger()).split('\n');
    expect(lines[0]).toBe('编号,用例,固定数据,浏览器,云端');
    expect(lines[0]).toBe(LEDGER_CSV_HEADER.join(','));
    expect(lines[0]).not.toContain('结论');
  });

  it('11 条台账就是 12 行（表头 + 11），编号升序', () => {
    const lines = ledgerToCsv(defaultLedger()).split('\n');
    expect(lines).toHaveLength(12);
    expect(lines[1].startsWith('1,')).toBe(true);
    expect(lines[11].startsWith('11,')).toBe(true);
  });

  it('手建的全未验行就是 无,none,none，且全文不出现判断词', () => {
    const csv = ledgerToCsv([row(9, false, 'none', 'none')]);
    expect(csv.split('\n')[1].endsWith(',无,none,none')).toBe(true);
    expect(csv).not.toContain('通过');
    expect(csv).not.toContain('全绿');
  });

  it('默认台账的浏览器列来自对照表（多为 partial），不在这里被拉平', () => {
    const csv = ledgerToCsv(defaultLedger());
    const cells = csv
      .split('\n')
      .slice(1)
      .map((line) => line.split(',').slice(-2));
    for (const [browser, cloud] of cells) {
      expect(['pass', 'partial', 'none']).toContain(browser);
      expect(cloud).toBe('none');
    }
    // 对照表里 #1 是 partial、#2 是 none：导出必须原样，不得自作主张统一成 none。
    expect(cells[0][0]).toBe('partial');
    expect(cells[1][0]).toBe('none');
  });

  it('浏览器与云端分别落列，互不顶替', () => {
    const csv = ledgerToCsv(ledgerFromEvidence([2, 5], { seen: { 2: 'pass' } }, [2]));
    const case2 = csv.split('\n').find((line) => line.startsWith('2,')) as string;
    expect(case2.endsWith(',有,pass,pass')).toBe(true);
    const case5 = csv.split('\n').find((line) => line.startsWith('5,')) as string;
    expect(case5.endsWith(',有,none,none')).toBe(true);
  });

  it('用例标题含逗号或引号时按 CSV 规则转义，列数不变', () => {
    const csv = ledgerToCsv([row(9, true, 'partial', 'none')]);
    const line = csv.split('\n')[1];
    // 无论标题里有什么，一行都应能被切成 5 列。
    const columns = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
    expect(columns.filter((part) => part !== '').length).toBe(5);
    expect(line).toContain(',有,partial,none');
  });

  it('文件名带日期且清掉非法字符，两轮导出不覆盖', () => {
    expect(ledgerCsvName(undefined, '2026-11-18')).toBe('outdoor-acceptance-ledger-2026-11-18.csv');
    expect(ledgerCsvName('2026-11-18 正式站走查第三轮', '2026-11-18')).toBe(
      'outdoor-acceptance-ledger-2026-11-18-正式站走查第三轮.csv',
    );
    expect(ledgerCsvName('2026/11/18:第三轮', '2026-11-18')).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe('台账 CSV 落盘', () => {
  const deps = () => {
    const created: { blob: Blob }[] = [];
    const clicked: string[] = [];
    const revoked: string[] = [];
    return {
      created,
      clicked,
      revoked,
      deps: {
        createObjectURL: (blob: Blob) => {
          created.push({ blob });
          return `blob:csv-${created.length}`;
        },
        revokeObjectURL: (url: string) => revoked.push(url),
        anchorFactory: (url: string, filename: string) => {
          clicked.push(`${filename}|${url}`);
          return { click: () => {} };
        },
      },
    };
  };

  it('落盘一次、点一次、回收一次；文件名与 MIME 都对', async () => {
    const h = deps();
    const result = downloadLedgerCsv(defaultLedger(), {
      asOf: '2026-11-18 第三轮',
      today: '2026-11-18',
      deps: h.deps,
    });
    expect(result).toEqual({ ok: true, filename: 'outdoor-acceptance-ledger-2026-11-18-第三轮.csv' });
    expect(h.created).toHaveLength(1);
    expect(h.created[0].blob.type).toBe('text/csv;charset=utf-8');
    expect(h.clicked).toHaveLength(1);
    expect(h.revoked).toEqual(['blob:csv-1']);
  });

  it('CSV 头一字节是 UTF-8 BOM，Excel 打开中文不乱码', async () => {
    const h = deps();
    downloadLedgerCsv(defaultLedger(), { today: '2026-11-18', deps: h.deps });
    // `Blob.text()` 会自己剥掉开头的 BOM，所以只能看原始字节。
    const bytes = new Uint8Array(await h.created[0].blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await h.created[0].blob.text();
    expect(text.startsWith('编号,用例')).toBe(true);
  });

  it('没有 URL 能力时返回 ok:false 与原因，不抛', () => {
    const result = downloadLedgerCsv(defaultLedger(), {
      today: '2026-11-18',
      deps: { createObjectURL: undefined },
    });
    expect(result.ok).toBe(false);
    expect(result.filename).toBe('outdoor-acceptance-ledger-2026-11-18.csv');
  });

  it('创建失败、找不到锚点都只回报原因', () => {
    const boom = downloadLedgerCsv(defaultLedger(), {
      today: '2026-11-18',
      deps: {
        createObjectURL: () => {
          throw new Error('nope');
        },
      },
    });
    expect(boom.reason).toBe('create-failed');

    const noAnchor = downloadLedgerCsv(defaultLedger(), {
      today: '2026-11-18',
      deps: { createObjectURL: () => 'blob:x', anchorFactory: () => null },
    });
    expect(noAnchor).toMatchObject({ ok: false, reason: 'no-anchor' });
  });
});
