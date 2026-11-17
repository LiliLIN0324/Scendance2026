"use client";

import { ACCEPTANCE_RULES } from "../lib/outdoor-acceptance-selfcheck";
import { CASE_IDS, type BrowserEvidence } from "../lib/outdoor-release-status-card";
import { summarizeWalkthrough, type WalkthroughBook } from "../lib/outdoor-walkthrough-book";

/**
 * 走查记录面板（M7.1，轮次 75）。
 *
 * 11 条验收用例各一行，三个按钮如实标记「看过 / 不构成通过 / 未看」。
 * 纯展示：记录本由外部持有（hook 的 ref），这里只把点击转成 `onMark(id, state)`。
 *
 * 面板不下结论——标题栏那行是 `summarizeWalkthrough()` 的原话，末句固定“仍需三类全绿”。
 */

const TITLE_OF = new Map(ACCEPTANCE_RULES.map((rule) => [rule.id, rule.title]));

const OPTIONS: readonly { state: BrowserEvidence; label: string }[] = [
  { state: "pass", label: "看过" },
  { state: "partial", label: "不构成通过" },
  { state: "none", label: "未看" },
];

const TONE: Record<BrowserEvidence, string> = {
  pass: "border-emerald-600/40 bg-emerald-50 text-emerald-800",
  partial: "border-amber-600/40 bg-amber-50 text-amber-800",
  none: "border-neutral-300 bg-white text-neutral-500",
};

export function OutdoorWalkthroughBoard({
  book,
  onMark,
}: {
  book: WalkthroughBook;
  onMark: (id: number, state: BrowserEvidence) => void;
}): JSX.Element {
  const summary = summarizeWalkthrough(book);
  return (
    <section
      aria-label="走查记录"
      className="rounded-xl border border-black/10 bg-white/85 p-3 text-xs text-neutral-700 shadow-sm"
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold text-neutral-800">走查记录</h3>
        <p className="text-neutral-500">{summary.line}</p>
      </header>
      <ol className="space-y-1">
        {CASE_IDS.map((id) => {
          const state = book.seen[id] ?? "none";
          const title = TITLE_OF.get(id) ?? `用例 ${id}`;
          return (
            <li key={id} className="flex items-center gap-2">
              <span className="w-6 shrink-0 tabular-nums text-neutral-400">#{id}</span>
              <span className="min-w-0 flex-1 truncate" title={title}>
                {title}
              </span>
              <span className="flex shrink-0 gap-1" role="group" aria-label={`用例 ${id} 走查状态`}>
                {OPTIONS.map((option) => (
                  <button
                    key={option.state}
                    type="button"
                    aria-pressed={state === option.state}
                    onClick={() => onMark(id, option.state)}
                    className={`rounded-md border px-1.5 py-0.5 transition-colors ${
                      state === option.state ? TONE[option.state] : "border-transparent text-neutral-400 hover:bg-neutral-100"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
