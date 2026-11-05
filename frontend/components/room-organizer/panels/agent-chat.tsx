'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUp, Globe, LayoutTemplate, Plus, Scan, SquareDashed } from '@/components/solid-icons';
import { useRoomEditor } from '../contexts';
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

/**
 * 空间 / 物料的底部动作条（S3 面板化后形态）。
 * 假聊天气泡已退役：这一格不再来回寒暄，只留一条短指令框 + 真动词钮。
 * 活动与 Bingo 走 AgentPanel 那场真对话，这里不接管。
 *
 * 第 8 批增补：
 *  - 生成进行中：底部「运行状态」面板（真步骤时间线 + 计时器 + 思考折叠）。
 *  - 常驻运行条三控件：跑完这步停 / 停止 / 为下一步加备注。
 *  - 监督三档开关（齿轮菜单）。
 *  - 空结果回执卡（不允许沉默结束）。
 */
const AGENT_CHAT_META: Record<'space' | 'material', { name: string; placeholder: string }> = {
  space: { name: '空间', placeholder: '一句话描述场地，如：80 人发布会，室内' },
  material: { name: '物料', placeholder: '一句话描述物件，如：一把户外折叠椅' },
};

const COLOR_GREEN = '#4A7C59';

export function AgentChat({ agent, onNewSpace, onOpenAholo, onSelectSpaceWorkflow }: { agent: ChatAgent; onNewSpace?: ((mode?: 'blank' | 'template') => void) | undefined; onOpenAholo?: ((kind: 'world' | 'recon', prompt?: string) => void) | undefined; onSelectSpaceWorkflow?: ((workflow: 'aholo' | 'traditional') => void) | undefined }): JSX.Element | null {
  const { layout } = useRoomEditor();
  void layout;
  const [draft, setDraft] = useState('');

  // 订阅运行时账本（真步骤时间线 / 三控件状态）。
  // 注意：所有 hooks 必须在 early return 之前调用（React rules of hooks）。
  const [run, setRun] = useState(getAgentRun);
  useEffect(() => subscribeAgentRun(() => setRun(getAgentRun())), []);
  const [mode, setMode] = useSupervisionMode();

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

  // 运行条：回车把 draft 当 steer 备注塞进下一轮上下文，不做主任务提交。
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

  const meta = AGENT_CHAT_META[agent];

  return (
    <div className={`ap-chat is-${agent}`}>
      {/* 第 8 批：运行态面板走共享件，活动脸与空间/物料脸共用同一块。 */}
      <AgentRunPanel scope={agent} steerInputId={`ap-chat-${agent}`}/>

      <form className="ap-composer ap-composer-compact" aria-label={`${meta.name}动作框`} onSubmit={run.isRunning ? submitSteer : submit}>
        {agent === 'space' && onOpenAholo && !run.isRunning && (
          <div className="ap-gen-chips" role="group" aria-label="生成方式">
            <button type="button" className="ap-gen-chip" onClick={() => { onSelectSpaceWorkflow?.('aholo'); onOpenAholo('world'); }}>
              <Globe size={13} aria-hidden="true"/><span>生成场地</span>
            </button>
            <button type="button" className="ap-gen-chip" onClick={() => { onOpenAholo('recon'); }}>
              <Scan size={13} aria-hidden="true"/><span>照片重建</span>
            </button>
          </div>
        )}
        <label className="sr-only" htmlFor={`ap-chat-${agent}`}>{meta.name}输入框</label>
        <div className="ap-composer-field">
          <textarea
            id={`ap-chat-${agent}`}
            rows={1}
            value={draft}
            maxLength={400}
            placeholder={run.isRunning ? '为下一步加备注…' : meta.placeholder}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }}
          />
        </div>
        <div className="ap-composer-bar">
          <div className="ap-composer-left">
            {agent === 'space' && (onNewSpace) && !run.isRunning && <details className="sc-chat-plus">
              <summary aria-label="更多操作" data-tip="更多"><Plus size={16} aria-hidden="true"/></summary>
              <div className="sc-chat-plus-menu">
                {onNewSpace && <>
                  <button type="button" onClick={event => { onNewSpace('blank'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><SquareDashed size={13} aria-hidden="true"/><span>新建空白空间</span></button>
                  <button type="button" onClick={event => { onNewSpace('template'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><LayoutTemplate size={13} aria-hidden="true"/><span>从模板开始</span></button>
                </>}
              </div>
            </details>}
            {/* 第 8 批：监督三档开关（Y2）。 */}
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
            {/* 物料这一格的左下角就是那颗生成物料星，和生成入口那格同一个入口、同一颗钮。 */}
            {agent === 'material' && <MaterialCreateCell/>}
          </div>
          <button type="submit" className="ap-send" aria-label="发送" disabled={!draft.trim()}><ArrowUp size={18}/></button>
        </div>
      </form>
    </div>
  );
}
