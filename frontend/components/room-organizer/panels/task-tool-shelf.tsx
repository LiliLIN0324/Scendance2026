'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { HEADCOUNT_MAX } from '../lib/workbench-agent';
import { INITIAL_BRIEF } from '../lib/creative-brief';
import { useAgent } from './agent-panel';
import { useStudioAgent } from './creative-studio';
import {
  checkBlockReason,
  handoffBlockReason,
  taskToolNextStep,
  taskToolOpenGroup,
  type TaskToolGroup,
} from './task-tool-next';
import './task-tool-shelf.css';

export interface TaskToolGroupRequest {
  group: TaskToolGroup;
  nonce: number;
}

/**
 * 助手下面的工具区。三组对应真实任务：定场地、放物件、检查并交付。
 * 不切换助手对话，也不新开一层全屏。
 */
export function TaskToolShelf({
  venueReady,
  itemCount,
  groupRequest,
  activityKey = '',
  onOpenChecklist,
  spaceSlot,
  materialSlot,
}: {
  venueReady: boolean;
  itemCount: number;
  groupRequest: TaskToolGroupRequest | null;
  /** 换项目时丢掉这一格里还没提交的人数草稿。 */
  activityKey?: string;
  onOpenChecklist(): void;
  spaceSlot: ReactNode;
  materialSlot: ReactNode;
}): JSX.Element {
  const agent = useAgent();
  const studio = useStudioAgent();
  // null 表示人还没点过。数据自己变（放进一件、读出存档）不把眼前的工具换掉。
  const [manual, setManual] = useState<TaskToolGroup | null>(null);
  const [seenActivity, setSeenActivity] = useState(activityKey);
  if (seenActivity !== activityKey) {
    setSeenActivity(activityKey);
    setManual(null);
  }
  const [note, setNote] = useState('');
  // null = 还没在这格里改过。默认 24 是脚手架，不能拿来判断「已经填了」。
  const [entry, setEntry] = useState<{ text: string; committed: boolean } | null>(null);

  useEffect(() => {
    if (!groupRequest) return;
    setManual(groupRequest.group);
  }, [groupRequest]);

  useEffect(() => {
    setEntry(null);
  }, [activityKey]);

  const scaffold = !!studio
    && !studio.hasSavedBrief
    && studio.brief.event === INITIAL_BRIEF.event
    && studio.brief.guests === INITIAL_BRIEF.guests;
  const peopleStated = entry ? entry.committed : !!studio && !scaffold;
  const generating = agent.state === 'generating' || agent.state === 'generatePaused';
  const unconfirmed = agent.state === 'planProposed' || agent.proposal !== null;
  const planShown = agent.state === 'planReady' || agent.state === 'planEdited';
  const step = taskToolNextStep({ venueReady, peopleStated, itemCount, planShown });
  const shown = manual ?? taskToolOpenGroup({ venueReady, itemCount });
  const checkReason = checkBlockReason({ itemCount, generating, unconfirmed });
  const handoffReason = handoffBlockReason({ itemCount, generating, unconfirmed });
  const peopleText = entry ? entry.text : (!studio || scaffold ? '' : String(studio.brief.guests));

  const choose = (next: TaskToolGroup) => {
    setManual(next);
    setNote('');
  };

  const writeGuests = (raw: string) => {
    if (!studio) return;
    if (raw.trim() === '') {
      setEntry({ text: '', committed: false });
      studio.setBrief(current => ({ ...current, guests: INITIAL_BRIEF.guests }));
      return;
    }
    if (!/^\d+$/.test(raw)) {
      setEntry({ text: raw, committed: false });
      return;
    }
    const next = Number(raw);
    if (next < 1 || next > HEADCOUNT_MAX) {
      setEntry({ text: raw, committed: false });
      return;
    }
    setEntry({ text: raw, committed: true });
    studio.setBrief(current => ({ ...current, guests: next }));
  };

  return (
    <section id="task-tool-shelf" className="sc-task-tools" aria-label="工具">
      <p className="sc-task-next" role="status">{step.text}</p>
      <label className={`sc-task-people${step.focus === 'people' ? ' is-next' : ''}`}>
        <span>这场来多少人</span>
        <input
          type="number"
          inputMode="numeric"
          aria-label="这场来多少人"
          min={1}
          max={HEADCOUNT_MAX}
          placeholder="例如 80"
          value={peopleText}
          disabled={!studio || !!studio.busy}
          onChange={event => writeGuests(event.target.value)}
        />
      </label>
      {!studio && <p className="sc-task-reason">人数还读不到。先在上面的对话里说出人数。</p>}
      <div className="sc-task-tabs" role="tablist" aria-label="空间、物料、检查">
        {([
          ['space', '空间'],
          ['material', '物料'],
          ['handoff', '检查'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`task-tab-${id}`}
            aria-selected={shown === id}
            aria-controls={`task-panel-${id}`}
            className={shown === id ? 'is-selected' : ''}
            onClick={() => choose(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="sc-task-panel"
        onPointerDown={() => setManual(shown)}
        role="tabpanel"
        id={`task-panel-${shown}`}
        aria-labelledby={`task-tab-${shown}`}
      >
        {shown === 'space' && <div className="sc-task-slot">{spaceSlot}</div>}
        {shown === 'material' && (
          <div className="sc-task-slot">{materialSlot}</div>
        )}
        {shown === 'handoff' && (
          <div className="sc-task-actions">
            <button type="button" className={step.focus === 'check' ? 'sc-task-primary' : 'sc-task-secondary'} disabled={checkReason !== null} onClick={() => agent.reviewNow()}>检查这一版</button>
            {checkReason && <p className="sc-task-reason" role="status">{checkReason}</p>}
            <button type="button" className="sc-task-secondary" disabled={handoffReason !== null} onClick={() => agent.callbacks.onOpenReview()}>准备给客户看</button>
            <button type="button" className="sc-task-secondary" disabled={handoffReason !== null} onClick={() => { agent.issueReviewLink(); setNote('链接写在上面的对话里，可以从那里复制。'); }}>复制给客户的链接</button>
            <button type="button" className="sc-task-secondary" disabled={handoffReason !== null} onClick={() => agent.callbacks.onOpenDelivery()}>交给执行</button>
            <button type="button" className="sc-task-secondary" disabled={handoffReason !== null} onClick={onOpenChecklist}>到场清单</button>
            {handoffReason && <p className="sc-task-reason" role="status">{handoffReason}</p>}
            {note && <p className="sc-task-reason" role="status">{note}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
