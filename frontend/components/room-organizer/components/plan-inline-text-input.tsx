'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * 2026-11-20 审计 K2：属性卡里的「名字」输入框改成草稿提交。
 *
 * 原来的写法是 `onChange → updateFacility/updateZone`，而每个 update 都无条件
 * `commitPlan`：改一个 8 字的名字 = 8 条历史，30 步撤销里只剩最近两三次操作。
 * 和同卡里尺寸、经纬输入框（本来就是「输入中不写 plan、失焦提交」）统一口径：
 *
 * - 输入过程中只改本地草稿，不写 plan、不压历史；
 * - 失焦、回车、Esc 之外不改写；回车与失焦各触发一次提交，内容没变就不提交；
 * - 名字不允许为空：清空后失焦回到上一个有效名（空名过不了 plan 契约校验）；
 * - 外部值变化（撤销、Agent 改方案、换选中）时同步草稿，避免留着上一件的名字。
 */
export function PlanInlineTextInput({
  ariaLabel,
  title,
  value,
  maxLength = 60,
  onCommit,
  style,
  allowEmpty = false,
  focusBorderColor,
}: {
  ariaLabel: string;
  title?: string;
  value: string;
  maxLength?: number;
  onCommit(next: string): void;
  style?: CSSProperties;
  /** 允许提交空串（默认不允许：名字为空就恢复上一个有效值）。 */
  allowEmpty?: boolean;
  /** 聚焦时把描边染成这个颜色，失焦恢复 transparent（沿用分区名「标题长相」的视觉）。 */
  focusBorderColor?: string;
}) {
  const [draft, setDraft] = useState(value);
  const lastCommitted = useRef(value);
  useEffect(() => {
    lastCommitted.current = value;
    setDraft(value);
  }, [value]);

  function commit(): void {
    const next = draft.trim();
    if (next === lastCommitted.current) {
      setDraft(next);
      return;
    }
    if (!next && !allowEmpty) {
      setDraft(lastCommitted.current);
      return;
    }
    lastCommitted.current = next;
    setDraft(next);
    onCommit(next);
  }

  return (
    <input
      aria-label={ariaLabel}
      {...(title ? { title } : {})}
      value={draft}
      maxLength={maxLength}
      onChange={event => setDraft(event.target.value)}
      onBlur={event => {
        if (focusBorderColor) event.currentTarget.style.borderColor = 'transparent';
        commit();
      }}
      onKeyDown={event => {
        // 中文输入法组合中的回车是在选词，不能当提交。
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(lastCommitted.current);
          event.currentTarget.blur();
        }
      }}
      onFocus={event => {
        if (focusBorderColor) event.currentTarget.style.borderColor = focusBorderColor;
      }}
      style={style}
    />
  );
}
