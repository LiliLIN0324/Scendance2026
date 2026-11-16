'use client';

import { ChevronRight, Pause, Play, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OutdoorStage } from '../lib/outdoor-agent-contract';

const stageSuggestions: Record<OutdoorStage, readonly { hint: string; prompt: string }[]> = {
  place: [
    { hint: '先找场地，再核对可用范围。', prompt: '先找杭州 IN77，核对可用范围' },
    { hint: '带上城市和场馆名，我才能核。', prompt: '在杭州西湖文化广场找一块能办周末市集的场地' },
    { hint: '地址、场馆、路口都行。', prompt: '杭州国际博览中心，核对可用范围' },
  ],
  scope: [
    { hint: '确认哪一片场地真的能用。', prompt: '帮我核对本次活动的实际可用范围' },
    { hint: '只用一部分场地？可以重新圈。', prompt: '我想在地图上重新圈出活动范围' },
  ],
  zones: [
    { hint: '先定每块区域的用途。', prompt: '按活动用途分区' },
    { hint: '有位置偏好？可以先说出来。', prompt: '签到区和观众区放北侧' },
  ],
  'main-routes': [
    { hint: '把入口、分区和主要通道连起来。', prompt: '排一下流线和出入口' },
    { hint: '已知正门位置时，可以指定来路。', prompt: '入口放在正门，别走地下车库' },
  ],
  objects: [
    { hint: '按区域说清要摆什么和数量。', prompt: '签到区摆 2 张桌子' },
    { hint: '也可以先从舞台配套开始。', prompt: '舞台区配音响和背景板' },
  ],
  'sub-routes': [
    { hint: '主通道定了，可以补齐支线入口。', prompt: '补一下子出入口' },
    { hint: '想把进场和散场分开？', prompt: '散场支线也排一下' },
  ],
  people: [
    { hint: '按分区安排岗位和人数。', prompt: '展览区 2 名保安、表演区 3 名工作人员' },
  ],
  'refine-3d': [
    { hint: '继续调整某个设施的模型。', prompt: '给舞台换个模型' },
    { hint: '沿已确认的路线看流动示意。', prompt: '开流动模拟看散场' },
  ],
};

export function OutdoorStageSuggestion({ stage, onPick }: {
  stage: OutdoorStage;
  onPick(prompt: string): void;
}): JSX.Element {
  const choices = stageSuggestions[stage];
  const [position, setPosition] = useState(0);
  const [reduced, setReduced] = useState(true);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = choices[position % choices.length]!;
  const previous = position > 0 ? choices[(position - 1) % choices.length] : undefined;

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!preference) return;
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (choices.length < 2 || reduced || paused || hovered || focused) return;
    const timer = window.setTimeout(() => setPosition(value => value + 1), 4200);
    return () => window.clearTimeout(timer);
  }, [choices, focused, hovered, paused, position, reduced]);

  return <div className="ap-stage-suggestion" role="group" aria-label="下一句建议" aria-live="off"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }}
    onPointerLeave={event => { if (event.pointerType === 'mouse') setHovered(false); }}
  >
    <button type="button" className="ap-stage-suggestion-pick" title={active.prompt}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onClick={() => onPick(active.prompt)}
    >
      <Sparkles size={15} aria-hidden="true" />
      <span className="ap-stage-suggestion-window">
        {previous && !reduced && <span key={position - 1} aria-hidden="true" className="ap-stage-suggestion-outgoing">{previous.hint}</span>}
        <span key={position} className={previous && !reduced ? 'ap-stage-suggestion-incoming' : undefined}>{active.hint}</span>
      </span>
    </button>
    {choices.length > 1 && <button type="button" className="ap-stage-suggestion-control"
      aria-label={reduced ? '下一条建议' : paused ? '播放建议轮播' : '暂停建议轮播'}
      onClick={() => reduced ? setPosition(value => value + 1) : setPaused(value => !value)}
    >{reduced ? <ChevronRight size={16} aria-hidden="true" /> : paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</button>}
  </div>;
}
