'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { ArrowUp } from 'lucide-react';
import { useRoomEditor } from '../contexts';
import { materialCount, venueArea } from '../lib/structural-layout';
import { formatArea } from '../lib/workbench-agent';
import {
  appendAgentChatMessage, globalAgentChatFeed, subscribeAgentChat, getAgentChatThreads,
  type AgentChatMessage, type ChatAgent,
} from './agent-chat-store';
import './agent-chat.css';

/** 每条线的名字，和左轨四格一致。 */
const AGENT_CHAT_META: Record<ChatAgent, { name: string; placeholder: string }> = {
  door: { name: '总控', placeholder: '说一句全局的，比如「今天先做发布会主厅」' },
  bingo: { name: 'Bingo', placeholder: '' },
  space: { name: '空间', placeholder: '说一句关于场地或观感的' },
  material: { name: '物料', placeholder: '说一句要加或要换的物料' },
};

/** 千篇一律的寒暄没意义：回答直接用画布上的真实读数拼。 */
function readout(agent: ChatAgent, facts: string[]): string {
  const hint = agent === 'door'
    ? '总控只汇总，不动手：改布置去 Bingo，换场地去空间，加物件去物料。'
    : agent === 'space'
      ? '换场地、套模板、调观感都在空间栏左边的面板里点。'
      : '要新物件，点下面那格「生成物料」走一遍，生成完会落到画布上。';
  return `${facts.join('；')}。${hint}`;
}

/**
 * 空间/物料/总控的底部对话。
 * 刻意只用 Bingo 那套 `ap-feed` / `ap-user` / `ap-turn` / `ap-composer` 结构，
 * 不另起一套输入条——四格看起来必须是同一个聊天框。
 */
export function AgentChat({ agent }: { agent: ChatAgent }): JSX.Element | null {
  const threads = useSyncExternalStore(subscribeAgentChat, getAgentChatThreads, getAgentChatThreads);
  const { layout, activeFloor } = useRoomEditor();
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLDivElement | null>(null);

  const door = agent === 'door';
  const messages = useMemo<AgentChatMessage[]>(
    () => (door ? globalAgentChatFeed(threads) : threads[agent] ?? []),
    [agent, door, threads],
  );

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages.length]);

  if (agent === 'bingo') return null;

  const facts = (() => {
    const area = formatArea(venueArea(layout));
    const items = materialCount(activeFloor?.items ?? []);
    if (agent === 'space') return [`场地 ${area} ㎡，这一层 ${items} 件物料`];
    if (agent === 'material') return [`这一层 ${items} 件物料`];
    return [`这场活动 ${area} ㎡，这一层 ${items} 件物料`];
  })();

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    appendAgentChatMessage(agent, 'you', text);
    appendAgentChatMessage(agent, 'agent', readout(agent, facts));
    setDraft('');
  };

  return (
    <div className={`ap-chat is-${agent}`}>
      <div className="ap-feed ap-chat-feed" ref={feedRef} aria-live="polite">
        {messages.length === 0 && (
          <p className="ap-chat-empty">{door ? '四个格子说过的话会汇总到这里。' : '还没有对话，写一句试试。'}</p>
        )}
        {messages.map(message => (message.from === 'you'
          ? <div key={message.id} className="ap-user"><div>{door && <small className="ap-chat-tag">{AGENT_CHAT_META[message.agent].name}</small>}<strong>{message.text}</strong></div></div>
          : <div key={message.id} className="ap-turn">{door && <small className="ap-chat-tag">{AGENT_CHAT_META[message.agent].name}</small>}<p className="ap-agent">{message.text}</p></div>))}
      </div>
      <form className="ap-composer" aria-label={door ? '全局聊天' : `${AGENT_CHAT_META[agent].name}聊天`} onSubmit={submit}>
        <label className="sr-only" htmlFor={`ap-chat-${agent}`}>{AGENT_CHAT_META[agent].name}输入框</label>
        <div className="ap-composer-field">
          <textarea
            id={`ap-chat-${agent}`}
            rows={2}
            value={draft}
            maxLength={400}
            placeholder={AGENT_CHAT_META[agent].placeholder}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }}
          />
        </div>
        <div className="ap-composer-bar">
          <div className="ap-composer-left"/>
          <button type="submit" className="ap-send" aria-label="发送" disabled={!draft.trim()}><ArrowUp size={18}/></button>
        </div>
      </form>
    </div>
  );
}