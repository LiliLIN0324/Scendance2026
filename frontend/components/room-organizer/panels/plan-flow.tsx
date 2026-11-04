'use client';

/**
 * Bingo 冷启动：主路径是说话 + 可点整句示例；听懂了再回显。
 * chips 只在「改一下」里纠偏，不当首页主角。
 */
import { useEffect, useMemo, useState } from 'react';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { sameLayoutContent } from '../lib/persistence';
import type { RoomLayout } from '../lib/types';
import { formatArea, parseBriefSentence, type AgentState } from '../lib/workbench-agent';
import './plan-flow.css';

export const PLAN_ACTIVITIES = [
  { id: 'popup', label: '品牌快闪', phrase: '快闪' },
  { id: 'workshop', label: '工作坊', phrase: '工作坊' },
  { id: 'market', label: '展览市集', phrase: '市集' },
  { id: 'launch', label: '发布会', phrase: '发布会' },
  { id: 'wedding', label: '婚礼聚会', phrase: '婚礼' },
] as const;

export const PLAN_VENUES = [
  { id: 'hall', label: '室内 12×9', phrase: '室内 12×9', length: 12, depth: 9, io: 'indoor' },
  { id: 'room', label: '室内 10×8', phrase: '室内 10×8', length: 10, depth: 8, io: 'indoor' },
  { id: 'yard', label: '户外 20×14', phrase: '户外 20×14', length: 20, depth: 14, io: 'outdoor' },
] as const;

export const PLAN_HEADCOUNTS = [30, 80, 120] as const;

/** 首屏可点整句：点进输入框，不替人发送。 */
export const PLAN_EXAMPLES = [
  '80 人发布会，室内 12×9',
  '30 人圆桌晚宴，室内 15×10',
  '120 人市集，户外 20×14',
] as const;

/** 解析结果里的活动名 → 纠偏芯片；对不上的仍可当短语出方案。 */
const EVENT_TO_ACTIVITY: Readonly<Record<string, (typeof PLAN_ACTIVITIES)[number]['id']>> = {
  快闪: 'popup',
  工作坊: 'workshop',
  市集: 'market',
  展览: 'market',
  发布会: 'launch',
  婚礼: 'wedding',
  派对: 'wedding',
};

/** 回显优先用人说的词，不把「圆桌晚宴」收成「派对」。 */
const EVENT_ECHO_PATTERN = /(圆桌晚宴|品牌快闪|新品发布|发布会|工作坊|展览市集|市集|婚礼聚会|婚礼|晚宴|派对|沙龙|酒会|快闪|年会|路演|黑客松)/;

const HOME_HIDDEN: ReadonlySet<AgentState> = new Set([
  'generating', 'generatePaused', 'generateFailed', 'planProposed', 'planReady', 'planEdited',
]);

type TouchedField = 'activity' | 'venue' | 'headcount';

export type PlanHeard = {
  activityId: string | null;
  activityPhrase: string | null;
  venueId: string | null;
  venuePhrase: string | null;
  customVenue: boolean;
  venueWidth: string;
  venueDepth: string;
  headcount: number | null;
  customHeadcount: boolean;
  headcountInput: string;
  heardParts: string[];
  missing: string[];
  ready: boolean;
};

function dimsMatch(a: number, b: number, length: number, depth: number): boolean {
  return (a === length && b === depth) || (a === depth && b === length);
}

function eventEcho(raw: string, event: string | null): string | null {
  if (!event) return null;
  const hit = raw.match(EVENT_ECHO_PATTERN);
  return hit?.[1] ?? event;
}

function missingLabel(slot: 'activity' | 'venue' | 'headcount'): string {
  if (slot === 'activity') return '活动类型';
  if (slot === 'venue') return '场地多大';
  return '人数';
}

/** 把输入框里那句需求折成听懂状态；纠偏 chips 与「生成方案」共用。 */
export function planSelectionFromText(raw: string): PlanHeard {
  const empty: PlanHeard = {
    activityId: null, activityPhrase: null, venueId: null, venuePhrase: null,
    customVenue: false, venueWidth: '', venueDepth: '',
    headcount: null, customHeadcount: false, headcountInput: '',
    heardParts: [], missing: [missingLabel('activity'), missingLabel('venue'), missingLabel('headcount')], ready: false,
  };
  const text = raw.trim();
  if (!text) return empty;
  const extraction = parseBriefSentence(text);
  const activityId = extraction.event ? (EVENT_TO_ACTIVITY[extraction.event] ?? null) : null;
  const activityPhrase = eventEcho(text, extraction.event);
  let venueId: string | null = null;
  let venuePhrase: string | null = null;
  let customVenue = false;
  let venueWidth = '';
  let venueDepth = '';
  if (extraction.lengthM !== null && extraction.widthM !== null) {
    const preset = PLAN_VENUES.find(item =>
      dimsMatch(extraction.lengthM!, extraction.widthM!, item.length, item.depth)
      && (extraction.venueIO === null || extraction.venueIO === item.io));
    if (preset) {
      venueId = preset.id;
      venuePhrase = preset.phrase;
    } else {
      customVenue = true;
      venueWidth = formatArea(extraction.lengthM);
      venueDepth = formatArea(extraction.widthM);
      const io = extraction.venueIO === 'outdoor' ? '户外' : extraction.venueIO === 'indoor' ? '室内' : null;
      venuePhrase = io
        ? `${io} ${formatArea(extraction.lengthM)}×${formatArea(extraction.widthM)}`
        : `${formatArea(extraction.lengthM)}×${formatArea(extraction.widthM)} 米`;
    }
  }
  const headcount = extraction.headcount;
  const presetCount = headcount !== null && (PLAN_HEADCOUNTS as readonly number[]).includes(headcount);
  const customHeadcount = headcount !== null && !presetCount;
  // 回显顺序：人数 · 活动 · 场地 —— 跟人说话的习惯对齐。
  const heardParts = [
    headcount !== null ? `${headcount} 人` : null,
    activityPhrase,
    venuePhrase,
  ].filter((part): part is string => Boolean(part));
  const missing = [
    !activityPhrase ? missingLabel('activity') : null,
    !venuePhrase ? missingLabel('venue') : null,
    headcount === null ? missingLabel('headcount') : null,
  ].filter((part): part is string => Boolean(part));
  return {
    activityId,
    activityPhrase,
    venueId,
    venuePhrase,
    customVenue,
    venueWidth,
    venueDepth,
    headcount: presetCount ? headcount : null,
    customHeadcount,
    headcountInput: customHeadcount && headcount !== null ? String(headcount) : '',
    heardParts,
    missing,
    ready: missing.length === 0,
  };
}

/** 没出过方案、画布还是开场那间屋子时，冷启动卡才出现在对话里。 */
export function isPlanHome(state: AgentState, layout: RoomLayout, hasProposal: boolean): boolean {
  if (hasProposal || HOME_HIDDEN.has(state)) return false;
  return sameLayoutContent(layout, INITIAL_LAYOUT);
}

/** 一句话交给既有生成入口，不另开「场景生成 / 布置生成」。 */
export function planGenerateSentence(activityPhrase: string, venuePhrase: string, headcount: number): string {
  return `${headcount} 人${activityPhrase}，${venuePhrase}，出方案`;
}

/** 输入框里已经是完整需求时，补上生成动词再交给对话入口。 */
export function planGenerateFromDraft(draft: string): string {
  const trimmed = draft.trim().replace(/[，,。.！!？?\s]+$/u, '');
  if (/(出方案|出一版|摆一版|生成布置|布置起来|开始摆|就按这个|按这个出)/.test(trimmed)) return trimmed;
  return `${trimmed}，出方案`;
}

/** 听懂回显：有缺项就问缺什么。 */
export function planHeardStatus(heardParts: string[], missing: string[]): string | null {
  if (heardParts.length === 0) return null;
  if (missing.length === 0) return `已听懂：${heardParts.join(' · ')}`;
  return `${heardParts.join(' · ')} · 还差${missing.join('、')}`;
}

export function PlanHome({ draft = '', onGenerate, onPickExample }: {
  draft?: string;
  onGenerate(sentence: string): void;
  /** 点例句只填进输入框，不替人发送。 */
  onPickExample?(sentence: string): void;
}): JSX.Element {
  const heard = useMemo(() => planSelectionFromText(draft), [draft]);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [headcount, setHeadcount] = useState<number | null>(null);
  const [customVenue, setCustomVenue] = useState(false);
  const [venueWidth, setVenueWidth] = useState('');
  const [venueDepth, setVenueDepth] = useState('');
  const [customHeadcount, setCustomHeadcount] = useState(false);
  const [headcountInput, setHeadcountInput] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<TouchedField, boolean>>>({});

  useEffect(() => {
    setTouched({});
    setAttempted(false);
    if (!draft.trim()) setAdjusting(false);
  }, [draft]);

  const activityTouched = Boolean(touched.activity);
  const venueTouched = Boolean(touched.venue);
  const headcountTouched = Boolean(touched.headcount);

  const effectiveActivityId = activityTouched ? activityId : (heard.activityId ?? activityId);
  const effectiveCustomVenue = venueTouched ? customVenue : (heard.customVenue || customVenue);
  const effectiveVenueId = venueTouched ? venueId : (heard.venueId ?? venueId);
  const effectiveVenueWidth = venueTouched ? venueWidth : (heard.venueWidth || venueWidth);
  const effectiveVenueDepth = venueTouched ? venueDepth : (heard.venueDepth || venueDepth);
  const effectiveHeadcount = headcountTouched ? headcount : (heard.headcount ?? headcount);
  const effectiveCustomHeadcount = headcountTouched ? customHeadcount : (heard.customHeadcount || customHeadcount);
  const effectiveHeadcountInput = headcountTouched ? headcountInput : (heard.headcountInput || headcountInput);

  const activity = PLAN_ACTIVITIES.find(item => item.id === effectiveActivityId);
  const venue = PLAN_VENUES.find(item => item.id === effectiveVenueId);
  const width = Number.parseFloat(effectiveVenueWidth);
  const depth = Number.parseFloat(effectiveVenueDepth);
  const customVenueOk = Number.isFinite(width) && Number.isFinite(depth) && width >= 2 && depth >= 2 && width <= 200 && depth <= 200;
  const customCount = Number.parseInt(effectiveHeadcountInput, 10);
  const customCountOk = Number.isInteger(customCount) && customCount >= 1 && customCount <= 5000;
  // 没点纠偏时优先回显人说的词（「圆桌晚宴」），别被芯片短语收成「婚礼」。
  const activityPhrase = activityTouched
    ? (activity?.phrase ?? null)
    : (heard.activityPhrase ?? activity?.phrase ?? null);
  const venueReady = Boolean(venue) || (effectiveCustomVenue && customVenueOk);
  const venuePhrase = venue?.phrase
    ?? (effectiveCustomVenue && customVenueOk ? `${width}×${depth} 米` : (!venueTouched ? heard.venuePhrase : null));
  const resolvedCount = effectiveHeadcount !== null ? effectiveHeadcount : customCountOk ? customCount : null;
  const ready = Boolean(activityPhrase && venueReady && venuePhrase && resolvedCount !== null);
  const missing = [
    !activityPhrase ? missingLabel('activity') : null,
    !venueReady ? missingLabel('venue') : null,
    resolvedCount === null ? missingLabel('headcount') : null,
  ].filter((part): part is string => Boolean(part));
  const heardParts = [
    resolvedCount !== null ? `${resolvedCount} 人` : null,
    activityPhrase,
    venuePhrase,
  ].filter((part): part is string => Boolean(part));
  const fromDraft = Boolean(draft.trim()) && !activityTouched && !venueTouched && !headcountTouched;
  const echo = planHeardStatus(heardParts, missing);
  const statusText = attempted && !ready
    ? `先补齐${missing.join('、')}，再生成方案。`
    : echo;

  const touch = (field: TouchedField) => {
    setAdjusting(true);
    setTouched(current => ({ ...current, [field]: true }));
  };

  const showExamples = !draft.trim() && !adjusting;

  return <form className="sc-plan-home" aria-label="生成活动方案" onSubmit={event => {
    event.preventDefault();
    if (!activityPhrase || !venueReady || !venuePhrase || resolvedCount === null) { setAttempted(true); setAdjusting(true); return; }
    if (fromDraft && heard.ready && draft.trim()) {
      onGenerate(planGenerateFromDraft(draft));
      return;
    }
    onGenerate(planGenerateSentence(activityPhrase, venuePhrase, resolvedCount));
  }}>
    {showExamples && <div className="sc-plan-examples" role="group" aria-label="需求例句">
      {PLAN_EXAMPLES.map(sentence => (
        <button
          key={sentence}
          type="button"
          className="sc-plan-example"
          onClick={() => onPickExample?.(sentence)}
        >{sentence}</button>
      ))}
    </div>}

    {statusText && <p className={`sc-plan-need${heardParts.length ? ' is-heard' : ''}`} role="status">{statusText}</p>}

    <button type="submit" className={`sc-plan-act${ready ? '' : ' is-disabled'}`} aria-disabled={!ready}>生成方案</button>

    <button
      type="button"
      className={`sc-plan-adjust${adjusting ? ' is-open' : ''}`}
      aria-expanded={adjusting}
      onClick={() => setAdjusting(value => !value)}
    >{adjusting ? '收起选项' : '改类型或人数'}</button>

    {adjusting && <>
      <fieldset>
        <legend>活动</legend>
        <div className="sc-plan-chips">
          {PLAN_ACTIVITIES.map(item => <button key={item.id} type="button" aria-pressed={effectiveActivityId === item.id} onClick={() => {
            touch('activity');
            setActivityId(item.id);
          }}>{item.label}</button>)}
        </div>
      </fieldset>
      <fieldset>
        <legend>场地</legend>
        <div className="sc-plan-chips">
          {PLAN_VENUES.map(item => <button key={item.id} type="button" aria-pressed={effectiveVenueId === item.id && !effectiveCustomVenue} onClick={() => {
            touch('venue');
            setVenueId(item.id);
            setCustomVenue(false);
          }}>{item.label}</button>)}
          <button type="button" aria-label="自定义场地" aria-pressed={effectiveCustomVenue} onClick={() => {
            touch('venue');
            setCustomVenue(true);
            setVenueId(null);
          }}>自定义</button>
        </div>
        {effectiveCustomVenue && <div className="sc-plan-custom">
          <label>宽 <input aria-label="场地宽度（米）" inputMode="decimal" min={2} max={200} placeholder="12" value={effectiveVenueWidth} onChange={event => {
            touch('venue');
            setCustomVenue(true);
            setVenueId(null);
            setVenueWidth(event.target.value);
          }}/> 米</label>
          <span aria-hidden="true">×</span>
          <label>深 <input aria-label="场地深度（米）" inputMode="decimal" min={2} max={200} placeholder="9" value={effectiveVenueDepth} onChange={event => {
            touch('venue');
            setCustomVenue(true);
            setVenueId(null);
            setVenueDepth(event.target.value);
          }}/> 米</label>
        </div>}
      </fieldset>
      <fieldset>
        <legend>人数</legend>
        <div className="sc-plan-chips">
          {PLAN_HEADCOUNTS.map(count => <button key={count} type="button" aria-pressed={effectiveHeadcount === count && !effectiveCustomHeadcount} onClick={() => {
            touch('headcount');
            setHeadcount(count);
            setCustomHeadcount(false);
          }}>{count} 人</button>)}
          <button type="button" aria-label="自定义人数" aria-pressed={effectiveCustomHeadcount} onClick={() => {
            touch('headcount');
            setCustomHeadcount(true);
            setHeadcount(null);
          }}>自定义</button>
        </div>
        {effectiveCustomHeadcount && <div className="sc-plan-custom">
          <label>人数 <input aria-label="人数（人）" inputMode="numeric" min={1} max={5000} placeholder="200" value={effectiveHeadcountInput} onChange={event => {
            touch('headcount');
            setCustomHeadcount(true);
            setHeadcount(null);
            setHeadcountInput(event.target.value);
          }}/> 人</label>
        </div>}
      </fieldset>
    </>}
  </form>;
}
