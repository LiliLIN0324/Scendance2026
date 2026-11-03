'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { ArrowUp, Globe, LayoutTemplate, Plus, Scan, SquareDashed } from '@/components/solid-icons';
import { useRoomEditor } from '../contexts';
import { materialCount, venueArea } from '../lib/structural-layout';
import { formatArea } from '../lib/workbench-agent';
import {
  appendAgentChatMessage, subscribeAgentChat, getAgentChatThreads,
  type ChatAgent,
} from './agent-chat-store';
import { AGENT_INPUT_SUGGESTIONS, SuggestionGhost, useSuggestion } from './typed-suggestion';
import { MaterialCreateCell } from './material-create-cell';
import './agent-chat.css';

/**
 * 每条线的名字，和左轨四格一致。
 * 总控与 Bingo 走 AgentPanel 里那场真对话（同一个 agent、同一段气泡），这里不接管。
 */
const AGENT_CHAT_META: Record<'space' | 'material', { name: string; placeholder: string }> = {
  space: { name: '空间', placeholder: '描述场地结构、图纸或环境需求' },
  material: { name: '物料', placeholder: '描述要找、调整或生成的物件' },
};

/** 千篇一律的寒暄没意义：回答直接用画布上的真实读数拼。 */
function readout(agent: 'space' | 'material', facts: string[]): string {
  const hint = agent === 'space'
    ? '空间默认走 Aholo World 世界模型生成 Gaussian 高斯场景；传统壳体与模板可随时切换。'
    : '物料负责物件规格和模型；生成后再交给 Bingo 纳入布置方案。';
  return `${facts.join('；')}。${hint}`;
}

/**
 * 空间 / 物料的底部对话。
 * 刻意只用 Bingo 那套 `ap-feed` / `ap-user` / `ap-turn` / `ap-composer` 结构，
 * 不另起一套输入条——四格看起来必须是同一个聊天框。
 */
export function AgentChat({ agent, onNewSpace, onOpenAholo, onSelectSpaceWorkflow }: { agent: ChatAgent; onNewSpace?: ((mode?: 'blank' | 'template') => void) | undefined; onOpenAholo?: ((kind: 'world' | 'recon', prompt?: string) => void) | undefined; onSelectSpaceWorkflow?: ((workflow: 'aholo' | 'traditional') => void) | undefined }): JSX.Element | null {
  const threads = useSyncExternalStore(subscribeAgentChat, getAgentChatThreads, getAgentChatThreads);
  const { layout, activeFloor } = useRoomEditor();
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const messages = useMemo(
    () => threads[agent] ?? [],
    [agent, threads],
  );

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages.length]);

  // 和总控、Bingo、生成条同一份逐字提示，只是这格说场地/物料的事。
  const suggestion = useSuggestion(AGENT_INPUT_SUGGESTIONS[agent]);
  const ghostVisible = !draft.trim();

  // 总控与 Bingo 是 AgentPanel 里那场真对话，这里不接管。
  if (agent === 'bingo' || agent === 'door') return null;

  const meta = AGENT_CHAT_META[agent];

  const facts = (() => {
    const area = formatArea(venueArea(layout));
    const items = materialCount(activeFloor?.items ?? []);
    if (agent === 'space') return [`场地 ${area} ㎡，这一层 ${items} 件物料`];
    return [`这一层 ${items} 件物料`];
  })();

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    appendAgentChatMessage(agent, 'you', text);
    if (agent === 'space' && onSelectSpaceWorkflow && /传统.*(空间|模板)|切换.*传统|空白.*空间/.test(text)) {
      onSelectSpaceWorkflow('traditional');
      appendAgentChatMessage(agent, 'agent', '已切换到传统空间流程。可直接从空白壳或场景模板开始；需要世界模型时再切回 Aholo。');
      setDraft('');
      return;
    }
    if (agent === 'space' && onSelectSpaceWorkflow && /切回.*(Aholo|世界模型|高斯)|切换到.*(Aholo|世界模型|高斯)/i.test(text)) {
      onSelectSpaceWorkflow('aholo');
    }
    if (agent === 'space' && onOpenAholo) {
      const kind = /重建|真实场地|实景|现场照片|现场视频|照片重建|视频重建/.test(text)
        ? 'recon'
        : /Aholo|世界模型|高斯|生成.{0,8}(空间|场景)|创建.{0,8}(空间|场景)/i.test(text)
          ? 'world'
          : null;
      if (kind) {
        onOpenAholo(kind, kind === 'world' ? text : undefined);
        appendAgentChatMessage(agent, 'agent', kind === 'world'
          ? '已打开 Aholo World 世界模型，并带入你的场景描述。生成后可以把 3DGS 高斯场景挂成本场环境。'
          : '已打开 Aholo 真实场地重建。请上传现场照片或视频；地图卫星图不能作为重建素材。');
        setDraft('');
        return;
      }
    }
    appendAgentChatMessage(agent, 'agent', readout(agent, facts));
    setDraft('');
  };

  return (
    <div className={`ap-chat is-${agent}`}>
      {/* 空会话也留着这层：它负责吃掉剩余高度，输入条才会被顶到面板底边。 */}
      <div className="ap-feed ap-chat-feed" ref={feedRef} aria-live="polite">
        {messages.map(message => (message.from === 'you'
          ? <div key={message.id} className="ap-user"><div><strong>{message.text}</strong></div></div>
          : <div key={message.id} className="ap-turn"><p className="ap-agent">{message.text}</p></div>))}
      </div>
      <form className="ap-composer ap-composer-compact" aria-label={`${meta.name}聊天`} onSubmit={submit}>
        <label className="sr-only" htmlFor={`ap-chat-${agent}`}>{meta.name}输入框</label>
        <div className="ap-composer-field">
          {ghostVisible && <SuggestionGhost className="ap-ghost ap-chat-ghost" full={suggestion.full} shown={suggestion.shown} onPick={text => { setDraft(text); requestAnimationFrame(() => inputRef.current?.focus()); }}/>}
          <textarea
            id={`ap-chat-${agent}`}
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={400}
            placeholder={ghostVisible ? '' : meta.placeholder}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Tab' && !draft.trim()) { event.preventDefault(); setDraft(suggestion.full); return; }
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }}
          />
        </div>
        <div className="ap-composer-bar">
          <div className="ap-composer-left">
            {agent === 'space' && (onNewSpace || onOpenAholo) && <details className="sc-chat-plus">
              <summary aria-label="更多操作" data-tip="更多"><Plus size={16} aria-hidden="true"/></summary>
              <div className="sc-chat-plus-menu">
                {onOpenAholo && <>
                  <button type="button" onClick={event => { onSelectSpaceWorkflow?.('aholo'); onOpenAholo('world'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Globe size={13} aria-hidden="true"/><span>Aholo 世界模型 · 高斯空间</span></button>
                  <button type="button" onClick={event => { onOpenAholo('recon'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Scan size={13} aria-hidden="true"/><span>Aholo 重建真实场地</span></button>
                </>}
                {onNewSpace && <>
                  <button type="button" onClick={event => { onNewSpace('blank'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><SquareDashed size={13} aria-hidden="true"/><span>传统 · 新建空白空间</span></button>
                  <button type="button" onClick={event => { onNewSpace('template'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><LayoutTemplate size={13} aria-hidden="true"/><span>传统 · 从模板开始</span></button>
                </>}
              </div>
            </details>}
            {/* 物料这一格的左下角就是那颗生成物料星，和总控那格同一个入口、同一颗钮。 */}
            {agent === 'material' && <MaterialCreateCell/>}
          </div>
          <button type="submit" className="ap-send" aria-label="发送" disabled={!draft.trim()}><ArrowUp size={18}/></button>
        </div>
      </form>
    </div>
  );
}
