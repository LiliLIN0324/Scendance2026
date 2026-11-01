'use client';

/**
 * v2 首屏。
 * 首屏只有活动卡、场地、人数和一颗「生成方案」。
 * 出方案之后画布顶不再加「布置 / 物料 / 执行资料」分段，这三档只走左轨。
 * 场景、物件、合成不在这里出现。
 */
import { useEffect, useState } from 'react';
import { useRoomEditor } from '../contexts';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { sameLayoutContent } from '../lib/persistence';
import { useAgent } from './agent-panel';
import type { RoomLayout } from '../lib/types';
import type { AgentState } from '../lib/workbench-agent';
import './plan-flow.css';

export const PLAN_ACTIVITIES = [
  { id: 'popup', label: '品牌快闪', phrase: '快闪' },
  { id: 'workshop', label: '工作坊', phrase: '工作坊' },
  { id: 'market', label: '展览市集', phrase: '市集' },
  { id: 'launch', label: '发布会', phrase: '发布会' },
  { id: 'wedding', label: '婚礼聚会', phrase: '婚礼' },
] as const;

export const PLAN_VENUES = [
  { id: 'hall', label: '室内 12×9', phrase: '室内 12×9' },
  { id: 'room', label: '室内 10×8', phrase: '室内 10×8' },
  { id: 'yard', label: '户外 20×14', phrase: '户外 20×14' },
] as const;

export const PLAN_HEADCOUNTS = [30, 80, 120] as const;

const HOME_HIDDEN: ReadonlySet<AgentState> = new Set([
  'generating', 'generatePaused', 'generateFailed', 'planProposed', 'planReady', 'planEdited',
]);

/** 没出过方案、画布还是开场那间屋子时，首屏才盖在画布上。 */
export function isPlanHome(state: AgentState, layout: RoomLayout, hasProposal: boolean): boolean {
  if (hasProposal || HOME_HIDDEN.has(state)) return false;
  return sameLayoutContent(layout, INITIAL_LAYOUT);
}

/** 一句话交给既有生成入口，不另开「场景生成 / 布置生成」。 */
export function planGenerateSentence(activityPhrase: string, venuePhrase: string, headcount: number): string {
  return `${headcount} 人${activityPhrase}，${venuePhrase}，出方案`;
}

/** 执行清单按物件名归并件数。画布顶不再为此单开分段。 */
export function materialRows(items: readonly { name: string }[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

export function PlanHome({ onGenerate }: { onGenerate(sentence: string): void }): JSX.Element {
  const [activityId, setActivityId] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [headcount, setHeadcount] = useState<number | null>(null);
  const [customVenue, setCustomVenue] = useState(false);
  const [venueWidth, setVenueWidth] = useState('');
  const [venueDepth, setVenueDepth] = useState('');
  const [customHeadcount, setCustomHeadcount] = useState(false);
  const [headcountInput, setHeadcountInput] = useState('');
  const [attempted, setAttempted] = useState(false);
  const activity = PLAN_ACTIVITIES.find(item => item.id === activityId);
  const venue = PLAN_VENUES.find(item => item.id === venueId);
  const width = Number.parseFloat(venueWidth);
  const depth = Number.parseFloat(venueDepth);
  const customVenueOk = Number.isFinite(width) && Number.isFinite(depth) && width >= 2 && depth >= 2 && width <= 200 && depth <= 200;
  const customCount = Number.parseInt(headcountInput, 10);
  const customCountOk = Number.isInteger(customCount) && customCount >= 1 && customCount <= 5000;
  const venueReady = Boolean(venue) || (customVenue && customVenueOk);
  const countReady = headcount !== null || (customHeadcount && customCountOk);
  const venuePhrase = venue?.phrase ?? `${width}×${depth} 米`;
  const countValue = headcount ?? (customCountOk ? customCount : null);
  const ready = Boolean(activity && venueReady && countValue !== null);
  const missing = [!activity && '活动', !venueReady && '场地', !countReady && '人数'].filter(Boolean);
  const needText = attempted ? `先选好${missing.join('、')}，再生成方案。` : `还差：${missing.join('、')}`;
  return <form className="sc-plan-home" aria-label="生成活动方案" onSubmit={event => {
    event.preventDefault();
    if (!activity || !venueReady || countValue === null) { setAttempted(true); return; }
    onGenerate(planGenerateSentence(activity.phrase, venuePhrase, countValue));
  }}>
    <fieldset>
      <legend>活动</legend>
      <div className="sc-plan-chips">
        {PLAN_ACTIVITIES.map(item => <button key={item.id} type="button" aria-pressed={activityId === item.id} onClick={() => setActivityId(item.id)}>{item.label}</button>)}
      </div>
    </fieldset>
    <fieldset>
      <legend>场地</legend>
      <div className="sc-plan-chips">
        {PLAN_VENUES.map(item => <button key={item.id} type="button" aria-pressed={venueId === item.id} onClick={() => { setVenueId(item.id); setCustomVenue(false); }}>{item.label}</button>)}
        <button type="button" aria-label="自定义场地" aria-pressed={customVenue} onClick={() => { setCustomVenue(true); setVenueId(null); }}>自定义</button>
      </div>
      {customVenue && <div className="sc-plan-custom">
        <label>宽 <input aria-label="场地宽度（米）" inputMode="decimal" min={2} max={200} placeholder="12" value={venueWidth} onChange={event => setVenueWidth(event.target.value)}/> 米</label>
        <span aria-hidden="true">×</span>
        <label>深 <input aria-label="场地深度（米）" inputMode="decimal" min={2} max={200} placeholder="9" value={venueDepth} onChange={event => setVenueDepth(event.target.value)}/> 米</label>
      </div>}
    </fieldset>
    <fieldset>
      <legend>人数</legend>
      <div className="sc-plan-chips">
        {PLAN_HEADCOUNTS.map(count => <button key={count} type="button" aria-pressed={headcount === count} onClick={() => { setHeadcount(count); setCustomHeadcount(false); }}>{count} 人</button>)}
        <button type="button" aria-label="自定义人数" aria-pressed={customHeadcount} onClick={() => { setCustomHeadcount(true); setHeadcount(null); }}>自定义</button>
      </div>
      {customHeadcount && <div className="sc-plan-custom">
        <label>人数 <input aria-label="人数（人）" inputMode="numeric" min={1} max={5000} placeholder="200" value={headcountInput} onChange={event => setHeadcountInput(event.target.value)}/> 人</label>
      </div>}
    </fieldset>
    <button type="submit" className={`sc-plan-act${ready ? '' : ' is-disabled'}`} aria-disabled={!ready}>生成方案</button>
    {!ready && <p className="sc-plan-need" role="status">{needText}</p>}
  </form>;
}

/** 挂在画布下缘的首屏。三态不拆这块画布。工具坞是否让开由 onHomeChange 告诉工作台。 */
export function PlanFlow({ onOpenAgent, onHomeChange }: { onOpenAgent(): void; onHomeChange(home: boolean): void }): JSX.Element | null {
  const agent = useAgent();
  const { layout } = useRoomEditor();
  const home = isPlanHome(agent.state, layout, agent.proposal !== null);
  useEffect(() => { onHomeChange(home); }, [home, onHomeChange]);
  useEffect(() => { if (agent.proposal) onOpenAgent(); }, [agent.proposal, onOpenAgent]);
  if (!home) return null;
  return <PlanHome onGenerate={sentence => { void agent.send(sentence); }} />;
}
