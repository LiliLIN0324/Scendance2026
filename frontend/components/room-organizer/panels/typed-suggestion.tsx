'use client';

import { useEffect, useState } from 'react';

/** 系统开了「减少动效」就一次显示整句，不再逐字打。 */
function prefersStill(): boolean {
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches !== false;
}

/**
 * 空输入时框里那句引导句：逐字打出来，轮换几条；按 Tab 一次填整句。
 * 「布置」「生成」共用这一套，别各写一份打字逻辑。
 */
export function useSuggestion(list: readonly string[]): { full: string; shown: string } {
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(() => (prefersStill() ? list[0]!.length : 0));
  const key = list.join('|');
  useEffect(() => { setIndex(0); setCount(prefersStill() ? (list[0]?.length ?? 0) : 0); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prefersStill()) return;
    const full = list[index] ?? list[0] ?? '';
    if (count < full.length) {
      const timer = window.setTimeout(() => setCount(value => value + 1), 72);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setIndex(value => (value + 1) % list.length);
      setCount(0);
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [list, index, count]);
  const full = list[index] ?? list[0] ?? '';
  return { full, shown: prefersStill() ? full : full.slice(0, count) };
}

/** 引导句本体：aria-hidden 的占位层，不挡点按，也不进无障碍树。 */
export function SuggestionGhost({ full, shown, className }: { full: string; shown: string; className: string }): JSX.Element {
  return <span className={className} aria-hidden="true" data-suggestion={full}>{shown}</span>;
}