'use client';

/**
 * AgentRunPanel —— 生成运行态面板（可复用）。
 *
 * 第 8 批前端接线的共用件：谁在跑生成，谁就把这块面板挂上。
 *
 * 内容口径（对应路线书 Y3/Y4/Y5/Y6 + X8）：
 * - 头部主标题是**阶段**（"第 2/4 阶段 · 定落点"）——云端给的真值，回答"在干什么"；
 *   拿不到阶段就不显示阶段，不拿轮数顶替。
 * - 副行是这一段的说明 + 预算读数（已用时 / 第 N 轮 / N 步）；
 * - 步骤流默认只显示最后 3 步，可「共 N 步，展开全部」；
 * - 每一步一行：中文步骤名 + 单步耗时，写入步带品牌绿左边框；
 * - 空结果回执卡：本轮既没给出候选也没改动画布时必须出声，不许沉默结束；
 * - 运行条三控件：跑完这步停 / 停止 / 为下一步加备注。
 * - 「停止」就地弹确认行（要停止这项工作吗？/ 取消 / 停止），不调 window.confirm；
 *   Escape 或失焦即取消。
 * - 运行结束后当前卡收进「过往任务 N ⌄」折叠行；下一次新运行再展开在折叠区之上。
 *   归档只活在组件内存里（最近 5 条），不写库、不碰后端。
 *
 * 数据全部来自 {@link agent-chat-store} 的运行时账本；本组件只读账本、
 * 不产生数据。生产者是谁由调用方决定（活动脸接云端 AgentRun）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {Box, ClipboardCheck, Map, MapPin, ShieldCheck, Sparkles} from '@/components/solid-icons';
import { detectStall, type StallResult, type StallSnapshot } from '@/lib/stall-detect';
import { phaseLabel } from '../../../../supabase/functions/_shared/agent-progress';
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
  type AgentStepLogEntry,
} from './agent-chat-store';


/** 停滞侦测的采样间隔：与云端轮询（2s）同频。 */
const STALL_SAMPLE_MS = 2000;

/** 归档列表最多留几条。 */
const ARCHIVE_LIMIT = 5;

// 只展示服务端已知进度句，不把模型文本、工具参数或用户输入当成执行记录。
const LAYOUT_PROGRESS = new Set([
  '等待开始','正在读取当前场景','正在检索模型资源','正在查询地点','正在读取局部平面','正在搜索可落点',
  '正在试排课桌椅','正在试排双人课桌椅','正在创建参数化模型','正在读取模型材质','正在创建材质副本',
  '正在检查方案','正在整理候选方案','正在统计物料清单','正在提交 Lux3D 生成任务',
  '已保存通过检查的候选方案','方案已准备好','执行已中断，保留有效结果','执行中断，原场景与有效方案已保留','已取消',
]);
function visibleProgress(value:string,scope:AgentRunScope):string {
  if(scope!=='layout')return chineseToolLabel(value);
  if(LAYOUT_PROGRESS.has(value)||/^第 [1-4]\/4 阶段 · (看现状|定落点|出方案|交付) · 第 [1-6]\/6 轮$/.test(value)||/^兼容模式生成方案（[12]\/2）$/.test(value))return value;
  return '正在处理任务';
}
const TOOL_LABELS:Record<string,string>={
  get_scene:'读取场景',search_resources:'查找物料',search_places:'查询地点',inspect_zone:'查看局部区域',
  find_free_areas:'寻找可用位置',prepare_seating_candidate:'试排课桌椅',prepare_shared_seating_candidate:'试排双人桌椅',
  create_parametric_model:'创建参数化模型',inspect_materials:'查看材质',customize_material:'调整材质',
  validate_candidate:'检查候选',submit_candidates:'提交候选',get_bom:'统计物料',start_lux3d_model:'提交模型生成任务',
};
function toolCategory(tool:string):'venue'|'material'|'position'|'check'|'candidate'|'generation' {
  if(['get_scene','inspect_zone','search_places'].includes(tool))return 'venue';
  if(['search_resources','inspect_materials','customize_material','get_bom'].includes(tool))return 'material';
  if(['find_free_areas','prepare_seating_candidate','prepare_shared_seating_candidate'].includes(tool))return 'position';
  if(tool==='validate_candidate')return 'check';
  if(tool==='submit_candidates')return 'candidate';
  return 'generation';
}
const CATEGORY_ICONS={venue:MapPin,material:Box,position:Map,check:ShieldCheck,candidate:ClipboardCheck,generation:Sparkles};
const LOCAL_STEP_LABEL: Record<string, string> = {
  select_furnishing: '选择桌椅',
  local_preview: '出预览',
  local_validate: '核对重叠',
  local_revise: '修改布置',
  local_confirm: '确认布置',
  local_applied: '已落画布',
};
function localStepStatus(outcome: 'running' | 'done' | 'error' | undefined): string | null {
  if (outcome === 'running') return '进行中';
  if (outcome === 'done') return '已完成';
  if (outcome === 'error') return '未完成';
  return null;
}
function eventStatus(stage:'started'|'finished',outcome:'success'|'failed'|'unknown'|null):string {
  if(stage==='started')return '已发起';
  if(outcome==='success')return '已返回结果';
  if(outcome==='failed')return '未完成';
  return '结果待核对';
}

/** 放置/写入类工具：标题后可挂「N 个物品」数量胶囊；itemCount 由账本给，缺省不渲染、不编数。 */
const PLACEMENT_TOOLS = new Set([
  'prepare_seating_candidate','prepare_shared_seating_candidate','create_parametric_model',
]);
function isPlacementTool(tool: string): boolean {
  return isWriteTool(tool) || PLACEMENT_TOOLS.has(tool);
}

/** 流水行右侧结果标记：进行中转圈 / 成功绿勾 / 失败红叉 / 待核对中性点。 */
type RowResult = 'running' | 'success' | 'failed' | 'neutral';

function eventRowResult(event: { stage: 'started'|'finished'; outcome: 'success'|'failed'|'unknown'|null }): RowResult {
  if (event.stage === 'started' && event.outcome === null) return 'running';
  if (event.outcome === 'failed') return 'failed';
  if (event.outcome === 'success') return 'success';
  return 'neutral';
}

function stepRowResult(outcome: 'running'|'done'|'error'|undefined): RowResult {
  if (outcome === 'running') return 'running';
  if (outcome === 'error') return 'failed';
  if (outcome === 'done') return 'success';
  return 'neutral';
}

const RESULT_MARK: Record<RowResult, string> = { running: '…', success: '✓', failed: '×', neutral: '·' };

/** 归档的一次完成运行：快照进组件内存，不写库。 */
interface ArchivedRun {
  id: number;
  phase: AgentRunState['phase'];
  thoughtCount: number;
  stepLog: AgentStepLogEntry[];
  eventLog: AgentRunState['eventLog'];
}

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
 * 停滞侦测：运行期间每 2s 采样一次进度快照（与云端轮询同频），交给纯函数
 * detectStall 判断「是否在同一处打转」。停止或开新一轮时重置历史。
 *
 * 云端只在进度真的变时才发一次账本更新，没变化就不发——所以这里不能靠订阅
 * 事件数「没变化」，得自己按心跳采样，把「没变化」也记下来。
 */
function useStall(run: AgentRunState): StallResult {
  const historyRef = useRef<StallSnapshot[]>([]);
  const [stall, setStall] = useState<StallResult>({ stalled: false });

  useEffect(() => {
    historyRef.current = [];
    if (!run.isRunning) {
      setStall({ stalled: false });
      return;
    }

    const sample = (): void => {
      const current = getAgentRun();
      const snapshot: StallSnapshot = {
        round: current.thoughtCount,
        // 前端没有真正的「改动格数」，用步骤数代理：它单调递增，能反映有没有继续往前走。
        changedCells: current.stepLog.length + current.eventLog.length,
        ts: Date.now(),
      };
      if (current.phase) snapshot.phase = current.phase;
      historyRef.current.push(snapshot);
      setStall(detectStall(historyRef.current));
    };

    sample();
    const timer = window.setInterval(sample, STALL_SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [run.isRunning, run.startedAt]);

  return stall;
}

/**
 * 渲染一次运行（当前或归档）的执行过程列表。抽出复用，避免当前卡和归档卡两套写法漂移。
 */
function RunProcessList({ entry, scope }: { entry: Pick<AgentRunState,'stepLog'|'eventLog'>, scope: AgentRunScope }): JSX.Element {
  const hasEvents = entry.eventLog.length > 0;
  return (
    <>
      <p className="ap-run-note">{hasEvents ? '根据收到的工具回执整理，可能遗漏步骤；工具返回结果不代表安全或规范检查通过。' : '根据收到的进度整理，可能遗漏步骤；不代表各项检查已通过。'}</p>
      <ol aria-label="执行过程" className="ap-run-list">
        {hasEvents ? entry.eventLog.map(event => {
          const category=toolCategory(event.tool),Icon=CATEGORY_ICONS[category];
          const result=eventRowResult(event);
          return <li key={event.seq} data-tool-category={category} className="ap-run-row" data-pending={result==='running'?'true':undefined}>
            <Icon size={15} aria-hidden="true" style={{color:'var(--wk-green)'}}/>
            <span>{TOOL_LABELS[event.tool]??'处理任务'}</span>
            <span className="ap-run-status"> · {eventStatus(event.stage,event.outcome)}</span>
            <span className="ap-run-tick" data-result={result} aria-hidden="true">{RESULT_MARK[result]}</span>
          </li>;
        }):entry.stepLog.map((step, index) => {
          const localName = LOCAL_STEP_LABEL[step.toolName];
          const localStatus = localName ? localStepStatus(step.outcome) : null;
          if (localName && localStatus) {
            const result=stepRowResult(step.outcome);
            return <li key={`${step.toolName}-${step.startedAt}-${index}`} className="ap-run-row" data-pending={result==='running'?'true':undefined}>
              <span>{localName}</span><span className="ap-run-status"> · {localStatus}</span>
              {step.outcome === 'error' && step.thought ? <span className="ap-run-status"> · {step.thought}</span> : null}
              <span className="ap-run-tick" data-result={result} aria-hidden="true">{RESULT_MARK[result]}</span>
            </li>;
          }
          const write = isWriteTool(step.toolName);
          const result=stepRowResult(step.outcome);
          return (
            <li
              key={`${step.toolName}-${step.startedAt}-${index}`}
              className="ap-run-row"
              data-kind={write?'write':undefined}
              data-pending={result==='running'?'true':undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>已观察到：</span><span style={{ fontWeight: write ? 600 : 400 }}>{visibleProgress(step.toolName,scope)}</span>
                {isPlacementTool(step.toolName) && typeof step.itemCount === 'number' && (
                  <span className="ap-run-count-pill">{step.itemCount} 个物品</span>
                )}
                {typeof step.durationMs === 'number' && step.durationMs > 0 && (
                  <span className="ap-run-status">· {formatDurationClock(step.durationMs)}</span>
                )}
              </div>
              <span className="ap-run-tick" data-result={result} aria-hidden="true">{RESULT_MARK[result]}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * 运行时面板。账本里没有真实运行时（没在跑、也没跑过）时返回 null，
 * 让调用方回退到自己的占位形态（本机规则模式那套写死的步骤）。
 *
 * `scope` 决定看哪张脸的账；`controls` 决定要不要挂运行条三控件——
 * 三控件里的「跑完这步停」「为下一步加备注」要后端支持「运行中插话」才
 * 能真生效，没有那条通道就别挂上去冒充能用。
 */
export function AgentRunPanel({ scope = 'layout', controls = true, steerInputId, onRestoreStart }: { scope?: AgentRunScope; controls?: boolean; steerInputId?: string; /** 收尾卡「还原到本轮开始」：调用方持有开跑前快照，返回是否真的还原了。 */ onRestoreStart?: (() => boolean) | undefined } = {}): JSX.Element | null {
  const run = useAgentRun();
  const now = useNowMs(run.isRunning);
  const stall = useStall(run);
  const [expandedAll, setExpandedAll] = useState(false);
  const [showProcess, setShowProcess] = useState(true);

  // —— 任务 1：停止确认就地替换 ——
  const [confirmingStop, setConfirmingStop] = useState(false);

  // —— 任务 2：过往任务归档折叠区（仅组件内存）——
  const [archive, setArchive] = useState<ArchivedRun[]>([]);
  const [currentArchived, setCurrentArchived] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const wasRunningRef = useRef(run.isRunning);

  // —— 任务 3：已送达备注 / 未完成步骤的聚合回折条 ——
  const [aggregateOpen, setAggregateOpen] = useState(false);

  // —— 任务 5：停止确认行打开时焦点落在「取消」（安全项）——
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // 跑结束的瞬间把当前 run 快照进归档列表，并把当前卡标成「已归档」。
  // 新一轮开始时清掉这个标记（新 run 自然展开在折叠区之上）。
  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = run.isRunning;

    if (wasRunning && !run.isRunning) {
      if (run.stepLog.length > 0 || run.eventLog.length > 0) {
        const snapshot: ArchivedRun = {
          id: run.startedAt || Date.now(),
          phase: run.phase,
          thoughtCount: run.thoughtCount,
          stepLog: run.stepLog,
          eventLog: run.eventLog,
        };
        setArchive(prev => [...prev, snapshot].slice(-ARCHIVE_LIMIT));
        setCurrentArchived(true);
      }
    }
    if (!wasRunning && run.isRunning) {
      setCurrentArchived(false);
    }
  }, [run.isRunning, run.startedAt, run.phase, run.thoughtCount, run.stepLog, run.eventLog]);

  // 跑停了或已请求收尾，确认行自动收起，别留半截。
  useEffect(() => {
    if (!run.isRunning || run.stopRequested) setConfirmingStop(false);
  }, [run.isRunning, run.stopRequested]);

  // 确认态按 Escape 取消。
  useEffect(() => {
    if (!confirmingStop) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setConfirmingStop(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmingStop]);

  // 确认行一打开就把焦点给「取消」：回车/空格都不会误触停止。
  useEffect(() => {
    if (confirmingStop) cancelRef.current?.focus();
  }, [confirmingStop]);

  const visibleSteps = useMemo(() => {
    if (expandedAll) return run.stepLog;
    return run.stepLog.slice(-3);
  }, [run.stepLog, expandedAll]);
  const visibleEvents=useMemo(()=>expandedAll?run.eventLog:run.eventLog.slice(-3),[run.eventLog,expandedAll]);

  // 账本里没有逐步批准/拒绝事件：聚合条只按现成维度数——已送达备注 + 未完成（failed/error）条目。
  const unresolvedCount = useMemo(() => {
    const failedEvents = run.eventLog.filter(e => e.outcome === 'failed').length;
    const failedSteps = run.stepLog.filter(s => s.outcome === 'error').length;
    return failedEvents + failedSteps;
  }, [run.eventLog, run.stepLog]);

  // 收尾卡保留改动数：只累加写入步账本给的 itemCount；取不到就不写具体数。
  const retainedCount = useMemo(
    () => run.stepLog.reduce((sum, s) => sum + (typeof s.itemCount === 'number' ? s.itemCount : 0), 0),
    [run.stepLog],
  );

  // 账本是四张脸共用的：只认自己那张脸的账，别把别的功能域的运行过程搬过来。
  if (run.scope !== scope) return null;
  // 既没在跑、也没有留下任何一步：这不是「运行态」，别占版面。
  if (!run.isRunning && run.stepLog.length === 0 && run.eventLog.length === 0 && !run.emptyOutcome && archive.length === 0) return null;

  // 跑完后这一行仍要说清「这一趟用了多久」，所以结束时按当前时刻算总耗时。
  const elapsedMs = run.startedAt && run.isRunning ? Math.max(0,now-run.startedAt) : 0;

  // 当前卡要不要展开：运行中展开；已被归档折叠的那一趟不再以主卡出现。
  const showCurrentCard = (run.isRunning || run.stepLog.length > 0 || run.eventLog.length > 0) && !currentArchived;

  // 停滞提示的入口：聚焦到父组件里那个已有的「运行中改道」输入框。面板自己
  // 不造新输入框——没有传 steerInputId 就只显示文字提示，不给按钮。
  const focusSteerInput = (): void => {
    if (!steerInputId) return;
    document.getElementById(steerInputId)?.focus();
  };

  const confirmCancel = (): void => setConfirmingStop(false);
  const confirmStop = (): void => {
    setConfirmingStop(false);
    requestAgentStop();
  };

  return (
    <>
      {/* 空结果回执卡（X8）——不允许沉默结束。 */}
      {run.emptyOutcome && !run.isRunning && (
        <div role="status" className="ap-run ap-run-receipt">
          <strong className="ap-run-receipt-title">本次没有返回可用候选。</strong>
          <span className="ap-run-receipt-body">请查看任务提示，再决定是否调整需求。</span>
          <button type="button" className="ap-run-pill" onClick={dismissAgentEmptyReceipt}>知道了</button>
        </div>
      )}

      {/* 运行状态面板——真步骤时间线（Y3/Y4/Y5/Y6）。跑完后收进「过往任务」折叠行，
          策划师仍可展开回看这一趟到底走了哪几步。 */}
      {showCurrentCard && (
        <div aria-live="polite" className="ap-run">
          {/* 主标题是「推进到哪一段工作」，不是「第几次模型调用」。
              阶段是云端给的真值（run.phase）：刷新页面重新读档也接得上。
              拿不到就不写阶段——不拿轮数顶替，那会把机器账当成工作进度。 */}
          <div className="ap-run-head">
            <span className="ap-run-state" data-state={run.isRunning ? 'running' : 'stopped'}><i aria-hidden="true"/><span>{run.isRunning ? '正在处理' : '本次运行已结束'}</span></span>
            {run.phase && <span className="ap-run-phase">· 当前阶段：{phaseLabel(run.phase)}</span>}
            {run.isRunning && <span className="ap-run-timer">{formatDurationClock(elapsedMs)}</span>}
          </div>

          {/* 副行：这一段具体在做什么 + 预算读数。
              轮数在这里，不在主标题——它是真实的（6 轮硬上限），但它不回答「在干什么」。 */}
          <div className="ap-run-meta">
            <span>{run.isRunning && <>已用时 {formatDurationClock(elapsedMs)} · </>}已进行 {run.thoughtCount} 轮模型调用</span>
          </div>

          {/* 停滞提示（纯前端推断）：连续 N 次轮询进度毫无变化，就提醒用户「似乎在同一处
              打转」，并给一个去写改道备注的入口。进度一旦前进立即移除（detectStall 判的）。 */}
          {stall.stalled && (
            <div role="status" className="ap-run-stall">
              <strong>暂未收到新的进度。</strong>
              <span>任务可能仍在处理中。</span>
              {steerInputId && (
                <button type="button" className="ap-run-pill" onClick={focusSteerInput}>去写备注</button>
              )}
            </div>
          )}

          {/* 改道备注的去向：写进输入框不等于它已经在生效。送到服务端的那句会在
              下一轮思考之前被取走，所以这里分「已送达（等下一轮生效）」和「待送达」两截说。 */}
          {(run.steerDelivered > 0 || run.steerNotes.length > 0) && (
            <div className="ap-run-steer">
              {run.steerDelivered > 0 && <span>已送达 {run.steerDelivered} 条改道备注 · 下一轮思考前生效</span>}
              {run.steerNotes.length > 0 && (
                <span style={{ color: '#8a6d3b' }}>
                  {run.steerDelivered > 0 ? ' · ' : ''}还有 {run.steerNotes.length} 条待送达
                </span>
              )}
            </div>
          )}

          <button type="button" aria-expanded={showProcess} className="ap-run-rollup" onClick={()=>setShowProcess(value=>!value)}>
            {showProcess?'收起执行过程':'查看执行过程'}
          </button>
          {showProcess && <>
          <RunProcessList entry={{ stepLog: visibleSteps, eventLog: visibleEvents }} scope={scope} />

          {(run.eventLog.length||run.stepLog.length) > 3 && (
            <button
              type="button"
              className="ap-run-rollup"
              onClick={() => setExpandedAll(v => !v)}
            >
              {expandedAll ? '收起' : `共观察到 ${run.eventLog.length||run.stepLog.length} 条，展开全部`}
            </button>
          )}

          {/* 已决策条目聚合回折条：账本没有逐步批准/拒绝事件，这里只按「已送达备注 / 未完成步骤」
              两个现成维度收成一行；无拒绝/未完成=绿，有未完成=粉。明细点开再看。 */}
          {(run.steerDelivered > 0 || unresolvedCount > 0) && (
            <div className="ap-run-aggregate" data-tone={unresolvedCount > 0 ? 'warn' : 'ok'}>
              <button
                type="button"
                aria-expanded={aggregateOpen}
                className="ap-run-aggregate-row"
                onClick={() => setAggregateOpen(v => !v)}
              >
                <span className="ap-run-aggregate-title">
                  {run.steerDelivered > 0 ? `${run.steerDelivered} 条备注已送达` : `${unresolvedCount} 步未完成`}
                </span>
                <span className="ap-run-aggregate-badge">{unresolvedCount > 0 ? '含未完成' : '全部已处理'}</span>
                <span className="ap-run-aggregate-chevron" aria-hidden="true">{aggregateOpen ? '⌃' : '⌄'}</span>
              </button>
              {aggregateOpen && (
                <ul className="ap-run-aggregate-body">
                  {run.steerDelivered > 0 && <li>已送达备注 {run.steerDelivered} 条 · 下一轮思考前生效</li>}
                  {run.steerNotes.length > 0 && <li>待送达备注 {run.steerNotes.length} 条</li>}
                  {unresolvedCount > 0 && <li>未完成步骤 {unresolvedCount} 条</li>}
                </ul>
              )}
            </div>
          )}
          </>}

          {/* 停止/结束后的人话收尾：保留改动数（取不到不写数）、未完成部分如实披露、
              「还原到本轮开始」一键写回开跑前快照（还原动作本身可 Ctrl+Z 撤销）。 */}
          {!run.isRunning && (run.stepLog.length > 0 || run.eventLog.length > 0) && (
            <div className="ap-run-wrapup">
              <p className="ap-run-wrapup-line">
                {retainedCount > 0 ? `地图上保留了 ${retainedCount} 处改动。` : '本轮没有在画布上留下改动。'}
              </p>
              {unresolvedCount > 0 && (
                <p className="ap-run-wrapup-line" data-tone="warn">有 {unresolvedCount} 步未能完成，列表里用 × 标出；已完成的部分不受影响。</p>
              )}
              <p className="ap-run-wrapup-line">停止时未完成的部分不会继续执行，可以接着补充说明。</p>
              <p className="ap-run-wrapup-line"><kbd className="ap-kbd">Ctrl+Z</kbd> 是逐步撤销{onRestoreStart && retainedCount > 0 ? '，也能撤掉这次还原' : ''}。</p>
              {onRestoreStart && retainedCount > 0 && (
                <div className="ap-run-wrapup-actions">
                  <button type="button" className="ap-run-pill" onClick={onRestoreStart}>还原到本轮开始</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 过往任务归档折叠行：运行结束后当前卡收成这一行，N=已归档的完成运行条数。 */}
      {archive.length > 0 && (
        <div className="ap-archive">
          <button
            type="button"
            className="ap-archive-row"
            aria-expanded={archiveOpen}
            onClick={() => setArchiveOpen(v => !v)}
          >
            <span className="ap-archive-title">过往任务 {archive.length}</span>
            <span className="ap-archive-chevron" aria-hidden="true">{archiveOpen ? '⌃' : '⌄'}</span>
          </button>
          {archiveOpen && (
            <div className="ap-archive-body">
              {archive.map((item, idx) => (
                <div key={item.id} className="ap-archive-item">
                  <div className="ap-run-head">
                    <span className="ap-run-state" data-state="stopped"><i aria-hidden="true"/><span>本次运行已结束</span></span>
                    {item.phase && <span className="ap-run-phase">· 当前阶段：{phaseLabel(item.phase)}</span>}
                    <span className="ap-run-meta-inline">已进行 {item.thoughtCount} 轮模型调用</span>
                  </div>
                  <RunProcessList entry={{ stepLog: item.stepLog, eventLog: item.eventLog }} scope={scope} />
                  {idx < archive.length - 1 && <div className="ap-archive-divider" aria-hidden="true" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 常驻运行条三控件（Y7/Y8/Y9）。 */}
      {run.isRunning && controls && (
        <div role="group" aria-label="运行中控制" className="ap-run-controls">
          {/* 紧急停止钮：只在运行中出现；点击同样进「要停止这项工作吗？」确认行，
              不绕开确认直接 requestAgentStop。确认行打开后收起，避免两套停止入口并存。 */}
          {!confirmingStop && (
            <button
              type="button"
              aria-label="紧急停止"
              title="停止这项工作"
              className="ap-run-emergency-stop"
              disabled={run.stopRequested}
              onClick={() => setConfirmingStop(true)}
            >
              <span aria-hidden="true" className="ap-run-emergency-stop-square" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setAgentPauseAfterStep(true)}
            disabled={run.shouldPauseAfterStep}
            className="ap-run-pill"
            data-active={run.shouldPauseAfterStep ? 'false' : 'true'}
          >
            {run.shouldPauseAfterStep ? '将在这步后停' : '跑完这步停'}
          </button>
          {!confirmingStop ? (
            <button
              type="button"
              onClick={() => setConfirmingStop(true)}
              disabled={run.stopRequested}
              className="ap-run-pill"
              data-stop="true"
              data-active={run.stopRequested ? 'false' : 'true'}
            >
              {run.stopRequested ? '正在收尾' : '停止'}
            </button>
          ) : (
            <div
              className="ap-stop-confirm"
              role="alertdialog"
              aria-label="确认停止"
              tabIndex={-1}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) confirmCancel();
              }}
            >
              <span className="ap-stop-confirm-text">要停止这项工作吗？</span>
              <button type="button" ref={cancelRef} autoFocus className="ap-run-pill" onClick={confirmCancel}>取消</button>
              <kbd className="ap-kbd" title="按 Esc 取消">Esc</kbd>
              <button type="button" className="ap-run-pill" data-stop="true" onClick={confirmStop}>停止</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
