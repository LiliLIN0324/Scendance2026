'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Camera, Globe, Scan } from '@/components/solid-icons';
import { useAgentOptional } from './agent-panel';
import { matchSceneIntent } from '../lib/scene-chat-intent';
import type { ScannedVenue } from '../lib/venue-scans';

type Message = { id: string; role: 'user' | 'agent'; text: string; amber?: boolean };

/**
 * 场景库里的真对话：能打字、能回话，也能直接把本机扫描加进本场。
 *
 * 认得出的现场动作（拍摄、生成、重建、加扫描）当场做掉并回报；
 * 其余句子原样交给主 Agent（brief 抽取 + 真模型），不在这里另造一套理解。
 */
export function SceneChat({ scans, onPickScan, onOpenCapture, onGenerate, onReconstruct }: {
  scans: readonly ScannedVenue[];
  onPickScan?: ((venue: ScannedVenue) => void) | undefined;
  onOpenCapture?: (() => void) | undefined;
  onGenerate?: (() => void) | undefined;
  onReconstruct?: (() => void) | undefined;
}): JSX.Element {
  const agent = useAgentOptional();
  const [draft, setDraft] = useState('');
  const [local, setLocal] = useState<Message[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);

  // 挂着 Agent 时，这场对话就是主会话本身：在哪边说都落进同一段话。
  const messages: readonly Message[] = agent ? agent.bubbles.slice(-12) : local;
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages.length]);

  const push = (message: Omit<Message, 'id'>): void => {
    if (agent) { agent.say(message); return; }
    setLocal(prev => [...prev.slice(-12), { ...message, id: `local-${prev.length}-${message.text.length}` }]);
  };

  const run = (raw: string): void => {
    const text = raw.trim();
    if (!text) return;
    setDraft('');
    const intent = matchSceneIntent(text, scans);
    if (intent.kind === 'agent') {
      if (agent) { void agent.send(text); return; }
      push({ role: 'user', text });
      push({ role: 'agent', amber: true, text: '这段对话得在工作台的 Agent 面板里说。' });
      return;
    }
    push({ role: 'user', text });
    if (intent.kind === 'capture') {
      onOpenCapture?.();
      push({ role: 'agent', text: '采集页开了：拍完把素材带回来，这里能直接生成场地。' });
      return;
    }
    if (intent.kind === 'generate') {
      onGenerate?.();
      push({ role: 'agent', text: '生成场地已经打开：写一句提示，或直接生成。' });
      return;
    }
    if (intent.kind === 'reconstruct') {
      onReconstruct?.();
      push({ role: 'agent', text: '照片重建已经打开：把这一场的照片传上去就能重建。' });
      return;
    }
    if (!onPickScan) {
      push({ role: 'agent', amber: true, text: '这个面板暂时接不上场景，先回工作台那边加。' });
      return;
    }
    const names = intent.venues.map(venue => venue.name);
    intent.venues.forEach(venue => onPickScan(venue));
    push({
      role: 'agent',
      text: names.length > 1
        ? `已把「${names.join('、')}」都加进本场，画面停在最后一场。`
        : `已把「${names[0]}」加进本场，正在加载实景。`,
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    run(draft);
  };

  return <div className="sc-scene-chat">
    <div className="sc-scene-chat-feed" ref={feedRef} aria-live="polite" aria-label="场景库对话">
      {messages.length === 0 && <p className="sc-scene-chat-lead">
        说说要做什么，比如「把西湖 0233 标准档加进本场」或「拍一段场地」。
      </p>}
      {messages.map(message => message.role === 'user'
        ? <div key={message.id} className="ap-user"><div><strong>{message.text}</strong></div></div>
        : <div key={message.id} className="ap-turn"><p className={`ap-agent${message.amber ? ' is-amber' : ''}`}>{message.text}</p></div>)}
    </div>
    <form className="sc-scene-chat-composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="sc-scene-chat-input">对场景库说一句话</label>
      <textarea
        id="sc-scene-chat-input"
        rows={1}
        value={draft}
        maxLength={400}
        placeholder="说一句，比如「把西湖 0233 标准档加进本场」"
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }}
      />
      <button type="submit" className="sc-scene-chat-send" aria-label="发送" disabled={!draft.trim()}><ArrowUp size={16}/></button>
    </form>
    <div className="sc-scene-chat-quick" role="group" aria-label="常用动作">
      {onOpenCapture ? <button type="button" onClick={() => run('拍摄场地')}><Camera size={13} aria-hidden="true"/>拍摄场地</button>
        : <a href="/guide/capture"><Camera size={13} aria-hidden="true"/>拍摄场地</a>}
      {onGenerate && <button type="button" onClick={() => run('生成场地')}><Globe size={13} aria-hidden="true"/>生成场地</button>}
      {onReconstruct && <button type="button" onClick={() => run('照片重建')}><Scan size={13} aria-hidden="true"/>照片重建</button>}
    </div>
  </div>;
}
