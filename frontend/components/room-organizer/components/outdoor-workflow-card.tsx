import { useEffect, useState } from "react";
import { Check, ClipboardList, Info, LayoutGrid, Map as MapIcon, PenTool, RotateCcw, RotateCw, Search, Sparkles, TriangleAlert } from "@/components/solid-icons";
import {
  OUTDOOR_STAGE_LABELS,
  type OutdoorCardRecord,
  type useOutdoorAgentWorkflow,
} from "../hooks/use-outdoor-agent-workflow";
import { loginResumeCaption, loginResumeHeadline } from "../lib/outdoor-login-copy";
import { formatDurationClock } from "../panels/agent-chat-store";
import type { OutdoorStage, OutdoorTurn } from "../lib/outdoor-agent-contract";

/** 每阶段一句图注；进行中的真实进度文案会临时顶替它，报错走红卡。 */
const STAGE_CAPTIONS: Record<OutdoorStage, string> = {
  place: "请核对活动实际范围，自动为你框选项目区域",
  scope: "已框出项目区域，确认后写进方案；也可只取其中一部分",
  zones: "按活动用途划分功能分区，室内外依据随区标注",
  "main-routes": "沿真实路网排人流（绿）/车流（灰）/后勤（点线）与出入口",
  objects: "按分区复用我的物料自动排布，也可先检索物料库",
  "sub-routes": "补齐物件间隙的子出入口与支线，散场不再挤主门",
  people: "岗位、人数与活动路径；可开流动示意看散场节奏",
  "refine-3d": "选中设施换模型、原位上传或生成（费用单独确认）",
};

/** 底图共享层：地表/水系/道路/街区，各阶段变体只追加自己的覆盖层。 */
function ThumbBase(): JSX.Element {
  return (
    <>
      <rect width="320" height="150" fill="#DDE8D2" />
      <path
        d="M0 118 C 60 108, 120 126, 180 120 S 290 132, 320 124 L320 150 L0 150 Z"
        fill="#BFD9E8"
      />
      <path
        d="M36 22 C 90 40, 120 78, 196 88 S 268 96, 300 92"
        stroke="#F4ECD9"
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M140 24 C 150 52, 168 70, 210 88"
        stroke="#F4ECD9"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="60" y="40" width="44" height="30" rx="4" fill="#C9DCC0" />
      <rect x="212" y="34" width="52" height="26" rx="4" fill="#C9DCC0" />
      <rect x="236" y="100" width="40" height="20" rx="4" fill="#C9DCC0" />
      <rect x="118" y="96" width="34" height="22" rx="4" fill="#D8CDB4" />
    </>
  );
}

/**
 * 卡片上幅的风格化地图缩略（自绘 SVG，无网络依赖、不声称是真实轮廓）：
 * 同一底图按阶段换覆盖层——place 落点、scope 选区、zones 色块、routes 箭头、
 * objects 座椅、sub-routes 支线、people 人流、refine-3d 体块。
 * 真实几何出来后逐步替换为数据切片，示意只是开局的占位观感。
 */
function StageThumb({ stage }: { stage: OutdoorStage }): JSX.Element {
  return (
    <svg
      className="ap-task-map"
      viewBox="0 0 320 150"
      role="img"
      aria-label="地图缩略示意"
      aria-hidden="true"
    >
      <ThumbBase />
      {stage === "place" && (
        <>
          <rect x="118" y="52" width="110" height="62" rx="8" fill="none" stroke="#4A7C59" strokeWidth="2.5" strokeDasharray="7 6" />
          <circle cx="173" cy="83" r="5" fill="#4A7C59" />
        </>
      )}
      {stage === "scope" && (
        <>
          <rect x="86" y="38" width="150" height="72" rx="6" fill="color-mix(in srgb, #4A7C59 14%, #ffffff)" stroke="#4A7C59" strokeWidth="2.5" />
          <rect x="82" y="34" width="8" height="8" fill="#ffffff" stroke="#4A7C59" strokeWidth="2" />
          <rect x="232" y="34" width="8" height="8" fill="#ffffff" stroke="#4A7C59" strokeWidth="2" />
          <rect x="82" y="106" width="8" height="8" fill="#ffffff" stroke="#4A7C59" strokeWidth="2" />
          <rect x="232" y="106" width="8" height="8" fill="#ffffff" stroke="#4A7C59" strokeWidth="2" />
        </>
      )}
      {stage === "zones" && (
        <>
          <rect x="40" y="24" width="112" height="70" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <rect x="158" y="24" width="122" height="42" rx="6" fill="#F2E3C2" stroke="#ffffff" strokeWidth="2" />
          <rect x="158" y="72" width="122" height="40" rx="6" fill="#BFD9E8" stroke="#ffffff" strokeWidth="2" />
          <rect x="40" y="100" width="240" height="14" rx="4" fill="#E3D9C0" stroke="#ffffff" strokeWidth="2" />
          <text x="62" y="62" fontSize="11" fill="#35624A">观众区</text>
          <text x="176" y="48" fontSize="11" fill="#96651F">表演区</text>
          <text x="176" y="95" fontSize="11" fill="#3D6C8C">餐饮区</text>
          <text x="60" y="111" fontSize="10" fill="#7A6F52">后勤带</text>
        </>
      )}
      {stage === "main-routes" && (
        <>
          <rect x="118" y="46" width="96" height="52" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <rect x="228" y="30" width="52" height="30" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <path d="M18 128 C 60 112, 92 96, 132 78" stroke="#4A7C59" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M132 78 L 122 80 M132 78 L 128 88" stroke="#4A7C59" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M300 40 C 270 56, 246 62, 218 66" stroke="#55585F" strokeWidth="5" strokeDasharray="10 7" fill="none" strokeLinecap="round" />
          <path d="M218 66 L 228 58 M218 66 L 229 70" stroke="#55585F" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M300 118 C 262 112, 232 108, 206 102" stroke="#96651F" strokeWidth="3.5" strokeDasharray="3 6" fill="none" strokeLinecap="round" />
          <circle cx="132" cy="78" r="5" fill="#ffffff" stroke="#35624A" strokeWidth="2.5" />
          <circle cx="300" cy="40" r="5" fill="#ffffff" stroke="#55585F" strokeWidth="2.5" />
          <circle cx="300" cy="118" r="5" fill="#ffffff" stroke="#96651F" strokeWidth="2.5" />
        </>
      )}
      {stage === "objects" && (
        <>
          <rect x="40" y="24" width="112" height="70" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <rect x="158" y="24" width="122" height="42" rx="6" fill="#F2E3C2" stroke="#ffffff" strokeWidth="2" />
          <g fill="#ffffff" stroke="#4A7C59" strokeWidth="1.5">
            <rect x="54" y="36" width="9" height="9" rx="2" /><rect x="70" y="36" width="9" height="9" rx="2" /><rect x="86" y="36" width="9" height="9" rx="2" /><rect x="102" y="36" width="9" height="9" rx="2" /><rect x="118" y="36" width="9" height="9" rx="2" />
            <rect x="54" y="56" width="9" height="9" rx="2" /><rect x="70" y="56" width="9" height="9" rx="2" /><rect x="86" y="56" width="9" height="9" rx="2" /><rect x="102" y="56" width="9" height="9" rx="2" /><rect x="118" y="56" width="9" height="9" rx="2" />
          </g>
          <g fill="#ffffff" stroke="#96651F" strokeWidth="1.5">
            <circle cx="182" cy="40" r="6" /><circle cx="206" cy="40" r="6" /><circle cx="230" cy="40" r="6" /><circle cx="254" cy="40" r="6" />
          </g>
          <rect x="176" y="56" width="64" height="6" rx="3" fill="#96651F" opacity="0.55" />
        </>
      )}
      {stage === "sub-routes" && (
        <>
          <rect x="118" y="46" width="96" height="52" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <rect x="40" y="30" width="52" height="34" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <path d="M18 128 C 60 112, 92 96, 132 78" stroke="#4A7C59" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.6" />
          <path d="M132 78 C 110 66, 92 60, 76 58" stroke="#35624A" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M132 78 C 118 96, 108 106, 96 112" stroke="#35624A" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M132 78 C 156 66, 176 62, 196 62" stroke="#35624A" strokeWidth="3" fill="none" strokeLinecap="round" />
          <rect x="72" y="52" width="9" height="9" rx="2" fill="#ffffff" stroke="#35624A" strokeWidth="2" />
          <rect x="91" y="107" width="9" height="9" rx="2" fill="#ffffff" stroke="#35624A" strokeWidth="2" />
          <rect x="192" y="57" width="9" height="9" rx="2" fill="#ffffff" stroke="#35624A" strokeWidth="2" />
        </>
      )}
      {stage === "people" && (
        <>
          <rect x="118" y="46" width="96" height="52" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <path d="M30 120 C 70 100, 110 84, 150 74 S 220 62, 250 58" stroke="#7FA8C9" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7" />
          <g fill="#4A7C59">
            <circle cx="60" cy="106" r="2.6" /><circle cx="72" cy="101" r="2.6" /><circle cx="86" cy="94" r="2.6" /><circle cx="98" cy="90" r="2.6" /><circle cx="112" cy="84" r="2.6" /><circle cx="126" cy="79" r="2.6" />
            <circle cx="142" cy="75" r="2.6" /><circle cx="156" cy="71" r="2.6" /><circle cx="170" cy="68" r="2.6" /><circle cx="184" cy="66" r="2.6" /><circle cx="198" cy="64" r="2.6" /><circle cx="212" cy="62" r="2.6" />
          </g>
          <g fill="#96651F">
            <rect x="120" y="42" width="10" height="10" rx="2" transform="rotate(45 125 47)" />
            <rect x="206" y="90" width="10" height="10" rx="2" transform="rotate(45 211 95)" />
          </g>
          <text x="134" y="51" fontSize="10" fill="#7A5A17">保安</text>
          <text x="220" y="100" fontSize="10" fill="#7A5A17">医疗</text>
        </>
      )}
      {stage === "refine-3d" && (
        <>
          <rect x="48" y="36" width="52" height="30" rx="4" fill="#C9DCC0" />
          <rect x="230" y="92" width="44" height="22" rx="4" fill="#C9DCC0" />
          <path d="M150 52 L 186 40 L 222 52 L 186 64 Z" fill="#9DBB92" />
          <path d="M150 52 L 186 64 L 186 100 L 150 88 Z" fill="#6F9770" />
          <path d="M186 64 L 222 52 L 222 88 L 186 100 Z" fill="#4A7C59" />
          <text x="168" y="84" fontSize="10" fill="#ffffff">主舞台</text>
        </>
      )}
    </svg>
  );
}

export function OutdoorThoughtRecord({ thought, request, awaiting = false, draft = "", steps = [], elapsedMs = null, compact = false, canvasNote = null, attention = false }: {
  thought: string | null;
  request?: string | null;
  awaiting?: boolean;
  draft?: string;
  steps?: readonly string[];
  elapsedMs?: number | null;
  compact?: boolean;
  canvasNote?: string | null;
  /** 本轮有真异常（地图依据没取全）才自动展开；常规轮默认收起。*/
  attention?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  // 2026-11-17：不再「只要在跑就展开」。这几步在请求发出前就全部就位，自动展开等于每次输入都弹一大块。
  const autoOpen = awaiting && attention;
  const [open, setOpen] = useState(autoOpen);
  useEffect(() => { setOpen(autoOpen); }, [autoOpen]);
  if (!thought && !awaiting) return null;
  const modelNote = (thought || draft) && (
    <details className="ap-outdoor-model-note" open>
      <summary>{awaiting ? "目前的思考" : elapsedMs === null ? "模型摘要" : `思考了 ${formatDurationClock(elapsedMs)}`}</summary>
      <p className="ap-run-thought-text">{thought ?? draft}</p>
    </details>
  );
  const stepRow = (step: string, index: number) => <li key={index} className="ap-run-thought-text">{step}</li>;
  // 2026-11-17：折叠窗口只截步骤，模型片段始终保留——否则窗口滑动会把最后真正有用的一步挤掉。
  const visibleSteps = showAll ? steps : steps.slice(-3);
  const rows = [
    ...visibleSteps.map((step, index) => stepRow(step, showAll ? index : steps.length - visibleSteps.length + index)),
    ...(modelNote ? [<li key="model">{modelNote}</li>] : []),
  ];
  return (
    <article className="ap-card ap-outdoor-thought-card" aria-label="思考卡片">
    {request && <header className="ap-outdoor-thought-heading">{request}</header>}
    {awaiting && <div className="ap-task-progress" aria-hidden="true" />}
    <details className="ap-run-thoughts" open={open} aria-busy={awaiting || undefined} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="ap-run-thoughts-summary">
        {awaiting ? "思考中" : "思考记录 · 1 条"}
        {canvasNote && <span className="ap-outdoor-thought-canvas">{canvasNote}</span>}
        {compact && !awaiting && elapsedMs !== null && <span className="ap-run-thoughts-hint">思考了 {formatDurationClock(elapsedMs)}</span>}
      </summary>
      {steps.length > 3 && <button className="ap-outdoor-thought-more" type="button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
        {showAll ? "收起较早步骤" : `共 ${steps.length} 步，查看较早步骤`}
      </button>}
      <ol className="ap-outdoor-thought-steps" start={showAll ? 1 : Math.max(1, steps.length - 3 + 1)}>
        {rows}
      </ol>
    </details>
    </article>
  );
}

/** 分区卡里的输入框：跟画布 ZoneEventInput 同一套口径——保留输入空格，失焦/回车才提交一次。 */
function ZoneCardField({ label, value, placeholder, maxLength, onCommit }: {
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  onCommit(text: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return <input
    aria-label={label}
    value={draft}
    placeholder={placeholder}
    maxLength={maxLength}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => onCommit(draft)}
    onKeyDown={(event) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        onCommit(draft);
        event.currentTarget.blur();
      }
    }}
  />;
}

export function OutdoorWorkflowCard({
  flow,
  onCancelPreview,
  onSearchPlace,
  onAdjustPlan,
  replyPending = false,
}: {
  flow: ReturnType<typeof useOutdoorAgentWorkflow>;
  replyPending?: boolean;
  onAdjustPlan?: () => void;
  /** 地图优先第一步：任务卡上直接给「搜索地点」入口，不用让人去画布左上角找。 */
  onSearchPlace?: (() => void) | undefined;
  /** 「下一句」建议芯片的预填回调：点芯片只填输入框，发送仍是用户按键确认。 */
  /** 2026-11-15 用户拍板：撤回预览要在对话流留「已放弃」徽章——按钮经此回调，
   *  由面板调 cancel() 并补一条决策留痕气泡；不传则保持原直调 cancel() 的行为。 */
  onCancelPreview?: (() => void) | undefined;
}) {
  const [libraryQuery, setLibraryQuery] = useState("");
  // 2026-11-18 用户指令：分区用途反问拆到任务卡下方的独立小卡；输入框内容只留在本卡。
  const [zonesAsk, setZonesAsk] = useState("");
  // 2026-11-18 用户指令：「缺物料？导入或生成」卡可叉掉；叉掉是面板内存态，换阶段自动回来。
  const [materialsAuxDismissed, setMaterialsAuxDismissed] = useState(false);
  // 2026-11-16：历史行可点开——展开当时的说明与按钮，看回这张卡当时到底问了什么。
  const [openRecordAt, setOpenRecordAt] = useState<number | null>(null);
  // 低风险提示条倒计时收场（对标谷地工坊「8 秒后自动按下」）：非错误提示、空闲且无待确认
  // 提案时才启动倒计时；「预览已就绪，核对后确认」这类要等动作的提示不自动消失。
  const recordRow = (record: OutdoorCardRecord, extraClass: string) => {
    const open = openRecordAt === record.at;
    const decision =
      record.decision === "confirmed" ? "已确认" : record.decision === "withdrawn" ? "已撤回" : "已替换";
    return (
      <li key={record.at} data-decision={record.decision} className={extraClass}>
        <button
          type="button"
          className="ap-card-history-row"
          aria-expanded={open}
          onClick={() => setOpenRecordAt(open ? null : record.at)}
        >
          <span className="ap-card-history-decision">{decision}</span>
          <span className="ap-card-history-title">{record.title}</span>
        </button>
        {open && (
          <div className="ap-card-history-detail">
            {record.notes.length > 0 && (
              <ul className="ap-card-history-notes">
                {record.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
            {record.actions.length > 0 && (
              <p className="ap-card-history-actions">{record.actions.join(" · ")}</p>
            )}
          </div>
        )}
      </li>
    );
  };
  // 2026-11-17：低风险提示原来 8 秒自动收起，线上看到的就是「刚做完一步，提示没了，卡片回到
  // 当前任务」，像什么都没发生。这行提示本来就是这一步的状态：留到下一句状态覆盖它，
  // 或者用户自己按「收起」。
  const actions: Partial<
    Record<typeof flow.state.stage, OutdoorTurn["action"]>
  > = {
    scope: "scope",
    zones: "zones",
    "main-routes": "main-routes",
    objects: "objects",
    "sub-routes": "sub-routes",
    people: "people",
    "refine-3d": "refine-3d",
  };
  const thoughtRecord = <OutdoorThoughtRecord key={flow.thoughtRequest} thought={flow.thought} request={flow.thoughtRequest} awaiting={flow.awaitingThought} draft={flow.thoughtDraft} steps={flow.designSteps} elapsedMs={flow.thoughtMs} compact={replyPending} canvasNote={flow.canvasNote} attention={flow.mapGap} />;
  // 2026-11-18 用户指令：分区还没给用途时，反问不再内嵌在任务卡里，而是任务卡下方的独立小卡。
  // 手画的分区在下方分区卡里补齐室内外后（全部不是 unknown），同样视为「用途已给」：
  // 反问小卡收掉，任务卡给出「生成分区预览」主按钮，不再让人必须说一句话才能推进。
  useEffect(() => {
    setMaterialsAuxDismissed(false);
  }, [flow.state.stage]);
  const planZonesReady =
    flow.drawnZones.length > 0 &&
    flow.drawnZones.every((zone) => !!zone.environment && zone.environment !== "unknown");
  const zonesNeedsPurpose =
    !flow.proposal &&
    !flow.drawingMode &&
    !planZonesReady &&
    flow.state.stage === "zones" &&
    (!flow.state.brief.zones.length ||
      flow.state.brief.zones.some((zone) => zone.environment === "unknown"));
  const pendingPlan = flow.pendingPlan;
  if (pendingPlan) return (
    <>
      {thoughtRecord}
      <section className="ap-card ap-outdoor-plan-approval" aria-label="待批准计划">
        <header className="ap-card-head ap-outdoor-plan-title">
          <strong><ClipboardList size={16} aria-hidden="true" />计划</strong>
          <span>{pendingPlan.steps.length} 个步骤</span>
        </header>
        <p className="ap-task-caption">批准后开始执行本轮计划。</p>
        <ol className="ap-outdoor-plan-steps">
          {pendingPlan.steps.map(step => <li key={step}>{step}</li>)}
        </ol>
        {/* 2026-11-18 用户：卡底就是一组动作，同一行、同高、都有边；取消不再单挂一行裸文字。 */}
        <div className="ap-card-actions">
          <button className="btn-primary" type="button" onClick={() => void flow.approvePlan(pendingPlan)}>批准并执行</button>
          {onAdjustPlan && <button className="btn-outline" type="button" onClick={onAdjustPlan}>调整计划</button>}
          <button className="btn-outline" type="button" onClick={() => flow.cancel()}>取消计划</button>
        </div>
      </section>
    </>
  );
  if (flow.awaitingThought) return thoughtRecord;
  if (replyPending && !flow.proposal && !flow.loginRequired) return thoughtRecord;
  return (
    <>
    {thoughtRecord}
    {/* 2026-11-14 用户指令：「前往登录」独立成一张卡，不再混在任务卡底部。 */}
    <section
      className="ap-card ap-status-card"
      aria-label="活动规划渐进任务"
      data-testid="outdoor-workflow-card"
      aria-busy={flow.busy || undefined}
    >
      <header className="ap-card-head">
        <strong>
          {flow.busy
            ? `正在处理 · ${OUTDOOR_STAGE_LABELS[flow.state.stage]}`
            : flow.proposal
              ? "待你核对"
              // 2026-11-17：失败时标题还是「当前任务 · …」，看上去跟正常步骤一样，
              // 用户不知道刚才那一下已经失败。直接把结论写在标题上，阶段留后面做定位。
              : flow.noticeKind === "error"
                ? `这一步没做成 · ${OUTDOOR_STAGE_LABELS[flow.state.stage]}`
                : flow.noticeSticky
                  ? // 2026-11-17 断点修复：反问补充时标题还是「当前任务 · 主通道」，对话在问物件、
                    // 卡在说通道，用户不知道自己卡在哪一步。标题直接说「等你补充」。
                    `等你补充 · ${OUTDOOR_STAGE_LABELS[flow.state.stage]}`
                  : `当前任务 · ${OUTDOOR_STAGE_LABELS[flow.state.stage]}`}
        </strong>
      </header>
      {flow.busy && (
        <div className="ap-task-progress" aria-hidden="true" />
      )}
      {/* 2026-11-16：有提案时不再放阶段缩略图——右侧地图已经画着这一版，缩略图只是重复信息。 */}
      {/* 2026-11-16 用户要求「引导卡片不要消失，历史记录很重要」：最近一条始终可见，点一下展开
          当时的说明与按钮；更早的收在展开项里。按活动存 localStorage，刷新还在。 */}
      {flow.cardRecords.length > 0 && (
        <div className="ap-card-history" aria-label="已完成的引导">
          <ol className="ap-card-history-list">
            {recordRow(flow.cardRecords.at(-1)!, "is-latest")}
          </ol>
          {flow.cardRecords.length > 1 && (
            <details className="ap-card-history-more">
              <summary>更早的引导 · {flow.cardRecords.length - 1}</summary>
              <ol className="ap-card-history-list">
                {flow.cardRecords
                  .slice(0, -1)
                  .reverse()
                  .map((record) => recordRow(record, ""))}
              </ol>
            </details>
          )}
        </div>
      )}
      {!flow.proposal && <StageThumb stage={flow.state.stage} />}
      {flow.notice && flow.noticeKind === "error" && !flow.loginRequired ? (
        flow.noticeView ? (
          <section
            className={`ap-card ap-error-card${flow.noticeView.tone === "muted" ? " is-muted" : ""}`}
            role="alert"
          >
            <span className="ap-error-stamp">
              <TriangleAlert size={12} aria-hidden="true" />
              {flow.noticeView.stamp}
            </span>
            <p className="ap-error-summary">{flow.noticeView.message}</p>
            <div className="ap-error-actions">
              {/* 按既定口径：重试是手动重发当前阶段动作，不自动换模型；两按钮都保留。 */}
              <button
                type="button"
                className="chip"
                disabled={flow.busy}
                onClick={() => void flow.action(actions[flow.state.stage] ?? "ask")}
              >
                <RotateCw size={14} aria-hidden="true" />
                重试云端理解
              </button>
              <button
                type="button"
                className="chip btn-outline"
                onClick={() => document.getElementById("ap-input")?.focus()}
              >
                改一句再说
              </button>
            </div>
          </section>
        ) : (
          <div className="ap-task-error" role="alert">
            <TriangleAlert size={14} aria-hidden="true" />
            <p>{flow.notice}</p>
            {/* 2026-11-17 用户拍「都做」：缺前置条件时「重试」只是把同一个动作原样重放，点完还是同一句话
                （正式站实测就是这样反复撞同一堵墙）。这时换成卡上写明、真能改变状态的那个动作。 */}
            {flow.noticeFix ? (
              <button
                type="button"
                className="ap-task-retry"
                disabled={flow.busy}
                onClick={() => void flow.applyNoticeFix()}
              >
                {flow.noticeFix.label}
              </button>
            ) : (
              <button
                type="button"
                className="ap-task-retry"
                disabled={flow.busy}
                onClick={() => void flow.action(actions[flow.state.stage] ?? "ask")}
              >
                重试
              </button>
            )}
          </div>
        )
      ) : flow.proposal ? null : (
        <p className="ap-task-caption">
          <MapIcon size={13} aria-hidden="true" />
          {flow.loginRequired
            ? STAGE_CAPTIONS[flow.state.stage]
            : flow.notice ||
              (flow.state.stage === "place" && flow.mapGap
                ? "没有取到可核对的真实地图/轮廓（地图服务本轮不可用）：请在地图上手画活动范围，或上传边界文件"
                : STAGE_CAPTIONS[flow.state.stage])}
          {flow.notice && !flow.loginRequired && (
            <button
              type="button"
              className="ap-task-dismiss"
              aria-label="收起这条提示"
              onClick={() => flow.dismissNotice()}
            >
              收起
            </button>
          )}
        </p>
      )}
      {/* 2026-11-18 用户指令：卡上不再显示「{活动名} · 同时N人」——brief 仍参与流程判断，
          只是这行信息不关键，撤掉展示。 */}
      {!flow.awaitingThought && !flow.thought && flow.designSteps.length > 0 && (
        <details className="ap-design-process" open>
          <summary>设计过程 <span>{flow.designSteps.length} 步</span></summary>
          <ol>
            {flow.designSteps.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}
          </ol>
        </details>
      )}
      {flow.proposal ? (
        <div className="ap-proposal">
          <strong className="ap-proposal-title">{flow.proposal.label}</strong>
          {flow.proposal.warnings.length > 0 && (
            <ul className="ap-proposal-notes">
              {flow.proposal.warnings.map((w) => (
                <li key={w}>
                  <Info size={12} aria-hidden="true" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          {/* 2026-11-16 用户：「这个确认的卡片做的一坨」——重排成
              标题 → 说明条目 → 一颗主动作 → 一行紧凑次要动作，不再有裸文字按钮和重复的取消入口。 */}
          <div className="ap-proposal-actions">
            <button
              className="ap-proposal-confirm"
              type="button"
              disabled={flow.busy}
              onClick={() =>
                flow.proposal && void flow.confirmProposal(flow.proposal)
              }
            >
              <Check size={14} aria-hidden="true" />
              {flow.proposal.afterConfirm === "main-routes"
                ? "确认分区并预览主通道"
                : flow.proposal.afterConfirm === "objects"
                  ? "确认分区并预览物料排布"
                  : "确认并应用这一版"}
            </button>
            <div className="ap-proposal-quiet-row">
              {flow.proposal.kind === "scope" && (
                <button
                  type="button"
                  className="ap-quiet-action"
                  disabled={flow.busy}
                  onClick={() =>
                    flow.proposal && flow.manualBoundary(flow.proposal)
                  }
                >
                  <PenTool size={13} aria-hidden="true" />
                  在地图上重画实际活动范围
                </button>
              )}
              {/* 2026-11-14 用户指令「给我几个方案」：物件排布方案循环切换（行列/居中/沿边）。 */}
              {flow.proposal.kind === "objects" && (
                <button
                  type="button"
                  className="ap-quiet-action"
                  disabled={flow.busy}
                  onClick={() => {
                    void flow.cycleObjectsLayout();
                  }}
                >
                  <LayoutGrid size={13} aria-hidden="true" />
                  换一种排法
                </button>
              )}
              <button
                type="button"
                className="ap-quiet-action"
                onClick={() => (onCancelPreview ? onCancelPreview() : flow.cancel())}
              >
                <RotateCcw size={13} aria-hidden="true" />
                撤回预览
              </button>
            </div>
          </div>
        </div>
      ) : flow.state.stage === "scope" && !flow.boundaryReady ? (
        // 2026-11-18 用户拍板：场地没有用地红线时，卡片先教怎么画，
        // 不再挂一颗点了也只会撞红卡的「确认活动范围」。
        <div className="ap-scope-guide">
          <div className="ap-scope-guide-art" aria-hidden="true">
            <svg viewBox="0 0 220 108" role="presentation" focusable="false">
              <rect width="220" height="108" rx="10" fill="#e8f0df" />
              <path d="M0 92c26-6 44 6 68 2s36-10 62-6 52 8 90 2v18H0z" fill="#cfe3f3" />
              <rect x="12" y="16" width="44" height="10" rx="2" fill="#efe6d2" />
              <rect x="122" y="14" width="58" height="9" rx="2" fill="#efe6d2" />
              <rect x="30" y="74" width="64" height="8" rx="2" fill="#efe6d2" />
              <rect x="56" y="27" width="96" height="52" fill="#f7f9f5" stroke="#2f7d4f" strokeWidth="2" />
              <g fill="#fff" stroke="#2f7d4f" strokeWidth="2">
                <rect x="51" y="22" width="10" height="10" rx="1" />
                <rect x="147" y="22" width="10" height="10" rx="1" />
                <rect x="51" y="74" width="10" height="10" rx="1" />
                <rect x="147" y="74" width="10" height="10" rx="1" />
              </g>
            </svg>
          </div>
          <p className="ap-scope-guide-title">先在图上圈出这次活动用的地</p>
          <p className="ap-scope-guide-text">
            沿场地边缘逐点单击，点回起点就闭合；闭合后红线就是设计范围，分区、流线、物件都按它排。
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={flow.busy}
            onClick={() => flow.manualBoundary()}
          >
            在地图上手画活动范围
          </button>
        </div>
      ) : flow.state.stage !== "place" && !flow.drawingMode ? (
        flow.state.stage === "zones" &&
        !planZonesReady &&
        (!flow.state.brief.zones.length ||
          flow.state.brief.zones.some((zone) => zone.environment === "unknown")) ? (
          // 2026-11-18 用户实测：这颗按钮承诺「点了就出分区预览」，但没用途时点了只会撞红卡
          // 反问「要分哪些用途」。没给指令就不挂空头按钮，如实引导去说用途或手画。
          // 2026-11-18 用户指令：反问与「手画分区」入口拆到任务卡下方的独立小卡（见 zonesNeedsPurpose），
          // 卡里带输入框可直填，提交走 handle() 与聊天输入同一条理解管线；这里不再重复渲染。
          null
        ) : (
          <div className="ap-card-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={flow.busy}
            onClick={() => void flow.action(actions[flow.state.stage] ?? "ask")}
          >
            {flow.state.stage === "scope"
              ? "确认活动范围"
              : flow.state.stage === "zones"
                ? "生成分区预览"
                : `预览${OUTDOOR_STAGE_LABELS[flow.state.stage]}`}
          </button>
          {/* 2026-11-18 用户：这颗是白底无描边的次要动作，渲染出来跟一行普通文字一样，
              看着根本不像能点。补上发丝边（btn-outline）并与主按钮同高、同一行并排。 */}
          {flow.state.stage === "scope" && (
            <button
              type="button"
              className="btn-outline"
              disabled={flow.busy}
              onClick={() => flow.manualBoundary()}
            >
              在地图上手画活动范围
            </button>
          )}
          {flow.state.stage === "zones" && (
            <button
              type="button"
              className="btn-outline"
              disabled={flow.busy}
              onClick={() => void flow.action("draw-zone")}
            >
              在地图上手画分区
            </button>
          )}
          </div>
        )
      ) : null}
      {(flow.state.stage === "objects" || flow.libraryChoices.length > 0) &&
        !flow.proposal && (
          <div aria-label="当前分区物料候选">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (libraryQuery.trim())
                  void flow.action(
                    "library-search",
                    undefined,
                    undefined,
                    libraryQuery.trim(),
                  );
              }}
            >
              <label>
                从我的物料库查找
                <input
                  aria-label="物料名称或用途"
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                  placeholder="例如 展板、音响"
                />
              </label>
              <button
                type="submit"
                className="btn-outline"
                disabled={flow.busy || !libraryQuery.trim()}
              >
                检索真实库
              </button>
            </form>
            {flow.libraryChoices.map((item) => (
              <button
                type="button"
                key={item.id}
                className="ap-quiet-action"
                disabled={flow.busy}
                aria-pressed={flow.selectedLibraryId === item.id}
                onClick={() => flow.chooseLibrary(item.id)}
              >
                {item.name} · {item.width.toFixed(2)}×{item.depth.toFixed(2)}m ·{" "}
                {item.modelSlug.startsWith("generated:local-glb:")
                  ? "本机会话"
                  : "我的库"}
              </button>
            ))}
            {/* 2026-11-18 用户指令：GLB 导入与 Lux3D 生成入口挪到任务卡下方的独立卡（可叉掉），见 ap-materials-aux。 */}
          </div>
        )}
      {flow.models && (
        <div aria-label="当前设施真实模型候选">
          {flow.models.choices.map((m, index) => (
            <button
              key={m.slug}
              type="button"
              className="ap-quiet-action"
              disabled={flow.busy}
              onClick={() =>
                void flow.action("choose-model", index, flow.models!.facilityId)
              }
            >
              {m.name} · {m.source}
            </button>
          ))}
        </div>
      )}
      {flow.state.stage === "refine-3d" && !flow.proposal && (
        <div className="ap-card-actions">
          <button type="button" className="btn-outline" onClick={() => void flow.action("models")}>
            比较所选设施模型
          </button>
          <button type="button" className="btn-outline" onClick={() => void flow.action("upload")}>
            给所选设施上传GLB
          </button>
          <button type="button" className="btn-outline" onClick={() => void flow.action("generate")}>
            准备原位生成（另行确认费用）
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => void flow.action("generate-image")}
          >
            上传图片准备生成（另行确认费用）
          </button>
        </div>
      )}
      {/* 2026-11-16 用户拍板：模型说「轮廓取不到，请手画」时，place 阶段卡上就得能点进去手画，
          不用让人自己到工具栏里翻。实现在 manualBoundary 的既有守卫里（无锚点/不可换场原位报错，不乱改）。
          2026-11-18 用户指令：place 两颗入口与 scope 阶段视觉一致——并入 ap-card-actions
          的 btn-primary/btn-outline 一排，不再用独立的紧凑胶囊样式。 */}
      {!flow.proposal && flow.state.stage === "place" && (
        <div className="ap-card-actions">
          {onSearchPlace && (
            <button
              type="button"
              className="btn-primary"
              disabled={flow.busy}
              onClick={onSearchPlace}
            >
              <Search size={13} aria-hidden="true" />
              搜索地点
            </button>
          )}
          <button
            type="button"
            className="btn-outline"
            disabled={flow.busy}
            onClick={() => flow.manualBoundary()}
          >
            <PenTool size={13} aria-hidden="true" />
            在地图上手画活动范围
          </button>
        </div>
      )}
      {!flow.proposal && flow.state.stage === "main-routes" && !flow.drawingMode && (
        <div className="ap-card-actions">
          <button
            type="button"
            className="btn-outline"
            disabled={flow.busy}
            onClick={() => void flow.action("draw-route")}
          >
            标出已知实际人行主线
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={flow.busy}
            onClick={() => void flow.action("draw-entrance")}
          >
            {/* 2026-11-18 用户反馈：原「标出待核对入口」是系统视角的词，看不懂；改成用户视角。
                标完的位置以「未核对」状态进方案，紧接着的入口通行核对卡会问这个口能不能走。 */}
            在地图上标一个入口
          </button>
        </div>
      )}
    </section>
      {/* 2026-11-18 用户指令：分区用途反问是任务卡下方的一张独立小卡，带输入框可直填。
          提交走 handle()——和在聊天框里说这句话走同一条理解管线；手画入口同卡保留。 */}
      {zonesNeedsPurpose && (
        <section
          className="ap-card ap-zones-ask"
          role="group"
          aria-label="说分区用途和室内外"
        >
          <header className="ap-card-head">
            <strong>说一句用途和室内外</strong>
          </header>
          <p className="ap-task-caption">
            例如「室外展览区和表演区」，我按这句出分区预览。
          </p>
          <form
            className="ap-zones-ask-form"
            onSubmit={(event) => {
              event.preventDefault();
              const text = zonesAsk.trim();
              if (!text || flow.busy) return;
              setZonesAsk("");
              void flow.handle(text);
            }}
          >
            <input
              aria-label="分区用途和室内外"
              value={zonesAsk}
              placeholder="室外展览区和表演区"
              onChange={(event) => setZonesAsk(event.target.value)}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={flow.busy || !zonesAsk.trim()}
            >
              出分区预览
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={flow.busy}
              onClick={() => void flow.action("draw-zone")}
            >
              在地图上手画分区
            </button>
          </form>
        </section>
      )}
      {/* 2026-11-18 用户指令：入口通行核对从任务卡内部挪出，做成任务卡下方的独立卡。
          只取第一个未核实入口；核对动作与口径不变。 */}
      {!flow.proposal &&
        !flow.busy &&
        ["main-routes", "objects", "sub-routes", "people"].includes(
          flow.state.stage,
        ) &&
        flow.unverifiedEntrances.slice(0, 1).map((n) => (
          <section
            key={n.id}
            className="ap-card ap-access-check"
            role="group"
            aria-label={`入口通行核对：「${n.name}」`}
          >
            <header className="ap-card-head">
              <strong>核对入口通行</strong>
              <span>核完这一版就按你的判断排</span>
            </header>
            <p className="ap-access-question">
              “{n.name}”能不能走、是只进、只出还是双向？选一个，我按你的判断出预览。
            </p>
            {/* 2026-11-17：原来三颗都叫「我已核对…预览标记」，只有后半句不同，用户分不清点哪个；
                而且是三颗裸 button，渲染出来就是三行左对齐的长句（线上截图就是这样）。
                改成三个等宽选项：大字号说方向，小字说记成什么。 */}
            <div className="ap-access-choices" role="group" aria-label={`“${n.name}”的进出方向`}>
              <button
                type="button"
                className="ap-access-choice"
                onClick={() =>
                  void flow.action("verify-access", undefined, n.id, undefined, "entry")
                }
              >
                只能进<span>入口</span>
              </button>
              <button
                type="button"
                className="ap-access-choice"
                onClick={() =>
                  void flow.action("verify-access", undefined, n.id, undefined, "exit")
                }
              >
                只能出<span>出口</span>
              </button>
              <button
                type="button"
                className="ap-access-choice"
                onClick={() =>
                  void flow.action("verify-access", undefined, n.id, undefined, "both")
                }
              >
                双向<span>入口 + 出口</span>
              </button>
            </div>
          </section>
        ))}
      {/* 2026-11-18 用户指令「随画随出卡」：手画模式下每闭合一个分区轮廓，下方清单就多一张
          分区卡；名称/用途/室内外可直改、可删，走画布同一条 commitPlan（可撤销）。
          zones 阶段画布上已有分区时同样列出，编辑不限于手画中。 */}
      {flow.state.stage === "zones" &&
      !flow.proposal &&
      !flow.busy &&
      (flow.drawingMode === "zone" || flow.drawnZones.length > 0) ? (
        <section className="ap-card ap-zones-list" role="group" aria-label="已画分区">
          <header className="ap-card-head">
            <strong>已画分区 · {flow.drawnZones.length}</strong>
            <span>
              {flow.drawingMode === "zone"
                ? "在地图上闭合一个轮廓，这里就多一张卡"
                : "改完直接生效，画布同步；预览按这里的用途和室内外排"}
            </span>
          </header>
          {flow.drawnZones.map((zone) => (
            <div className="ap-zone-card" key={zone.id}>
              <div className="ap-zone-card-row">
                <ZoneCardField
                  label={`分区「${zone.name}」名称`}
                  value={zone.name}
                  placeholder="分区名称"
                  maxLength={60}
                  onCommit={(text) => {
                    if (text.trim() && text.trim() !== zone.name)
                      flow.zoneEdits.renameZone(zone.id, text);
                  }}
                />
                <button
                  type="button"
                  className="ap-zone-card-delete"
                  aria-label={`删除分区「${zone.name}」`}
                  disabled={flow.busy}
                  onClick={() => flow.zoneEdits.deleteZone(zone.id)}
                >
                  删除
                </button>
              </div>
              <div className="ap-zone-card-row">
                <ZoneCardField
                  label={`分区「${zone.name}」用途`}
                  value={zone.event ?? ""}
                  placeholder="用途（如 展览、演出）"
                  maxLength={120}
                  onCommit={(text) => {
                    if (text.trim() !== (zone.event ?? ""))
                      flow.zoneEdits.setZoneEvent(zone.id, text);
                  }}
                />
                <div className="ap-zone-card-env" role="group" aria-label={`分区「${zone.name}」室内外`}>
                  <button
                    type="button"
                    className={zone.environment === "outdoor" ? "is-on" : ""}
                    disabled={flow.busy}
                    aria-pressed={zone.environment === "outdoor"}
                    onClick={() =>
                      flow.zoneEdits.setZoneEnvironment(
                        zone.id,
                        zone.environment === "outdoor" ? "unknown" : "outdoor",
                      )
                    }
                  >
                    室外
                  </button>
                  <button
                    type="button"
                    className={zone.environment === "indoor" ? "is-on" : ""}
                    disabled={flow.busy}
                    aria-pressed={zone.environment === "indoor"}
                    onClick={() =>
                      flow.zoneEdits.setZoneEnvironment(
                        zone.id,
                        zone.environment === "indoor" ? "unknown" : "indoor",
                      )
                    }
                  >
                    室内
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {/* 2026-11-18 用户指令：缺物料的两条路（导入 GLB / Lux3D 生成）从任务卡挪出，做成
          可叉掉的独立卡；叉掉只在面板内存里生效，换阶段自动恢复。 */}
      {!flow.proposal &&
      !flow.busy &&
      !materialsAuxDismissed &&
      flow.state.stage === "objects" ? (
        <section
          className="ap-card ap-materials-aux"
          role="group"
          aria-label="缺物料：导入或生成"
        >
          <header className="ap-card-head">
            <strong>缺物料？导入或生成</strong>
            <button
              type="button"
              className="ap-task-dismiss"
              aria-label="收起这张卡"
              onClick={() => setMaterialsAuxDismissed(true)}
            >
              × 收起
            </button>
          </header>
          <label className="ap-glb-import" data-testid="outdoor-glb-import">
            原位导入 GLB（≤10MB，仅本会话，不上传不收费）
            {/* 2026-11-14 用户反馈：原生文件选择器裸露在流程卡里不合适——视觉隐藏（点击 label 仍弹文件框）。 */}
            <input
              type="file"
              aria-label="当前活动导入GLB物料"
              accept=".glb,model/gltf-binary"
              disabled={flow.busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void flow.importLibraryGlb(file);
              }}
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                opacity: 0,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                whiteSpace: "nowrap",
              }}
            />
          </label>
          {/* 2026-11-18：生成链已经有了（额度确认/回执锁都在 generation-sheet），缺的是对话主路径的入口。
              物件阶段给一颗明确动作；和上面「一句话布置 / 目录落位预览」分开写，不混成同一颗按钮。 */}
          <div className="ap-card-actions ap-lux3d-entry" data-testid="outdoor-lux3d-entry">
            <button
              type="button"
              className="btn-outline"
              disabled={flow.busy}
              data-testid="outdoor-lux3d-generate"
              onClick={() => flow.startLux3dGeneration()}
            >
              <Sparkles size={13} aria-hidden="true" />
              ✨ 用 Aholo Lux3D 生成道具
            </button>
            <p className="ap-task-caption">
              由 Aholo Lux3D 生成三维模型：区别于「一句话布置 / 目录落位预览」——这里造的是新模型，不是把现成物料摆上去。提交前仍需在面板里勾选额度。
            </p>
          </div>
        </section>
      ) : null}
      {flow.loginRequired && !flow.loginSatisfied && (
      <section
        className="ap-card ap-status-card"
        role="status"
        aria-label="需要登录"
      >
        <header className="ap-card-head">
          <strong>
            {loginResumeHeadline({ rangeConfirmed: flow.scopeConfirmed() })}
          </strong>
        </header>
        <p className="ap-task-caption">
          <MapIcon size={13} aria-hidden="true" />
          {loginResumeCaption({ rangeConfirmed: flow.scopeConfirmed() })}
        </p>
        {/* 2026-11-16 用户指令：登录完成后不再留「已登录 · 可以继续」再点一次——
            登录一到位就由 useOutdoorAgentWorkflow 自动续上，这张卡只在真的没登录时出现。 */}
        <div className="ap-card-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              window.dispatchEvent(new Event("scendance:request-account-login"))
            }
          >
            前往登录
          </button>
        </div>
      </section>
    )}
    </>
  );
}
