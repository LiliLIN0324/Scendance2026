'use client';

import { useState, type FormEvent } from 'react';
import { ArrowUp, Globe, LayoutTemplate, Plus, Scan, SquareDashed } from '@/components/solid-icons';
import { useRoomEditor } from '../contexts';
import type { ChatAgent } from './agent-chat-store';
import { MaterialCreateCell } from './material-create-cell';
import './agent-chat.css';

/**
 * 空间 / 物料的底部动作条（S3 面板化后形态）。
 * 假聊天气泡已退役：这一格不再来回寒暄，只留一条短指令框 + 真动词钮。
 * 总控与 Bingo 走 AgentPanel 那场真对话，这里不接管。
 */
const AGENT_CHAT_META: Record<'space' | 'material', { name: string; placeholder: string }> = {
  space: { name: '空间', placeholder: '一句话描述场地，如：80 人发布会，室内' },
  material: { name: '物料', placeholder: '一句话描述物件，如：一把户外折叠椅' },
};

export function AgentChat({ agent, onNewSpace, onOpenAholo, onSelectSpaceWorkflow }: { agent: ChatAgent; onNewSpace?: ((mode?: 'blank' | 'template') => void) | undefined; onOpenAholo?: ((kind: 'world' | 'recon', prompt?: string) => void) | undefined; onSelectSpaceWorkflow?: ((workflow: 'aholo' | 'traditional') => void) | undefined }): JSX.Element | null {
  const { layout } = useRoomEditor();
  void layout;
  const [draft, setDraft] = useState('');

  // 总控与 Bingo 是 AgentPanel 里那场真对话，这里不接管。
  if (agent === 'bingo' || agent === 'door') return null;

  const meta = AGENT_CHAT_META[agent];

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    // 真动作：空间脸 4 条口令直通对应回调；不匹配就只是清空——不再拼假寒暄。
    if (agent === 'space' && onSelectSpaceWorkflow && /传统.*(空间|模板)|切换.*传统|空白.*空间/.test(text)) {
      onSelectSpaceWorkflow('traditional');
      setDraft('');
      return;
    }
    if (agent === 'space' && onSelectSpaceWorkflow && /切回.*(生成|建模)|切换到.*(生成|建模)/.test(text)) {
      onSelectSpaceWorkflow('aholo');
      setDraft('');
      return;
    }
    if (agent === 'space' && onOpenAholo) {
      const kind = /重建|真实场地|实景|现场照片|现场视频|照片重建|视频重建/.test(text)
        ? 'recon'
        : /生成.{0,8}(空间|场景)|创建.{0,8}(空间|场景)/.test(text)
          ? 'world'
          : null;
      if (kind) {
        onOpenAholo(kind, kind === 'world' ? text : undefined);
        setDraft('');
        return;
      }
    }
    setDraft('');
  };

  return (
    <div className={`ap-chat is-${agent}`}>
      <form className="ap-composer ap-composer-compact" aria-label={`${meta.name}动作框`} onSubmit={submit}>
        <label className="sr-only" htmlFor={`ap-chat-${agent}`}>{meta.name}输入框</label>
        <div className="ap-composer-field">
          <textarea
            id={`ap-chat-${agent}`}
            rows={1}
            value={draft}
            maxLength={400}
            placeholder={meta.placeholder}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
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
                  <button type="button" onClick={event => { onSelectSpaceWorkflow?.('aholo'); onOpenAholo('world'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Globe size={13} aria-hidden="true"/><span>生成场地</span></button>
                  <button type="button" onClick={event => { onOpenAholo('recon'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Scan size={13} aria-hidden="true"/><span>上传照片重建场地</span></button>
                </>}
                {onNewSpace && <>
                  <button type="button" onClick={event => { onNewSpace('blank'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><SquareDashed size={13} aria-hidden="true"/><span>新建空白空间</span></button>
                  <button type="button" onClick={event => { onNewSpace('template'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><LayoutTemplate size={13} aria-hidden="true"/><span>从模板开始</span></button>
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
