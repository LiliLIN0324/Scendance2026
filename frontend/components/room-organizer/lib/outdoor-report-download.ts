/**
 * 把会话报告落成本地文件（M7.1，2026-11-17）。
 *
 * 记录/工单的真实出口是“存一份文件”，不是控制台。但下载这一步有个硬约束：
 * jsdom 里没有 `URL.createObjectURL`，也没有真实点击下载。所以这里把三件外部能力
 * 都做成可注入的（`createObjectURL` / `anchorFactory` / `revokeObjectURL`），
 * 生产走浏览器默认实现，单测走假实现——逻辑本身就可测。
 *
 * 失败一律不抛：导不出文件时返回 `{ ok: false, reason }`，调用方照旧能拿到文本。
 */

import type { SessionReport } from './outdoor-session-report';

export interface ReportDownloadDeps {
  /** 默认 `URL.createObjectURL`。 */
  createObjectURL?: ((blob: Blob) => string) | undefined;
  /** 默认 `URL.revokeObjectURL`。 */
  revokeObjectURL?: ((url: string) => void) | undefined;
  /** 默认创建一个 `a[download]` 并在 body 上点一下。 */
  anchorFactory?: ((url: string, filename: string) => { click: () => void } | null) | undefined;
}

export interface ReportDownloadResult {
  ok: boolean;
  filename: string;
  /** 失败原因（成功时不填）。 */
  reason?: 'no-url-api' | 'create-failed' | 'no-anchor';
}

/** `scendance-outdoor-report-20261117-062500.txt`，用导出时刻而不是“现在”，便于对账。 */
export function reportFilename(exportedAt: number): string {
  const d = new Date(exportedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `scendance-outdoor-report-${stamp}.txt`;
}

function defaultAnchor(url: string, filename: string): { click: () => void } | null {
  if (typeof document === 'undefined') return null;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  return {
    click: () => {
      a.click();
      a.remove();
    },
  };
}

export function downloadSessionReport(
  report: SessionReport,
  deps: ReportDownloadDeps = {},
): ReportDownloadResult {
  return downloadTextFile({
    text: report.text,
    filename: reportFilename(report.exportedAt),
    mime: 'text/plain;charset=utf-8',
    deps,
  });
}

/**
 * 通用版：把一段文本落成文件。报告与台账 CSV 共用这一条路径，
 * 免得两处各写一套 blob/anchor 逻辑——一套错了另一套看着“能跑”。
 */
export function downloadTextFile(input: {
  text: string;
  filename: string;
  mime: string;
  deps?: ReportDownloadDeps | undefined;
}): ReportDownloadResult {
  const deps = input.deps ?? {};
  const filename = input.filename;
  const create =
    deps.createObjectURL ??
    (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL.bind(URL)
      : null);
  if (!create) return { ok: false, filename, reason: 'no-url-api' };

  let url: string;
  try {
    url = create(new Blob([input.text], { type: input.mime }));
  } catch {
    return { ok: false, filename, reason: 'create-failed' };
  }

  const revoke =
    deps.revokeObjectURL ??
    (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function'
      ? URL.revokeObjectURL.bind(URL)
      : null);

  try {
    const anchor = (deps.anchorFactory ?? defaultAnchor)(url, filename);
    if (!anchor) {
      revoke?.(url);
      return { ok: false, filename, reason: 'no-anchor' };
    }
    anchor.click();
    return { ok: true, filename };
  } finally {
    // 点完就回收；即使 click 抛错也不留悬挂的 blob URL。
    revoke?.(url);
  }
}
