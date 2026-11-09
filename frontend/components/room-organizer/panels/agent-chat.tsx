'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUp, Globe, LayoutTemplate, Plus, Scan, SquareDashed } from '@/components/solid-icons';
import { useSupervisionMode } from '../hooks/use-supervision-mode';
import {
  getAgentRun,
  pushAgentSteerNote,
  subscribeAgentRun,
  type ChatAgent,
} from './agent-chat-store';
import { AgentRunPanel } from './agent-run-panel';
import { MaterialCreateCell } from './material-create-cell';
import './agent-chat.css';

/** Space and materials expose direct actions; text is reserved for steering an active run. */
const COLOR_GREEN = '#4A7C59';

export function AgentChat({ agent, onNewSpace, onOpenAholo, onSelectSpaceWorkflow, hideLibraryActions }: {
  agent: ChatAgent;
  onNewSpace?: ((mode?: 'blank' | 'template') => void) | undefined;
  onOpenAholo?: ((kind: 'world' | 'recon', prompt?: string) => void) | undefined;
  hideLibraryActions?: boolean;
  onSelectSpaceWorkflow?: ((workflow: 'aholo' | 'traditional') => void) | undefined;
}): JSX.Element | null {
  const [draft, setDraft] = useState('');

  // 订阅运行时账本（真步骤时间线 / 三控件状态）。
  // 注意：所有 hooks 必须在 early return 之前调用（React rules of hooks）。
  const [run, setRun] = useState(getAgentRun);
  useEffect(() => subscribeAgentRun(() => setRun(getAgentRun())), []);
  const [mode, setMode] = useSupervisionMode();

  const submitSteer = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    pushAgentSteerNote(text);
    setDraft('');
  };

  // 活动与 Bingo 是 AgentPanel 里那场真对话，这里不接管。
  // 放在所有 hooks 之后（React rules of hooks）。
  if (agent === 'bingo' || agent === 'door') return null;
  const canSteer = run.isRunning && run.scope === agent;

  return (
    <div className={`ap-chat is-${agent}`}>
      <AgentRunPanel scope={agent} steerInputId={`ap-chat-${agent}`}/>

      {!hideLibraryActions && <div className="ap-tool-actions">
        <div className="ap-composer-left">
          {agent === 'material' && <MaterialCreateCell variant="action"/>}
          {agent === 'space' && onOpenAholo && <>
            <button type="button" className="ap-gen-chip" onClick={() => { onSelectSpaceWorkflow?.('aholo'); onOpenAholo('world'); }}>
              <Globe size={15} aria-hidden="true"/>生成场地
            </button>
            <button type="button" className="ap-gen-chip" onClick={() => onOpenAholo('recon')}>
              <Scan size={15} aria-hidden="true"/>照片重建
            </button>
          </>}
          {agent === 'space' && onNewSpace && <details className="sc-chat-plus">
            <summary aria-label="更多操作" title="更多操作"><Plus size={16} aria-hidden="true"/></summary>
            <div className="sc-chat-plus-menu">
              <button type="button" onClick={event => { onNewSpace('blank'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><SquareDashed size={13} aria-hidden="true"/>新建空白空间</button>
              <button type="button" onClick={event => { onNewSpace('template'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><LayoutTemplate size={13} aria-hidden="true"/>从模板开始</button>
            </div>
          </details>}
        </div>
      </div>}

      {canSteer && <form className="ap-composer ap-composer-compact" aria-label="调整正在运行的任务" onSubmit={submitSteer}>
        <label className="sr-only" htmlFor={`ap-chat-${agent}`}>为下一步加备注</label>
        <div className="ap-composer-field">
          <textarea
            id={`ap-chat-${agent}`}
            rows={1}
            value={draft}
            maxLength={400}
            placeholder="为下一步加备注…"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }}
          />
        </div>
        <div className="ap-composer-bar">
          <div className="ap-composer-left">
            <details className="sc-chat-plus" aria-label="监督档位">
              <summary data-tip="监督档位" style={{ fontSize: 12, cursor: 'pointer', color: '#6b7280' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLOR_GREEN, display: 'inline-block' }} aria-hidden="true"/>
                  监督
                </span>
              </summary>
              <div
                className="sc-chat-plus-menu"
                role="radiogroup"
                aria-label="监督档位"
                style={{ padding: '8px 10px', minWidth: 200 }}
              >
                {([
                  { value: 'strict' as const, label: '严格', hint: '每件家具摆放前都会问你' },
                  { value: 'checkpoint' as const, label: '关键节点', hint: '在计划步骤和大范围改动前询问' },
                  { value: 'auto' as const, label: '自动', hint: '无冲突直接放置，有冲突才问你' },
                ]).map(opt => (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0', cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="radio"
                        name={`supervision-${agent}`}
                        checked={mode === opt.value}
                        onChange={() => setMode(opt.value)}
                        style={{ accentColor: COLOR_GREEN }}
                      />
                      <span style={{ fontWeight: mode === opt.value ? 600 : 400, color: '#2b2f36' }}>{opt.label}</span>
                    </span>
                    {mode === opt.value && (
                      <span style={{ paddingLeft: 22, fontSize: 11, color: '#6b7280' }}>{opt.hint}</span>
                    )}
                  </label>
                ))}
              </div>
            </details>
          </div>
          <button type="submit" className="ap-send" aria-label="添加备注" disabled={!draft.trim()}><ArrowUp size={18}/></button>
        </div>
      </form>}
    </div>
  );
}
