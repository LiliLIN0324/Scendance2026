'use client';

import { useEffect, useState } from 'react';
import type { ChatAgent } from './agent-chat-store';

/** 系统开了「减少动效」就一次显示整句，不再逐字打。 */
function prefersStill(): boolean {
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches !== false;
}

/**
 * 四格输入框共用这一份引导句：总控、Bingo、空间、物料。
 * 每格只说它自己那一层的事，句子短到一行放得下；生成条另有自己的清单。
 */
export const AGENT_INPUT_SUGGESTIONS: Record<ChatAgent, readonly string[]> = {
  door: ['这场活动的目标和限制是……', '帮我梳理还缺哪些信息', '汇总进度并检查交接'],
  bingo: ['80 人发布会，室内 12×9，安排签到和主舞台', '按墨金发布配一套', '按奶油会客配一套'],
  space: ['用 Aholo 世界模型生成一个户外婚礼花园', '用现场照片或视频重建这座真实场地', '切换到传统空间模板'],
  material: ['生成 20 把适合户外的折叠椅', '把主桌模型换成圆桌', '再加一张茶几'],
};

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

/**
 * 引导句本体：不挡无障碍树，也不出现在 Tab 序列里。
 * 给了 onPick 就是可点的提示——点一下只把整句填进输入框，不替人发送。
 */
export function SuggestionGhost({ full, shown, className, onPick }: { full: string; shown: string; className: string; onPick?(text: string): void }): JSX.Element {
  if (onPick) {
    return <button type="button" className={`${className} is-pickable`} aria-hidden="true" tabIndex={-1} data-suggestion={full} onClick={() => onPick(full)}>{shown}</button>;
  }
  return <span className={className} aria-hidden="true" data-suggestion={full}>{shown}</span>;
}
