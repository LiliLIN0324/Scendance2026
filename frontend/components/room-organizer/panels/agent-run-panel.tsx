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
} from './agent-chat-store';

const COLOR_STONE = '#F4F5F7';
const COLOR_GREEN = '#4A7C59';
const COLOR_RED = '#C0392B';
const COLOR_AMBER = '#B45309';

/** 停滞侦测的采样间隔：与云端轮询（2s）同频。 */
const STALL_SAMPLE_MS = 2000;

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
function eventStatus(stage:'started'|'finished',outcome:'success'|'failed'|'unknown'|null):string {
  if(stage==='started')return '已发起';
  if(outcome==='success')return '已返回结果';
  if(outcome==='failed')return '未完成';
  return '结果待核对';
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
 * 运行时面板。账本里没有真实运行时（没在跑、也没跑过）时返回 null，
 * 让调用方回退到自己的占位形态（本机规则模式那套写死的步骤）。
 *
 * `scope` 决定看哪张脸的账；`controls` 决定要不要挂运行条三控件——
 * 三控件里的「跑完这步停」「为下一步加备注」要后端支持「运行中插话」才
 * 能真生效，没有那条通道就别挂上去冒充能用。
 */
export function AgentRunPanel({ scope = 'layout', controls = true, steerInputId }: { scope?: AgentRunScope; controls?: boolean; steerInputId?: string } = {}): JSX.Element | null {
  const run = useAgentRun();
  const now = useNowMs(run.isRunning);
  const stall = useStall(run);
  const [expandedAll, setExpandedAll] = useState(false);
  const [showProcess, setShowProcess] = useState(true);

  const visibleSteps = useMemo(() => {
    if (expandedAll) return run.stepLog;
    return run.stepLog.slice(-3);
  }, [run.stepLog, expandedAll]);
  const visibleEvents=useMemo(()=>expandedAll?run.eventLog:run.eventLog.slice(-3),[run.eventLog,expandedAll]);

  // 账本是四张脸共用的：只认自己那张脸的账，别把别的功能域的运行过程搬过来。
  if (run.scope !== scope) return null;
  // 既没在跑、也没有留下任何一步：这不是「运行态」，别占版面。
  if (!run.isRunning && run.stepLog.length === 0 && run.eventLog.length === 0 && !run.emptyOutcome) return null;

  // 跑完后这一行仍要说清「这一趟用了多久」，所以结束时按当前时刻算总耗时。
  const elapsedMs = run.startedAt && run.isRunning ? Math.max(0,now-run.startedAt) : 0;

  // 停滞提示的入口：聚焦到父组件里那个已有的「运行中改道」输入框。面板自己
  // 不造新输入框——没有传 steerInputId 就只显示文字提示，不给按钮。
  const focusSteerInput = (): void => {
    if (!steerInputId) return;
    document.getElementById(steerInputId)?.focus();
  };

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
          <strong style={{ display: 'block', marginBottom: 2, color: '#2b2f36' }}>本次没有返回可用候选。</strong>
          <span style={{ color: '#4a4f57' }}>请查看任务提示，再决定是否调整需求。</span>
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
      {(run.isRunning || run.stepLog.length > 0 || run.eventLog.length > 0) && (
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
          {/* 主标题是「推进到哪一段工作」，不是「第几次模型调用」。
              阶段是云端给的真值（run.phase）：刷新页面重新读档也接得上。
              拿不到就不写阶段——不拿轮数顶替，那会把机器账当成工作进度。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, fontWeight: 600, color: '#2b2f36' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: run.isRunning ? COLOR_GREEN : '#9aa0a6', display: 'inline-block' }} aria-hidden="true"/>
            <span>{run.isRunning ? '正在处理' : '本次运行已结束'}</span>
            {run.phase && <span>· 当前阶段：{phaseLabel(run.phase)}</span>}
          </div>

          {/* 副行：这一段具体在做什么 + 预算读数。
              轮数在这里，不在主标题——它是真实的（6 轮硬上限），但它不回答「在干什么」。 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6, fontSize: 11.5, color: '#4a4f57' }}>
            <span>
              {run.isRunning && <>已用时 {formatDurationClock(elapsedMs)} · </>}
              已进行 {run.thoughtCount} 轮模型调用
            </span>
          </div>

          {/* 停滞提示（纯前端推断）：连续 N 次轮询进度毫无变化，就提醒用户「似乎在同一处
              打转」，并给一个去写改道备注的入口。进度一旦前进立即移除（detectStall 判的）。 */}
          {stall.stalled && (
            <div
              role="status"
              style={{
                margin: '0 0 6px',
                padding: '8px 10px',
                background: '#FFF7E6',
                borderLeft: `3px solid ${COLOR_AMBER}`,
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.6,
                color: '#7a4f01',
              }}
            >
              <strong>暂未收到新的进度。</strong>
              <span>任务可能仍在处理中。</span>
              {steerInputId && (
                <button
                  type="button"
                  onClick={focusSteerInput}
                  style={{
                    marginLeft: 8,
                    padding: '2px 8px',
                    fontSize: 11.5,
                    border: `1px solid ${COLOR_AMBER}`,
                    borderRadius: 999,
                    background: '#fff',
                    color: COLOR_AMBER,
                    cursor: 'pointer',
                  }}
                >
                  去写备注
                </button>
              )}
            </div>
          )}

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

          <button type="button" aria-expanded={showProcess} onClick={()=>setShowProcess(value=>!value)} style={{border:0,background:'transparent',color:COLOR_GREEN,padding:'4px 0',cursor:'pointer',fontSize:12}}>
            {showProcess?'收起执行过程':'查看执行过程'}
          </button>
          {showProcess && <>
          <p style={{margin:'2px 0 6px',fontSize:11.5,color:'#4a4f57'}}>{run.eventLog.length?'根据收到的工具回执整理，可能遗漏步骤；工具返回结果不代表安全或规范检查通过。':'根据收到的进度整理，可能遗漏步骤；不代表各项检查已通过。'}</p>
          <ol aria-label="执行过程" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {run.eventLog.length>0?visibleEvents.map(event=>{
              const category=toolCategory(event.tool),Icon=CATEGORY_ICONS[category];
              return <li key={event.seq} data-tool-category={category} style={{padding:'5px 8px',background:COLOR_STONE,borderRadius:4,color:'#4a4f57',display:'flex',alignItems:'center',gap:6}}>
                <Icon size={15} aria-hidden="true" style={{color:COLOR_GREEN}}/><span>{TOOL_LABELS[event.tool]??'处理任务'}</span><span> · {eventStatus(event.stage,event.outcome)}</span>
              </li>;
            }):visibleSteps.map((step, index) => {
              const write = isWriteTool(step.toolName);
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
                    <span>已观察到：</span><span style={{ fontWeight: write ? 600 : 400 }}>{visibleProgress(step.toolName,scope)}</span>
                    {write && typeof step.itemCount === 'number' && <span style={{ color: COLOR_GREEN, fontSize: 11.5 }}>· {step.itemCount} 件</span>}
                  </div>
                </li>
              );
            })}
          </ol>

          {(run.eventLog.length||run.stepLog.length) > 3 && (
            <button
              type="button"
              onClick={() => setExpandedAll(v => !v)}
              style={{ marginTop: 6, border: 'none', background: 'transparent', color: COLOR_GREEN, fontSize: 11.5, cursor: 'pointer', padding: 0 }}
            >
              {expandedAll ? '收起' : `共观察到 ${run.eventLog.length||run.stepLog.length} 条，展开全部`}
            </button>
          )}
          </>}
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
