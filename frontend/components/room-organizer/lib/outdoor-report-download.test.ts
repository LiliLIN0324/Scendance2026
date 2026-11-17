import { describe, expect, it } from 'vitest';
import { downloadSessionReport, reportFilename } from './outdoor-report-download';
import type { SessionReport } from './outdoor-session-report';

const AT = Date.UTC(2026, 10, 17, 6, 25, 0);

function report(over: Partial<SessionReport> = {}): SessionReport {
  return {
    version: 1,
    exportedAt: AT,
    traces: { version: 1, exportedAt: AT, rows: [], text: '户外 Agent 诊断导出 · 0 轮' },
    metrics: {
      totals: {
        turns: 0,
        modelCalls: 0,
        mapCalls: 0,
        confirmations: 0,
        appliedCount: 0,
        firstUsefulFeedbackAvgMs: null,
        previewAvgMs: null,
        applyAvgMs: null,
      },
      rows: [],
      text: 'turns=0 model=0 map=0 confirm=0 applied=0',
    },
    text: '户外 Agent 诊断导出 · 0 轮\n\n[outdoor-metrics] 汇总 turns=0 model=0',
    ...over,
  };
}

describe('reportFilename', () => {
  it('用导出时刻（UTC）命名，扩展名固定 .txt', () => {
    expect(reportFilename(AT)).toBe('scendance-outdoor-report-20261117-062500.txt');
  });
});

describe('downloadSessionReport', () => {
  it('把报告文本原样塞进 Blob 并点一次下载，成功后回收 URL', () => {
    const seen: { blob?: Blob; url: string; filename?: string; clicks: number } = {
      url: '',
      clicks: 0,
    };
    let revoked = '';
    const result = downloadSessionReport(report(), {
      createObjectURL: (blob) => {
        seen.blob = blob;
        return 'blob:fake-1';
      },
      revokeObjectURL: (url) => {
        revoked = url;
      },
      anchorFactory: (url, filename) => {
        seen.url = url;
        seen.filename = filename;
        return { click: () => void (seen.clicks += 1) };
      },
    });
    expect(result).toEqual({ ok: true, filename: 'scendance-outdoor-report-20261117-062500.txt' });
    expect(seen.url).toBe('blob:fake-1');
    expect(seen.filename).toBe('scendance-outdoor-report-20261117-062500.txt');
    expect(seen.clicks).toBe(1);
    expect(revoked).toBe('blob:fake-1');
    expect(seen.blob?.type).toBe('text/plain;charset=utf-8');
  });

  it('文件内容与 report.text 一致（不多不少）', async () => {
    let blob: Blob | null = null;
    downloadSessionReport(report({ text: 'A行\nB行' }), {
      createObjectURL: (b) => {
        blob = b;
        return 'blob:x';
      },
      revokeObjectURL: () => {},
      anchorFactory: () => ({ click: () => {} }),
    });
    expect(blob).not.toBeNull();
    expect(await (blob as unknown as Blob).text()).toBe('A行\nB行');
  });

  it('没有建 URL 的能力时返回 no-url-api，不抛错', () => {
    const result = downloadSessionReport(report(), {
      createObjectURL: undefined,
      anchorFactory: () => ({ click: () => {} }),
    });
    // jsdom 环境下 URL.createObjectURL 通常缺失，正好走这条分支
    if (typeof URL.createObjectURL !== 'function') {
      expect(result).toEqual({
        ok: false,
        filename: 'scendance-outdoor-report-20261117-062500.txt',
        reason: 'no-url-api',
      });
    } else {
      expect(result.ok).toBe(true);
    }
  });

  it('建 URL 抛错时返回 create-failed', () => {
    const result = downloadSessionReport(report(), {
      createObjectURL: () => {
        throw new Error('quota');
      },
      revokeObjectURL: () => {},
      anchorFactory: () => ({ click: () => {} }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('create-failed');
  });

  it('拿不到锚点时回收 URL 并返回 no-anchor', () => {
    let revoked = '';
    const result = downloadSessionReport(report(), {
      createObjectURL: () => 'blob:y',
      revokeObjectURL: (url) => void (revoked = url),
      anchorFactory: () => null,
    });
    expect(result.reason).toBe('no-anchor');
    expect(revoked).toBe('blob:y');
  });

  it('click 抛错时仍然回收 URL（不留悬挂 blob）', () => {
    let revoked = '';
    expect(() =>
      downloadSessionReport(report(), {
        createObjectURL: () => 'blob:z',
        revokeObjectURL: (url) => void (revoked = url),
        anchorFactory: () => ({
          click: () => {
            throw new Error('boom');
          },
        }),
      }),
    ).toThrow('boom');
    expect(revoked).toBe('blob:z');
  });
});
