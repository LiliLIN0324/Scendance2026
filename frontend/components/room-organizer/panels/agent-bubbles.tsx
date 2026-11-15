/**
 * 聊天气泡区与运行进度：从 agent-panel 抽出的展示层。
 *
 * 只接渲染需要的数据与回调，不再接整个 AgentValue——
 * 会话、写保护、提案确认仍留在 LayoutAgentProvider 与面板主体。
 */
import { useEffect, useState } from 'react';
import { Check, Clock, Copy, FileImage, Pencil, RotateCw, SquareDashed, TriangleAlert } from '@/components/solid-icons';
import { parseFollowUpOptions, segmentBubbleBlocks } from '../lib/bubble-text';
import { toolChipStatus, toolStatusWord, toolTraceRows } from '../lib/tool-trace';
import { MaterialCandidatesPanel } from './material-candidates-panel';

export type Bubble = {
  id: string; role: 'user' | 'agent'; text: string; meta?: string; warn?: string; amber?: boolean;
  /** Only model-authored conversation may be used as model history. */
  modelConversation?: boolean;
  materialQueries?: readonly string[];
  /** 清单/文案这种多行回话：不做两行截断，保留换行。 */
  long?: boolean;
  /** 选进来的图纸/照片：跟这条消息一起留在聊天区，不是只把文件名当一行字。 */
  image?: string;
  /** 气泡里的一句话动作：只给「拖了图纸、还差一步就能出方案」这种当场要点的下一步，不当第二套入口。 */
  action?: { label: string; run(): void };
  /**
   * 「要不要我帮你圈区」提议卡：AI 给完硬建议、末尾问一句时挂这个。
   * 渲染成品牌绿描边小卡 + 「好，帮我圈」按钮；落盘时函数被丢，回读不会重现按钮。
   */
  zoneApply?: { run(): void };
  /** S2 T2：审校台专属气泡（体检回执/钉评指路）。Bingo 脸只回放这类，活动脸回放全部。 */
  review?: boolean;
  /**
   * 失败/未启用卡片外壳：带 alert 的 agent 消息渲染成图1错误卡（标签 + 摘要 + 动作），
   * 而不是旧的裸竖线气泡。retry 为运行时闭包，落盘时丢弃，回放不重现按钮。
   */
  alert?: { stamp: string; tone?: 'warn' | 'muted'; retry?: () => void };
  /**
   * 决策留痕（对标谷地工坊「已批准」上屏）：提案卡应用/放弃/取消任务后卡片卸载，
   * 决策以徽章气泡留在对话流里，回看时知道哪版被怎么处置了。仅展示，不回传模型。
   */
  decision?: 'approved' | 'rejected' | 'cancelled';
};

export function ToolCallTrace({ line, rows, understanding, onStop }: {
  line: string | null;
  rows: ReturnType<typeof toolTraceRows>;
  understanding: boolean;
  onStop(): void;
}): JSX.Element | null {
  const status = toolChipStatus(line);
  const running = rows.some(row => row.status === 'running') || status === 'running';
  const failed = [...rows].reverse().find(row => row.status === 'error');
  const [opened, setOpened] = useState(running);
  useEffect(() => { setOpened(running); }, [running]);
  // 理解中计时（对标谷地工坊每个状态都带时长）：从 understanding 翻真那一刻起走秒，
  // 翻回假即停。只给等待预期，不承诺进度。
  const [understandingSeconds, setUnderstandingSeconds] = useState(0);
  useEffect(() => {
    if (!understanding) { setUnderstandingSeconds(0); return; }
    setUnderstandingSeconds(0);
    const timer = window.setInterval(() => setUnderstandingSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [understanding]);
  if (!line && rows.length === 0 && !failed) return null;
  const understandingClock = understanding && understandingSeconds > 0
    ? `${Math.floor(understandingSeconds / 60)}:${(understandingSeconds % 60).toString().padStart(2, '0')}`
    : null;
  return <section className="ap-tools" aria-label="工具调用">
    {line && status && <p role="status" className={`ap-tool-chip is-${status}`}>
      <span className="ap-tool-state">{toolStatusWord(status)}</span>
      <span>{line}</span>
      {understandingClock && <span className="ap-tool-clock" aria-hidden="true">{understandingClock}</span>}
      {understanding && line === '正在理解活动需求…' && <button type="button" onClick={onStop}>停止等待</button>}
    </p>}
    {!line && failed && <p role="status" className="ap-tool-chip is-error">
      <span className="ap-tool-state">未完成</span>
      <button type="button" onClick={() => setOpened(value => !value)}>{failed.result || failed.name}</button>
    </p>}
    {rows.length > 0 && <details open={opened} onToggle={event => setOpened(event.currentTarget.open)}>
      <summary>执行过程</summary>
      <ol className="ap-tool-rows">
        {rows.map((row, index) => <li key={row.id} className={`ap-tool-row is-${row.status}`}>
          <span className="ap-tool-row-no" aria-hidden="true">{index + 1}</span>
          <div className="ap-tool-row-body">
            <div className="ap-tool-row-line">
              <span className="ap-tool-row-name">{row.name}</span>
              <span className="ap-tool-row-stat">{toolStatusWord(row.status)}</span>
            </div>
            <div className="ap-tool-row-detail">{row.result}</div>
          </div>
        </li>)}
      </ol>
    </details>}
  </section>;
}

export function Bubbles({ bubbles, sessionKey, reviewOnly = false, onPickOption, onResendMessage, onOpenMaterials }: {
  bubbles: readonly Bubble[];
  /** 面板算好的会话标识：物料候选卡的 key 用它，组件本身不认识 session。 */
  sessionKey: string;
  reviewOnly?: boolean;
  onPickOption: (text: string) => void;
  onResendMessage?: (text: string) => void;
  onOpenMaterials: () => void;
}): JSX.Element {
  const list = reviewOnly ? bubbles.filter(bubble => bubble.review) : bubbles;
  // 2026-11-14 用户指令：气泡 hover 出「复制 / 编辑」；编辑只给最近一条用户消息，
  // 且在原位变成 chat 框——发送即替换这句话并重新走理解管线（不回填底部输入框）。
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const lastUserBubbleId = [...list].reverse().find(bubble => bubble.role === 'user')?.id ?? null;
  const copyMessage = (bubble: Bubble): void => {
    void navigator.clipboard?.writeText(bubble.text).catch(() => {});
    setCopiedId(bubble.id);
    window.setTimeout(() => setCopiedId(current => (current === bubble.id ? null : current)), 1200);
  };
  const copyButton = (bubble: Bubble) => (
    <button type="button" aria-label={copiedId === bubble.id ? '已复制' : '复制这条消息'} onClick={() => copyMessage(bubble)}>
      {copiedId === bubble.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
  const submitEdit = (): void => {
    const value = editDraft.trim();
    if (!value) return;
    setEditingId(null);
    onResendMessage?.(value);
  };
  return <>{list.map((bubble, bubbleIndex) => {
    const followups = bubble.role === 'agent' ? parseFollowUpOptions(bubble.text) : [];
    const laterUserTexts = list.slice(bubbleIndex + 1).filter(b => b.role === 'user').map(b => b.text.trim());
    const pickedOption = followups.find(option => laterUserTexts.includes(option));
    const settled = pickedOption !== undefined;
    return bubble.role === 'user'
    ? <div key={bubble.id} className="ap-bubble-wrap is-user">
      {editingId === bubble.id ? (
        <form className="ap-msg-edit" onSubmit={event => { event.preventDefault(); submitEdit(); }}>
          <textarea
            value={editDraft}
            rows={2}
            autoFocus
            maxLength={600}
            aria-label="编辑这条消息"
            onChange={event => setEditDraft(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitEdit(); }
              else if (event.key === 'Escape') { event.preventDefault(); setEditingId(null); }
            }}
          />
          <div className="ap-msg-edit-actions">
            <button type="button" className="chip" onClick={() => setEditingId(null)}>取消</button>
            <button type="submit" className="chip btn-primary" disabled={!editDraft.trim()}>发送</button>
          </div>
        </form>
      ) : (<>
        <div className={`ap-user${bubble.meta || bubble.warn ? ' is-file' : ''}`}>{(bubble.meta || bubble.warn) && <FileImage size={16} aria-hidden="true"/>}<div><strong>{bubble.text}</strong>{bubble.image && <img className="ap-msg-image" src={bubble.image} alt={bubble.text}/>}{bubble.meta && <small>{bubble.meta}</small>}{bubble.warn && <small className="ap-warn"><span aria-hidden="true">!</span>{bubble.warn}</small>}</div></div>
        <div className="ap-msg-actions">
          {copyButton(bubble)}
          {onResendMessage && bubble.id === lastUserBubbleId && <button type="button" aria-label="编辑这条消息" data-tip="编辑后重新发送" onClick={() => { setEditingId(bubble.id); setEditDraft(bubble.text); }}><Pencil size={14} aria-hidden="true"/></button>}
        </div>
      </>)}
    </div>
    : <div key={bubble.id} className="ap-bubble-wrap"><div className="ap-turn">{bubble.alert ? (
      <section className={`ap-card ap-error-card${bubble.alert.tone === 'muted' ? ' is-muted' : ''}`} role="alert">
        <span className="ap-error-stamp"><TriangleAlert size={12} aria-hidden="true"/>{bubble.alert.stamp}</span>
        <div className={`ap-error-body${bubble.long ? ' is-long' : ''}`}>
          {segmentBubbleBlocks(bubble.text).map((block, index) => block.kind === 'list'
            ? <ol key={index} className="ap-agent-list">{block.items!.map((item, itemIndex) => <li key={itemIndex} className="ap-agent-list-item">{item}</li>)}</ol>
            : <span key={index} className="ap-agent-line">{block.text}</span>)}
        </div>
        <div className="ap-error-actions">
          {bubble.alert.retry && <button type="button" className="chip" onClick={bubble.alert.retry}><RotateCw size={14} aria-hidden="true"/>重试云端理解</button>}
          <button type="button" className="chip btn-outline" onClick={() => document.getElementById('ap-input')?.focus()}>改一句再说</button>
        </div>
      </section>
    ) : (
      <div className={`ap-agent${bubble.amber ? ' is-amber' : ''}${bubble.long ? ' is-long' : ''}`}>
        {segmentBubbleBlocks(bubble.text).map((block, index) => block.kind === 'list'
          ? <ol key={index} className="ap-agent-list">{block.items!.map((item, itemIndex) => <li key={itemIndex} className="ap-agent-list-item">{item}</li>)}</ol>
          : <span key={index} className="ap-agent-line">{block.text}</span>)}
      </div>
    )}
      {followups.length > 0 && (
        <div className="ap-option-pick" role="group" aria-label="可选回复">
          {followups.map(option => {
            const picked = option === pickedOption;
            return <button key={option} type="button" className={`ap-option-row${picked ? ' is-picked' : ''}${settled && !picked ? ' is-dim' : ''}`} disabled={settled} onClick={() => onPickOption(option)}>
              <span className="ap-option-row-cap">{option}</span>
              {picked && <span className="ap-option-row-mark"><Check size={11} aria-hidden="true"/>已选</span>}
            </button>;
          })}
        </div>
      )}
      {bubble.zoneApply && (
        <div className="ap-zone-proposal">
          <span className="ap-blocked-stamp"><SquareDashed size={12} aria-hidden="true"/>圈区域</span>
          <p className="ap-zone-proposal__hint">要不要直接在 2D 上把提议的区域圈出来？</p>
          <button type="button" className="ap-zone-proposal__btn" onClick={bubble.zoneApply.run}>好，帮我圈</button>
        </div>
      )}
      {bubble.action && <button type="button" className="ap-bubble-action" onClick={bubble.action.run}>{bubble.action.label}</button>}
      {bubble.decision && (
        <span className={`ap-decision-badge ${bubble.decision === 'approved' ? 'is-approved' : 'is-rejected'}`} role="status">
          <Check size={12} aria-hidden="true"/>{bubble.decision === 'approved' ? '已批准' : bubble.decision === 'cancelled' ? '已取消任务' : '已放弃'}
        </span>
      )}
      {bubble.materialQueries?.map(query=><MaterialCandidatesPanel key={`${sessionKey}:${bubble.id}:${query}`} query={query} onOpenLibrary={()=>onOpenMaterials()}/>)}
      </div>
      <div className="ap-msg-actions">{copyButton(bubble)}</div>
    </div>;
  })}</>;
}

export function GenProgress({ paused, hidden, onResume, onWithdraw, onStop }: {
  paused?: boolean;
  hidden?: boolean;
  onResume(): void;
  onWithdraw(): void;
  onStop(): void;
}): JSX.Element | null {
  // 真实步骤时间线在场时，这套写死的步骤条让位——不同时摆两套进度。
  if (hidden) return null;
  return <div className={`ap-card ap-progress-card${paused ? ' is-paused' : ''}`} id="gen-progress">
    <span className="ap-progress-stamp"><Clock size={12} aria-hidden="true"/>{paused ? '已暂停' : '生成中'}</span>
    <p className="ap-progress-note">{paused ? '布置预览已暂停' : '正在准备布置预览'}</p>
    <div className="ap-progress-actions">
      {paused
        ? <>
            <button type="button" className="chip" onClick={onResume}>接着摆</button>
            <button type="button" className="chip btn-outline" onClick={onWithdraw}>不要了</button>
          </>
        : <button type="button" className="ap-link" onClick={onStop}>停一下</button>}
    </div>
  </div>;
}