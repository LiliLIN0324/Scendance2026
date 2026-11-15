'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUp } from '@/components/solid-icons';
import { getAgentRun, pushAgentSteerNote, subscribeAgentRun, type ChatAgent } from './agent-chat-store';
import { AgentRunPanel } from './agent-run-panel';
import './agent-chat.css';

/**
 * 空间/物料栏的底部。
 *
 * 2026-11-16 用户指令：这两栏原来的「一句话描述场地 / 一句话描述物件」输入框属于旧的内联生成界面，
 * 已经并进统一生成面板（左轨「场地」、物料栏的星、属性卡三格都是同一个面板）。
 * 所以这里不再有描述框、不再转交活动对话、也不再挂一颗自己的生成星——
 * 只在 agent 真的在跑的时候留一个「备注」框，把一句话塞进下一轮上下文。
 */
export interface AgentChatProps {
  agent: ChatAgent;
}

export function AgentChat({ agent }: AgentChatProps): JSX.Element | null {
  const [run, setRun] = useState(getAgentRun);
  useEffect(() => subscribeAgentRun(() => setRun(getAgentRun())), []);
  const [note, setNote] = useState('');

  // 活动与 Bingo 是 AgentPanel 里那场真对话，这里不接管（放在 hooks 之后，守 rules of hooks）。
  if (agent === 'bingo' || agent === 'door') return null;
  const name = agent === 'space' ? '空间' : '物料';
  const inputId = `ap-chat-${agent}`;

  const submitNote = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = note.trim();
    if (!text) return;
    pushAgentSteerNote(text);
    setNote('');
  };

  return (
    <div className={`ap-chat is-${agent}`}>
      <AgentRunPanel scope={agent} {...(run.isRunning ? { steerInputId: inputId } : {})} />

      {run.isRunning && (
        <form className="ap-composer ap-composer-compact" aria-label={`${name}备注`} onSubmit={submitNote}>
          <label className="sr-only" htmlFor={inputId}>{name}备注</label>
          <div className="ap-composer-field">
            <textarea
              id={inputId}
              rows={1}
              value={note}
              maxLength={400}
              placeholder="为下一步加备注…"
              onChange={event => setNote(event.target.value)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
              }}
            />
          </div>
          <div className="ap-composer-bar">
            <div className="ap-composer-actions">
              <kbd className="ap-kbd" title="回车发送；Shift+Enter 换行">Enter</kbd>
              <button type="submit" className="ap-send" aria-label="发送备注" disabled={!note.trim()}><ArrowUp size={18}/></button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
