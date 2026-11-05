'use client';

/**
 * AgentRunPanel —— 生成运行态面板（可复用）。
 *
 * 第 8 批前端接线的共用件：谁在跑生成，谁就把这块面板挂上。
 *
 * 内容口径（对应路线书 Y3/Y4/Y5/Y6 + X8）：
 * - 头部一行说清「正在思考 · N 条思考 · 已用时 mm:ss」——N 是**云端给的真实
 *   模型调用轮数**，不是前端自己数的；
 * - 步骤流默认只显示最后 3 步，可「共 N 步，展开全部」；
 * - 每一步一行：中文步骤名 + 单步耗时，写入步带品牌绿左边框；
 * - 空结果回执卡：本轮既没给出候选也没改动画布时必须出声，不许沉默结束；
 * - 运行条三控件：跑完这步停 / 停止 / 为下一步加备注。
 *
 * 数据全部来自 {@link agent-chat-store} 的运行时账本；本组件只读账本、
 * 不产生数据。生产者是谁由调用方决定（活动脸接云端 AgentRun）。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  chineseToolLabel,
  dismissAgentEmptyReceipt,
  formatDurationClock,
  getAgentRun,
  isWriteTool,
  requestAgentStop,
  setAgentPauseAfterStep,
  subscribeAgentRun,
  type AgentRunScope,
  type AgentRunState,
} from './agent-chat-store';

const COLOR_STONE = '#F4F5F7';
const COLOR_GREEN = '#4A7C59';
const COLOR_RED = '#C0392B';

/** 订阅运行时账本。 */
export function useAgentRun(): AgentRunState {
  const [run, setRun] = useState(getAgentRun);
  useEffect(() => subscribeAgentRun(() => setRun(getAgentRun())), []);
  return run;
}

/** 1s 心跳：驱动头部「已用时」和当前步进行中那一格。 */
function useNowMs(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return running ? now : 0;
}

/**
 * 运行时面板。账本里没有真实运行时（没在跑、也没跑过）时返回 null，
 * 让调用方回退到自己的占位形态（本机规则模式那套写死的步骤）。
 *
 * `scope` 决定看哪张脸的账；`controls` 决定要不要挂运行条三控件——
 * 三控件里的「跑完这步停」「为下一步加备注」要后端支持「运行中插话」才
 * 能真生效，没有那条通道就别挂上去冒充能用。
 */
export function AgentRunPanel({ scope = 'layout', controls = true }: { scope?: AgentRunScope; controls?: boolean } = {}): JSX.Element | null {
  const run = useAgentRun();
  const now = useNowMs(run.isRunning);
  const [expandedAll, setExpandedAll] = useState(false);
  const [openThought, setOpenThought] = useState<number | null>(null);

  const visibleSteps = useMemo(() => {
    if (expandedAll) return run.stepLog;
    return run.stepLog.slice(-3);
  }, [run.stepLog, expandedAll]);

  // 账本是四张脸共用的：只认自己那张脸的账，别把别的功能域的运行过程搬过来。
  if (run.scope !== scope) return null;
  // 既没在跑、也没有留下任何一步：这不是「运行态」，别占版面。
  if (!run.isRunning && run.stepLog.length === 0 && !run.emptyOutcome) return null;

  // 跑完后这一行仍要说清「这一趟用了多久」，所以结束时按当前时刻算总耗时。
  const elapsedMs = run.startedAt ? (run.isRunning ? now : Date.now()) - run.startedAt : 0;

  return (
    <>
      {/* 空结果回执卡（X8）——不允许沉默结束。 */}
      {run.emptyOutcome && !run.isRunning && (
        <div
          role="status"
          style={{
            margin: '6px 0',
            padding: '10px 12px',
            background: COLOR_STONE,
            borderLeft: `3px solid ${COLOR_GREEN}`,
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ display: 'block', marginBottom: 2, color: '#2b2f36' }}>没做成。</strong>
          <span style={{ color: '#4a4f57' }}>换个说法再试，或先告诉我场地尺寸和大致人数。</span>
          <button
            type="button"
            onClick={dismissAgentEmptyReceipt}
            style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11.5, border: '1px solid #d4d7dc', borderRadius: 999, background: '#fff', cursor: 'pointer' }}
          >
            知道了
          </button>
        </div>
      )}

      {/* 运行状态面板——真步骤时间线（Y3/Y4/Y5/Y6）。跑完后仍留在场上，
          策划师要能回看这一趟到底走了哪几步。 */}
      {(run.isRunning || run.stepLog.length > 0) && (
        <div
          aria-live="polite"
          style={{
            margin: '6px 0',
            padding: '10px 12px',
            background: COLOR_STONE,
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontWeight: 600, color: '#2b2f36' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: run.isRunning ? COLOR_GREEN : '#9aa0a6', display: 'inline-block' }} aria-hidden="true"/>
            {run.isRunning
              ? <span>正在思考 · {run.thoughtCount} 条思考 · 已用时 {formatDurationClock(elapsedMs)}</span>
              : <span>这一趟走完了 · {run.thoughtCount} 条思考 · {run.stepLog.length} 步 · 用时 {formatDurationClock(elapsedMs)}</span>}
          </div>

          {/* 改道备注的去向：写进输入框不等于它已经在生效。送到服务端的那句会在
              下一轮思考之前被取走，所以这里分「已送达（等下一轮生效）」和「待送达」两截说。 */}
          {(run.steerDelivered > 0 || run.steerNotes.length > 0) && (
            <div style={{ margin: '0 0 6px', fontSize: 11.5, color: '#4a4f57', lineHeight: 1.5 }}>
              {run.steerDelivered > 0 && <span>已送达 {run.steerDelivered} 条改道备注 · 下一轮思考前生效</span>}
              {run.steerNotes.length > 0 && (
                <span style={{ color: '#8a6d3b' }}>
                  {run.steerDelivered > 0 ? ' · ' : ''}还有 {run.steerNotes.length} 条待送达
                </span>
              )}
            </div>
          )}

          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {visibleSteps.map((step, index) => {
              const globalIndex = run.stepLog.indexOf(step);
              const write = isWriteTool(step.toolName);
              const duration = step.durationMs > 0
                ? formatDurationClock(step.durationMs)
                : formatDurationClock(now - step.startedAt);
              return (
                <li
                  key={`${step.toolName}-${step.startedAt}-${index}`}
                  style={{
                    padding: '5px 8px',
                    background: write ? '#fff' : COLOR_STONE,
                    borderLeft: write ? `3px solid ${COLOR_GREEN}` : '3px solid transparent',
                    borderRadius: 4,
                    color: write ? '#2b2f36' : '#6b7280',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: write ? 600 : 400 }}>{chineseToolLabel(step.toolName)}</span>
                    {write && typeof step.itemCount === 'number' && <span style={{ color: COLOR_GREEN, fontSize: 11.5 }}>· {step.itemCount} 件</span>}
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#6b7280' }}>耗时 {duration}</span>
                    {step.thought && (
                      <button
                        type="button"
                        onClick={() => setOpenThought(openThought === globalIndex ? null : globalIndex)}
                        style={{ border: 'none', background: 'transparent', color: COLOR_GREEN, fontSize: 11, cursor: 'pointer', padding: 0 }}
                      >
                        {openThought === globalIndex ? '收起思考' : '查看思考内容'}
                      </button>
                    )}
                  </div>
                  {openThought === globalIndex && step.thought && (
                    <p style={{ margin: '4px 0 0', paddingTop: 4, borderTop: '1px dashed #d4d7dc', fontSize: 11.5, lineHeight: 1.5, color: '#4a4f57' }}>
                      {step.thought}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          {run.stepLog.length > 3 && (
            <button
              type="button"
              onClick={() => setExpandedAll(v => !v)}
              style={{ marginTop: 6, border: 'none', background: 'transparent', color: COLOR_GREEN, fontSize: 11.5, cursor: 'pointer', padding: 0 }}
            >
              {expandedAll ? '收起' : `共 ${run.stepLog.length} 步，展开全部`}
            </button>
          )}
        </div>
      )}

      {/* 常驻运行条三控件（Y7/Y8/Y9）。 */}
      {run.isRunning && controls && (
        <div
          role="group"
          aria-label="运行中控制"
          style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}
        >
          <button
            type="button"
            onClick={() => setAgentPauseAfterStep(true)}
            disabled={run.shouldPauseAfterStep}
            style={{
              padding: '4px 10px', fontSize: 11.5, borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${COLOR_GREEN}`, background: run.shouldPauseAfterStep ? COLOR_STONE : '#fff', color: COLOR_GREEN,
              opacity: run.shouldPauseAfterStep ? 0.6 : 1,
            }}
          >
            {run.shouldPauseAfterStep ? '将在这步后停' : '跑完这步停'}
          </button>
          <button
            type="button"
            onClick={requestAgentStop}
            disabled={run.stopRequested}
            style={{
              padding: '4px 10px', fontSize: 11.5, borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${COLOR_RED}`, background: '#fff', color: COLOR_RED,
              opacity: run.stopRequested ? 0.6 : 1,
            }}
          >
            {run.stopRequested ? '正在收尾' : '停止'}
          </button>
        </div>
      )}
    </>
  );
}
