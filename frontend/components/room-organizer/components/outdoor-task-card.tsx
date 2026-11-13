'use client';
import type { ReactNode } from 'react';

export interface OutdoorTaskProgress {
  intent: string;
  state: 'ready' | 'working' | 'confirm' | 'done' | 'stopped' | 'blocked';
  action: string;
  stopLabel?: '停止查找' | '停止模拟';
  steps: string[];
  prompts?: string[];
  focusFacilityId?: string | undefined;
}

/** 同一任务的一张卡：只写真实动作，不编执行时长、不展示底层工具噪声。 */
export function OutdoorTaskCard({ task, canStop = false, onStop, onPrefill, onInspectFacility, children }: {
  task: OutdoorTaskProgress;
  canStop?: boolean;
  onStop(): void;
  onPrefill(text: string): void;
  onInspectFacility?(id: string): void;
  children?: ReactNode;
}): JSX.Element {
  const labels = { ready: '待操作', working: '正在处理', confirm: '待你确认', done: '已应用', stopped: '已停止', blocked: '需要补充' };
  return <section className="ap-card ap-venue-card" aria-label="户外规划任务" data-testid="outdoor-task-card" data-state={task.state}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
      <span className="ap-option-row-mark" role="status">{labels[task.state]}</span>
      <span className="ap-lead-body" style={{ flex: 1 }}>{task.action}</span>
      {canStop && task.state === 'working' && <button type="button" className="chip" onClick={onStop}>{task.stopLabel ?? '停止查找'}</button>}
    </div>
    <p className="ap-lead-title">{task.intent}</p>
    {task.steps.length > 0 && <details style={{ width: '100%' }}>
      <summary className="ap-lead-body">已完成 {task.steps.length} 步 · 查看最近步骤</summary>
      <ol className="ap-lead-body">{task.steps.slice(-3).map((step, index) => <li key={`${index}:${step}`}>✓ {step}</li>)}</ol>
    </details>}
    {children}
    {(task.state === 'done' || task.state === 'ready') && task.focusFacilityId && onInspectFacility && <button type="button" className="ap-option-row" onClick={() => onInspectFacility(task.focusFacilityId!)}>选中设施 · 查看模型候选 / 生成 / 上传</button>}
    {task.prompts?.length ? <div className="ap-option-pick">{task.prompts.map(text => <button type="button" className="ap-option-row" key={text} onClick={() => onPrefill(text)}>{text}</button>)}</div> : null}
    <p className="ap-lead-body">可在下面继续补充要求；预览不等于已写入方案。</p>
  </section>;
}
