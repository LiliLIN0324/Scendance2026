'use client';

import { ChevronDown, Megaphone, Pause, Play, Store, Utensils } from 'lucide-react';
import { useEffect, useState } from 'react';
import './agent-task-examples.css';

/** 卡面把「活动」和「场地参数」摆在一条线上，标题里不带标点；标点只在拼成一句话时补。 */
const examples = [
  { title: '80 人发布会', detail: '室内 12×9', icon: Megaphone },
  { title: '30 人圆桌晚宴', detail: '室内 15×10', icon: Utensils },
  { title: '120 人市集', detail: '户外 20×14', icon: Store },
] as const;

/** 点卡/读屏用的是完整一句话，逗号在这里补，不进卡面。 */
const sentenceOf = (example: typeof examples[number]): string => `${example.title}，${example.detail}`;

/**
 * 输入框上方那**一格**建议：收起时就是这一行例句（3.2s 换一句，点整行填进输入框，不发送）。
 * 行尾的 `⌄` 把这一格换成两张能力卡——不另起折叠行，所以能力卡展开时这里整行让位。
 * 只给对话输入框用：登录卡片没有可填的地方，不放这条。
 */
export function AgentTaskExamples({ onPick, onExpand }: {
  /** 点整行把这句填进输入框，不替人发送。 */
  onPick(sentence: string): void;
  /** 同一格换成两张能力卡。 */
  onExpand(): void;
}): JSX.Element {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!preference) return;
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  // 静止 3.2s 换下一句；鼠标悬停、键盘聚焦或手动暂停时停住，离开后重新计时。
  useEffect(() => {
    if (reducedMotion || paused || hovered || focused) return;
    const timer = window.setTimeout(() => setIndex(value => (value + 1) % examples.length), 3200);
    return () => window.clearTimeout(timer);
  }, [focused, hovered, index, paused, reducedMotion]);

  const example = examples[index]!;
  const Icon = example.icon;
  const sentence = sentenceOf(example);

  return <div className="sc-task-examples" role="group" aria-label="需求例句" aria-live="off"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }}
    onPointerLeave={event => { if (event.pointerType === 'mouse') setHovered(false); }}
  >
    <button type="button" className="sc-task-example"
      aria-label={`试试这样描述你的活动：${sentence}`}
      title={`${sentence}（点一下填进输入框）`}
      onClick={() => onPick(sentence)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span className="sc-task-example-icon" aria-hidden="true"><Icon size={13} /></span>
      <span className="sc-task-example-sentence" key={index}>
        <strong>{example.title}</strong>
        <span className="sc-task-example-dot" aria-hidden="true">·</span>
        <small>{example.detail}</small>
      </span>
    </button>
    {!reducedMotion && <button type="button" className="sc-task-examples-toggle"
      aria-label={paused ? '播放示例轮播' : '暂停示例轮播'}
      onClick={() => setPaused(value => !value)}
    >{paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</button>}
    <button type="button" className="sc-task-examples-toggle" aria-expanded="false"
      aria-controls="ap-capability-cards" aria-label="展开你可以做什么" title="换成能力卡"
      onClick={onExpand}
    ><ChevronDown size={14} aria-hidden="true" /></button>
  </div>;
}
