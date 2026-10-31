'use client';

/**
 * v2 首屏与结果视图。
 * 首屏只有活动卡、场地、人数和一颗「生成方案」。
 * 生成之后，布置 / 物料 / 执行资料是同一份方案的三块视图。
 * 场景、物件、合成不在这里出现。
 */
import { Boxes, ListChecks, SquareStack, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRoomEditor } from '../contexts';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { sameLayoutContent } from '../lib/persistence';
import { venueArea } from '../lib/structural-layout';
import { formatArea, type AgentState } from '../lib/workbench-agent';
import { useAgent } from './agent-panel';
import type { RoomLayout } from '../lib/types';
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

const PLATES: ReadonlyArray<{ id: 'layout' | 'materials' | 'execution'; label: string; Icon: LucideIcon }> = [
  { id: 'layout', label: '布置', Icon: SquareStack },
  { id: 'materials', label: '物料', Icon: Boxes },
  { id: 'execution', label: '执行资料', Icon: ListChecks },
];

type PlateId = (typeof PLATES)[number]['id'];

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

export function materialRows(items: readonly { name: string }[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

export function PlanHome({ onGenerate }: { onGenerate(sentence: string): void }): JSX.Element {
  const [activityId, setActivityId] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [headcount, setHeadcount] = useState<number | null>(null);
  const activity = PLAN_ACTIVITIES.find(item => item.id === activityId);
  const venue = PLAN_VENUES.find(item => item.id === venueId);
  const ready = Boolean(activity && venue && headcount);
  return <form className="sc-plan-home" aria-label="生成活动方案" onSubmit={event => {
    event.preventDefault();
    if (!activity || !venue || headcount === null) return;
    onGenerate(planGenerateSentence(activity.phrase, venue.phrase, headcount));
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
        {PLAN_VENUES.map(item => <button key={item.id} type="button" aria-pressed={venueId === item.id} onClick={() => setVenueId(item.id)}>{item.label}</button>)}
      </div>
    </fieldset>
    <fieldset>
      <legend>人数</legend>
      <div className="sc-plan-chips">
        {PLAN_HEADCOUNTS.map(count => <button key={count} type="button" aria-pressed={headcount === count} onClick={() => setHeadcount(count)}>{count} 人</button>)}
      </div>
    </fieldset>
    <button type="submit" className="sc-plan-act" disabled={!ready}>生成方案</button>
  </form>;
}

export function PlanPlates({ items, areaLabel, onExport }: {
  items: readonly { name: string }[];
  areaLabel: string;
  onExport(): void;
}): JSX.Element {
  const [plate, setPlate] = useState<PlateId>('layout');
  const rows = materialRows(items);
  return <section className="sc-plan-plates" aria-label="方案">
    <div role="tablist" aria-label="方案视图">
      {PLATES.map(entry => <button key={entry.id} type="button" role="tab" aria-label={entry.label} data-tip={entry.label} title={entry.label} aria-selected={plate === entry.id} onClick={() => setPlate(entry.id)}><entry.Icon size={20} aria-hidden="true"/></button>)}
    </div>
    {plate === 'materials' && <div role="tabpanel" aria-label="物料">
      {rows.length === 0
        ? <p>这一版还没有物料</p>
        : <ul>{rows.map(row => <li key={row.name}><span>{row.name}</span><b>{row.count}</b></li>)}</ul>}
    </div>}
    {plate === 'execution' && <div role="tabpanel" aria-label="执行资料">
      <p>{items.length} 件 · {areaLabel}</p>
      <button type="button" className="sc-plan-act" onClick={onExport}>导出交接</button>
    </div>}
  </section>;
}

/** 挂在画布上：首屏或三块视图。工具坞是否让开，由 onHomeChange 告诉工作台。 */
export function PlanFlow({ onOpenAgent, onHomeChange }: { onOpenAgent(): void; onHomeChange(home: boolean): void }): JSX.Element {
  const agent = useAgent();
  const { layout, activeFloor } = useRoomEditor();
  const home = isPlanHome(agent.state, layout, agent.proposal !== null);
  useEffect(() => { onHomeChange(home); }, [home, onHomeChange]);
  useEffect(() => { if (agent.proposal) onOpenAgent(); }, [agent.proposal, onOpenAgent]);
  if (home) return <PlanHome onGenerate={sentence => { void agent.send(sentence); }} />;
  return <PlanPlates
    items={activeFloor.items}
    areaLabel={`${formatArea(venueArea(layout))} ㎡`}
    onExport={() => { onOpenAgent(); agent.previewExport(); }}
  />;
}
