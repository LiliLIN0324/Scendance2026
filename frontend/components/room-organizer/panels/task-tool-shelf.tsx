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
  onOpenChecklist,
  spaceSlot,
  materialSlot,
}: {
  venueReady: boolean;
  itemCount: number;
  groupRequest: TaskToolGroupRequest | null;
  onOpenChecklist(): void;
  spaceSlot: ReactNode;
  materialSlot: ReactNode;
}): JSX.Element {
  const agent = useAgent();
  const studio = useStudioAgent();
  const [picked, setPicked] = useState(false);
  const [group, setGroup] = useState<TaskToolGroup>('space');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!groupRequest) return;
    setPicked(true);
    setGroup(groupRequest.group);
  }, [groupRequest]);

  const peopleStated = !!studio && (studio.hasSavedBrief || studio.brief.guests !== INITIAL_BRIEF.guests);
  const generating = agent.state === 'generating' || agent.state === 'generatePaused';
  const unconfirmed = agent.state === 'planProposed' || agent.proposal !== null;
  const planShown = agent.state === 'planReady' || agent.state === 'planEdited';
  const step = taskToolNextStep({ venueReady, peopleStated, itemCount, planShown });
  const shown: TaskToolGroup = picked ? group : step.group;
  const checkReason = checkBlockReason({ itemCount, generating, unconfirmed });
  const handoffReason = handoffBlockReason({ itemCount, generating, unconfirmed });
  const peopleValue = peopleStated && studio ? String(studio.brief.guests) : '';

  const choose = (next: TaskToolGroup) => {
    setPicked(true);
    setGroup(next);
    setNote('');
  };

  const writeGuests = (raw: string) => {
    if (!studio) return;
    if (raw.trim() === '') {
      studio.setBrief(current => ({ ...current, guests: INITIAL_BRIEF.guests }));
      return;
    }
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    const guests = Math.max(1, Math.min(HEADCOUNT_MAX, Math.floor(next)));
    studio.setBrief(current => ({ ...current, guests }));
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
          value={peopleValue}
          disabled={!studio || !!studio.busy}
          onChange={event => writeGuests(event.target.value)}
        />
      </label>
      {!studio && <p className="sc-task-reason">人数还读不到。先在上面的对话里说出人数。</p>}
      <div className="sc-task-tabs" role="tablist" aria-label="空间、物料、检查与交付">
        {([
          ['space', '空间'],
          ['material', '物料'],
          ['handoff', '检查与交付'],
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
        role="tabpanel"
        id={`task-panel-${shown}`}
        aria-labelledby={`task-tab-${shown}`}
      >
        {shown === 'space' && (
          <>
            <button type="button" className={step.focus === 'venue' ? 'sc-task-primary' : 'sc-task-secondary'} onClick={() => agent.startVenuePicker()}>定场地</button>
            <p className="sc-task-hint">点一下会打开选场地。也可以直接在画面里改尺寸。</p>
            <div className="sc-task-slot">{spaceSlot}</div>
            <details className="sc-task-more">
              <summary>其他场地做法</summary>
              <button type="button" className="sc-task-secondary" disabled={!agent.callbacks.onOpenReference} onClick={() => agent.callbacks.onOpenReference?.()}>看图纸和照片</button>
              {!agent.callbacks.onOpenReference && <p className="sc-task-reason">图纸入口还没接上。</p>}
              <a className="sc-task-secondary" href="/guide/capture">用手机拍场地</a>
            </details>
          </>
        )}
        {shown === 'material' && (
          <>
            <p className="sc-task-hint">点一件，它会放到画面上。拖进去也可以。</p>
            <div className="sc-task-slot">{materialSlot}</div>
          </>
        )}
        {shown === 'handoff' && (
          <>
            <button type="button" className={step.focus === 'check' ? 'sc-task-primary' : 'sc-task-secondary'} disabled={checkReason !== null} onClick={() => agent.reviewNow()}>检查这一版</button>
            {checkReason && <p className="sc-task-reason" role="status">{checkReason}</p>}
            <details className="sc-task-more">
              <summary>交给别人</summary>
              <button type="button" className="sc-task-secondary" disabled={handoffReason !== null} onClick={() => agent.callbacks.onOpenReview()}>准备给客户看</button>
              <button type="button" className="sc-task-secondary" disabled={handoffReason !== null} onClick={() => { agent.issueReviewLink(); setNote('链接写在上面的对话里，可以从那里复制。'); }}>复制给客户的链接</button>
              <button type="button" className="sc-task-secondary" disabled={handoffReason !== null} onClick={() => agent.callbacks.onOpenDelivery()}>交给执行</button>
              <button type="button" className="sc-task-secondary" disabled={handoffReason !== null} onClick={onOpenChecklist}>到场清单</button>
              {handoffReason && <p className="sc-task-reason" role="status">{handoffReason}</p>}
              {note && <p className="sc-task-reason" role="status">{note}</p>}
            </details>
          </>
        )}
      </div>
    </section>
  );
}
