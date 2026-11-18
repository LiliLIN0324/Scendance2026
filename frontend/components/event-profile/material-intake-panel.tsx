import { useState } from 'react';
import type { EventOperations } from '../../../supabase/functions/_shared/event-operations-contract';
import { acceptIntakeDrafts, parseMaterialIntake, type IntakeDraft } from '../../lib/material-intake';

/**
 * 粘贴材料起草（P1-0 接线）：解析 → 逐条勾选 → 写入流程单。
 * 写入走 acceptIntakeDrafts 的标题去重，不覆盖已有任务。
 */
export interface MaterialIntakePanelProps {
  operations: EventOperations;
  projectId: string;
  disabled?: boolean;
  onAccept: (next: EventOperations) => void;
  now?: string;
}

export function MaterialIntakePanel({ operations, projectId, disabled = false, onAccept, now = new Date().toISOString() }: MaterialIntakePanelProps) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<IntakeDraft[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const parse = () => {
    const parsed = parseMaterialIntake(text);
    setDrafts(parsed);
    setSelected(new Set(parsed.map(draft => draft.id)));
    setMessage(parsed.length ? null : { kind: 'error', text: '没有解析到可写入的行，请检查材料是否为空。' });
  };
  const accept = () => {
    try {
      const result = acceptIntakeDrafts(operations, drafts, [...selected], { projectId, acceptedAt: now });
      onAccept(result.operations);
      setDrafts([]);
      setSelected(new Set());
      setText('');
      setMessage({ kind: 'ok', text: `已写入 ${result.addedTaskIds.length} 项，原有任务未被覆盖。` });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '材料未写入，请重试。' });
    }
  };

  return (
    <details className="sc-material-intake">
      <summary>粘贴材料起草流程单</summary>
      <label className="sc-field">材料原文
        <textarea rows={6} value={text} maxLength={20000} disabled={disabled}
          placeholder="每行一件事；写了负责人或时刻就带出，没写就留空" onChange={event => setText(event.target.value)} />
      </label>
      <div className="sc-handoff-actions">
        <button className="sc-button" type="button" disabled={disabled || !text.trim()} onClick={parse}>解析材料</button>
      </div>
      {drafts.length > 0 && <fieldset disabled={disabled}>
        <legend>{`解析到 ${drafts.length} 行，勾选后写入`}</legend>
        <ul className="sc-material-intake-list">
          {drafts.map(draft => <li key={draft.id}>
            <label>
              <input type="checkbox" checked={selected.has(draft.id)} onChange={event => {
                const next = new Set(selected);
                if (event.target.checked) next.add(draft.id); else next.delete(draft.id);
                setSelected(next);
              }} />
              {draft.title}
              {draft.ownerName ? <small>{` · 负责人 ${draft.ownerName}`}</small> : null}
              {draft.timeText ? <small>{` · 原文时刻 ${draft.timeText}（不生成排期）`}</small> : null}
            </label>
            <small className="sc-note">{`第 ${draft.sourceLine} 行：${draft.sourceQuote}`}</small>
          </li>)}
        </ul>
        <div className="sc-handoff-actions">
          <button className="sc-button" type="button" disabled={disabled || selected.size === 0} onClick={accept}>写入流程单</button>
        </div>
      </fieldset>}
      {message ? <p role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
    </details>
  );
}
