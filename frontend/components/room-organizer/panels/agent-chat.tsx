'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Globe, LayoutTemplate, Plus, Scan, SquareDashed } from '@/components/solid-icons';
import { useSupervisionMode, type SupervisionMode } from '../hooks/use-supervision-mode';
import {
  getAgentRun,
  pushAgentSteerNote,
  subscribeAgentRun,
  type ChatAgent,
} from './agent-chat-store';
import { AgentRunPanel } from './agent-run-panel';
import { MaterialCreateCell } from './material-create-cell';
import type { BackendSession } from '@/lib/backend-session';
import './agent-chat.css';

/** Space and materials expose direct actions; text is reserved for steering an active run. */
const COLOR_GREEN = '#4A7C59';
// Unsent text stays in this page only, partitioned by the caller's activity/session/account scope.
const retainedDrafts = new Map<string,string>();

const AGENT_CHAT_META: Record<'space' | 'material', { name: string; placeholder: string }> = {
  space: { name: '空间', placeholder: '一句话描述场地，如：80 人发布会，室内' },
  material: { name: '物料', placeholder: '一句话描述物件，如：一把户外折叠椅' },
};

/**
 * 监督三档与人话说明（语系对齐 petitmaker）。
 * 模型/供应商由服务端密钥决定：agent-chat-store 运行账本、BackendSession 快照、
 * assistant/chat 返回契约（仅 status+answer）与本地持久化里都没有可直接读取的当前
 * 对话模型名字段；provider_model 属逐条重建任务，GenerationCapabilities.model 是
 * 异步拉取的生成引擎能力，均不代表对话模型。因此摘要只显示监督档，取不到模型名时不编造。
 */
const SUPERVISION_OPTIONS: ReadonlyArray<{ value: SupervisionMode; label: string; hint: string }> = [
  { value: 'strict', label: '严格', hint: '每次改动前都先问你' },
  { value: 'checkpoint', label: '关键节点', hint: '在计划步骤和大范围改动前询问' },
  { value: 'auto', label: '自动', hint: '自动执行，无需逐步确认；所有修改均可撤销' },
];

export interface AgentChatProps {
  agent: ChatAgent;
  onNewSpace?: ((mode?: 'blank' | 'template') => void) | undefined;
  onOpenAholo?: ((kind: 'world' | 'recon', prompt?: string) => void) | undefined;
  onSelectSpaceWorkflow?: ((workflow: 'aholo' | 'traditional') => void) | undefined;
  /** True means the current activity accepted the text for its existing conversation. */
  onForwardToActivity?: ((text:string) => boolean | Promise<boolean>) | undefined;
  draftScope?: string | undefined;
  /** 登录后的云会话。物料生成靠它提交，不在浏览器里放密钥。 */
  controller?: BackendSession | undefined;
  hideLibraryActions?: boolean;
}

export function AgentChat({ agent, onNewSpace, onOpenAholo, onSelectSpaceWorkflow, onForwardToActivity, draftScope, controller, hideLibraryActions }: AgentChatProps): JSX.Element | null {
  const [draft, setDraft] = useState(()=>draftScope ? retainedDrafts.get(draftScope)??'' : '');
  const [notice, setNotice] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const forwardingRef = useRef(false);
  function rememberDraft(value:string):void { if(draftScope){if(value)retainedDrafts.set(draftScope,value);else retainedDrafts.delete(draftScope);}setDraft(value); }

  // 订阅运行时账本（真步骤时间线 / 三控件状态）。
  // 注意：所有 hooks 必须在 early return 之前调用（React rules of hooks）。
  const [run, setRun] = useState(getAgentRun);
  useEffect(() => subscribeAgentRun(() => setRun(getAgentRun())), []);
  const [mode, setMode] = useSupervisionMode();
  const activeOption = SUPERVISION_OPTIONS.find(option => option.value === mode) ?? SUPERVISION_OPTIONS[1]!;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if(forwardingRef.current)return;
    const text = draft.trim();
    if (!text) return;
    const actionClauses=text.split(/[，,。；;！!]/).map(value=>value.trim()).filter(value=>value&&!/(?:不要|不用|无需|不需要|暂不|别|已经|已完成|完成了|如何|怎么|怎样|是否|能否|要不要|是什么意思|[?？])/.test(value));
    // These shortcuts are not a general conversation; retain any unhandled request.
    if (agent === 'space' && onSelectSpaceWorkflow && actionClauses.some(value=>/传统.*(空间|模板)|切换.*传统|空白.*空间/.test(value))) {
      onSelectSpaceWorkflow('traditional');
      rememberDraft('');
      return;
    }
    if (agent === 'space' && onSelectSpaceWorkflow && actionClauses.some(value=>/切回.*(生成|建模)|切换到.*(生成|建模)/.test(value))) {
      onSelectSpaceWorkflow('aholo');
      rememberDraft('');
      return;
    }
    if (agent === 'space' && onOpenAholo) {
      // Questions, negations and completed actions belong to the conversation,
      // not to a shortcut that opens a generation workflow.
      const actionClause=actionClauses.find(value=>/(?:重建|生成.{0,8}(?:空间|场景)|创建.{0,8}(?:空间|场景))/.test(value));
      const kind = actionClause && /重建/.test(actionClause)
        ? 'recon'
        : actionClause && /生成.{0,8}(空间|场景)|创建.{0,8}(空间|场景)/.test(actionClause)
          ? 'world'
          : null;
      if (kind) {
        onOpenAholo(kind, kind === 'world' ? text : undefined);
        rememberDraft('');
        return;
      }
    }
    if(onForwardToActivity){
      forwardingRef.current=true;setForwarding(true);setNotice('正在转交活动对话，请稍候。');
      let accepted=false;
      try{accepted=await onForwardToActivity(text);}catch{/* Keep the original input for the user. */}
      finally{forwardingRef.current=false;setForwarding(false);}
      if(accepted){rememberDraft('');setNotice('已转交活动对话。');return;}
    }
    setNotice('这条需求暂时无法转交。请复制内容，打开活动对话继续；输入内容已保留。');
  };

  // 运行条：回车把 draft 当 steer 备注塞进下一轮上下文，不做主任务提交。
  const submitSteer = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    pushAgentSteerNote(text);
    rememberDraft('');
  };

  // 活动与 Bingo 是 AgentPanel 里那场真对话，这里不接管。
  // 放在所有 hooks 之后（React rules of hooks）。
  if (agent === 'bingo' || agent === 'door') return null;
  const meta = AGENT_CHAT_META[agent];

  return (
    <div className={`ap-chat is-${agent}`}>
      <AgentRunPanel scope={agent} steerInputId={`ap-chat-${agent}`}/>

      {!hideLibraryActions && agent === 'space' && <div className="ap-tool-actions">
        <div className="ap-composer-left">
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

      <form className="ap-composer ap-composer-compact" aria-label={`${meta.name}动作框`} onSubmit={run.isRunning ? submitSteer : submit}>
        <label className="sr-only" htmlFor={`ap-chat-${agent}`}>{meta.name}输入框</label>
        <div className="ap-composer-field">
          <textarea
            id={`ap-chat-${agent}`}
            rows={1}
            value={draft}
            disabled={forwarding}
            maxLength={400}
            placeholder={run.isRunning ? '为下一步加备注…' : meta.placeholder}
            onChange={event => { rememberDraft(event.target.value); setNotice(''); }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }}
          />
        </div>
        {notice && <p role="status">{notice}</p>}
        <div className="ap-composer-bar">
          <div className="ap-composer-left">
            <details className="ap-supervise" aria-label="监督档位">
              <summary>
                <span className="ap-supervise-dot" aria-hidden="true"/>
                监督
              </summary>
              <div
                className="ap-supervise-menu"
                role="radiogroup"
                aria-label="监督档位"
              >
                <p className="ap-supervise-summary">
                  <span className="ap-supervise-summary-kicker">当前监督</span>
                  <span className="ap-supervise-summary-value">{activeOption.label}</span>
                </p>
                {SUPERVISION_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    className={`ap-supervise-option${mode === opt.value ? ' is-active' : ''}`}
                  >
                    <span className="ap-supervise-option-row">
                      <input
                        type="radio"
                        name={`supervision-${agent}`}
                        checked={mode === opt.value}
                        onChange={() => setMode(opt.value)}
                        style={{ accentColor: COLOR_GREEN }}
                      />
                      <span className="ap-supervise-option-label">{opt.label}</span>
                    </span>
                    <span className="ap-supervise-option-hint">{opt.hint}</span>
                  </label>
                ))}
              </div>
            </details>
            {/* 物料这一格的左下角就是那颗生成物料星，和生成入口那格同一个入口、同一颗钮。 */}
            {agent === 'material' && <MaterialCreateCell {...(controller ? { controller } : {})} listenForAsk/>}
          </div>
          <div className="ap-composer-actions">
            <kbd className="ap-kbd" title="回车发送；Shift+Enter 换行">Enter</kbd>
            <button type="submit" className="ap-send" aria-label="发送" disabled={forwarding || !draft.trim()}><ArrowUp size={18}/></button>
          </div>
        </div>
      </form>
    </div>
  );
}
