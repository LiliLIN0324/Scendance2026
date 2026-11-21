import { useEffect, useRef, useState } from "react";
import type { AgentDocument } from "../lib/agent-documents";
import { AGENT_RANGE_BASIS_NOTE, reviseVenueRange, type VenueRangeBasis } from "../lib/agent-venue-range";
import { proposeWeddingLayout, WEDDING_LIBRARY_QUERIES, type WeddingCandidateMetrics } from "../lib/wedding-layout";
import { requestsWeddingOptimization, weddingDesignRequest } from "../lib/wedding-request";
import { readOutdoorProjectRecord, saveOutdoorProjectRecord } from "../lib/outdoor-project-store";
import { outdoorCorridorStrips } from "../lib/outdoor-event-logic";
import { getActiveAssistantSessionId } from "./use-assistant-sessions";
import { conversationProjectId, conversationTurnKey, recordConversationTurn, type ConversationTraceTransport } from "../lib/conversation-recorder";
import { isVenueResearchRequest } from "../lib/venue-research";
import { gateAction, type SupervisionLevel } from "../lib/agent-supervision";
import { getAgentSupervision, useAgentSupervision } from "../lib/agent-supervision-store";
import { outdoorActionRisk } from "../lib/agent-action-risk";
import type { BackendSession } from "@/lib/backend-session";
import { agentErrorView, type AgentErrorView } from "@/lib/agent-error-view";
import type { PlanPoint, SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import type { ChatProviderId } from "../../../../supabase/functions/_shared/chat-provider";
import { lux3dFacilityTarget, openLux3dDialogGeneration, parseLux3dDialogIntent } from "../lib/lux3d-dialog-entry";
import {
  boundaryKey,
  evidencedCount,
  mergeOutdoorFacts,
  planVersion,
  proposalMapWarnings,
  type OutdoorAgentBridge,
  type OutdoorFlowState,
  type OutdoorMapContext,
  type OutdoorMapEditHighlight,
  type OutdoorModelChoice,
  type OutdoorLibraryItem,
  type OutdoorStage,
  type OutdoorTurn,
  type OutdoorBrief,
} from "../lib/outdoor-agent-contract";
import { outdoorClarificationQuestion, understandOutdoorTurn, type OutdoorClarification } from "../lib/outdoor-agent-understanding";
import { headcountOnlyAdjustment } from "../lib/outdoor-headcount-adjustment";
import { resolveChoiceReply, resumeActionForRequest } from "../lib/outdoor-choice-reply";
import { restoreOutdoorFlow } from "../lib/outdoor-flow-restore";
import { deferredNote } from "../lib/outdoor-layered-task";
import { DEFAULT_SCOPE_MARGIN_M, expandRect } from "../lib/outdoor-design-scope";
import {
  loadRemoteCardHistory,
  mergeCardHistory,
  pushRemoteCardHistory,
  sanitizeCardHistory,
  type CardHistoryEntry,
} from "../lib/outdoor-card-history-sync";
import { createLiveTurn } from "../lib/outdoor-turn-live";
import { createMetricsBook, summarizeMetrics } from "../lib/outdoor-metrics-book";
import { exportMetricsReport } from "../lib/outdoor-metrics-export";
import { buildSessionReport } from "../lib/outdoor-session-report";
import { CASE_IDS, FIXED_DATA_CASES, isAllGreen, logReleaseStatus, type BrowserEvidence } from "../lib/outdoor-release-status-card";
import { releaseStatusBundle } from "../lib/outdoor-release-bundle";
import { formatGapList, formatNextGap, missingEvidence } from "../lib/outdoor-release-gaps";
import { ledgerToCsv } from "../lib/outdoor-release-csv";
import { downloadLedgerCsv as saveLedgerCsv } from "../lib/outdoor-release-csv";
import { formatSectionCheck } from "../lib/outdoor-report-sections";
import {
  bookToRecord,
  markSeen,
  setAsOf,
  summarizeWalkthrough,
} from "../lib/outdoor-walkthrough-book";
import { loadBook, loadCloud, saveBook, saveCloud } from "../lib/outdoor-walkthrough-store";
import { createTurnTraceBook } from "../lib/turn-trace-log";
import { downloadSessionReport } from "../lib/outdoor-report-download";
import { assessAcceptance, formatAcceptanceStatement, summarizeAssessment } from "../lib/outdoor-acceptance-selfcheck";
import {
  proposeUseZones,
  defaultZonesForEvent,
  proposeInventoryObjects,
  proposeRoleWorkers,
  validateWorkflowPlan,
  prunePlanForBoundary,
  splitNeedsByZone,
  describeZoneMismatch,
  OBJECTS_LAYOUT_STRATEGIES,
  OBJECTS_LAYOUT_LABELS,
  type ObjectsLayoutStrategy,
} from "../lib/outdoor-agent-planning";
import { readOutdoorPersonalLibrary, readOutdoorBuiltinLibrary } from "../lib/outdoor-personal-library";
// 2026-11-17 用户拍板「AI 先当设计师，先出一版他看看」：没有清单时按分区用途出默认方案。
import { draftDemand } from "../lib/outdoor-draft-design";
// docs/46 V-P2：虚拟场地意图切纸面（ground-mode store，2D/3D 同步跟随）。
import { writePlanGroundMode } from "../lib/plan-basemap-source";
// 2026-11-20 P1：结果摘要、本次变化、一句话局部调整（纯逻辑在 lib，hook 只做接线与档位判定）。
import { buildDesignSummary, type DesignSummary } from "../lib/outdoor-design-summary";
import { describePlanChange, diffPlanObjects, type PlanChangeSummary } from "../lib/outdoor-plan-change";
import { applyLocalAdjust, parseLocalAdjustment, parseRightBasisAnswer, type DirectionBasis } from "../lib/outdoor-local-adjust";
// 2026-11-14：直引纯函数库（原从组件模块引入，会把 three.js 级别的依赖链拖进 hook 且有循环风险）。
import { enuToLngLat, lngLatToEnu } from "../lib/outdoor-plan-canvas";

/**
 * 2026-11-16 用户要求「每次的引导卡片不要消失，历史记录很重要」：
 * 一张卡被确认、被撤回、或被新提案顶掉时都留一条记录，在卡片底部按时间顺序列出来；
 * 按 scope 存 localStorage，刷新/切活动后还在。
 */
export type OutdoorCardRecord = CardHistoryEntry & {
  stage: OutdoorStage;
  kind: OutdoorWorkflowProposal["kind"];
};

function cardActionsFor(kind: OutdoorWorkflowProposal["kind"]): string[] {
  return [
    "确认并应用这一版",
    ...(kind === "scope" ? ["在地图上重画实际活动范围"] : []),
    ...(kind === "objects" ? ["换一种排法"] : []),
    "撤回预览",
  ];
}
export const OUTDOOR_CARD_RECORDS_LIMIT = 30;
const cardRecordsKey = (scope: string) => `scendance:outdoor-cards:${scope}`;

export function readCardRecords(scope: string): OutdoorCardRecord[] {
  try {
    return sanitizeCardHistory(
      JSON.parse(localStorage.getItem(cardRecordsKey(scope)) ?? "[]"),
    ) as OutdoorCardRecord[];
  } catch {
    return [];
  }
}

function writeCardRecords(scope: string, records: OutdoorCardRecord[]) {
  try {
    localStorage.setItem(
      cardRecordsKey(scope),
      JSON.stringify(records.slice(-OUTDOOR_CARD_RECORDS_LIMIT)),
    );
  } catch {}
}
import { fetchOpenFreeMapBuildings, lngLatRingsToEnu } from "../lib/openfreemap-buildings";
import { planPointInRing } from "../lib/site-plan-editing";
import { planRingAreaM2 } from "../../../../supabase/functions/_shared/site-plan";
import { proposeOutdoorStyle } from "../lib/outdoor-style-preview";
import type { StyleBundle } from "../lib/style-bundles";
import { fetchRoadNetwork } from "../lib/road-network";
import { checkBoundaryRing } from "../lib/site-plan-editing";
import { buildRouteProposal, roadFetchPlanForBoundary, routeIntentNote } from "../lib/route-proposal";
import { buildSubEntranceProposal } from "../lib/sub-entrance";
import {
  parseShorelineDemand,
  proposeShorelineLayout,
  shorelineIntent,
} from "../lib/outdoor-shoreline-layout";
import {
  parseRouteLineDemand,
  proposeRouteLineLayout,
  referenceKindFor,
  routeLineIntent,
} from "../lib/outdoor-route-line-layout";
import { facilityFootprintRing } from "../lib/site-plan-facilities";
import { renamedNodeName } from "../lib/site-plan-node-names";
import type { OutdoorTaskProgress } from "../components/outdoor-task-card";

export interface OutdoorWorkflowProposal {
  kind: OutdoorStage | "verify-access" | "model" | "style";
  label: string;
  base: string;
  mapVersion: string;
  epoch: number;
  next: SitePlanData;
  warnings: string[];
  references: OutdoorTurn["references"];
  preserveOriginal?: boolean;
  approvalReason?: string;
  actorId?: string | null;
  /** 发起这条提案的用户原话：应用阶段失败留痕时作 userText，没有就留空（不拿卡片标签冒充）。 */
  requestText?: string;
  afterConfirm?: "main-routes" | "objects" | "design-event";
  afterConfirmRequest?: { turn: OutdoorTurn; message: string; documents: AgentDocument[]; imageCount: number };
}
/**
 * 2026-11-17：用户把设计交回来的口头禅。「随便放」「你看着办」不是新需求，是授权我先做一版。
 * 这种句子不该再被反问清单——按分区用途与面积出默认方案就行。
 */
function designerCue(message: string): boolean {
  return /随便|看着办|你看着|你定|都行|都可以|随你|按你的|不用问|挑好的|自主.{0,6}(?:规划|设计|安排)|继续执行|无需等待|不需要等待|采用.{0,6}默认/u.test(message);
}

export const OUTDOOR_STAGE_LABELS: Record<OutdoorStage, string> = {
  place: "搜索目标地点",
  scope: "核对具体活动范围",
  zones: "分区用途与室内外依据",
  "main-routes": "主要入口与通道",
  // 2026-11-17：原来叫「按用途复用我的物料」——用户根本没给清单时这句是假的（用的是内置库默认件），
  // 也把阶段名说成了承诺。这里直接说这一步在做的事：按分区摆放物料。
  objects: "摆放物料",
  "sub-routes": "物件间隙的子入口与支线",
  people: "岗位、人数与活动路径",
  // 2026-11-19 用户反馈「同规划3D深化看不懂」：这步对布局不动，只给选中的设施换模型/上传/生成，
  // 阶段名直接说这件事；「同一份规划」的信息由切 3D 视角时的状态句承担。
  "refine-3d": "设施 3D 模型精修",
};

/**
 * 2026-11-17 用户拍「都做」：缺前置条件不是「再试一次」能解决的——红卡上那颗「重试」只是把同一个动作
 * 原样重放，点完还是同一句话。这类拦阻改成给一个真能改变状态的动作按钮（如「去核对主要入口与通道」）。
 */
export type OutdoorNoticeFix = { action: OutdoorTurn["action"]; label: string };
/** 带「下一步」的拦阻：抛出点在 act() 内部，catch 统一把 fix 挂到红卡上。 */
class OutdoorStepBlocked extends Error {
  constructor(message: string, readonly fix: OutdoorNoticeFix) {
    super(message);
  }
}
/** 范围未确认时的拦阻文案（两个分支共用一份，避免改一处忘一处）。 */
const NO_BOUNDARY_NOTICE =
  "地图上还没有可核对的活动边界；请点「在地图上手画活动范围」，或在左上角重新搜索地点并选择候选。";
const MAP_EDIT_HINTS: Partial<Record<OutdoorWorkflowProposal["kind"], string>> = {
  // 2026-11-18 用户反馈「为什么要写这么多」：应用提示只保留一句真正要紧的动作话；
  // 「边界就在眼前」「下一步是什么」分别由画布和任务卡标题承担，聊天里不重复。
  scope: "不贴合就拖顶点调整，改完重新核对。",
  zones: "分区不合适可拖动整块或拖顶点微调。",
  "main-routes": "路线和候选入口可拖动微调。",
};

function changedIds<T extends { id: string }>(before: readonly T[], after: readonly T[]): string[] {
  const previous = new Map(before.map(item => [item.id, item]));
  return after.filter(item => JSON.stringify(item) !== JSON.stringify(previous.get(item.id))).map(item => item.id);
}


function mapEditHighlight(kind: OutdoorWorkflowProposal["kind"], before: SitePlanData, after: SitePlanData): OutdoorMapEditHighlight | null {
  switch (kind) {
    case "scope":
      return { kind };
    case "zones":
      return { kind, zoneIds: changedIds(before.zones, after.zones) };
    case "main-routes":
      return { kind, routeIds: changedIds(before.routes, after.routes), nodeIds: changedIds(before.nodes, after.nodes) };
    default:
      return null;
  }
}
const stages = Object.keys(OUTDOOR_STAGE_LABELS) as OutdoorStage[];
const outdoorPlanSteps: Partial<Record<OutdoorTurn["action"], readonly string[]>> = {
  'design-event': ['读取婚礼需求与附件分区', '预留完整线宽的通道', '联合布置物料与桌椅并列出缺项'],
  zones: ["核对活动范围和已有分区", "按活动用途和室内外依据生成分区预览"],
  revise: ["核对要调整的分区和需要保留的内容", "生成调整后的分区预览"],
  "main-routes": ["核对边界、道路和入口依据", "预览连接活动区域的主通道"],
  objects: ["核对各分区的物料与数量", "从可用物料中匹配尺寸，生成排布预览"],
  "sub-routes": ["核对主通道和各分区的连接点", "预览通往各分区的支线"],
  people: ["核对各分区的岗位和人数", "预览人员点位"],
  "refine-3d": ["核对所选设施及其现有尺寸", "打开对应设施的 3D 深化"],
  adjust: ["核对要调整的设施和参考位置", "在原有规划上生成调整预览"],
  connect: ["核对入口和目标通道", "预览两者的连接方式"],
};
const unknownMap: OutdoorMapContext = {
  version: "map:unavailable",
  status: "unavailable",
  text: "基础地图结构化上下文尚未取得；未向模型提供地图像素，不得声称看图；室内门与通道未知。",
  featureIds: [],
  unknowns: ["建筑/开放空间/入口证据未知", "地图像素没有提交模型"],
};
function readState(scope: string, planVersionNow: string | null = null): OutdoorFlowState {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(`scendance:outdoor-flow:${scope}`) ?? "null");
  } catch {
    raw = null;
  }
  // 刷新恢复同一套口径：旧草稿降级保留；过期的登录等待、未确认边界不还原（见 lib/outdoor-flow-restore）。
  return restoreOutdoorFlow({ raw, scope, stages, planVersion: planVersionNow }).state;
}
/** Confirmation is an authorization boundary, never delegated to model classification. */
export function explicitProposalApproval(message: string): boolean {
  const text = message.normalize("NFKC").trim();
  const withoutPositive = text.replace(/(?:没|没有)问题/gu, "");
  if (
    /不|没|别|勿|拒绝|取消|暂|等|如果|除非|假如|若|再|之前|以后|但是|不过|还是|是否|能否|吗|么|[?？“”"'`]|例如|比如|他说|她说/u.test(
      withoutPositive,
    )
  )
    return false;
  return /^(?:这个安排没问题[,，]?)?(?:就按(?:它|这个|这版|当前方案)(?:来|执行|应用|落下去)(?:吧)?|(?:我|我们)?(?:同意|确认|批准|确定)(?:应用|执行)?(?:(?:当前|这|这一)?(?:版|方案|提案))?(?:吧)?|(?:请)?(?:应用|执行)(?:(?:这|这一|当前)?(?:版|方案|提案))?(?:吧)?|好|好的|可以|就这版|没问题|没有问题|同意这版方案|确认这版方案|就这样)[。!！]?$/u.test(
    text,
  );
}
/** 裸机器错误码到人话的映射；人类可读的报错文案原样通过，不进这张表。 */
const ERROR_CODE_NOTICES: Record<string, string> = {
  NETWORK_ERROR: "网络连接没有完成，本次未执行；请检查网络后再试。",
  INVALID_RESPONSE: "服务商返回了无法核对的内容，本次未执行；请稍后重试。",
  INVALID_CREDENTIALS: "服务商拒绝了这个密钥，可能已被吊销；本次未执行。",
  CONFIGURATION_MISSING: "服务配置缺失，本次未执行；请先完成配置再试。",
  CONVERSATION_API_NOT_CONFIGURED: "会话服务未配置，本次未执行；请先完成配置再试。",
  CLOUD_OPERATION_BUSY: "云端正忙，本次未执行；请稍后重试。",
  AI_BUSY: "生成任务正忙，本次未执行；请稍后重试。",
  GENERATION_BUSY: "生成任务正忙，本次未执行；请稍后重试。",
  SESSION_CHANGED: "会话已切换，本次未执行；请回到当前活动再试。",
  CANVAS_PROJECT_MISMATCH: "画布项目已变化，本次未执行。",
  CLOUD_WRITE_BLOCKED: "云端写入被暂停，本次未执行。",
  ASSET_UPLOAD_TIMEOUT: "等待响应超时，本次未执行；请稍后重试。",
  ASSET_UPLOAD_ABORTED: "上传已中止，本次未执行。",
};

/** 整句都是 ALL_CAPS 机器码时换成人话（未知码走兜底），别把 NETWORK_ERROR 这种词裸给用户看。 */
function friendlyErrorNotice(text: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(text)) return text;
  return ERROR_CODE_NOTICES[text] ?? "请求没有完成，本次未执行；请稍后重试。";
}

/** 提案基座与当前画布做「纯新增」比对时要逐条对齐的实体表。 */
const PLAN_ENTITY_KEYS = [
  "zones",
  "facilities",
  "routes",
  "nodes",
  "workers",
  // 车辆（plan.vehicles，2026-11-16 #118）：与其它实体同口径——基座之后的纯新增不算「规划已变化」，
  // 但要靠 carryNewEntities 一并带回，两处必须成对。
  "vehicles",
  "annotations",
  "measurements",
] as const;

/**
 * 基座快照是否仍原样在画布上：基座里每个实体都没被删/改，且边界、锚点等非实体字段一字未动。
 * 任何一处变动都算「规划已变化」，绝不拿基座快照覆盖用户内容。
 */
export function baseStillIntact(base: SitePlanData, current: SitePlanData): boolean {
  const baseObj = base as unknown as Record<string, unknown>;
  const nowObj = current as unknown as Record<string, unknown>;
  for (const key of PLAN_ENTITY_KEYS) {
    const before = (baseObj[key] ?? []) as readonly { id: string }[];
    const now = (nowObj[key] ?? []) as readonly { id: string }[];
    const kept = before.every(item =>
      now.some(x => x.id === item.id && JSON.stringify(x) === JSON.stringify(item)),
    );
    if (!kept) return false;
  }
  const keys = new Set([...Object.keys(baseObj), ...Object.keys(nowObj)]);
  for (const key of PLAN_ENTITY_KEYS) keys.delete(key);
  return [...keys].every(
    key => JSON.stringify(baseObj[key]) === JSON.stringify(nowObj[key]),
  );
}

/** 把基座之后用户新画的实体并进提案；对没加东西的画布是恒等运算。 */
export function carryNewEntities(
  base: SitePlanData,
  next: SitePlanData,
  current: SitePlanData,
): SitePlanData {
  const carryList = <T extends { id: string }>(
    baseItems: readonly T[],
    nextItems: readonly T[],
    currentItems: readonly T[],
  ): T[] => {
    const baseIds = new Set(baseItems.map(item => item.id));
    const nextIds = new Set(nextItems.map(item => item.id));
    return [
      ...nextItems,
      ...currentItems.filter(item => !baseIds.has(item.id) && !nextIds.has(item.id)),
    ];
  };
  const vehicles = carryList(base.vehicles ?? [], next.vehicles ?? [], current.vehicles ?? []);
  return {
    ...next,
    zones: carryList(base.zones, next.zones, current.zones),
    facilities: carryList(base.facilities, next.facilities, current.facilities),
    routes: carryList(base.routes, next.routes, current.routes),
    nodes: carryList(base.nodes, next.nodes, current.nodes),
    workers: carryList(base.workers, next.workers, current.workers),
    annotations: carryList(base.annotations ?? [], next.annotations ?? [], current.annotations ?? []),
    measurements: carryList(base.measurements ?? [], next.measurements ?? [], current.measurements ?? []),
    // 车辆按契约是可选集合：缺省 = 没有车，读取层不合成空数组、不落盘。
    // 因此只有真存在车（提案里有，或用户新画了）时才写回该键；旧 plan 应用提案后仍不带 vehicles 字段。
    ...(next.vehicles !== undefined || vehicles.length > 0 ? { vehicles } : {}),
  };
}

export function useOutdoorAgentWorkflow(input: {
  scope: string;
  bridge: () => OutdoorAgentBridge | null;
  controller: () => BackendSession | null;
  begin: () => number;
  current: (epoch: number) => boolean;
  status: (task: OutdoorTaskProgress) => void;
  say: (text: string, clarification?: boolean) => void;
  search: (query: string) => void;
  provider?: () => ChatProviderId | undefined;
  model?: () => string | null;
  simulate?: (active: boolean) => boolean;
  supervision?: () => SupervisionLevel | undefined;
}) {
  // 当前方案版本：刷新恢复时用它判登录等待/未确认边界是否过期。
  // 注意：首次 render 时 callbacks ref 还没建，只能先用入参 bridge；后续（换活动）再用 ref 里的最新回调。
  const planVersionFrom = (bridge: () => OutdoorAgentBridge | null) => {
    const plan = bridge()?.getPlan();
    return plan ? planVersion(plan) : null;
  };
  const currentPlanVersion = () => planVersionFrom(() => callbacks.current.bridge());
  const [state, setState] = useState(() => readState(input.scope, planVersionFrom(input.bridge)));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [proposal, setProposal] = useState<OutdoorWorkflowProposal | null>(
    null,
  );
  const [appliedHighlight, setAppliedHighlight] = useState<OutdoorMapEditHighlight | null>(null);
  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;
  const [cardRecords, setCardRecords] = useState<OutdoorCardRecord[]>(() =>
    readCardRecords(cardHistoryKey()),
  );
  /**
   * 2026-11-17：历史跟随后端活动身份——一旦这份活动拿到了 `remoteActivityId`，
   * 就按它当 key 读写，换设备才读得到；还没同步时退回本机 scope。
   */
  function cardHistoryKey(): string {
    try {
      return readOutdoorProjectRecord(input.scope)?.remoteActivityId ?? input.scope;
    } catch {
      return input.scope;
    }
  }
  const cardRecordsRef = useRef(cardRecords);
  cardRecordsRef.current = cardRecords;
  // 2026-11-17：后端副本仅在访问到账号时补一次（换设备/清缓存后靠它把历史接回来）。
  useEffect(() => {
    const scope = cardHistoryKey();
    let cancelled = false;
    void loadRemoteCardHistory(callbacks.current.controller(), scope).then((remote) => {
      if (cancelled || !remote.length || scope !== stateRef.current.scope) return;
      const merged = mergeCardHistory(
        cardRecordsRef.current,
        remote,
      ) as OutdoorCardRecord[];
      if (merged.length === cardRecordsRef.current.length) return;
      cardRecordsRef.current = merged;
      setCardRecords(merged);
      writeCardRecords(scope, merged);
    });
    return () => {
      cancelled = true;
    };
  }, [input.scope]);
  /** 一张卡收场时留痕：确认、撤回、被新提案顶掉都算。 */
  function recordCard(
    target: OutdoorWorkflowProposal,
    decision: OutdoorCardRecord["decision"],
  ) {
    const scope = cardHistoryKey();
    const entry: OutdoorCardRecord = {
      at: Date.now(),
      stage: stateRef.current.stage,
      kind: target.kind,
      title: target.label,
      decision,
      notes: [...target.warnings],
      actions: cardActionsFor(target.kind),
    };
    const next = [...cardRecordsRef.current, entry].slice(-OUTDOOR_CARD_RECORDS_LIMIT);
    cardRecordsRef.current = next;
    setCardRecords(next);
    writeCardRecords(scope, next);
    // 后端副本：未登录 / 离线 / 服务未部署都只是少一份副本，不拦本机记录。
    void pushRemoteCardHistory(callbacks.current.controller(), scope, next);
  }
  const [models, setModels] = useState<{
    facilityId: string;
    choices: OutdoorModelChoice[];
    base: string;
  } | null>(null);
  const [libraryChoices, setLibraryChoices] = useState<OutdoorLibraryItem[]>(
    [],
  );
  const [selectedLibraryId, setSelectedLibraryId] = useState<
    string | undefined
  >();
  const [busy, setBusy] = useState(false);
  const [simulating, setSimulating] = useState(false);
  /**
   * 2026-11-18 用户实测：进入手画模式后任务卡还挂着旧引导（「先说用途或手画」+手画按钮），
   * 与通知条自相矛盾，「收起」也和内容脱节。这里记录当前绘制模式，卡上据此收掉旧内容，
   * 让通知条成为唯一指令。任意新回合、取消、切活动都会清掉。
   */
  const [drawingMode, setDrawingMode] = useState<"zone" | "route" | "node" | null>(null);
  /**
   * 2026-11-18 用户指令「随画随出卡」：zones 阶段（含手画中）把画布分区清单同步给任务卡，
   * 每闭合一个轮廓，卡下方就多一张分区卡。画布不对外发变更事件，沿用 scope 阶段
   * 「低频读一次 bridge 快照」的既有口径；内容不变时不 setState，避免轮询空转重渲染。
   */
  const [drawnZones, setDrawnZones] = useState<SitePlanData["zones"]>([]);
  /**
   * 2026-11-19 T1-d2：把画布上的**真实用地红线**同步给任务卡画轮廓。
   * 口径沿用分区清单：低频读 bridge 快照（800ms），只有合法闭合环才算数，
   * 内容不变不 setState。卡片不再画任何示意地图，没真实红线就只出一句状态。
   */
  const [boundaryRing, setBoundaryRing] = useState<PlanPoint[] | null>(null);
  /**
   * 2026-11-19 用户反馈「S8 无从下手」：精修卡的四颗动作全部作用于所选设施——没选中时
   * 挂着也只能报错。这里把画布当前选中的设施同步给卡：有选中才出动作组，没选中出引导句。
   * 画布不对外发变更事件，沿用分区清单的同款轮询口径。
   */
  const [selectedFacility, setSelectedFacility] = useState<{ id: string; name: string } | null>(
    null,
  );
  /**
   * 2026-11-20 P1：一版方案的结果摘要（推荐理由 / 实际容量 / 关键假设）+ 本次变化 + 撤销快照。
   * `undoBefore` 是「这次应用前」的完整 plan 快照：撤销时整份写回，对象与引用一起恢复，
   * 不靠逐条反推，也不依赖画布内部撤销栈的实现细节。
   */
  type DesignState = {
    title: string;
    summary: DesignSummary;
    state: "proposal" | "applied" | "reverted";
    change: PlanChangeSummary | null;
    undoBefore: SitePlanData | null;
    appliedVersion: string | null;
  };
  type DesignPending = {
    label: string;
    why: string;
    next: SitePlanData;
    before: SitePlanData;
    kind: "design" | "adjust" | "adopt" | "undo";
    summary?: DesignSummary;
    title?: string;
  };
  type DesignCompareCandidate = {
    id: "A" | "B";
    label: string;
    strategy: "ceremony-first" | "banquet-first";
    plan: SitePlanData;
    summary: DesignSummary;
    /** 与比较基线（当前画布）相比的变更项数；卡片直接显示，不自己重算。 */
    diff: { added: number; removed: number; changed: number };
    /** 这一版自己算出来的空间取舍（面积 / 席位 / 通道 / 路线交叉）；A/B 各用各的。 */
    tradeoffs: string[];
    /** 这一版自己的实算指标；用来判断两版到底差在哪，而不是只看文案。 */
    metrics: WeddingCandidateMetrics;
  };
  const [design, setDesign] = useState<DesignState | null>(null);
  /** 最近一次由 Agent 写入的改动快照；结果卡还没出现时（例如只位移了一组）也能撤销。 */
  const [lastEdit, setLastEdit] = useState<{ before: SitePlanData; label: string; appliedVersion: string } | null>(null);
  const [designPending, setDesignPending] = useState<DesignPending | null>(null);
  const [designCompare, setDesignCompare] = useState<{
    activeId: "A" | "B";
    candidates: DesignCompareCandidate[];
    base: string;
  } | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareNote, setCompareNote] = useState<string | null>(null);
  const [locateNote, setLocateNote] = useState<string | null>(null);
  /** 画布当前显式选中的对象 id（下一句的上下文）；`detached` = 用户主动清除了引用。 */
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [selectionDetached, setSelectionDetached] = useState(false);
  const selectionIdsRef = useRef<string[]>([]);
  /** 用户已经回答过「右＝屏幕还是场地东侧」；只记本会话，不写配置。 */
  const directionBasis = useRef<DirectionBasis | null>(null);
  /** 刚问过方向口径：只有这时才把「按东侧 / 按屏幕」当成回答，避免误吞地名。 */
  const basisAsked = useRef(false);
  /** 本轮婚礼布局的输入快照：比较另一版时按同一份边界/物料/禁区重算。 */
  const designInput = useRef<{
    plan: SitePlanData;
    brief: OutdoorBrief;
    library: OutdoorLibraryItem[];
    hardBlocks: PlanPoint[][];
    guests?: number;
  } | null>(null);
  /** 2026-11-18：scope 阶段画布上是否已有合法用地红线——卡片据此决定「直接给核对卡」还是「教怎么画」。 */
  const [boundaryReady, setBoundaryReady] = useState(false);
  /** 已经自动签发过确认预览的那份边界；同一份边界撤回后不再自动弹回。 */
  const autoScopeSig = useRef<string | null>(null);
  const [notice, setNotice] = useState("");
  const [designSteps, setDesignSteps] = useState<string[]>([]);
  /** 2026-11-17：画布规模并进思考卡摘要（一行），不再作为一条步骤占一行。 */
  const [canvasNote, setCanvasNote] = useState<string | null>(null);
  const [thought, setThought] = useState<string | null>(null);
  const [awaitingThought, setAwaitingThought] = useState(false);
  const [thoughtDraft, setThoughtDraft] = useState("");
  const [thoughtMs, setThoughtMs] = useState<number | null>(null);
  const [thoughtRequest, setThoughtRequest] = useState<string | null>(null);
  type PendingPlan = {
    steps: readonly string[];
    turn: OutdoorTurn;
    message: string;
    base: string;
    selected: string;
    documents: AgentDocument[];
    imageCount: number;
    job: { epoch: number; controller: AbortController; scope: string; actorId?: string | null };
  };
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const pendingPlanRef = useRef<PendingPlan | null>(null);
  function updatePendingPlan(plan: PendingPlan | null) {
    pendingPlanRef.current = plan;
    setPendingPlan(plan);
  }
  const [noticeKind, setNoticeKind] = useState<"info" | "error">("info");
  /**
   * 2026-11-16 用户拍板：要你动手的提示（反问补充/待确认/需要补充）不许倒计时自己消失——
   * 线上实测就是提示 8s 收起后卡片回落成「自动为你框选」，看起来像一点没动。
   */
  const [noticeSticky, setNoticeSticky] = useState(false);
  /**
   * 本轮结构化地图依据没取全（服务端地图 503/failed 时 status 不是 ready）：
   * place 阶段就不能再承诺「自动为你框选」。
   */
  const [mapGap, setMapGap] = useState(false);
  const [noticeView, setNoticeView] = useState<AgentErrorView | null>(null);
  /** 红卡上的「下一步」（缺前置条件时替代无意义的「重试」）；null = 走原有的重试口径。 */
  const [noticeFix, setNoticeFix] = useState<OutdoorNoticeFix | null>(null);
  const refsRef = useRef<OutdoorTurn["references"]>([]);
  const lastRequestRef=useRef<{scope:string;ownerId:string|null;message:string;clarification:OutdoorClarification|undefined;images:string[];documents:AgentDocument[]}|null>(null);
  const lastActionRef=useRef<{scope:string;ownerId:string|null;args:Parameters<typeof action>}|null>(null);
  const supervisionLevel = useAgentSupervision();
  const currentSupervision = () => callbacks.current.supervision?.() ?? getAgentSupervision();
  function currentActorId():string|null {
    const viewer=callbacks.current.controller()?.getSnapshot?.().user;
    return viewer&&!viewer.is_anonymous?viewer.id:null;
  }
  /**
   * 2026-11-17：用户刚刚从上一轮二选一里挑了第 N 项（原请求 + 选中的分支）。
   * 只在同一轮内有效：模型如果又把同一句追问端回来，靠它本地接着走，而不是把问题重复一遍。
   */
  const pendingChoiceRef = useRef<{ request: string; chosen: { index: number; text: string } } | null>(null);
  const mapRef = useRef<OutdoorMapContext>(unknownMap);
  const abort = useRef<AbortController | null>(null);
  // M7.1：一轮对话的轨迹与指标（只打日志与记簿，不影响界面与请求）。
  const metricsBook = useRef(createMetricsBook());
  const traceBook = useRef(createTurnTraceBook());
  /** 走查记录本：本轮页面里逐条标，标完直接进状态卡（同时落盘，刷新后不丢）。 */
  const walkthroughBook = useRef(loadBook());
  /** 云端真跑过的用例号：只能人显式声明，永远不从浏览器结果推。 */
  const cloudPass = useRef<number[]>(loadCloud());
  const liveTurn = useRef(createLiveTurn({ book: metricsBook.current, traceBook: traceBook.current }));
  const token = useRef<number | null>(null);
  const scopeRef = useRef(input.scope);
  scopeRef.current = input.scope;
  const callbacks = useRef(input);
  callbacks.current = input;
  function persist(next: OutdoorFlowState) {
    stateRef.current = next;
    setState(next);
    try {
      localStorage.setItem(
        `scendance:outdoor-flow:${next.scope}`,
        JSON.stringify(next),
      );
    } catch {
      setNotice(
        "工作流上下文暂未存下；规划本身不清除，刷新后会重新核对活动范围。",
      );
    }
  }
  function status(
    action: string,
    phase: OutdoorTaskProgress["state"] = "ready",
    extra: Partial<OutdoorTaskProgress> & { fix?: OutdoorNoticeFix | null } = {},
  ) {
    // fix 只给卡片用，不进 task progress（它不属于任务进度字段）。
    const { fix, ...rest } = extra;
    const friendly = friendlyErrorNotice(action);
    setNotice(friendly);
    setNoticeView(null);
    setNoticeFix(fix ?? null);
    setNoticeKind(phase === "blocked" ? "error" : "info");
    setNoticeSticky(phase === "ask" || phase === "blocked" || phase === "confirm");
    callbacks.current.status({
      intent: OUTDOOR_STAGE_LABELS[stateRef.current.stage],
      state: phase,
      action: friendly,
      steps: stateRef.current.completed.map((s) => OUTDOOR_STAGE_LABELS[s]),
      ...rest,
    });
  }
  function designStep(text: string) {
    setDesignSteps(steps => steps.at(-1) === text ? steps : [...steps.slice(-9), text]);
  }
  function start(continueDesign = false) {
    if (!continueDesign) {
      setDesignSteps([]);
      setCanvasNote(null);
      setThought(null);
      setThoughtMs(null);
      setThoughtRequest(null);
    }
    updatePendingPlan(null);
    setAwaitingThought(false);
    setThoughtDraft("");
    setAppliedHighlight(null);
    setSimulating(false);
    refsRef.current = [];
    abort.current?.abort();
    const epoch = callbacks.current.begin();
    liveTurn.current.begin("scene");
    token.current = epoch;
    const controller = new AbortController();
    abort.current = controller;
    setProposal(null);
    proposalRef.current = null;
    setModels(null);
    setBusy(true);
    return { epoch, controller, scope: scopeRef.current, actorId: currentActorId() };
  }
  function live(job: {
    epoch: number;
    controller: AbortController;
    scope: string;
    actorId?: string | null;
  }) {
    return (
      token.current === job.epoch &&
      !job.controller.signal.aborted &&
      scopeRef.current === job.scope &&
      (job.actorId === undefined || job.actorId === (currentActorId())) &&
      callbacks.current.current(job.epoch)
    );
  }
  function cancel(options?: { preservePendingLogin?: boolean }) {
    const withdrawnCard = proposalRef.current;
    setDesignSteps([]);
    setDrawingMode(null);
    setCanvasNote(null);
    updatePendingPlan(null);
    setAwaitingThought(false);
    setThoughtDraft("");
    setAppliedHighlight(null);
    if (simulating) callbacks.current.simulate?.(false);
    setSimulating(false);
    abort.current?.abort();
    // 2026-11-18：撤回预览 / 改手画后，同一份红线不再自动弹回确认卡（重画边界才会重新签）。
    const liveBridge = callbacks.current.bridge();
    const livePlan = liveBridge?.getPlan();
    const visible = liveBridge?.visibleActivityRange?.();
    autoScopeSig.current = visible && checkBoundaryRing(visible.boundary).ok
      ? JSON.stringify({ anchor: visible.anchor, boundary: visible.boundary })
      : livePlan ? JSON.stringify({ anchor: livePlan.anchor, boundary: livePlan.boundary }) : null;
    callbacks.current.begin(); // Invalidate the shared outer task epoch as well as this hook.
    token.current = null;
    proposalRef.current = null;
    setProposal(null);
    setModels(null);
    setBusy(false);
    if (withdrawnCard) recordCard(withdrawnCard, "withdrawn");
    if (!options?.preservePendingLogin) {
      const { pendingLogin: _pendingLogin, ...kept } = stateRef.current;
      persist({ ...kept, pendingBoundary: undefined });
    }
    liveTurn.current.settle("cancelled");
    status("已取消当前预览/请求；已应用的规划与需求都保留。", "stopped");
  }
  const sessionController=input.controller();
  useEffect(()=>{
    const readOwner=()=>{const viewer=sessionController?.getSnapshot?.().user;return viewer&&!viewer.is_anonymous?viewer.id:null;};
    let owner=readOwner();
    return sessionController?.subscribe?.(()=>{
      const next=readOwner();
      if(next===owner)return;
      const previous=owner;owner=next;
      const pending=stateRef.current.pendingLogin;
      const keepLogin=!!pending&&(next===null||!pending.ownerId||pending.ownerId===next)&&(previous===null||next===null);
      cancel({preservePendingLogin:keepLogin});
      if(!keepLogin)lastRequestRef.current=null;
      lastActionRef.current=null;
      status(keepLogin?'登录状态已变化，将按原账号与场地版本核对待续请求。':'账号已变化，已停止原账号请求并收回候选；现有规划保留。','blocked');
    });
  },[sessionController,input.scope]);
  useEffect(() => {
    setDesignSteps([]);
    setDrawingMode(null);
    setThought(null);
    setThoughtMs(null);
    setThoughtRequest(null);
    updatePendingPlan(null);
    setAwaitingThought(false);
    setThoughtDraft("");
    setAppliedHighlight(null);
    abort.current?.abort();
    token.current = null;
    setProposal(null);
    proposalRef.current = null;
    setModels(null);
    setLibraryChoices([]);
    setSelectedLibraryId(undefined);
    setBusy(false);
    setSimulating(false);
    const next = readState(input.scope, currentPlanVersion());
    const localCards = readCardRecords(cardHistoryKey());
    cardRecordsRef.current = localCards;
    setCardRecords(localCards);
    stateRef.current = next;
    setState(next);
  }, [input.scope]);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  function nextStage(stage: OutdoorStage) {
    // 2026-11-21 恢复被 950c6dd8 误删的阶段推进：这个函数的本意是「标记本阶段完成并进入下一阶段」，
    // 11-19 那次提交把 `stages[i + 1]` 改成了原地不动，范围确认完任务卡还停在「核对具体活动范围」，
    // 于是同一份红线被反复要求确认（用户实测「更早的引导·8」）。按创建时的语义恢复。
    const i = stages.indexOf(stage);
    const completed = [...new Set([...stateRef.current.completed, stage])];
    persist({
      ...stateRef.current,
      completed,
      stage: stages[Math.min(stages.length - 1, i + 1)]!,
    });
  }
  function requireScope(plan: SitePlanData): boolean {
    if (stateRef.current.confirmedBoundary === boundaryKey(plan)) return true;
    if (currentSupervision() !== "strict" && checkBoundaryRing(plan.boundary).ok && !stateRef.current.pendingBoundary) {
      persist({ ...stateRef.current, confirmedBoundary: boundaryKey(plan) });
      return true;
    }
    persist({
      ...stateRef.current,
      stage: "scope",
      confirmedBoundary: null,
      completed: stateRef.current.completed.filter((s) => s === "place"),
    });
    return false;
  }
  /**
   * 2026-11-18 用户实测：画布上已有画好的红线（甚至已确认），进页任务卡却默认停在
   * 「搜索目标地点」——流程草稿里没有这份事实，阶段就和画布脱节了。这里对账：
   * 画布上有合法闭合边界时，阶段不退回 place，未确认的推到 scope 等确认卡。
   * 只对账，不发言不发请求；在画布 bridge 注册时调用（进页/切活动都会重新注册）。
   */
  function reconcileCanvasStage() {
    const plan = callbacks.current.bridge()?.getPlan();
    if (!plan || !checkBoundaryRing(plan.boundary).ok) return;
    if (stateRef.current.stage !== "place") return;
    persist({ ...stateRef.current, stage: "scope" });
  }
  /**
   * 2026-11-18 用户拍板：场地已经有用地红线时，任务卡就该直接是「待你核对」这张，
   * 不该让人先点一次「确认活动范围」才看到它；只有场地还没有红线时，才给画红线的引导卡。
   * 画布不对外发变更事件，所以 scope 阶段低频读一次 bridge 快照：红线一闭合就签发确认预览。
   * 同一份边界只自动签一次——用户点了「撤回预览」不会立刻又被弹回来；重画边界才会重新签。
   */
  useEffect(() => {
    if ((state.stage !== "scope" && state.stage !== "place") || proposal || busy || drawingMode) {
      setBoundaryReady(false);
      return undefined;
    }
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const bridge = callbacks.current.bridge();
      const planNow = bridge?.getPlan() ?? null;
      const visible = bridge?.visibleActivityRange?.() ?? null;
      const visibleReady = !!visible && checkBoundaryRing(visible.boundary).ok;
      const ready = !!planNow && (visibleReady || (stateRef.current.stage === "scope" && checkBoundaryRing(planNow.boundary).ok));
      setBoundaryReady(ready);
      if (!ready || !planNow) return;
      const sig = JSON.stringify({ anchor: visibleReady ? visible.anchor : planNow.anchor,
        boundary: visibleReady ? visible.boundary : planNow.boundary });
      if (autoScopeSig.current === sig) return;
      autoScopeSig.current = sig;
      // 搜索范围只是候选：进入同一份确认卡，用户确认前不写入 plan.boundary。
      if (visibleReady) {
        offerBoundary(visible.anchor, visible.boundary, visible.name.trim() || "当前地图范围");
        return;
      }
      if (currentSupervision() !== "strict" && !stateRef.current.pendingBoundary) {
        persist({ ...stateRef.current, stage: "objects", confirmedBoundary: boundaryKey(planNow) });
        return;
      }
      const job = start();
      persist({ ...stateRef.current, stage: "scope" });
      offer(planNow, "scope", "确认当前活动范围", job, [
        "红线圈住的就是这次活动实际用的那片地；确认后分区、流线、物件都按这片范围排。",
      ]);
      setBusy(false);
    };
    tick();
    const timer = setInterval(tick, 800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [state.stage, proposal, busy, drawingMode, supervisionLevel]);

  // 2026-11-19 T1-d2：真实用地红线同步（任务卡画真轮廓用，不再画示意地图）。
  // 与分区清单同口径：800ms 读一次 bridge 快照，只有合法闭合环才交给卡；不变不重渲染。
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const ring = callbacks.current.bridge()?.getPlan()?.boundary ?? null;
      const valid = ring && checkBoundaryRing(ring).ok ? ring : null;
      setBoundaryRing(current => (JSON.stringify(current) === JSON.stringify(valid) ? current : valid));
    };
    tick();
    const timer = setInterval(tick, 800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  // 2026-11-18 用户指令「随画随出卡」：zones 阶段（含手画中）把画布分区清单同步给任务卡，
  // 与上面 scope 阶段的边界轮询同口径。内容不变时不 setState，避免轮询空转重渲染。
  useEffect(() => {
    if (state.stage !== "zones" && drawingMode !== "zone") {
      setDrawnZones(current => (current.length ? [] : current));
      return undefined;
    }
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const zonesNow = callbacks.current.bridge()?.getPlan()?.zones ?? [];
      setDrawnZones(current =>
        JSON.stringify(current) === JSON.stringify(zonesNow) ? current : zonesNow,
      );
    };
    tick();
    const timer = setInterval(tick, 800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [state.stage, drawingMode]);

  // 2026-11-19 用户反馈：精修阶段的卡要知道画布上有没有选中设施——没选中就出引导句，不空挂四颗按钮。
  useEffect(() => {
    if (state.stage !== "refine-3d") {
      setSelectedFacility(null);
      return undefined;
    }
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const bridge = callbacks.current.bridge();
      const plan = bridge?.getPlan();
      const selected = bridge?.selectedIds?.() ?? [];
      const hit = plan?.facilities.find(
        (f) => selected.includes(f.id),
      );
      const next = hit ? { id: hit.id, name: hit.name } : null;
      setSelectedFacility(current =>
        current?.id === next?.id && current?.name === next?.name ? current : next,
      );
    };
    tick();
    const timer = setInterval(tick, 800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [state.stage]);

  // 2026-11-20 P1：画布选中即「下一句的对象」。同一条低频快照口径（800ms），
  // 选中变化时把用户之前「清除引用」的标记复位——重新点选就是重新带上。
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const ids = callbacks.current.bridge()?.selectedIds?.() ?? [];
      if (ids.join("|") === selectionIdsRef.current.join("|")) return;
      selectionIdsRef.current = ids;
      setSelectionIds(ids);
      setSelectionDetached(false);
    };
    tick();
    const timer = setInterval(tick, 800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  async function mapContext(signal: AbortSignal) {
    const bridge = callbacks.current.bridge();
    const map = bridge?.mapContext
      ? await bridge.mapContext(signal)
      : unknownMap;
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    mapRef.current = map;
    return map;
  }
  function offer(
    next: SitePlanData,
    kind: OutdoorWorkflowProposal["kind"],
    label: string,
    job: { epoch: number; controller: AbortController; scope: string; actorId?: string | null },
    warnings: string[] = [],
    afterConfirm?: OutdoorWorkflowProposal["afterConfirm"],
    afterConfirmRequest?: OutdoorWorkflowProposal["afterConfirmRequest"],
  preserveOriginal = false,
  directApply = false,
  requestText?: string,
): void | Promise<void> {
  // 有了一版可看的预览就不再记账：追问预算只数“毫无进展”的那几轮。
  askStreakRef.current = 0;
  const base = callbacks.current.bridge()?.getPlan();
  if (!base || !live(job)) return;
  try {
    validateWorkflowPlan(base, next);
  } catch (error) {
    // 预览生成即被几何闸门拦下（如分区越出）：有用户原话就留一行失败留痕，再原样抛给任务卡。
    if (requestText?.trim()) recordConversationTurn(callbacks.current.controller() as unknown as ConversationTraceTransport | null, {
      turnKey: conversationTurnKey(), sessionId: getActiveAssistantSessionId(input.scope) ?? 'unknown', turnIndex: 0,
      surface: 'assistant', userText: requestText.trim(),
      assistantText: error instanceof Error ? error.message : '几何闸门未通过，未生成预览。',
      outcome: 'failed', errorCode: 'PREVIEW_BLOCKED',
    });
    throw error;
  }
    // 地图证据类警告（"证据没取到"）只在真靠证据做判断的阶段给：scope 阶段边界还没定，
    // 证据必然对不上，摆上去就是噪声。validateMapPlan 该 throw 的阻断一如既往保留。
    const mapWarnings = callbacks.current.bridge()?.validateMapPlan?.(base, next) ?? [];
    warnings = [
      ...warnings,
      ...proposalMapWarnings(kind, mapWarnings),
    ];
    const risk = outdoorActionRisk(base, next, label);
    const gate = gateAction(currentSupervision(), risk);
    // 2026-11-21 用户实测：画布上已有同一条红线时，任务卡「确认活动范围」点完还会弹一张
    // 「确认并应用这一版」，两击确认的是同一份数据（核对阶段对有效红线就是原样重发一份提案）。
    // 提案与画布完全一致且监督档不另要求复核时不再立检查点，点一下就落地推进；
    // 边界/锚点真变了（搜索候选、手画重画、按尺寸改线）或监督档要求时，照常停在预览卡上。
    const unchangedScope = kind === "scope" && !afterConfirmRequest && JSON.stringify(next) === JSON.stringify(base);
    // 2026-11-21 用户拍板「候选点选直接落地」：候选是用户刚亲手选的，锚定写入不再单独立核对卡；
    // 严格档仍由 gate 拦下核对。
    const pickedScope = kind === "scope" && directApply && !afterConfirmRequest;
    const checkpoint = ((kind === 'scope' && !afterConfirmRequest) || kind === 'verify-access' || !!objectsLayoutRef.current?.packed) && !unchangedScope && !pickedScope;
    const approvalReason = gate.required ? gate.why : checkpoint
      ? kind === 'verify-access' ? '真实出入口的通行状态需要你核对。' : kind === 'scope' ? '请核对本次活动要使用的场地范围。' : '这版采用了压缩通道的摆放方式，需要核对。'
      : '';
  const p = {
    kind,
    label,
    base: JSON.stringify(base),
    mapVersion: kind === "scope" ? "map:unavailable" : mapRef.current.version,
    epoch: job.epoch,
    next,
    warnings,
    references: [...refsRef.current],
    preserveOriginal: preserveOriginal || risk.kind === 'destructive',
    approvalReason,
    actorId: job.actorId??null,
    ...(requestText?.trim() ? { requestText: requestText.trim() } : {}),
    ...(afterConfirm ? { afterConfirm } : {}),
    ...(afterConfirmRequest ? { afterConfirmRequest } : {}),
  };
    const replaced = proposalRef.current;
    if (replaced && replaced.base !== p.base) recordCard(replaced, "replaced");
    proposalRef.current = p;
    setProposal(p);
    if (kind === "scope" && next.anchor) {
      callbacks.current.bridge()?.previewBoundary?.(next.anchor, next.boundary);
    }
    if (kind === "zones" || kind === "main-routes" || kind === "objects") {
      // 「等待核对」由下面 status 的提示条说，运行卡只记事实，避免同一句在两个表面重复。
      designStep(`已生成「${label}」预览。`);
    }
    status(`${label}预览已就绪；核对后确认才写入，可整批撤销。`, "confirm");
    liveTurn.current.markPreview();
    liveTurn.current.log();
    if (!checkpoint && !gate.required) {
      // 直接落地没有核对卡：范围类的提醒（如超界淘汰）改走设计过程留痕，不静默丢。
      if (kind === "scope") for (const w of warnings) designStep(w);
      // unchangedScope/pickedScope 都是「用户刚亲手确认」的落地，不是监督档代跑：按手动确认走收尾文案，
      // 不多念「已按监督档自动执行」。
      return confirm(p, !(unchangedScope || pickedScope));
    }
  }
  async function confirm(expected?: OutdoorWorkflowProposal, automatic = false) {
    liveTurn.current.markConfirm();
    if (expected && proposalRef.current !== expected) {
      status("这张确认卡已过期，未应用其他任务的提案。", "blocked");
      return;
    }
    let p = proposalRef.current,
      bridge = callbacks.current.bridge(),
      plan = bridge?.getPlan();
    if (
      !p ||
      !plan ||
      !callbacks.current.current(p.epoch)
    ) {
      proposalRef.current = null;
      setProposal(null);
      status("当前规划已变化，旧提案已失效；请基于最新场地重算。", "blocked");
      return;
    }
    // 2026-11-16 用户生产实测：点「确认并应用这一版」后界面毫无反应（地图核对与写盘都是异步的，
    // 期间没有一个字反馈）。一点就先给可见状态，避免被当成没点上而重复点。
    status(`正在应用「${p.label}」…`, "working");
    // 2026-11-14 用户实测：提案基座拍快照之后用户新画的实体（如室内分区）不该让提案整张失效，
    // 也不该在应用时被基座快照冲掉——「纯新增」放行并把新增实体并回提案（一条 undo）；
    // 基座实体被删改、或边界/锚点等非实体字段变了仍然失效（防静默丢失用户内容）。
    let baseObj = JSON.parse(p.base) as SitePlanData;
    const expire = () => {
      proposalRef.current = null;
      setProposal(null);
      status("当前规划已变化，旧提案已失效；请基于最新场地重算。", "blocked");
    };
    if (!baseStillIntact(baseObj, plan)) {
      // 2026-11-17 玉泉鱼跃实测卡点：scope 提案（确认活动范围）只锁「边界+锚点」，不锁实体快照。
      // 预览期间用户用画布工具改实体（一键收进红线、拖顶点、增删物件）不作废确认卡——
      // 那些是用户自己的操作，确认时按此刻画布重新按边界安置即可；边界/锚点变了才失效。
      if (p.kind !== "scope" || boundaryKey(plan) !== boundaryKey(baseObj)) {
        expire();
        return;
      }
      baseObj = plan;
      p = { ...p, next: prunePlanForBoundary(plan, plan.boundary, plan.anchor ?? undefined).next };
      proposalRef.current = p;
      setProposal(p);
    }
    /** 按「最新画布」把新增实体并回提案；await 期间画布若再变，重新判定再合并。 */
    const mergeLatest = (current: SitePlanData): boolean => {
      if (!baseStillIntact(baseObj, current)) {
        expire();
        return false;
      }
      const carried = carryNewEntities(baseObj, p!.next, current);
      if (JSON.stringify(carried) !== JSON.stringify(p!.next)) {
        p = { ...p!, next: carried };
        proposalRef.current = p;
        setProposal(p);
      }
      return true;
    };
    if (!mergeLatest(plan)) return;
    const check = abort.current;
    const confirmationScope = scopeRef.current;
    const owns = () =>
      Boolean(
        check &&
          !check.signal.aborted &&
          abort.current === check &&
          token.current === p!.epoch &&
          proposalRef.current === p &&
          scopeRef.current === confirmationScope &&
          (p!.actorId === undefined || p!.actorId === (currentActorId())) &&
          callbacks.current.current(p!.epoch),
      );
    if (!owns()) return;
    // Re-read map version before accepting any proposal that relied on map context.
    if (bridge?.mapContext && p.mapVersion !== "map:unavailable") {
      let map: OutdoorMapContext;
      try {
        map = await bridge.mapContext(check!.signal);
      } catch (error) {
        if (!owns()) return;
        liveTurn.current.settle("failed");
        status(
          error instanceof Error
            ? error.message
            : "当前地图依据无法核对，未应用。",
          "blocked",
        );
        return;
      }
      if (!owns()) return;
      if (
        p.mapVersion !== map.version ||
        !baseStillIntact(baseObj, bridge.getPlan() ?? plan)
      ) {
        setProposal(null);
        proposalRef.current = null;
        status("地图或规划依据已更新，旧提案已失效，请重新生成。", "blocked");
        return;
      }
    }
    if (
      p.references.length &&
      bridge?.validateCurrentReferences &&
      !bridge.validateCurrentReferences(p.references)
    ) {
      setProposal(null);
      proposalRef.current = null;
      status("当前对象引用已失效，请重新核对；未修改规划。", "blocked");
      return;
    }
    designStep(`正在把「${p.label}」写入画布…`);
    try {
      validateWorkflowPlan(plan, p.next);
      bridge?.validateMapPlan?.(plan, p.next);
    } catch (error) {
      setProposal(null);
      proposalRef.current = null;
      const reason = error instanceof Error ? error.message : "当前几何依据无法核对，未应用。";
      // 应用阶段失败也留痕：设计轮已 answered，另起一行记失败与卡片原话（新 turnKey，不覆盖已答复行）。
      if (p.requestText?.trim()) recordConversationTurn(callbacks.current.controller() as unknown as ConversationTraceTransport | null, {
        turnKey: conversationTurnKey(), sessionId: getActiveAssistantSessionId(input.scope) ?? 'unknown', turnIndex: 0,
        surface: 'assistant', userText: p.requestText.trim(), assistantText: reason,
        outcome: 'failed', errorCode: 'APPLY_BLOCKED',
      });
      status(reason, "blocked");
      return;
    }
    if (!owns()) return;
    const applyBase = bridge?.getPlan();
    // 应用前按最新画布再并一次：新增实体已带进 p.next，所以应用基准就是当前画布（仍是同一条 undo）。
    if (!applyBase) {
      status("画布当前不可用，未应用；原规划保留。", "blocked");
      return;
    }
    if (!mergeLatest(applyBase)) return; // 基座已被改：mergeLatest 内部已给出失效提示
    if(automatic){
      const latestGate=gateAction(currentSupervision(),outdoorActionRisk(applyBase,p.next,p.label));
      if(latestGate.required){
        p={...p,approvalReason:latestGate.why};proposalRef.current=p;setProposal(p);
        status(latestGate.why,'confirm');return;
      }
    }
    let recoveryProjectId: string | undefined;
    if(p.preserveOriginal){
      recoveryProjectId=`agent-before-${crypto.randomUUID()}`;
      const now=new Date().toISOString();
      saveOutdoorProjectRecord({v:1,projectId:recoveryProjectId,name:`${p.label}前方案`,createdAt:now,updatedAt:now,plan:applyBase},undefined,false);
      if(!readOutdoorProjectRecord(recoveryProjectId)?.plan){
        status('原方案恢复副本未能保存，新方案未应用；请释放本机存储空间后重试。','blocked');return;
      }
    }
    if (!bridge?.applyPlan?.(p.next, JSON.stringify(applyBase))) {
      status("画布当前不可写或保存身份变化，未应用；原规划保留。", "blocked");
      return;
    }
    setAppliedHighlight(mapEditHighlight(p.kind, applyBase, p.next));
    liveTurn.current.markApplied();
    // 2026-11-20 P1：婚礼联合布置/候选采用落到画布后，结果卡切到「已应用 + 本次变化 + 可撤销」。
    // 快照就是这次的 applyBase，整份写回即可完整撤销对象与引用。
    if (p.label.startsWith("婚礼联合布置") || p.label.startsWith("采用「")) {
      const appliedPlan = p.next;
      const designChange = describePlanChange(diffPlanObjects(applyBase, appliedPlan), appliedPlan);
      setDesign((prev) =>
        prev
          ? { ...prev, state: "applied", change: designChange, undoBefore: applyBase, appliedVersion: planVersion(appliedPlan) }
          : prev,
      );
    }
    if(automatic){p.warnings=[...p.warnings,`已按${currentSupervision()}监督档自动执行；改动可撤销。`];designStep('已按监督设置自动应用这一版，可整批撤销。');}
    if(recoveryProjectId)callbacks.current.say(`已保留优化前的完整本机方案：[打开原方案](?project=${encodeURIComponent(recoveryProjectId)}&mode=outdoor)。当前优化也可整批撤销。`);
    liveTurn.current.log();
    recordCard(p, "confirmed");
    proposalRef.current = null;
    setProposal(null);
    if (p.kind === "scope") {
      persist({ ...stateRef.current, confirmedBoundary: boundaryKey(p.next), pendingBoundary: undefined });
      setMapGap(false);
      nextStage("scope");
    } else if (p.kind === "verify-access") {
      // 2026-11-21 恢复被 950c6dd8 一并简化掉的深阶段保护：入口核对发生在物件/人员等后段时，
      // 任务卡不该被拽回「摆放物料」（创建时的原语义）。
      persist({
        ...stateRef.current,
        stage: ["sub-routes", "people", "refine-3d"].includes(stateRef.current.stage)
          ? stateRef.current.stage
          : "objects",
      });
    } else if (p.kind === "style") {
      // Cosmetic only: do not advance or confirm any venue/layout stage.
    } else if (p.kind === "model") {
      persist({ ...stateRef.current, stage: "refine-3d" });
    } else if (p.kind === "objects") {
      // 2026-11-21 用户拍板：支线已并入路线预览，物件确认直接进「岗位、人数与活动路径」，
      // 不再单独停「子入口与支线」停靠卡（路线按需排，主通道+支线一次出齐）。
      const completed = [...new Set([...stateRef.current.completed, "objects" as const])];
      persist({ ...stateRef.current, completed, stage: "people" });
    } else nextStage(p.kind);
    const mapEditHint = MAP_EDIT_HINTS[p.kind];
    // 2026-11-17 断点修复：硬挤预览确认后，回话必须把「需求没变、画布已到物理上限」说清，
    // 不然下一轮用户看着 50 个摊以为自己要的 120 被悄悄改了。
    const packedNote =
      p.kind === "objects" && objectsLayoutRef.current?.packed
        ? "注意：这版是「硬挤」物理极限；你记的需求数量没变，画布已塞到上限，要宽松就减数量或扩分区。"
        : "";
    status(
      mapEditHint
        ? `已应用「${p.label}」。${mapEditHint}`
        : `已应用「${p.label}」，可以继续调整或撤销。${packedNote}`,
      "done",
    );
    if (p.kind === "zones" || p.kind === "main-routes" || p.kind === "objects") {
      designStep(`已确认并应用「${p.label}」。`);
    }
    if (p.afterConfirmRequest) {
      const request=p.afterConfirmRequest;
      await act(request.turn,request.message,true,request.documents,request.imageCount);
    } else if (p.afterConfirm) {
      await act({ action: p.afterConfirm, reply: "", references: [], facts: {} }, "", true);
    }
  }
  function offerBoundary(
    anchor: NonNullable<SitePlanData["anchor"]>,
    boundary: SitePlanData["boundary"],
    name: string,
    basis?: VenueRangeBasis,
    continuation?: OutdoorWorkflowProposal["afterConfirmRequest"],
    directApply = false,
  ): void | Promise<void> {
    const base = callbacks.current.bridge()?.getPlan();
    if (!base) return;
    const job = start();
    persist({
      ...stateRef.current,
      stage: "scope",
      confirmedBoundary: null,
      completed: ["place"],
      pendingBoundary: { anchor, boundary, name, base: JSON.stringify(base), ...(basis ? { basis } : {}) },
      ...(basis ? { rangeBasis: basis } : {}),
    });
    try {
      // 2026-11-14 用户拍板「以第一个选区为准」：换边界时旧内容按新边界重新安置（越界随场淘汰，
      // 整批可撤销），不再让「分区越出已确认活动边界」把换场卡死；锚点位移则旧场内容整体清空。
      const pruned = prunePlanForBoundary(base, boundary, anchor);
      const dropped = [
        pruned.droppedZones.length ? `分区 ${pruned.droppedZones.join("、")}` : "",
        pruned.droppedFacilities.length ? `物件 ${pruned.droppedFacilities.join("、")}` : "",
        pruned.droppedRoutes.length ? `流线 ${pruned.droppedRoutes.join("、")}` : "",
      ].filter(Boolean);
      const completion = offer(
        // 2026-11-17 「同一标准」：范围确认卡是一个自带红线的方案，落地后必须配白框——
        // 预览与确认走同一份数据，不靠画布那边事后补（那条路留给手画红线和换场地）。
        // 2026-11-20 用户拍板：范围依据是内部口径，不往画布上贴说明注记（此前那条 note 会压在地图正中）。
        // 旧方案里若已经带了这条注记，这次提交顺手清掉，不再原样带回。
        { ...pruned.next, anchor, boundary, designScope: expandRect(boundary, DEFAULT_SCOPE_MARGIN_M),
          ...(pruned.next.annotations?.some(note => note.name === AGENT_RANGE_BASIS_NOTE)
            ? { annotations: pruned.next.annotations.filter(note => note.name !== AGENT_RANGE_BASIS_NOTE) }
            : {}) },
        "scope",
        `确认“${name}”的活动范围`,
        job,
        [
          // 2026-11-20 用户拍板：范围来源、可用聊天缩小这类交代全部不再进卡；卡上只留“换场后发生了什么”。
          ...(pruned.swept ? ["换场地已清空旧内容，确认后整批可撤销。"] : []),
          ...(!pruned.swept && dropped.length ? [`超出新边界已淘汰：${dropped.join("；")}（可整批撤销）。`] : []),
        ],
        continuation ? 'design-event' : undefined,
        continuation,
        false,
        directApply,
      );
      if(completion)return completion.catch(error=>{
        status(error instanceof Error?error.message:'范围候选无法核对，未修改规划。','blocked');
      }).finally(()=>setBusy(false));
    } catch (error) {
      status(
        error instanceof Error
          ? error.message
          : "范围候选无法核对，未修改规划。",
        "blocked",
      );
    }
    setBusy(false);
  }
  /**
   * 搜索选区画在地图上，但不是 plan.boundary。核对（以及范围未确认时的下一步）
   * 把它送进现有的范围确认卡：确认后才写入红线，取消则选区还在。
   */
  function promoteVisibleRange(): boolean {
    const visible = callbacks.current.bridge()?.visibleActivityRange?.() ?? null;
    if (!visible || !checkBoundaryRing(visible.boundary).ok) return false;
    if (!callbacks.current.bridge()?.getPlan()) return false;
    offerBoundary(visible.anchor, visible.boundary, visible.name.trim() || "当前地图范围");
    return true;
  }
  function manualBoundary(expected?: OutdoorWorkflowProposal) {
    if (expected && proposalRef.current !== expected) {
      status("这张确认卡已过期，未应用其他任务的提案。", "blocked");
      return;
    }
    const p = proposalRef.current,
      bridge = callbacks.current.bridge(),
      plan = bridge?.getPlan();
    const anchor = p?.next.anchor ?? plan?.anchor;
    if (!anchor) return;
    cancel();
    persist({
      ...stateRef.current,
      stage: "scope",
      confirmedBoundary: null,
      completed: stateRef.current.completed.filter((s) => s === "place"),
    });
    if (!bridge?.beginVenueBoundary(anchor)) {
      status(
        "当前已有规划不能更换锚点，请新建专用活动；原草稿保留。",
        "blocked",
      );
      return;
    }
    status(
      "请在同一地图圈出实际活动范围并闭合：只圈这次真正用到的那片地，闭合后回来核对。",
    );
  }
  // 2026-11-14 用户指令「给我几个方案」：物件排布方案基座（objects 动作时的 plan/候选/当前策略）。
  const objectsLayoutRef = useRef<{
    base: SitePlanData;
    library: OutdoorLibraryItem[];
    strategy: ObjectsLayoutStrategy;
    /** 本次预览实际用的需求清单（可能是默认方案，「换一种排法」要按同一份清单重排）。 */
    brief: OutdoorBrief;
    /** 2026-11-17 硬挤预览：换排法时继续按硬挤净空重排，不然一换就撞「放不下」。 */
    packed?: boolean;
    /** docs/47 A3：排布证据随基座走——换排法时同一套禁区/代价重排，不因切换丢证据。 */
    buildings?: PlanPoint[][] | undefined;
    hardBlocks?: PlanPoint[][] | undefined;
    softAreas?: PlanPoint[][] | undefined;
  } | null>(null);
  /**
   * 2026-11-17 追问预算：连续追问且画布毫无改动的次数。
   * 到 2 就停止提问、直接出默认方案——用户的原话是「随便」「你看着办」，不是要一份问卷。
   */
  const askStreakRef = useRef(0);
  /** 上一轮用户原话：补答上一问时（「1000 张摊位」→「放在摆摊区」）数字仍是用户亲口说的。 */
  const priorUserTextRef = useRef("");
  /** 提案卡「换一种排法」：同一基座换下一策略重排，重新出预览（不写盘，确认才应用）。 */
  async function cycleObjectsLayout() {
    const stored = objectsLayoutRef.current;
    const p = proposalRef.current;
    if (!stored || !p || p.kind !== "objects") {
      status("还没有可切换排法的物件预览；说一句想摆什么，或者说「随便摆」，我先出一版默认方案。", "blocked");
      return;
    }
    const job = start();
    const order = OBJECTS_LAYOUT_STRATEGIES;
    const next = order[(order.indexOf(stored.strategy) + 1) % order.length]!;
    try {
      const result = await proposeInventoryObjects(
        stored.base,
        stored.brief,
        stored.library,
        undefined,
        {
          strategy: next,
          // 2026-11-17 硬挤预览换排法：继续按硬挤净空重排，不然一换就撞「放不下」。
          packed: stored.packed === true,
          // docs/47 A3：换排法沿用同一套建筑禁区与地图证据（水域/围栏禁区 + 绿地代价），
          // 不因切换排法把禁区丢掉。
          buildings: stored.buildings,
          hardBlocks: stored.hardBlocks,
          softAreas: stored.softAreas,
          // 2026-11-14 用户指令「进度条要显示在干嘛」：落位进度实时上屏。
          onPhase: (phase) => status(`正在落位：${phase}`, "working", { stopLabel: "停止查找" }),
          signal: job.controller.signal,
        },
      );
      // 排成功才推进策略指针，失败时下一击仍从同一种排法重试。
      objectsLayoutRef.current = { ...stored, strategy: next };
      offer(
        result.plan,
        "objects",
        `逐区复用库内真实设施（排法：${OBJECTS_LAYOUT_LABELS[next]}）`,
        job,
        [
          `排布方案 ${OBJECTS_LAYOUT_LABELS[next]}——还有 ${
            order
              .filter((s) => s !== next)
              .map((s) => OBJECTS_LAYOUT_LABELS[s])
              .join("、")
          } 可切换。`,
        ],
      );
    } catch (error) {
      if (live(job))
        status(
          error instanceof Error ? error.message : "换排法未能重排，预览保持原样。",
          "blocked",
        );
    } finally {
      if (live(job)) setBusy(false);
    }
  }

  function manualApplied() {
    const plan = callbacks.current.bridge()?.getPlan();
    if (!plan) return;
    const job = start();
    persist({ ...stateRef.current, stage: "scope" });
    // 2026-11-14 用户拍板「以第一个选区为准」：手画闭合同样按新边界重新安置旧内容。
    const pruned = prunePlanForBoundary(plan, plan.boundary, plan.anchor ?? undefined);
    const dropped = [
      pruned.droppedZones.length ? `分区 ${pruned.droppedZones.join("、")}` : "",
      pruned.droppedFacilities.length ? `物件 ${pruned.droppedFacilities.join("、")}` : "",
      pruned.droppedRoutes.length ? `流线 ${pruned.droppedRoutes.join("、")}` : "",
    ].filter(Boolean);
    offer(pruned.next, "scope", "确认手画的活动范围", job, [
      "这是你手画的范围，确认后才写进方案。",
      ...(dropped.length ? [`超出新边界已淘汰：${dropped.join("；")}（可整批撤销）。`] : []),
    ]);
    setBusy(false);
  }
  /**
   * 2026-11-17 用户实测：手画边界时按 Esc 退出后，任务仍停在「核对具体活动范围」并提示
   * 「已框出项目区域、确认后写进方案」，可实际什么都没写入；再点核对就会把任务打回搜索。
   * Esc 是显式取消：清掉这次未确认的候选，回到进入画线前的阶段；已经确认过的边界不动。
   */
  function manualCanceled() {
    abort.current?.abort();
    proposalRef.current = null;
    setProposal(null);
    setModels(null);
    setBusy(false);
    setAppliedHighlight(null);
    setDesignSteps([]);
    const confirmed = stateRef.current.confirmedBoundary;
    persist({
      ...stateRef.current,
      stage: confirmed ? "scope" : "place",
      confirmedBoundary: confirmed ?? null,
      completed: stateRef.current.completed.filter(
        (s) => s === "place" || (!!confirmed && s === "scope"),
      ),
      pendingBoundary: undefined,
    });
    status(
      confirmed
        ? "已取消这次画线；原有活动范围保留。需要时可重新手画。"
        : "已取消这次画线；未写入活动范围。需要时可重新手画或搜索地点。",
      "ready",
    );
  }
  async function act(turn: OutdoorTurn, message: string, continueDesign = false, documents?: AgentDocument[], imageCount = 0) {
    // 新回合开始即视为离开「纯手画」状态：卡上旧内容恢复，或按新意图重排。
    if (turn.action !== "draw-zone" && turn.action !== "draw-route" && turn.action !== "draw-entrance")
      setDrawingMode(null);
    const priorUserText = priorUserTextRef.current;
    priorUserTextRef.current = message;
    if (turn.action === "cancel") {
      cancel();
      return;
    }
    if (turn.action === "simulate" || turn.action === "stop-simulation") {
      const active = turn.action === "simulate";
      const ok = callbacks.current.simulate?.(active) ?? false;
      setBusy(false);
      setSimulating(active && ok);
      status(
        ok
          ? active
            ? "流动示意已启动：按已应用的流线看走向，改完流线再播一次。"
            : "流动示意已停止，规划不变。"
          : "当前无已确认路线可播放；请先应用主线/支线。",
        active && ok ? "working" : "ready",
      );
      return;
    }
    if (turn.action === "confirm") {
      await confirm();
      return;
    }
    if (turn.action === "search") {
      if (!turn.query?.trim())
        throw new Error(
          "想在哪个地点做？请给地点名或地址。" + deferredNote(priorUserTextRef.current),
        );
      // 2026-11-17 玉泉鱼跃实测卡点：已确认场地后，一次 search（哪怕只是模型误判）不再
      // 静默清掉 confirmedBoundary——候选照常列出，但换场必须走候选确认卡显式换锚；
      // 用户不理候选直接继续说需求，仍能按已确认范围推进布局。
      // 同一天补：画布上已有红线、待确认候选或可见选区时，不要把任务卡打回「搜索目标地点」。
      const planNow = callbacks.current.bridge()?.getPlan() ?? null;
      const pending = stateRef.current.pendingBoundary;
      const hasRange = Boolean(stateRef.current.confirmedBoundary)
        || Boolean(planNow && checkBoundaryRing(planNow.boundary).ok)
        || Boolean(pending && checkBoundaryRing(pending.boundary).ok)
        || Boolean(callbacks.current.bridge()?.visibleActivityRange?.());
      persist({
        ...stateRef.current,
        stage: hasRange ? stateRef.current.stage : "place",
        ...(hasRange ? {} : { confirmedBoundary: null, completed: [] }),
      });
      callbacks.current.search(turn.query);
      return;
    }
    if (turn.action === "virtual-venue") {
      // docs/46 V-P2：虚拟场地意图——跳过「搜索目标地点」，切纸面起稿；地理锚点缺失变成合法态
      // （覆盖层对 paper 态不回填预置锚点）。引导用户画红线：闭合同帧自动生成设计范围。
      writePlanGroundMode("paper");
      persist({
        ...stateRef.current,
        stage: "scope",
        confirmedBoundary: null,
        completed: [],
      });
      status(
        turn.reply?.trim()
          || "已切到纸面模式：不关联真实地点。用物件库「用地红线（重画）」画出场地边界，闭合后自动生成设计范围，我们接着分区、摆物件。",
        "ready",
      );
      return;
    }
    const bridge = callbacks.current.bridge(),
      plan = bridge?.getPlan();
    if (!bridge || !plan) throw new Error("当前活动画布未准备好；原需求保留。");
    const normalized = {
      ...turn,
      facts: {
        ...turn.facts,
        ...(turn.facts.items
          ? {
              items: turn.facts.items.map((i) => ({
                ...i,
                zone: mapRef.current.sourceIds?.[i.zone] ?? i.zone,
              })),
            }
          : {}),
        ...(turn.facts.people
          ? {
              people: turn.facts.people.map((p) => ({
                ...p,
                zone: mapRef.current.sourceIds?.[p.zone] ?? p.zone,
              })),
            }
          : {}),
      },
    };
    // 2026-11-17 正式站实测：用户回一句「随便放」，模型却编了一份清单，校验发现这句原文里没有依据
    // → 整轮抛错 → 红卡 +「重试」，而重试只会把同一句再撞一次。
    // 用户没给清单时，任何清单都是模型编的：这里直接丢掉，改按分区用途与面积出默认方案。
    // 2026-11-17：撤除语不算「模糊指令」——「摊位都撤了」没有数字也没量词，但它点名了已有物料并要求撤掉，
    // 模型给的 count=0 清单是正当的；若按 vagueDemand 丢掉，用户看到的就是「说了撤，什么都没变」。
    const clearOut =
      /(撤|拆掉|拆了|拿掉|去掉|清空|不要了|不留|别放|全清)/u.test(message);
    const vagueDemand =
      !clearOut &&
      !/\d/.test(message) &&
      !/[个张把套顶组排座条件台块只面根副]/u.test(message);
    const fabricated =
      turn.action !== 'design-event' && vagueDemand &&
      ((turn.facts.items?.length ?? 0) > 0 || Boolean(turn.facts.guests));
    const candidates = fabricated
      ? { ...normalized, facts: { ...normalized.facts, items: undefined, guests: undefined } }
      : normalized;
    // 2026-11-19 正式站实测：模型把「人数改为 150 人，保持现有分区」判成 adjust，
    // 但 operation 为空；这不是空间变更，不该走下面「没有本句依据」的红卡。
    // guests 已逐字引用本句时只更新简报，画布与分区原样保留。
    const headcountOnly = headcountOnlyAdjustment(turn, message);
    const merged = mergeOutdoorFacts(
      stateRef.current,
      turn.action === 'design-event' ? { ...candidates, facts: {} } : candidates,
      message,
      priorUserText,
    );
    persist(headcountOnly !== null
      ? { ...merged, brief: { ...merged.brief, guests: headcountOnly } }
      : merged);
    if (headcountOnly !== null) {
      designStep(`只更新人数为 ${headcountOnly} 人；现有分区、边界和画布内容保持不变。`);
      status(
        turn.reply?.trim() || `已把人数记为 ${headcountOnly} 人；现有分区保持不变，未改动画布。`,
        "ready",
      );
      return;
    }
    if (fabricated) {
      const what = (turn.facts.items ?? [])
        .map((item) => item.query)
        .filter(Boolean)
        .slice(0, 3)
        .join("、");
      designStep(
        `模型这一轮给的清单（${what || "未具名"}）在你这句话里找不到依据，我没有采用；改按分区用途与面积出默认方案。`,
      );
    }
    if (turn.action === "ask") {
      const autonomousWedding=/婚礼|婚宴|结婚/u.test(`${message} ${stateRef.current.brief.event??''}`)
        &&/继续执行|不需要等待|无需等待|自主.{0,8}规划/u.test(message);
      if(autonomousWedding){
        designStep('已授权自主婚礼规划：缺失桌位与尺寸采用标记的默认参数，场地依据缺口仍待核对。');
        await act({...turn,action:'design-event'},message,continueDesign,documents,imageCount);
        return;
      }
      // 2026-11-17 用户拍「都做」的第二个卡点：用户已经明确选了上一轮二选一里的第 N 项，
      // 模型却又把同一件事反问一遍——原样端回去，用户看到的就是「我选了第一个方案，什么都没发生」。
      // 这时不再重复追问：按原请求确定性地推到对应预览（只出预览，不写画布）。
      const chosen = pendingChoiceRef.current;
      pendingChoiceRef.current = null;
      const resume = chosen ? resumeActionForRequest(chosen.request) : null;
      if (chosen && resume) {
        await act(
          { action: resume, reply: "", references: [], facts: {} },
          chosen.request,
        );
        // offer() 会把提示条换成「预览已就绪」；把这轮的来历记进设计过程，
        // 让人在卡上仍能看到「这一版是按我选的那一项走的」，而不是默默换了个东西。
        designStep(
          `按你选的「${chosen.chosen.text}」继续原请求；本轮只出预览，未写入画布。`,
        );
        return;
      }
      // 2026-11-17 用户实测「就沿着水岸线」→ 被反問「北/东/南/西」，而画布上河就在那儿。
      // 水体/水道与道路折线都已进快照，沿岸/沿线措辞的追问不再问方位：
      // 沿真实参照直接出预览；真没有参照/界外才给可执行的下一步。ask 与非 ask 共用 referencePreview。
      const askReference = shorelineIntent(message)
        ? "shoreline"
        : routeLineIntent(message)
          ? "route-line"
          : null;
      if (askReference && (await referencePreview(askReference, message, continueDesign, null))) return;
      // 2026-11-17 用户拍板「AI 先当设计师，先出一版他看看」：追问预算是硬的。
      // 连续第二次追问、画布毫无改动、用户这句又不是在提问（「你能做什么」这种不算）时，
      // 不再问第三句，直接按当前分区出默认方案（只出预览）。
      const planNow = callbacks.current.bridge()?.getPlan() ?? null;
      const questionish = /[?？]\s*$|^(?:怎么|如何|能不能|可不可以|可以吗|是不是|为什么)/u.test(message.trim());
      const canDraft = !!planNow && checkBoundaryRing(planNow.boundary).ok
        && !stateRef.current.pendingBoundary
        && (!stateRef.current.brief.items.length || designerCue(message));
      const draftRequested=designerCue(message)||/(?:^|[，,。；;])\s*(?:请|帮我|我想|我要)?\s*(?:布置|规划|设计|安排)/u.test(message);
      if (!questionish && canDraft && (askStreakRef.current >= 1 || draftRequested)) {
        askStreakRef.current = 0;
        designStep("已授权自主起稿：按已知用途、面积和物料继续规划，缺失的可调整参数采用标记的默认值，是否应用由监督设置和实际改动决定。");
        await act({ ...turn, action: "objects", reply: "", references: [], facts: {} }, message, continueDesign);
        return;
      }
      askStreakRef.current += 1;
      // 2026-11-15 用户拍板：反问不是错误——reply 走普通对话气泡（谷地工坊同款），
      // 任务卡只留一条中性提示；不进红卡、不给「重试」（重试对反问无意义）。
      askForDetails(turn.reply || "请补充当前活动需求；没有修改规划。");
      return;
    }
    const job = start(continueDesign);
    refsRef.current = turn.references.filter(
      (r) => r.id.startsWith("plan:") || r.id.startsWith("osm:"),
    );
    const original = JSON.stringify(plan);
    try {
      if (turn.action === "scope") {
        const candidate = stateRef.current.pendingBoundary;
        const range = turn.facts.scope;
        if (range) {
          const source = range.sourceId ? documents?.flatMap(doc => doc.sections.map((section, index) => ({ id: `${doc.id}:${index}`, ...section })))
            .find(section => section.id === range.sourceId) : undefined;
          if (!message.includes(range.evidence) && !source?.text.includes(range.evidence)) {
            askForDetails('这次范围调整缺少可核对的原话或图纸尺寸依据，请说出长宽、移动方向或引用资料中的那一段。');
            return;
          }
          const numbers = range.evidence.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
          const supplied = [range.widthM, range.depthM, range.shiftEastM, range.shiftNorthM, range.rotationDeg]
            .filter((value): value is number => value !== undefined && value !== 0);
          if (supplied.some(value => !numbers.includes(Math.abs(value)))) {
            askForDetails('请用米说明具体长宽或位移，避免把参考图中的比例误当成实际尺寸。');
            return;
          }
          const directionWords = { north: '北', south: '南', east: '东', west: '西' };
          if (range.portion && (!range.evidence.includes(directionWords[range.portion]) || !/半边|半块|半部分|一半/u.test(range.evidence))) {
            askForDetails('你想保留哪半边？可以说“用西半边”，也可以直接给出这块活动范围的长宽。');
            return;
          }
          const anchor = candidate?.anchor ?? plan.anchor;
          if (!anchor) { askForDetails('先说出场地名称，我会定位并提出范围，再根据这句话调整。'); return; }
          const nextBoundary = reviseVenueRange(candidate?.boundary ?? plan.boundary, range);
          const previousBasis = candidate?.basis ?? stateRef.current.rangeBasis;
          offerBoundary(anchor, nextBoundary, candidate?.name ?? '当前场地', {
            kind: range.widthM || range.depthM ? 'user-dimensions' : previousBasis?.kind ?? 'concept',
            location: previousBasis?.location ?? 'assumed',
            scale: range.widthM || range.depthM ? 'user-provided' : previousBasis?.scale ?? 'assumed',
            detail: `${source ? `资料 ${source.location}` : '用户原话'}：${range.evidence}。${previousBasis?.location !== 'mapped' ? '仍是概念范围，实际草坪位置尚待核对。' : '几何调整不等于场地方已确认可使用。'}`,
          });
          return;
        }
        // 2026-11-17 用户实测：候选轮廓还在，只因为画布基座有了一点点变化（自动补设计范围、
        // 新增实体等），旧的「base 完全一致」门就把候选判死，顺手把 pendingBoundary 也清掉，
        // 任务退回搜索。候选来自用户刚看过的那张图，这里按当前画布重新签发一次候选，不清状态。
        if (candidate && checkBoundaryRing(candidate.boundary).ok) {
          offerBoundary(candidate.anchor, candidate.boundary, candidate.name, candidate.basis);
          return;
        }
        if (checkBoundaryRing(plan.boundary).ok) {
          // 地图上已经有有效用地红线（手画闭合或刷新后仍在）：重新签发一份核对预览，
          // 边界与画布内容都不动；确认后才写入并推进，不把已有边界清掉。
          persist({ ...stateRef.current, stage: "scope" });
          await offer(plan, "scope", "确认当前活动范围", job, [
            "红线圈住的就是这次活动实际用的那片地；确认后分区、流线、物件都按这片范围排。",
          ]);
          setBusy(false);
          return;
        }
        // 红线还没落盘，但地图上有搜索选区：用同一张确认卡把它写进 plan.boundary。
        if (promoteVisibleRange()) {
          setBusy(false);
          return;
        }
        // 没有候选也没有有效边界时，不把任务打回搜索、不清任何已画几何——
        // 留在核对阶段并直接告诉用户下一步：手画或重新搜索。
        persist({
          ...stateRef.current,
          stage: "scope",
          confirmedBoundary: null,
          completed: stateRef.current.completed.filter((s) => s === "place"),
        });
        status(
          NO_BOUNDARY_NOTICE + deferredNote(priorUserTextRef.current),
          "blocked",
        );
        setBusy(false);
        return;
      }
      if (turn.action === 'design-event' && stateRef.current.pendingBoundary) {
        const candidate=stateRef.current.pendingBoundary;
        await offerBoundary(candidate.anchor,candidate.boundary,candidate.name,candidate.basis,{turn,message,documents:documents??[],imageCount});
        designStep('范围确认后会继续同一份婚礼联合布置，不用重新说一遍需求。');
        return;
      }
      if (!requireScope(plan)) {
        // 2026-11-17 玉泉鱼跃实测卡点：范围未确认不硬抛死路（原文案把用户引回重新搜索地点，
        // 对检索不到轮廓的 POI 就是 85 秒白等）。画布上已有合法闭合边界时直接出确认卡，
        // 一键回到主流程；没有边界也留在核对阶段，给手画/重搜两条路，不把任务打回搜索。
        if (!checkBoundaryRing(plan.boundary).ok) {
          if (promoteVisibleRange()) {
            setBusy(false);
            return;
          }
          persist({
            ...stateRef.current,
            stage: "scope",
            confirmedBoundary: null,
            completed: stateRef.current.completed.filter((s) => s === "place"),
          });
          status(
            NO_BOUNDARY_NOTICE + deferredNote(priorUserTextRef.current),
            "blocked",
          );
          setBusy(false);
          return;
        }
        persist({ ...stateRef.current, stage: "scope" });
        await offer(plan, "scope", "确认当前活动范围", job, [
          "红线圈住的就是这次活动实际用的那片地；确认后分区、流线、物件都按这片范围排。",
        ],turn.action==='design-event'?'design-event':undefined,turn.action==='design-event'?{turn,message,documents:documents??[],imageCount}:undefined);
        setBusy(false);
        return;
      }
      const designingRoutes = turn.action === "main-routes";
      if(turn.action==='design-event'){
        const grounded=(fact:{evidence:string;sourceId?:string|undefined}):boolean=>message.includes(fact.evidence)
          || Boolean(documents?.some(doc=>doc.sections.some((section,index)=>(!fact.sourceId||fact.sourceId===`${doc.id}:${index}`)&&section.text.includes(fact.evidence))))
          || Boolean(fact.sourceId?.match(/^image:(\d+)$/)&&Number(fact.sourceId.slice(6))<imageCount);
        const current=stateRef.current.brief;
        const suppliedZones=turn.facts.zones?.filter(grounded)??[];
        const suppliedItems=turn.facts.items?.filter(item=>grounded(item)&&evidencedCount(item.evidence,item.count))??[];
        const designBrief:OutdoorBrief={...current,
          ...(turn.facts.event&&grounded(turn.facts.event)?{event:turn.facts.event.value}:{}),
          ...(turn.facts.guests&&grounded(turn.facts.guests)&&evidencedCount(turn.facts.guests.evidence,turn.facts.guests.value)?{guests:turn.facts.guests.value}:{}),
          ...(suppliedZones.length?{zones:suppliedZones}:{}),
          ...(suppliedItems.length?{items:suppliedItems}:{}),
        };
        if(!/婚礼|婚宴|结婚/u.test(designBrief.event??message)){
          askForDetails('这条联合布置工具当前用于婚礼。请说明婚礼的场地与已有要求；其他活动仍可按分区和物料分别安排。');return;
        }
        persist({...stateRef.current,brief:designBrief,stage:'objects'});
        status('正在把婚礼分区、通道和物料安排成同一份布局。','working',{stopLabel:'停止布置'});
        await mapContext(job.controller.signal);
        if(!live(job)||JSON.stringify(bridge.getPlan())!==original)return;
        const queries=[...WEDDING_LIBRARY_QUERIES,...designBrief.items.map(item=>item.query)];
        const library=bridge.readLibrary?await bridge.readLibrary(queries,job.controller.signal)
          :(await Promise.allSettled([readOutdoorPersonalLibrary(callbacks.current.controller(),bridge.projectId?.()??input.scope,queries,job.controller.signal),readOutdoorBuiltinLibrary(queries,job.controller.signal)]))
            .flatMap(result=>result.status==='fulfilled'?result.value:[]);
        if(!live(job)||JSON.stringify(bridge.getPlan())!==original)return;
        const map=mapRef.current,graded=map.layoutEvidence?.();
        const hardBlocks=[...(map.buildingAreas?.()??[]),...(graded?.hard??[]).flatMap(feature=>feature.geometry.type==='polygon'
          ?[feature.geometry.points]:outdoorCorridorStrips(feature.geometry.points,1))];
        const optimize=requestsWeddingOptimization(message);
        const report=await proposeWeddingLayout({plan,brief:designBrief,library,optimize,strategy:turn.designStrategy??'ceremony-first',hardBlocks,signal:job.controller.signal,
          onPhase:text=>{if(live(job)){status(text,'working',{stopLabel:'停止布置'});designStep(text);}}});
        if(!live(job)||JSON.stringify(bridge.getPlan())!==original)return;
        for(const quantity of report.quantities)designStep(`${quantity.zone}：${quantity.role} ${quantity.placed}/${quantity.requested}${quantity.placeholder?'（尺寸占位件）':''}`);
        // 2026-11-20 P1：结果摘要 + 本轮输入快照（比较另一版时按同一份边界/物料重算）。
        const designSummary=buildDesignSummary({plan:report.plan,quantities:report.quantities,checks:report.checks,notes:report.notes,reachability:report.reachability,
          strategy:turn.designStrategy??'ceremony-first',...(designBrief.guests?{guests:designBrief.guests}:{})});
        designInput.current={plan,brief:designBrief,library,hardBlocks,...(designBrief.guests?{guests:designBrief.guests}:{})};
        setDesign({title:designSummary.title,summary:designSummary,state:'proposal',change:null,undoBefore:null,appliedVersion:null});
        setDesignCompare(null);setDesignPending(null);setCompareNote(null);setLocateNote(null);
        objectsLayoutRef.current=null;
        if (report.checks.hardConflicts > 0) {
          status(`本版存在硬冲突，尚未写入画布：${designSummary.issues.join("；")}。先调整冲突后重新规划。`, "blocked");
          return;
        }
        await offer(report.plan,'objects','婚礼联合布置：分区、物料与流线',job,[...report.notes,
          ...report.quantities.map(quantity=>`${quantity.zone} · ${quantity.role}：${quantity.placed} 件${quantity.placeholder?'，占位待选型':''}`)],undefined,undefined,optimize,undefined,message);
        return;
      }
      const designingObjects = turn.action === "objects";
      if (designingRoutes || designingObjects || turn.action === "zones" || turn.action === "revise") {
        designStep(plan.zones.length
          ? `已核对活动边界和画布上已有的 ${plan.zones.length} 个分区。`
          : "已核对活动边界，当前场地还没有功能分区。");
      }
      if (
        turn.action === "draw-zone" ||
        turn.action === "draw-route" ||
        turn.action === "draw-entrance"
      ) {
        const mode =
          turn.action === "draw-zone"
            ? "zone"
            : turn.action === "draw-route"
              ? "route"
              : "node";
        if (!bridge.beginDrawing?.(mode))
          throw new Error("当前画布尚未准备好，原规划保留。");
        setDrawingMode(mode);
        status(
          mode === "zone"
            ? "已进入手画模式。请在地图上画出分区轮廓并闭合，再补充分区名称、用途和室内外属性。"
            : mode === "route"
              ? "已启动同一地图的人行主通道绘制；请沿真实可用通道连接入口，不把未知室内通路当真实。"
              : "已启动同一地图的入口标注；位置来自用户意图，仍需核对真实门与通行权限。",
          "ready",
        );
        return;
      }
      const needsZones = !plan.zones.length && designingRoutes;
      // action='zones' 也要先有用途，否则 proposeUseZones 会直接抛“要分哪些用途”红卡。
      const wantsZones = turn.action === "zones" || needsZones;
      let zoneNeeds = stateRef.current.brief.zones;
      // 2026-11-19 用户：「你搞一些集市活动」不该先反问分区——
      // 常见活动类型直接按默认分区出一版，假设写进设计过程，用户再改。
      if (wantsZones && (!zoneNeeds.length || zoneNeeds.some(zone => zone.environment === "unknown"))) {
        const inferred = defaultZonesForEvent(message);
        if (inferred.length) {
          zoneNeeds = inferred;
          persist({ ...stateRef.current, brief: { ...stateRef.current.brief, zones: inferred } });
          designStep(`按「${inferred.map(zone => zone.name).join("、")}」先分一版区；这是默认假设，可以再改。`);
        }
      }
      if (wantsZones && (!zoneNeeds.length || zoneNeeds.some(zone => zone.environment === "unknown"))) {
        askForDetails("这次活动要分成哪些区域？请告诉我各区的用途和室内外属性，例如室外展览区和室外表演区。");
        return;
      }
      await mapContext(job.controller.signal);
      if (!live(job)) return;
      if (JSON.stringify(bridge.getPlan()) !== original) {
        status("读取期间画布已变化，请基于当前规划重新预览。", "blocked");
        return;
      }
      if (turn.action === "adjust" || turn.action === "connect") {
        if (!turn.operation || !message.includes(turn.operation.evidence))
          throw new Error("空间变更没有本句依据，未执行。");
        if (!bridge.proposeSpatialEdit)
          throw new Error("地图空间工具尚未接通，未执行。");
        await offer(
          bridge.proposeSpatialEdit(turn, plan),
          turn.action === "adjust"
            ? stateRef.current.stage === "refine-3d"
              ? "model"
              : "objects"
            : "main-routes",
          turn.action === "adjust"
            ? "按真实对象关系调整设施"
            : "入口连接真实相邻道路",
          job,
          [
            "地图证据与用户对象同版本绑定，仍需确认；未推断未记录的室内门/通行权限。",
          ],
        );
        return;
      }
      if (turn.action === "zones" || turn.action === "revise" || needsZones) {
        persist({ ...stateRef.current, stage: "zones" });
        // 2026-11-18 用户口径「先设计，用户会告诉你他的想法」：分区确认后直接接一版物件预览，
        // 不再先停到「核对主通道」；只有用户自己点名要主通道时才接主通道。
        // 2026-11-21 用户拍板：这条链此前断着（普通分区 afterConfirm 传空，确认后停在主通道阶段），
        // 现在补上——确认分区即出物件预览。
        const afterConfirm = designingRoutes ? "main-routes" : "objects";
        designStep(needsZones
          ? `先按已知用途划分区域，让${designingRoutes ? "主通道" : "物料"}有明确的服务范围。`
          : "根据已知用途和室内外条件，在活动边界内安排分区。");
        const next = bridge.proposeZones
          ? bridge.proposeZones(plan, stateRef.current.brief)
          : proposeUseZones(
              plan,
              stateRef.current.brief,
              undefined,
              // 轮次 110：「缺分区要分哪些用途」是追问，上一句的后置活接在问句后（不回退成“下一步”）。
              deferredNote(priorUserTextRef.current),
            );
        if (needsZones) {
          const names = next.zones.slice(0, 4).map(zone => zone.name).join("、");
          designStep(`分区预览包含 ${next.zones.length} 个区域：${names}${next.zones.length > 4 ? "等" : ""}。`);
        }
        await offer(
          next,
          "zones",
          "分区用途与室内外属性",
          job,
          [
            "室内边界必须由用户图纸或已有手画分区确认；地图不提供室内通道事实。",
          ],
          afterConfirm,
        );
        return;
      }
      if (!plan.zones.length && !["objects", "library-search", "upload", "generate", "generate-image", "adjust", "connect"].includes(turn.action))
        throw new OutdoorStepBlocked(
          "这项操作需要知道要连接的区域，请指定区域或先画出它。",
          { action: "zones", label: "先生成分区预览" },
        );
      if (turn.action === "main-routes") {
        persist({ ...stateRef.current, stage: "main-routes" });
        designStep("把真实道路与活动边界相交的位置作为入口候选，再预览主通道。");
        status("读取真实路网证据，出入口交点只作待核对候选。", "working", {
          stopLabel: "停止查找",
        });
        if (!plan.anchor)
          throw new Error("活动还没有真实锚点，请先定位并确认范围。");
        // 2026-11-14 测试修正：路网 bbox 按边界真实地理位置取（边界可离锚点很远）。
        const roadPlan = roadFetchPlanForBoundary(plan.boundary, plan.anchor);
        // 2026-11-14 修复：快照里存了 road 特征才用快照；只锚了场地轮廓的快照回空会让
        // bridge.roadNetwork() 直接短路实时抓取（连请求都不发）→「未取得可核对路网」死路。
        // 快照无路就走实时路网（Overpass → 高德路径规划兜底）。
        let roads = bridge.roadNetwork?.() ?? null;
        if (!roads || !roads.roads.length) {
          roads = await fetchRoadNetwork(
            roadPlan.center,
            roadPlan.spanM,
            { signal: job.controller.signal },
          );
        }
        if (!live(job) || JSON.stringify(bridge.getPlan()) !== original) return;
        const proposal = buildRouteProposal({
          boundary: plan.boundary,
          anchor: plan.anchor,
          roads: roads.roads,
          // 2026-11-18（#3）：把这一轮的原话接进选路口径——「改走仁和路、别沿湖滨路走」
          // 这类改口要能落到提案上，而不是照旧按等级与长度挑同一条路。
          request: message,
        });
        if (!proposal)
          throw new Error(
            "未取得可核对路网。请在同一画布标出已知通道/入口或提供图纸，再核对；不会捏造建筑门与室内通道。",
          );
        // 2026-11-14 用户拍板「流线可以从场地外延伸到场内——要考虑大家怎么来的」：
        // 不再按边界裁掉界外段，整段道路保留；道路与边界的交点即出入口候选，界外部分是到场流线。
        const clipped = proposal.routes;
        if (!clipped.length)
          throw new Error(
            "未取得可核对路网。请在同一画布标出已知通道/入口或提供图纸，再核对；不会捏造建筑门与室内通道。",
          );
        const nodes = proposal.nodes.map((n) => ({
          ...n,
          verification: "unverified" as const,
          notes: `${n.notes}；道路交点推断，门口/通行权限待核对。`,
        }));
        // 2026-11-21 用户拍板：主通道与摊位间支线一次出齐、一次确认，不再分「主通道」「子入口」
        // 两个阶段各核一遍。物件已排时支线按这份提案的布局现算；排不出去就如实说，不硬造。
        const proposedPlan = { ...plan, routes: [...plan.routes, ...clipped], nodes: [...plan.nodes, ...nodes] };
        const sub = plan.facilities.length ? buildSubEntranceProposal(proposedPlan) : null;
        const subNote = !plan.facilities.length
          ? null
          : sub
            ? `摊位间支线已一并排出（${sub.routes.length} 条）；观众接人行主线。`
            : "主通道先出；物件间这版没有可行支线（会穿展位/表演区），要调就挪物件后再说一声。";
        await offer(
          sub
            ? { ...proposedPlan, routes: [...proposedPlan.routes, ...sub.routes], nodes: [...proposedPlan.nodes, ...sub.nodes] }
            : proposedPlan,
          "main-routes",
          "主要流线与待核对入口",
          job,
          [
            // 2026-11-18（#3）：按了原话改选路的，卡上要写清改了什么；没改就还是老口径。
            routeIntentNote(proposal.intent) ??
              "这些线是按道路等级挑的到场候选；哪个口真能走，等你核对后写进规划。",
            "界外段是到场流线候选（怎么来的），与边界的交点即待核对入口；写入后可画布编辑。",
            ...(subNote ? [subNote] : []),
          ],
        );
        return;
      }
      if (turn.action === "verify-access") {
        const rawTarget =
          turn.facts.access?.id ??
          turn.references.filter((r) => r.layer === "plan")[0]?.id;
        const target = rawTarget
          ? (mapRef.current.sourceIds?.[rawTarget] ?? rawTarget)
          : undefined;
        if (
          turn.facts.access &&
          !turn.references.some(
            (r) => (mapRef.current.sourceIds?.[r.id] ?? r.id) === target,
          )
        )
          throw new Error("核对入口需绑定本轮真实引用，未修改。");
        if (!target || !plan.nodes.some((n) => n.id === target))
          throw new Error("请选中要核对的具体入口；无法把“这个”猜成某扇门。");
        if (
          turn.facts.access?.kind &&
          turn.facts.access.kind !== "entry" &&
          !/出|exit/i.test(turn.facts.access.evidence)
        )
          throw new Error(
            "出口/出入口方向需要用户明确核对，未从仅入口推断出口。",
          );
        await offer(
          {
            ...plan,
            nodes: plan.nodes.map((n) => {
              if (n.id !== target) return n;
              const nextKind = turn.facts.access?.kind ?? n.kind;
              return {
                ...n,
                kind: nextKind,
                // 2026-11-15：核对成「仅出口/双向」也走同一套自动改名（入口 1 → 出口 1）。
                name: renamedNodeName(n.name, nextKind, plan.nodes, n.id),
                verification: "user-confirmed" as const,
              };
            }),
          },
          "verify-access",
          // 2026-11-17：原来叫「用户核对入口可用」——界面是在对用户说话，不该用第三人称叫「用户」，
          // 也没说清核对的是「什么」。这里真正要确认的是这扇门能不能走、是进还是出。
          "入口方向与可通行性",
          job,
        );
        return;
      }
      if (turn.action === "library-search") {
        if (!turn.query?.trim())
          throw new Error(
            "想找哪种设施？请给名称或用途，例如展板/音响；只读真实库，不生成。",
          );
        const found = bridge.readLibrary
          ? await bridge.readLibrary([turn.query], job.controller.signal)
          : (await Promise.allSettled([
              readOutdoorPersonalLibrary(
                callbacks.current.controller(),
                bridge.projectId?.() ?? input.scope,
                [turn.query],
                job.controller.signal,
              ),
              readOutdoorBuiltinLibrary([turn.query], job.controller.signal),
            ])).flatMap(r => (r.status === "fulfilled" ? r.value : []));
        if (!live(job)) return;
        setLibraryChoices(found.slice(0, 5));
        setSelectedLibraryId(undefined);
        status(
          found.length
            ? "已读到真实库候选与尺寸（个人库与内置件都查过）；选定后告诉我对应分区和数量，仍先预览。"
            : "库里没有可用匹配（个人库与内置件都查过）；可改名检索或在当前卡导入GLB（本机解析真实尺寸、不上传不收费）。",
          "ready",
        );
        return;
      }
      if (turn.action === "objects") {
        // 2026-11-18 用户定口径：「不要有太多负面反馈，先设计，用户会告诉你他的想法」。
        // 入口/主通道没核实不再拦下整轮排版：先按分区和用途出一版预览，缺口写在卡上；
        // 门口仍按 2m 净空预留（clearForObject），补上通道后再按通道重排一版。
        // 2026-11-17 用户口径：「人数也不确定吧，有的时候先搞活动也有」。人数是活动定下来才知道的事，
        // 先布场、后补人数是常态，所以这里不再把「没有人数」当错误拦下——规划层的 validateWorkflowDemand
        // 本来就按人数可空设计（没有人数就跳过 2㎡/人 粗筛），本分支的 throw 与它自相矛盾，
        // 且失败卡只有一个「重试」（= 原样重跑 objects），人数不变就永远撞同一堵墙。
        // 仍然不从物件数量反推人数：缺人数就如实写在提案卡上，不假装做过容量核对。
        // 阶段改到通过前置校验之后再落盘：一次失败不该把任务卡永久改成「按用途复用我的物料」。
        persist({ ...stateRef.current, stage: "objects" });
        status(
          "正在查找合适的物料和尺寸。",
          "working",
          { stopLabel: "停止查找" },
        );
        designStep("按分区用途、物料的真实尺寸和已核对的通道试排。");
        // 2026-11-17 用户拍板「用户是讲不清楚需要什么的，AI 就是设计师，先出一版」：
        // 没有清单不再回头问「各区需要哪些物件、各多少」——按分区用途 + 真实面积 + 人数
        // 直接出一份默认清单，走同一套真实物料库和几何落位。只出预览，不写画布；
        // 默认值也不写回 state.brief，用户下一句亲口说的数量仍然优先。
        const draft = stateRef.current.brief.items.length
          ? null
          : draftDemand(plan, stateRef.current.brief);
        if (draft && !draft.items.length) {
          status(
            draft.notes.join(" ") || "画布上的分区还没有可用用途，先补分区用途或直接说要放什么。",
            "blocked",
          );
          return;
        }
        const demandBrief: OutdoorBrief = draft
          ? { ...stateRef.current.brief, items: draft.items }
          : stateRef.current.brief;
        if (draft)
          designStep(
            `没有清单：按分区用途与面积出默认方案（${draft.items.map((i) => `${i.zone} ${i.query}×${i.count}`).join("、")}）；数量为可调整的布局假设，不改写用户确认需求。`,
          );
        const queries = demandBrief.items.map((i) => i.query);
        const library = bridge.readLibrary
          ? await bridge.readLibrary(queries, job.controller.signal)
          : (await Promise.allSettled([
              readOutdoorPersonalLibrary(
                callbacks.current.controller(),
                bridge.projectId?.() ?? input.scope,
                queries,
                job.controller.signal,
              ),
              readOutdoorBuiltinLibrary(queries, job.controller.signal),
            ])).flatMap(r => (r.status === "fulfilled" ? r.value : []));
        if (!live(job) || JSON.stringify(bridge.getPlan()) !== original) return;
        // 2026-11-14 用户指令「建筑给室内分区，设计别做进室内」：拉边界内建筑足迹（室内禁区）。
        // plan.buildings 已有就用；没有则随路网查询抓 OSM building（同一次 Overpass）。
        // 过滤：面积 ≥45% 边界的（商场整体轮廓这种）丢弃；一个点都不在边界内的丢弃。
        let buildingsEnu: PlanPoint[][] = plan.buildings?.map(b => b.points) ?? [];
        if (!buildingsEnu.length && plan.anchor) {
          // 2026-11-14 用户指令「进度条要显示在干嘛」：建筑抓取是 10-60s 的大头，单独上屏。
          status("正在抓取地图建筑足迹（OpenFreeMap 矢量瓦片）…", "working", { stopLabel: "停止查找" });
          const boundaryArea = planRingAreaM2(plan.boundary);
          // ① 首选 OpenFreeMap 矢量瓦片（CDN 稳定，无 Overpass 坏窗口）。
          try {
            const boundaryLngLat = plan.boundary.map(pt => enuToLngLat(pt.x, pt.y, plan.anchor!.lng, plan.anchor!.lat));
            const lngs = boundaryLngLat.map(p => p.lng);
            const lats = boundaryLngLat.map(p => p.lat);
            const rings = await fetchOpenFreeMapBuildings(
              { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) },
              job.controller.signal,
            );
            buildingsEnu = lngLatRingsToEnu(rings, plan.anchor!.lng, plan.anchor!.lat)
              .filter(ring => ring.length >= 3)
              .filter(ring => planRingAreaM2(ring) < boundaryArea * 0.45)
              .filter(ring => ring.some(pt => planPointInRing(pt, plan.boundary)));
          } catch { /* OpenFreeMap 失败走后备源 */ }
          // ② 后备：路网查询（Overpass building + 高德兜底，坏窗口依赖种子/缓存）。
          if (!buildingsEnu.length) {
            const fetchPlan = roadFetchPlanForBoundary(plan.boundary, plan.anchor);
            try {
              const net = await fetchRoadNetwork(
                fetchPlan.center,
                fetchPlan.spanM,
                { signal: job.controller.signal },
              );
              buildingsEnu = (net.buildings ?? [])
                .map(b => b.points.map(([lng, lat]) => lngLatToEnu(lng, lat, plan.anchor!.lng, plan.anchor!.lat)))
                .filter(ring => ring.length >= 3)
                .filter(ring => planRingAreaM2(ring) < boundaryArea * 0.45)
                .filter(ring => ring.some(pt => planPointInRing(pt, plan.boundary)));
            } catch { /* 建筑抓不到就不禁区内渲染，不阻断物件流程 */ }
          }
        }
        const buildingsForPlan = buildingsEnu.length
          ? buildingsEnu.map((points, i) => ({ id: `building:${i}`, points }))
          : undefined;
        const basePlan: SitePlanData = buildingsForPlan ? { ...plan, buildings: buildingsForPlan } : plan;
        if (!live(job) || JSON.stringify(bridge.getPlan()) !== original) return;
        // docs/47 A3：证据分级进排布引擎——hard 块（水域/围栏）作禁区、绿地作落位代价。
        // 一行式摘要已随 issued 上下文给模型（A2）；这里是引擎消费点。没有证据就传空数组，
        // 引擎行为与旧首-fit完全一致；要素几何异常（<3 点 / 非有限坐标）整条丢弃，不猜。
        const layoutEvidence = mapRef.current.layoutEvidence?.();
        const evidenceRings = (features: ReadonlyArray<{ geometry: { points: PlanPoint[] } }>) =>
          features
            .map((f) => f.geometry.points)
            .filter(
              (pts) =>
                pts.length >= 3 &&
                pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
            );
        const hardBlocks = layoutEvidence ? evidenceRings(layoutEvidence.hard) : [];
        const softAreas = layoutEvidence ? evidenceRings(layoutEvidence.soft) : [];
        // 2026-11-17：默认方案是算出来的，几何不一定吃得下（演出区按面积算了 200+ 个座，
        // 实际只排得进几十个）。放不下就按真实能容纳的量缩，并把缩过的数量写在卡上——
        // 既不静默失败，也不冒充“按面积算的数字都成立”。
        const wantedItems = demandBrief.items;
        const proposeOpts = {
          strategy: "rows" as const,
          // 2026-11-18 用户口径「先设计」：人数/面积粗筛不再拦下一整版，
          // 结论由 result.demandNote 带回卡上；用户看到设计后自己决定要不要调。
          softDemand: true,
          buildings: buildingsEnu.length ? buildingsEnu : undefined,
          // docs/47 A3：水域/围栏 hard 块作禁区，绿地 soft 块计落位代价。
          hardBlocks,
          softAreas,
          // 2026-11-14 用户指令「进度条要显示在干嘛」：落位进度实时上屏（逐区刷新状态文字）。
          onPhase: (phase: string) => status(`正在落位：${phase}`, "working", { stopLabel: "停止查找" }),
          signal: job.controller.signal,
        };
        let result: Awaited<ReturnType<typeof proposeInventoryObjects>> | null = null;
        let fitError: string | null = null;
        let shrinkItems: OutdoorBrief["items"] | null = null;
        let packedWarning: string | null = null;
        try {
          result = await proposeInventoryObjects(basePlan, demandBrief, library, undefined, proposeOpts);
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          // 2026-11-17 断点修复：人数粗筛类拦截（表演区无观众区/缺来宾区/面积不足）不是重放能解的，
          // 转成带「出分区预览」下一步的红卡，别给一个只会撞墙的重试。
          if (/观众区域|来宾活动区域|2㎡\/人/.test(error.message))
            throw new OutdoorStepBlocked(error.message, {
              action: "zones",
              label: "出分区预览（补观众区/调分区）",
            });
          if (!/放不下/.test(error.message)) throw error;
          fitError = error.message;
          if (draft) {
            // 设计师草案：按面积反算的量放不下，缩的是我算的数，不是用户说的数。
            let draftItems = wantedItems;
            for (let attempt = 0; attempt <= 8 && result === null; attempt += 1) {
              try {
                result = await proposeInventoryObjects(
                  basePlan,
                  { ...demandBrief, items: draftItems },
                  library,
                  undefined,
                  proposeOpts,
                );
              } catch (shrinkError) {
                if (!(shrinkError instanceof Error)) throw shrinkError;
                if (/观众区域|来宾活动区域|2㎡\/人/.test(shrinkError.message))
                  throw new OutdoorStepBlocked(shrinkError.message, {
                    action: "zones",
                    label: "出分区预览（补观众区/调分区）",
                  });
                if (!/放不下/.test(shrinkError.message)) throw shrinkError;
                fitError = shrinkError.message;
                // 只缩“放不下”的那个分区：全区减半会把本来排得下的摆摊区一起砍到 3 个摊。
                const zoneName = /“([^”]+)”放不下/u.exec(shrinkError.message)?.[1];
                draftItems = draftItems.map((item) =>
                  item.zone === zoneName
                    ? { ...item, count: Math.max(1, Math.floor(item.count / 2)) }
                    : item,
                );
              }
            }
            if (result === null) throw error;
            shrinkItems = draftItems;
          } else {
            // 2026-11-17 用户拍板「就硬挤在一起，甲方就会明白放不下了」：用户亲口要的数量不替他减。
            // 切硬挤重排——互不重叠、门口只留最小净空——塞到物理极限，让预览自己说明放不下。
            try {
              result = await proposeInventoryObjects(basePlan, demandBrief, library, undefined, {
                ...proposeOpts,
                packed: true,
              });
            } catch {
              // 连硬挤都放不下第一件：回到原始红卡，如实说明。
              throw error;
            }
            const shortfall = result.capacityShortfall;
            if (shortfall.some((s) => s.placed < 1)) throw error;
            packedWarning =
              `你要的「${shortfall.map((s) => `${s.zone} ${s.query}×${s.requested}`).join("、")}」` +
              `硬挤的物理极限是 ${shortfall.map((s) => `${s.zone} ${s.query}×${s.placed}`).join("、")}：` +
              `预览就是挤到塞不下为止的样子（物件互不重叠、门口留了净空，但物件之间已经没有通道）；` +
              `疏散与合规要现场核验。要宽松就得扩分区、减数量或换更小的物料。`;
          }
        }
        const finalBrief: OutdoorBrief = shrinkItems
          ? { ...demandBrief, items: shrinkItems }
          : demandBrief;
        // 换一种排法按这份 brief 重排：草案用缩过的量；硬挤时保持用户原数并继续硬挤。
        objectsLayoutRef.current = {
          base: basePlan,
          library,
          strategy: "rows",
          brief: finalBrief,
          packed: Boolean(packedWarning),
          // docs/47 A3：建筑禁区与地图证据（水域/围栏禁区 + 绿地代价）随基座存档，
          // 换排法时同一套重排，不因切换丢证据。
          buildings: buildingsEnu.length ? buildingsEnu : undefined,
          hardBlocks,
          softAreas,
        };
        if (packedWarning) {
          designStep("用户要的数量放不下：按「硬挤」出预览塞到物理极限，差额写在提案卡上，没有改用户记下的数量。");
        } else if (fitError && draft && shrinkItems) {
          const fitted = shrinkItems.map((i) => `${i.zone} ${i.query}×${i.count}`).join("、");
          designStep(`按面积算的清单排不下（${fitError}），已缩到实际能放的数量：${fitted}。`);
        }
        // 2026-11-17 死结 3：需求分区对不上画布的（如上一轮遗留的旧需求）跳过并如实报出，
        // 同时从需求清单里摘掉——留着的话每一轮都会重复报同一批，物件阶段永远走不下去。
        const mismatchNotice: string[] = [];
        if (result.mismatched.length) {
          const dropped = new Set(
            result.mismatched.map((m) => `${m.need.zone} ${m.need.query} ${m.need.count}`),
          );
          persist({
            ...stateRef.current,
            brief: {
              ...stateRef.current.brief,
              items: stateRef.current.brief.items.filter(
                (i) => !dropped.has(`${i.zone} ${i.query} ${i.count}`),
              ),
            },
          });
          mismatchNotice.push(describeZoneMismatch(result.mismatched, plan, { removed: true }));
        }
        await offer(result.plan, "objects", draft ? "物料布置" : "物料排布", job, [
          // 默认值必须自证是默认值：用户看到的每一版都说清「这不是你说的数量」。
          ...(draft ? ["这版是默认方案：数量按分区用途和面积反算；说个数或哪件要改，我按你的改。", ...draft.notes] : []),
          ...(packedWarning ? [packedWarning] : []),
          ...(fitError && draft && shrinkItems
            ? [`按面积算的数量现场排不下：已缩到实际能容纳的 ${shrinkItems.map((i) => `${i.query}×${i.count}`).join("、")}；要更多只能换更小的真实物料或扩分区，不硬塞。`]
            : []),
          ...(result.demandNote ? [`人数/面积粗筛没过：${result.demandNote}`] : []),
          `排布方案：${OBJECTS_LAYOUT_LABELS.rows}——卡上「换一种排法」可切换 ${OBJECTS_LAYOUT_LABELS.center}/${OBJECTS_LAYOUT_LABELS.perimeter}。`,
          ...(buildingsForPlan?.length ? [`已避开 ${buildingsForPlan.length} 处建筑占地。`] : []),
          ...(hardBlocks.length
            ? [`地图证据里 ${hardBlocks.length} 处水域/围栏列为禁区：物件排布自动避开，不进禁区。`]
            : []),
          ...(softAreas.length
            ? [`地图证据里 ${softAreas.length} 处绿地按「可摆但有代价」参与落位：优先避让，避不开时按代价最小落位并在物件备注注明。`]
            : []),
          ...mismatchNotice,
        ]);
        return;
      }
      if (turn.action === "sub-routes") {
        persist({ ...stateRef.current, stage: "sub-routes" });
        if (!plan.facilities.length)
          throw new OutdoorStepBlocked(
            "先确认各区实际物件，再沿物件空隙安排子入口和支线；不能先穿过未来展位/表演区。",
            { action: "objects", label: "先去排各区物件" },
          );
        const proposal = buildSubEntranceProposal(plan);
        if (!proposal)
          throw new Error(
            "现有物件/保护区域之间没有可连通的2m人行支线；请选区调整物件或明确已知入口，不会穿展位/表演区。",
          );
        await offer(
          {
            ...plan,
            routes: [...plan.routes, ...proposal.routes],
            nodes: [...plan.nodes, ...proposal.nodes],
          },
          "sub-routes",
          "物件间隙子入口与支线",
          job,
          ["观众接人行主线；后勤/人员岗位还需核对各自专用路径。"],
        );
        return;
      }
      if (turn.action === "people") {
        persist({ ...stateRef.current, stage: "people" });
        const peoplePlan = proposeRoleWorkers(plan, stateRef.current.brief);
        // 2026-11-17 死结 3：岗位分区对不上画布的同样跳过并如实报出，并从需求清单摘掉。
        const peopleMismatch: string[] = [];
        const { mismatched: peopleMismatched } = splitNeedsByZone(
          plan,
          stateRef.current.brief.people,
        );
        if (peopleMismatched.length) {
          const droppedPeople = new Set(
            peopleMismatched.map(
              (m) => `${m.need.zone} ${m.need.role} ${m.need.count}`,
            ),
          );
          persist({
            ...stateRef.current,
            brief: {
              ...stateRef.current.brief,
              people: stateRef.current.brief.people.filter(
                (p) => !droppedPeople.has(`${p.zone} ${p.role} ${p.count}`),
              ),
            },
          });
          peopleMismatch.push(
            describeZoneMismatch(peopleMismatched, plan, {
              removed: true,
              subject: "岗位未安排",
            }),
          );
        }
        await offer(
          peoplePlan,
          "people",
          "按岗位、数量与通路安排人员",
          job,
          [
            "人员按岗位挂在对应分区和通路上；区域或流线一改，人员跟着重排。",
            ...peopleMismatch,
          ],
        );
        return;
      }
      if (turn.action === "refine-3d") {
        bridge.setView?.("3d");
        persist({ ...stateRef.current, stage: "refine-3d" });
        status(
          "已切同一份规划的3D视角。选设施或告诉我名称，可在对话比较真实模型、调整/替换、上传；不会先要求生成。",
        );
        return;
      }
      const refs = turn.references
        .filter((r) => r.layer === "plan")
        .map((r) => mapRef.current.sourceIds?.[r.id] ?? r.id);
      const selected = bridge.selectedIds?.() ?? [];
      const facility =
        plan.facilities.find((f) => refs.includes(f.id)) ??
        plan.facilities.find((f) => selected.includes(f.id)) ??
        (turn.query
          ? plan.facilities.find((f) => f.name === turn.query)
          : undefined);
      if (!facility)
        throw new Error(
          "请选中或明确设施名称；当前指代没有唯一真实对象，不会改错设施。",
        );
      bridge.inspectFacility?.(facility.id);
      if (turn.action === "models") {
        if (!bridge.models)
          throw new Error("当前画布模型候选桥尚未连接，原设施不变。");
        const choices = await bridge.models(facility.id);
        if (!live(job) || JSON.stringify(bridge.getPlan()) !== original) return;
        if (!choices.length)
          throw new Error(
            "此设施尚无可核对模型候选，可上传GLB或图片；不会虚构候选/自动收费。",
          );
        setModels({ facilityId: facility.id, choices, base: original });
        status(
          `“${facility.name}”模型候选已读到；选择后预览确认，3D与2D同规划。`,
          "ready",
        );
        return;
      }
      if (turn.action === "choose-model") {
        const candidate =
          models?.facilityId === facility.id
            ? models.choices[turn.choice ?? -1]
            : undefined;
        if (!candidate || models?.base !== original)
          throw new Error("候选已过期或尚未选择，请重新读取当前设施候选。");
        if (
          !candidate.width ||
          !candidate.depth ||
          !Number.isFinite(candidate.width) ||
          !Number.isFinite(candidate.depth)
        )
          throw new Error(
            "此模型候选缺少可核对真实尺寸，未替换；请先上传核对模型尺寸。",
          );
        await offer(
          {
            ...plan,
            facilities: plan.facilities.map((f) =>
              f.id === facility.id
                ? {
                    ...f,
                    modelOverride: candidate.slug,
                    size: { width: candidate.width!, depth: candidate.depth! },
                  }
                : f,
            ),
          },
          "model",
          `替换“${facility.name}”模型`,
          job,
          ["换模型后按同一套占地和通道规则重查；这次不再计费。"],
        );
        return;
      }
      if (turn.action === "generate" || turn.action === "generate-image") {
        if (
          !bridge.openGenerate?.(
            facility.id,
            turn.action === "generate-image" ? "image" : "text",
          )
        )
          throw new Error("当前设施原位生成未准备好。");
        status(
          "已打开此设施的原位生成表单；费用/项目/设施归属需单独确认，当前没有提交收费任务。",
        );
        return;
      }
      if (turn.action === "upload") {
        if (!bridge.openUpload?.(facility.id))
          throw new Error("当前设施上传入口未准备好。");
        status(
          "已打开此设施的本机GLB选择；图片生成请另选图片表单并单独确认费用，未创建任务。",
        );
        return;
      }
      status(turn.reply || "请补充要修改的具体对象与要求。", "blocked");
    } catch (error) {
      if (live(job))
        status(
          error instanceof Error ? error.message : "当前提案无法核对，未执行。",
          "blocked",
          error instanceof OutdoorStepBlocked ? { fix: error.fix } : {},
        );
    } finally {
      if (live(job)) setBusy(false);
    }
  }
  /**
   * 2026-11-14 用户指令「物件排布路由摇摆，给我几个方案」：多分区物件清单句式
   * （「摊位区 18 个市集摊位、舞台表演区 1 个舞台」）确定性解析为 objects 回合，
   * 不再依赖理解模型路由（实测 deepseek 对该句式在 zones/objects/library-search 间摇摆）。
   * ≥2 段才接管（单区清单仍走模型，保留其追问能力）；解析失败回 null 由模型兜底。
   */
  function synthesizeObjectsTurn(
    message: string,
    plan: SitePlanData,
  ): OutdoorTurn | null {
    const segments = message
      .split(/[，,；;]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length < 2) return null;
    const items: Array<{
      zone: string;
      query: string;
      count: number;
      evidence: string;
    }> = [];
    for (const segment of segments) {
      const zone = plan.zones.find((z) => segment.startsWith(z.name));
      if (!zone) continue;
      const rest = segment.slice(zone.name.length);
      const match = rest.match(/^\s*(\d{1,4})\s*[个把只组台张]?\s*(\S.*)$/);
      if (!match) continue;
      const count = Number(match[1]);
      if (!Number.isInteger(count) || count < 1 || count > 500) continue;
      const query = match[2]!.trim();
      if (!query) continue;
      items.push({
        zone: zone.name,
        query,
        count,
        evidence: segment,
      });
    }
    if (items.length < 2) return null;
    return {
      action: "objects",
      reply: "",
      references: [],
      facts: { items },
    } as OutdoorTurn;
  }

  type ReferencePreviewResult =
    | { ok: true; next: SitePlanData; label: string; warnings: string[]; designStepText: string }
    | { ok: false; message: string };

  /** 沿岸（水岸线参照）预览构建：钓位贴岸、观众区退让、签到裁判席。 */
  function shorelinePreviewBuild(plan: SitePlanData, message: string): ReferencePreviewResult {
    const proposal = proposeShorelineLayout(
      {
        shorelines: mapRef.current.water?.() ?? [],
        boundary: plan.boundary,
        demand: parseShorelineDemand(message),
        obstacles: plan.facilities.map(facilityFootprintRing),
        exclusions: plan.zones.map(zone => zone.polygon),
      },
      () => crypto.randomUUID(),
    );
    if (!proposal.ok) return { ok: false, message: proposal.message };
    const { layout } = proposal;
    return {
      ok: true,
      next: {
        ...plan,
        zones: [...plan.zones, ...layout.zones],
        facilities: [...plan.facilities, ...layout.facilities],
        routes: [...plan.routes, ...layout.routes],
        nodes: [...plan.nodes, ...layout.nodes],
      },
      label: `沿岸排布·${layout.summary.waterName}（${layout.summary.stations} 个钓位）`,
      warnings: layout.summary.warnings,
      designStepText: `沿真实岸线 ${layout.summary.runLengthM} m、间距 ${layout.summary.spacingM} m 排出 ${layout.summary.stations} 个钓位；本版只出预览，未写入画布。`,
    };
  }

  /** 沿线（巡游/赛道线参照）预览构建：补给站贴线、起终点区、拱门节点；地图参照补赛事中心线。 */
  function routeLinePreviewBuild(plan: SitePlanData, message: string): ReferencePreviewResult {
    const proposal = proposeRouteLineLayout(
      {
        lines: [
          ...(mapRef.current.roadLines?.() ?? []),
          ...plan.routes
            .filter(route => route.kind === "pedestrian")
            .map(route => ({ id: route.id, name: route.name, points: route.points, widthM: route.widthM ?? 3 })),
        ],
        boundary: plan.boundary,
        demand: parseRouteLineDemand(message),
        obstacles: plan.facilities.map(facilityFootprintRing),
        exclusions: plan.zones.map(zone => zone.polygon),
      },
      () => crypto.randomUUID(),
    );
    if (!proposal.ok) return { ok: false, message: proposal.message };
    const { layout } = proposal;
    return {
      ok: true,
      next: {
        ...plan,
        zones: [...plan.zones, ...layout.zones],
        facilities: [...plan.facilities, ...layout.facilities],
        routes: [...plan.routes, ...layout.routes],
        nodes: [...plan.nodes, ...layout.nodes],
      },
      label: `沿线排布·${layout.summary.lineName}（${layout.summary.stations} 个补给站）`,
      warnings: layout.summary.warnings,
      designStepText: `沿线路 ${layout.summary.runLengthM} m、间距 ${layout.summary.spacingM} m 排出 ${layout.summary.stations} 个补给站；本版只出预览，未写入画布。`,
    };
  }

  /**
   * 2026-11-17：参照排布（沿岸/沿线）的确定性接管——ask 与 zones/objects/revise 共用一条路径。
   * 返回 true = 本轮已按参照排布处理（出预览/给下一步/亮失败），调用方直接 return；
   * 返回 false = 没接管（画布未就绪），调用方落回原路径。
   */
  async function referencePreview(
    kind: "shoreline" | "route-line",
    message: string,
    continueDesign: boolean,
    existingJob?: { epoch: number; controller: AbortController; scope: string; actorId?: string | null } | null,
  ): Promise<boolean> {
    const job = existingJob ?? start(continueDesign);
    const before = JSON.stringify(callbacks.current.bridge()?.getPlan());
    try {
      await mapContext(job.controller.signal);
      const referencePlan = callbacks.current.bridge()?.getPlan();
      if (!live(job)) return true;
      if (!referencePlan) return false;
      if (JSON.stringify(referencePlan) !== before) {
        status("读取期间画布已变化，请基于当前规划重新预览。", "blocked");
        return true;
      }
      const result =
        kind === "shoreline"
          ? shorelinePreviewBuild(referencePlan, message)
          : routeLinePreviewBuild(referencePlan, message);
      if (result.ok) {
        designStep(result.designStepText);
        await offer(result.next, "objects", result.label, job, result.warnings);
        return true;
      }
      askForDetails(result.message);
      return true;
    } catch (error) {
      // 取消就静默结束；真失败（如校验拦截）如实亮出原因，不回退到「问方位」。
      if (error instanceof DOMException && error.name === "AbortError") return true;
      status(
        error instanceof Error
          ? error.message
          : "参照排布未完成；请在地图上确认参照位置后重试。",
        "blocked",
      );
      return true;
    }
  }
  function askForDetails(question: string) {
    // 轮次 109：反问只问“现在要什么”，但上一句里已经交代过的后置活（“最后再调通道”）
    // 不能因为正在追问就消失——气泡与提示条都把它补上，用户才看得出后半句没被吞。
    const note = deferredNote(priorUserTextRef.current);
    callbacks.current.say(question + note, true);
    status("补充对话里的信息后可以继续。" + note, "ask");
  }
  /** 2026-11-17：红卡上的「下一步」——按卡上写的那个动作真正推进，而不是把同一个动作原样重放。 */
  async function applyNoticeFix() {
    const fix = noticeFix;
    if (!fix) return;
    setNoticeFix(null);
    await action(fix.action);
  }

  function clarify(message: string): boolean {
    const bridge = callbacks.current.bridge();
    const plan = bridge?.getPlan();
    if (!bridge || !plan) return false;
    const question = outdoorClarificationQuestion(message, plan, bridge.selectedIds?.() ?? []);
    if (!question) return false;
    start();
    setBusy(false);
    if (stateRef.current.pendingLogin) {
      const { pendingLogin: _pendingLogin, ...kept } = stateRef.current;
      persist(kept);
    }
    askForDetails(question);
    return true;
  }

  /**
   * 任务卡入口：已有合法红线的户外方案里，直接用 Aholo Lux3D 造一件道具。
   * 只打开现成的生成面板（额度确认、提交回执、unknown 锁都在那里）；本次不提交、不扣额度。
   */
  function startLux3dGeneration(prompt = ""): boolean {
    const bridge = callbacks.current.bridge();
    const plan = bridge?.getPlan();
    if (!plan || !checkBoundaryRing(plan.boundary).ok) {
      status("还没有可用的活动红线：先在图上圈定活动范围，再用 Aholo Lux3D 生成道具；本次没有创建任务。", "blocked");
      return false;
    }
    const facility = lux3dFacilityTarget(plan.facilities, bridge?.selectedIds?.() ?? []);
    openLux3dDialogGeneration({ facility, prompt });
    status(
      `已打开 Aholo Lux3D 生成面板${facility ? `（生成结果回填「${facility.name}」）` : "（生成结果先进模型库）"}；勾选额度并提交后才会创建任务，本次没有提交。`,
    );
    return true;
  }

  async function handle(message: string, clarification?: OutdoorClarification, images?: string[], documents?: AgentDocument[], trace?: { turnKey: string; sessionId: string; turnIndex: number; projectId?: string }): Promise<boolean> {
    if (!callbacks.current.bridge()?.applyPlan) return false;
    const waiting = pendingPlanRef.current;
    if (waiting && (explicitProposalApproval(message) || /^批准(?:这(?:份|个))?计划[。！!]?$/u.test(message.trim()))) {
      await approvePlan(waiting);
      return true;
    }
    if (explicitProposalApproval(message) && proposalRef.current) {
      await confirm();
      return true;
    }
    if (
      /^(?:取消|停下|停止|先停一下|不要这版)[。！!]?$/u.test(message.trim())
    ) {
      cancel();
      return true;
    }
    const plan = callbacks.current.bridge()?.getPlan();
    if (!plan) return false;
    lastActionRef.current=null;
    lastRequestRef.current={scope:scopeRef.current,ownerId:currentActorId(),message,clarification,images:images??[],documents:documents??[]};
    // 2026-11-20 P1：选中对象 + 明确位移句在本地完成，先于模型理解。
    // 「按东侧 / 按屏幕」只在上一次真问过方向口径时当成回答，避免吞掉地名。
    if (!clarification) {
      if (basisAsked.current) {
        const basis = parseRightBasisAnswer(message);
        if (basis) {
          basisAsked.current = false;
          // 2026-11-20 P1：3D 里「屏幕右」随相机转，落不成固定场地方向——当场说清，
          // 别先把口径「记住」再反过来不给用。
          if (basis === 'screen' && callbacks.current.bridge()?.currentView?.() === '3d') {
            const text = '3D 里“屏幕右”随相机转，落不成固定方向；这次说“往东/往西 几米”，或切回 2D 平面再说“往右”。';
            status(text, 'ask');
            callbacks.current.say(text, true);
            return true;
          }
          directionBasis.current = basis;
          status(`记住了：“右”按${basis === 'east' ? '场地东侧（+x）' : '屏幕右边'}算；再说一次怎么移就行。`, 'ready');
          callbacks.current.say(`“右”按${basis === 'east' ? '场地东侧（+x）' : '屏幕右边'}算。`, false);
          return true;
        }
      }
      if (tryLocalAdjust(message)) return true;
    }
    // 对话主路径的生成入口：先认「生成一件新道具」，再走模型理解。
    // 只打开现有生成面板，不提交、不扣额度；「摆/放」句仍归 #167 的落位预览。
    if (!clarification) {
      const lux3d = parseLux3dDialogIntent(message);
      if (lux3d) {
        if (!checkBoundaryRing(plan.boundary).ok) {
          status("还没有可用的活动红线：先在图上圈定活动范围，再用 Aholo Lux3D 生成道具；本次没有创建任务。", "blocked");
          return true;
        }
        const selected = callbacks.current.bridge()?.selectedIds?.() ?? [];
        const facility = lux3dFacilityTarget(plan.facilities, selected, message);
        openLux3dDialogGeneration({ facility, prompt: lux3d.prompt });
        callbacks.current.say(
          `已按这句话打开 Aholo Lux3D 生成面板${facility ? `，生成结果回填「${facility.name}」` : "，生成结果先保存到模型库"}；勾选额度并提交后才会创建任务。`,
        );
        status("已打开 Aholo Lux3D 生成面板；本次没有提交、没有扣额度。");
        return true;
      }
    }
    // 2026-11-17：先认「这句是不是在回答上一轮的二选一」。认出来就把选中的那一项结构化带进理解层；
    // 认不出就清空——绝不让上一轮的选项影响下一句无关的话。
    const choiceReply = clarification
      ? resolveChoiceReply(message, clarification.question)
      : null;
    pendingChoiceRef.current =
      choiceReply && clarification
        ? { request: clarification.request, chosen: choiceReply.chosen }
        : null;
    // 2026-11-14：确定性 objects 预路由（先于理解模型）——「分区名+数量+物件名」清单句直接合成。
    const planForSynth = plan;
    const weddingTurn=!documents?.length&&!images?.length?weddingDesignRequest(message,stateRef.current.brief.event,plan):null;
    if(weddingTurn){
      await act(weddingTurn,message);
      return true;
    }
    const sessionForRouting = callbacks.current.controller();
    const localOnly = (typeof navigator !== "undefined" && !navigator.onLine)
      || !sessionForRouting || (sessionForRouting.getSnapshot && (!sessionForRouting.getSnapshot().user || sessionForRouting.getSnapshot().user?.is_anonymous));
    const synthesizedTurn = localOnly ? synthesizeObjectsTurn(message, planForSynth) : null;
    if (synthesizedTurn) {
      stateRef.current = mergeOutdoorFacts(
        stateRef.current,
        synthesizedTurn,
        message,
      );
      persist(stateRef.current);
      await act(synthesizedTurn, message);
      return true;
    }
    const previousProposal = proposalRef.current;
    // 2026-11-16 线上实测：未登录时先花 14~16s 抓结构化地图上下文，之后才被 UNAUTHENTICATED 拒掉——
    // 用户看到的就是「输入完干等十几秒，最后只有一句登录提示」。先判登录：未登录立刻给登录卡，
    // 不抓地图、不请求模型。确定性动作（确认/取消/物件清单）在更前面已经处理完，不受影响。
    const session = callbacks.current.controller();
    const viewer = session?.getSnapshot?.().user;
    if (session?.getSnapshot && (!viewer || viewer.is_anonymous)) {
      start();
      setBusy(false);
      persist({
        ...stateRef.current,
        pendingLogin: { message, planVersion: planVersion(plan) },
      });
      status("登录后即可使用当前 Agent 模型，场地草稿已保存。", "blocked");
      return true;
    }
    const job = start();
    const base = JSON.stringify(plan);
    const selected = callbacks.current.bridge()?.selectedIds?.() ?? [];
    let modelStarted: number | undefined;
    setThoughtRequest(message);
    setCanvasNote(`已读画布 ${plan.zones.length} 个分区 · ${plan.facilities.length} 项设施`);
    setAwaitingThought(true);
    status(
      "结合当前需求、选中对象与结构化地图依据理解本句；未读取地图像素、未执行修改。",
      "working",
      { stopLabel: "停止查找" },
    );
    try {
      // 选址调研不依赖当前画布的建筑/道路几何，也不该先等一次地图扫描。
      const researching = isVenueResearchRequest(message);
      if (researching) status("正在查本地场地调研与实时地图地点，整理候选和建议。", "working", { stopLabel: "停止查找" });
      const map = researching ? unknownMap : await mapContext(job.controller.signal);
      if (!live(job)) return true;
      // 本轮地图依据是否取全：place 阶段卡据此决定要不要继续承诺「自动为你框选」。
      setMapGap(map.status !== "ready");
      if (map.status === "ready") designStep("已取得结构化地图依据，用来核对请求涉及的位置。");
      if (map.status === "partial") designStep("地图依据只有一部分，缺失的位置需要核对。");
      if (map.status === "unavailable" && !researching) designStep("本轮未取得地图依据，将使用已有规划和输入内容。");
      const turn = await understandOutdoorTurn({
        message,
        documents,
        // 留痕锚点：优先用发送方传来的（含真实 turnIndex / projectId）；
        // 钩子内部重试（登录补发、重试卡）没有上游锚点，按当前会话自补。
        trace: trace ?? (() => {
          const fallbackProjectId = conversationProjectId(callbacks.current.bridge()?.projectId?.());
          return {
            turnKey: conversationTurnKey(),
            sessionId: getActiveAssistantSessionId(input.scope) ?? 'unknown',
            turnIndex: 0,
            ...(fallbackProjectId ? { projectId: fallbackProjectId } : {}),
          };
        })(),
        researchScope: `${input.scope}:${getActiveAssistantSessionId(input.scope) ?? 'local'}`,
        ...(images?.length ? { images } : {}),
        clarification: waiting
          ? { request: waiting.message, question: `待批准的计划：${waiting.steps.join("；")}。请结合用户补充的要求理解本句。` }
          : clarification && {
              ...clarification,
              ...(choiceReply ? { choice: choiceReply.chosen } : {}),
            },
        libraryChoices: libraryChoices.map(
          ({ id, name, width, depth, height }) => ({
            id,
            name,
            width,
            depth,
            height,
          }),
        ),
        ...(selectedLibraryId ? { selectedLibraryId } : {}),
        state: stateRef.current,
        plan,
        ...(previousProposal
          ? {
              proposal: {
                label: previousProposal.label,
                baseVersion: planVersion(
                  JSON.parse(previousProposal.base) as SitePlanData,
                ),
              },
            }
          : {}),
        selected,
        map,
        controller: callbacks.current.controller(),
        signal: job.controller.signal,
        onRequest: () => {
          if (live(job)) {
            modelStarted = performance.now();
          }
        },
        onThought: text => {
          if (live(job)) setThoughtDraft(draft => draft + text);
        },
        provider: callbacks.current.provider?.(),
        model: callbacks.current.model?.() ?? null,
      });
      if (
        !live(job) ||
        JSON.stringify(callbacks.current.bridge()?.getPlan()) !== base
      )
        return true;
      setAwaitingThought(false);
      setThoughtDraft("");
      if (modelStarted !== undefined) setThoughtMs(performance.now() - modelStarted);
      if (stateRef.current.pendingLogin) {
        const { pendingLogin: _pendingLogin, ...kept } = stateRef.current;
        persist(kept);
      }
      setThought(turn.thought?.replace(/\s+/gu, " ").trim() || (
        turn.action === "ask" ? "模型选择直接回复或请你补充信息。"
          : turn.action === "search" ? "模型选择查找目标地点。"
          : "模型已返回本轮处理决定，工作台会按当前任务的规则核对。"
      ));
      callbacks.current.bridge()?.highlightReferences?.(turn.references);
      // Ordinary model output cannot grant confirmation or fees on the user's behalf.
      if (turn.action === "confirm") {
        if (
          !previousProposal ||
          !explicitProposalApproval(message) ||
          !turn.confirmationEvidence ||
          !message.includes(turn.confirmationEvidence)
        ) {
          status(
            "当前没有可确认的提案，或本句没有明确确认意图；没有代替你应用。",
            "blocked",
          );
          return true;
        }
        proposalRef.current = { ...previousProposal, epoch: job.epoch };
        setProposal(proposalRef.current);
        await confirm();
        return true;
      }
      // 2026-11-17 用户拍板：沿岸（钓鱼）与沿线（巡游、马拉松）参照类活动，模型不回 ask、
      // 直接给设计动作时跳过通用计划批准闸门直接出参照预览（预览本身就是确认环节）；
      // 范围未确认则落回通用流程先确认范围。
      const referenceKind = referenceKindFor(message, stateRef.current.brief.event);
      if (
        referenceKind &&
        (turn.action === "zones" || turn.action === "objects" || turn.action === "revise") &&
        stateRef.current.confirmedBoundary === boundaryKey(plan)
      ) {
        if (await referencePreview(referenceKind, message, true, job)) return true;
      }
      const steps = outdoorPlanSteps[turn.action];
      if (steps && /先(?:给|列|拟|出|看).{0,8}计划|先.{0,6}计划.{0,8}(?:确认|批准)/u.test(message)) {
        const zoneNames = turn.facts.zones?.filter(zone => message.includes(zone.evidence)).map(zone => zone.name) ?? [];
        const needsZones = !plan.zones.length && (turn.action === "main-routes" || turn.action === "objects");
        const showZoneNames = zoneNames.length > 0 && (turn.action === "zones" || turn.action === "revise");
        const proposedSteps = [
          ...(needsZones ? ["根据已知用途先拟分区，核对后再推进下一步"] : []),
          ...steps.map((step, index) => showZoneNames && index === steps.length - 1
            ? `${step}（${zoneNames.join("、")}）`
            : step),
        ];
        updatePendingPlan({ steps: proposedSteps, turn, message, base, selected: JSON.stringify(selected), job, documents: documents??[], imageCount: images?.length??0 });
        status("计划已拟好，等你批准。", "confirm");
        return true;
      }
      const constraintBefore = JSON.stringify({brief:stateRef.current.brief,stage:stateRef.current.stage,completed:stateRef.current.completed});
      await act(turn, message, true, documents, images?.length??0);
      // A neutral clarification is not cancellation or authorization. Only the unchanged
      // scope checkpoint may remain pending; never retain a geometric/model proposal
      // across unstructured new requirements. Cancel/new facts/new actions still invalidate.
      if (turn.action === "ask" && previousProposal?.kind === "scope" && live(job) &&
          previousProposal.base === JSON.stringify(callbacks.current.bridge()?.getPlan()) &&
          constraintBefore === JSON.stringify({brief:stateRef.current.brief,stage:stateRef.current.stage,completed:stateRef.current.completed})) {
        proposalRef.current = {...previousProposal,epoch:job.epoch};
        setProposal(proposalRef.current);
      }
    } catch (error) {
      const errorStatus =
        error && typeof error === "object" && "status" in error
          ? String((error as { status?: unknown }).status)
          : undefined;
      if (
        live(job) &&
        error &&
        typeof error === "object" &&
        (("code" in error && error.code === "UNAUTHENTICATED") ||
          (error instanceof Error && error.message === "UNAUTHENTICATED"))
      ) {
        const owner = callbacks.current.controller()?.getSnapshot?.().user;
        const alreadyLoggedIn = Boolean(owner && !owner.is_anonymous);
        persist({
          ...stateRef.current,
          pendingLogin: {
            message,
            planVersion: planVersion(plan),
            ...(owner && !owner.is_anonymous ? { ownerId: owner.id } : {}),
          },
        });
        // 2026-11-14 用户指令：已登录还撞 401 = 凭证失效，不是没登录——文案不再虚假承诺「登录即可用模型」。
        status(
          alreadyLoggedIn
            ? "登录状态已失效，请重新登录；场地草稿已保存。"
            : "登录后即可使用当前 Agent 模型，场地草稿已保存。",
          "blocked",
        );
      } else if (
        live(job) &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "AGENT_UNDERSTANDING_DISABLED"
      ) {
        // 2026-11-14 用户指令：模型未配置不是登录问题——登录恢复流程里撞到它就把登录卡摘掉，终止循环。
        if (stateRef.current.pendingLogin) {
          const { pendingLogin: _pendingLogin, ...kept } = stateRef.current;
          persist(kept);
        }
        status(
          error instanceof Error
            ? error.message
            : "当前环境未开启 Agent 理解模型，规划未变。",
          "blocked",
        );
        if (errorStatus) setNoticeView(agentErrorView(errorStatus));
      } else if (live(job)) {
        status(
          error instanceof Error
            ? error.message
            : "本次理解/提案无法核对，未执行。",
          "blocked",
        );
        if (errorStatus) setNoticeView(agentErrorView(errorStatus));
      }
    } finally {
      if (live(job)) {
        setAwaitingThought(false);
        setThoughtDraft("");
        setBusy(false);
      }
    }
    return true;
  }
  async function importLibraryGlb(file: File) {
    if (renderedToken !== token.current || renderedScope !== scopeRef.current) {
      status("文件选择所属任务已经变化，未导入其他活动。", "blocked");
      return;
    }
    const job = start();
    try {
      const [
        { validateLocalGlbPick, newLocalGlbKey },
        { importLocalGlb },
        { registerGeneratedFacilityModel },
      ] = await Promise.all([
        import("../lib/glb-import"),
        import("../three/glb-assets"),
        import("../lib/facility-generated-models"),
      ]);
      const error = validateLocalGlbPick(file);
      if (error) throw new Error(error);
      const asset = await importLocalGlb(file, newLocalGlbKey());
      if (!live(job)) return;
      const modelSlug = `generated:${asset.key}`;
      registerGeneratedFacilityModel({
        projectId: callbacks.current.bridge()?.projectId?.() ?? input.scope,
        slug: modelSlug,
        name: asset.name,
        glbUrl: asset.key,
        width: asset.width,
        depth: asset.depth,
        height: asset.height,
        facilityId: `library-${asset.key}`,
        facilityName: asset.name,
        createdAt: Date.now(),
        sessionOnly: true,
      });
      setLibraryChoices([
        {
          id: asset.key,
          name: asset.name,
          source: "personal",
          width: asset.width,
          depth: asset.depth,
          height: asset.height,
          modelSlug,
          available: true,
        },
      ]);
      setSelectedLibraryId(asset.key);
      status(
        "已在本机解析GLB真实尺寸，尚未摆放、未上传、未收费。此导入仅本会话有效；请说明放哪个区、多少件后预览。",
        "ready",
      );
    } catch (error) {
      if (live(job))
        status(
          error instanceof Error ? error.message : "GLB无法核对，未导入。",
          "blocked",
        );
    } finally {
      if (live(job)) setBusy(false);
    }
  }
  async function previewStyle(bundle: StyleBundle) {
    if(renderedToken!==token.current||renderedScope!==scopeRef.current){status('色板所属任务已变化，请在当前活动重新预览。','blocked');return;}
    const bridge=callbacks.current.bridge(),base=bridge?.getPlan();
    if(!base){status('当前活动规划尚未载入，未创建风格预览。','blocked');return;}
    const baseVersion=JSON.stringify(base),job=start();refsRef.current=[];
    try{
      await mapContext(job.controller.signal);
      if(!live(job))return;
      if(JSON.stringify(callbacks.current.bridge()?.getPlan())!==baseVersion)throw new Error('规划已变化，请重新选择色板预览。');
      await offer(proposeOutdoorStyle(base,bundle),'style',`「${bundle.name}」现有设施配色`,job,['只换设施主色，尺寸和占地不动；模型自带材质不跟着变。']);
    }catch(error){if(live(job))status(error instanceof Error?error.message:'配色预览无法核对，未修改。','blocked');}
    finally{if(live(job))setBusy(false);}
  }
  const renderedToken = token.current;
  const renderedScope = input.scope;
  /**
   * 2026-11-18 用户指令「随画随出卡」：分区卡上的改名/用途/室内外/删除，与画布编辑走
   * 同一条 applyPlan 提交（validateWorkflowPlan + commitPlan，可整批撤销）；画布自己在
   * 删分区时会把落单的 workers/facilities 摘出该分区，这里保持同一语义。
   */
  function commitZones(mutate: (plan: SitePlanData) => SitePlanData): boolean {
    const bridge = callbacks.current.bridge();
    const plan = bridge?.getPlan();
    if (!plan || !bridge?.applyPlan) return false;
    return bridge.applyPlan(mutate(plan), planVersion(plan));
  }
  const zoneEdits = {
    renameZone: (id: string, name: string): boolean => {
      const text = name.trim();
      if (!text) return false;
      return commitZones(plan => ({
        ...plan,
        zones: plan.zones.map(z => (z.id === id ? { ...z, name: text } : z)),
      }));
    },
    setZoneEvent: (id: string, event: string): boolean => {
      const text = event.trim();
      return commitZones(plan => ({
        ...plan,
        zones: plan.zones.map(z => {
          if (z.id !== id) return z;
          if (!text) {
            const next = { ...z };
            delete next.event;
            return next;
          }
          return { ...z, event: text };
        }),
      }));
    },
    setZoneEnvironment: (
      id: string,
      environment: NonNullable<SitePlanData["zones"][number]["environment"]>,
    ): boolean =>
      commitZones(plan => ({
        ...plan,
        zones: plan.zones.map(z => (z.id === id ? { ...z, environment } : z)),
      })),
    deleteZone: (id: string): boolean =>
      commitZones(plan => ({
        ...plan,
        zones: plan.zones.filter(z => z.id !== id),
        workers: plan.workers.map(w => (w.zoneId === id ? { ...w, zoneId: undefined } : w)),
        facilities: plan.facilities.map(f => (f.zoneId === id ? { ...f, zoneId: undefined } : f)),
      })),
  };
  /**
   * 2026-11-20 P1：结果卡里的分区/设施 → 画布定位。
   * 只读：不改坐标、不改选中以外的状态；画布没有定位接口时如实说，不用「假装飞过去」。
   */
  function locateDesignEntities(ids: readonly string[]): void {
    const bridge = callbacks.current.bridge();
    const plan = bridge?.getPlan();
    if (!bridge || !plan) {
      setLocateNote("画布尚未载入，无法定位。");
      return;
    }
    const available = ids.filter((id) => plan.facilities.some((facility) => facility.id === id));
    if (!available.length) {
      setLocateNote("这一项没有可直接定位的设施（分区/流线定位还需画布提供接口）。");
      return;
    }
    const first = plan.facilities.find((facility) => facility.id === available[0]);
    // 优先整组入镜：画布提供 focusEntities 时一次把这一组都塞进视口；
    // 没有就回落到既有 inspectFacility（只聚焦第一件，并在提示里如实说明是同一组）。
    const groupWide = bridge.focusEntities?.(available) ?? false;
    if (groupWide) {
      setLocateNote(
        `已在画布框出这一组${available.length > 1 ? `（${available.length} 件）` : `「${first?.name ?? "设施"}」`}；之后不再继续跟拍。`,
      );
      return;
    }
    const ok = bridge.inspectFacility?.(available[0]) ?? false;
    setLocateNote(
      ok
        ? `已在画布定位「${first?.name ?? "设施"}」${available.length > 1 ? `，同组 ${available.length} 件` : ""}；视角只随选中移动，不再继续跟拍。`
        : "画布没有提供定位接口，没有改变视角。",
    );
  }

  /** 下一句的显式对象：选中 id 与可读名字（最多 2 个，避免卡上一长串）。 */
  function designSelectionView(): { count: number; labels: string[]; detached: boolean } {
    const plan = callbacks.current.bridge()?.getPlan();
    // 件数也只数「现在还在画布上的」：选中后又被删掉的对象不该出现在上下文条里（审计 B7 同类）。
    const present = plan
      ? selectionIds.filter((id) => plan.facilities.some((facility) => facility.id === id))
      : [];
    const labels = plan
      ? present
          .map((id) => plan.facilities.find((facility) => facility.id === id)?.name)
          .filter((name): name is string => Boolean(name))
          .slice(0, 2)
      : [];
    return { count: present.length, labels, detached: selectionDetached };
  }

  /**
   * 2026-11-20：应用一版改动。先按真实差异算风险，再走既有监督档（严格档每步都问，
   * 关键节点只问覆盖/删除/大范围，自动档直接执行）；档位不改锁定与版本校验。
   */
  function commitDesignChange(
    next: SitePlanData,
    before: SitePlanData,
    label: string,
    kind: DesignPending["kind"],
    extras: { summary?: DesignSummary; title?: string } = {},
  ): boolean {
    const bridge = callbacks.current.bridge();
    const plan = bridge?.getPlan();
    if (!bridge?.applyPlan || !plan) {
      status("画布当前不可用，未应用；原方案保留。", "blocked");
      return false;
    }
    if (JSON.stringify(plan) !== JSON.stringify(before)) {
      status("画布在你确认前又改过，这一版没有覆盖；原方案保留。", "blocked");
      return false;
    }
    // 确认卡等待期间图层也可能被锁定，写入瞬间必须重查。
    if (kind !== "undo" && bridge.facilityLayerLocked?.()) {
      status("设施层已锁定：这次改动没有写入画布。", "blocked");
      return false;
    }
    if (!bridge.applyPlan(next, JSON.stringify(before))) {
      status("画布拒绝写入（版本或保存身份变化），原方案保留。", "blocked");
      return false;
    }
    const change = describePlanChange(diffPlanObjects(before, next), next);
    setLastEdit(kind === "undo" ? null : { before, label, appliedVersion: planVersion(next) });
    setDesign((prev) =>
      prev
        ? {
            ...prev,
            title: extras.title ?? prev.title,
            summary: extras.summary ?? prev.summary,
            // 撤销后状态写「已撤销」，不再挂「可撤销」的字样：画布已经回到应用前，
            // 再说「已应用 · 可撤销」会让人以为还能再撤一次（实际只会得到「没有可撤销的这次应用」）。
            state: kind === "undo" ? "reverted" : "applied",
            change,
            // 撤销后不再留「再撤销一次」的按钮；再点一次就是重做，这不是用户要的语义。
            undoBefore: kind === "undo" ? null : before,
            appliedVersion: planVersion(next),
          }
        : prev,
    );
    setDesignPending(null);
    setLocateNote(null);
    status(
      `已应用「${label}」：${change.headline}${kind === "undo" ? "；已回到这次应用前的完整方案" : "；可撤销一次"}。`,
      "done",
    );
    designStep(`本次变化：${change.headline}。`);
    return true;
  }

  function requestDesignChange(
    next: SitePlanData,
    before: SitePlanData,
    label: string,
    kind: DesignPending["kind"],
    extras: { summary?: DesignSummary; title?: string } = {},
  ): "applied" | "pending" | "blocked" {
    // 撤销是回到我们刚保存的快照，本身可再应用，不再叠一层确认。
    if (kind !== "undo" && callbacks.current.bridge()?.facilityLayerLocked?.()) {
      // 采用候选/局部位移都在改写现有设施，锁定层上不写；撤销放行（回到锁定前的快照）。
      status("设施层已锁定：这次改动没有写入画布。先在图层里解锁设施层，再说一次。", "blocked");
      return "blocked";
    }
    if (kind !== "undo") {
      const risk = outdoorActionRisk(before, next, label);
      const gate = gateAction(currentSupervision(), risk);
      if (gate.required) {
        setDesignPending({ label, why: gate.why, next, before, kind, ...extras });
        status(gate.why, "confirm");
        return "pending";
      }
    }
    return commitDesignChange(next, before, label, kind, extras) ? "applied" : "blocked";
  }

  function confirmDesignPending(): void {
    const pending = designPending;
    if (!pending) return;
    commitDesignChange(pending.next, pending.before, pending.label, pending.kind, {
      ...(pending.summary ? { summary: pending.summary } : {}),
      ...(pending.title ? { title: pending.title } : {}),
    });
  }

  function dismissDesignPending(): void {
    if (!designPending) return;
    setDesignPending(null);
    status("已取消这次应用；画布保持原样。", "ready");
  }

  /** 撤销：整份写回应用前的快照——对象 id、桌号引用、分区归属一起回来，不是逐条反推。 */
  function undoDesignApply(): void {
    const before = lastEdit?.before ?? design?.undoBefore;
    const appliedVersion = lastEdit?.appliedVersion ?? design?.appliedVersion;
    const current = callbacks.current.bridge()?.getPlan();
    if (!before || !current) {
      status("没有可撤销的这次应用。", "blocked");
      return;
    }
    if (!appliedVersion || planVersion(current) !== appliedVersion) {
      status("画布在这次应用后又改过，旧的整场撤销没有覆盖新内容；请使用画布的逐步撤销。", "blocked");
      return;
    }
    requestDesignChange(before, current, "撤销这次应用", "undo");
  }

  /**
   * 比较方案：按同一份边界/物料算出两种分区配比，只换卡片数据；采用前不改画布视角。
   *
   * 2026-11-20 修正一处真问题：原来按 strategy 跑两遍规划器，但规划器返回的 `report.plan`
   * 永远是「推荐版」的布局（strategy 只影响推荐的取舍，不影响返回值），所以 A、B 拿到的
   * 其实是同一份 plan、同一份数量、同一段取舍文案——比较卡看起来有两版，采用哪版都一样。
   * 现在一次规划就带出两版，各用各的 plan / 数量 / 动线自检 / 差异，并如实说清差在哪。
   */
  async function openDesignCompare(): Promise<void> {
    const inputData = designInput.current;
    const current = callbacks.current.bridge()?.getPlan();
    if (!inputData || !current) {
      status("还没有可比较的婚礼方案；先生成一版，再说比较。", "blocked");
      return;
    }
    const compareBase = JSON.stringify(current);
    setCompareBusy(true);
    setCompareNote(null);
    try {
      const controller = new AbortController();
      const report = await proposeWeddingLayout({
        plan: inputData.plan,
        brief: inputData.brief,
        library: inputData.library,
        hardBlocks: inputData.hardBlocks,
        optimize: false,
        signal: controller.signal,
      });
      const candidates: DesignCompareCandidate[] = report.candidates.map((item) => {
        const strategy = item.id;
        const summary = buildDesignSummary({
          plan: item.plan,
          quantities: item.quantities,
          checks: {
            collisions: item.hardConflicts.collisions,
            boundary: item.hardConflicts.boundary,
            obstacles: item.hardConflicts.obstacles,
            corridors: item.hardConflicts.corridors,
            ceremonySeats: item.metrics.ceremonySeats,
            banquetSeats: item.metrics.banquetSeats,
            target: item.metrics.target,
            access: "pending",
            safety: "unverified",
          },
          notes: report.notes,
          reachability: item.reachability,
          strategy,
          ...(inputData.guests ? { guests: inputData.guests } : {}),
        });
        return {
          id: strategy === "ceremony-first" ? "A" : "B",
          label: item.label,
          strategy,
          plan: item.plan,
          summary,
          tradeoffs: item.tradeoffs,
          metrics: item.metrics,
          // 两版变更多少：设施 / 分区 / 动线三类枚举都算一项；这一版跟自己原始方案比，不跟另一版比。
          diff: {
            added: item.diff.facilities.added + item.diff.zones.added + item.diff.routes.added,
            removed: item.diff.facilities.removed + item.diff.zones.removed + item.diff.routes.removed,
            changed: item.diff.facilities.changed + item.diff.zones.changed + item.diff.routes.changed,
          },
        };
      });
      setDesignCompare({ activeId: "A", candidates, base: compareBase });
      setCompareNote(compareNoteFor(candidates));
    } catch (error) {
      status(error instanceof Error ? error.message : "另一版没有算出来；当前方案保留。", "blocked");
    } finally {
      setCompareBusy(false);
    }
  }

  /**
   * 比较卡的口径说明：两版确实有差别就写差别在哪；算下来一模一样就照实说「分不出差别」，
   * 不把同一份布局包装成两种有取舍的方案。
   */
  function compareNoteFor(candidates: DesignCompareCandidate[]): string {
    const base = "两版按同一份边界与物料计算；切换只换卡片数据，采用前不改画布，也不移动视角。";
    const [first, second] = candidates;
    if (!first || !second) {
      // 场地里已有分区（或非婚礼分区必须原样留下）时，规划器只保得住一版：
      // 照实说，不拿同一份布局复制成两张页签假装有两版。
      return "这块场地已有分区要保留，本轮只算得出一版可比较的方案；要换排法先说「重新排一下」，会在保留锁定与其它分区的前提下重排。";
    }
    const same = (key: keyof WeddingCandidateMetrics) => first.metrics[key] === second.metrics[key];
    const identical = same("ceremonySeats")
      && same("banquetSeats")
      && same("banquetTables")
      && same("ceremonyZoneM2")
      && same("banquetZoneM2")
      && same("entryWalkM")
      && same("serviceRouteM")
      && same("routeCrossings");
    if (identical) {
      return `${base} 这两版算出来的面积、席位与通道完全相同——这块场地分不出两种配比的差别，选哪版容量都一样。`;
    }
    const a = first.metrics;
    const b = second.metrics;
    return `${base} A「${first.label}」仪式区 ${a.ceremonyZoneM2} ㎡、观礼 ${a.ceremonySeats} 席、入口步行 ${a.entryWalkM} m；B「${second.label}」仪式区 ${b.ceremonyZoneM2} ㎡、观礼 ${b.ceremonySeats} 席、入口步行 ${b.entryWalkM} m。`;
  }

  function selectDesignCandidate(id: "A" | "B"): void {
    setDesignCompare((prev) => (prev ? { ...prev, activeId: id } : prev));
  }

  function adoptDesignCandidate(): void {
    const compare = designCompare;
    const current = callbacks.current.bridge()?.getPlan();
    if (!compare || !current) {
      status("没有可采用的候选。", "blocked");
      return;
    }
    const candidate = compare.candidates.find((item) => item.id === compare.activeId);
    if (!candidate) return;
    if (candidate.summary.issues.length) {
      const text = `这一版存在硬冲突，不能直接采用：${candidate.summary.issues.join("；")}。`;
      setCompareNote(text);
      status(text, "blocked");
      return;
    }
    let basePlan: SitePlanData | null = null;
    try {
      basePlan = JSON.parse(compare.base) as SitePlanData;
    } catch {
      basePlan = null;
    }
    // 旧候选不能覆盖较新的手动修改：基座实体被动过就拒绝，并要求重新比较。
    if (!basePlan || JSON.stringify(basePlan) !== JSON.stringify(current)) {
      setCompareNote("画布在你比较期间有了新的修改；这版候选不会覆盖它，请重新比较。");
      status("画布已有更新的修改，这版候选没有覆盖；原方案保留。", "blocked");
      return;
    }
    const result = requestDesignChange(candidate.plan, current, `采用「${candidate.label}」`, "adopt", {
      summary: candidate.summary,
      title: `婚礼布置 · ${candidate.label}`,
    });
    if (result === "applied") {
      setDesignCompare(null);
      setCompareNote(null);
    }
  }

  /** 当前选中 + 明确位移句 → 本地完成，不改其它分区、不重排全场。 */
  function tryLocalAdjust(message: string): boolean {
    const bridge = callbacks.current.bridge();
    const plan = bridge?.getPlan();
    if (!bridge || !plan) return false;
    const ids = selectionDetached ? [] : (bridge.selectedIds?.() ?? []);
    const parse = parseLocalAdjustment(message, {
      selectedCount: ids.length,
      rightBasis: directionBasis.current,
      screenBearingDeg: bridge.viewBearingDeg?.() ?? null,
      view: bridge.currentView?.() ?? "2d",
    });
    if (parse.kind === "none") return false;
    if (parse.kind === "clarify") {
      if (parse.reason === "no-basis-bearing") basisAsked.current = true;
      callbacks.current.say(parse.question, true);
      status(parse.question, "ask");
      return true;
    }
    if (callbacks.current.bridge()?.facilityLayerLocked?.()) {
      // 审计 K3：层锁只锁画布、锁不住清单侧选中；写入前必须自己拦，不能靠选中态。
      callbacks.current.say("设施层现在是锁定的，这组对象我没有移动。先在图层里解锁设施层，再说一次就能改。", true);
      status("设施层已锁定：本次没有移动任何对象，也未写入画布。", "blocked");
      return true;
    }
    const result = applyLocalAdjust(plan, ids, parse.request);
    if (!result.movedIds.length) {
      status(result.note || "选中的对象已不在画布上；没有移动。", "blocked");
      return true;
    }
    const label = parse.request.kind === "spread" ? "把选中的一组拉开" : "移动选中的一组";
    const outcome = requestDesignChange(result.plan, plan, label, "adjust");
    designStep(`本次范围：${parse.request.basisLabel} · 只动选中的 ${result.movedIds.length} 件。`);
    if (outcome === "applied") {
      status(
        `已${parse.request.kind === "spread" ? "拉开" : "移动"}选中的 ${result.movedIds.length} 件（${parse.request.basisLabel}）；${result.note}`,
        "done",
      );
    }
    return true;
  }

  async function action(
    action: OutdoorTurn["action"],
    choice?: number,
    reference?: string,
    query?: string,
    accessKind?: "entry" | "exit" | "both",
  ) {
    if (renderedToken !== token.current || renderedScope !== scopeRef.current) {
      status("这张操作卡已过期，请使用当前任务卡；未执行。", "blocked");
      return;
    }
    lastRequestRef.current=null;
    lastActionRef.current={scope:scopeRef.current,ownerId:currentActorId(),args:[action,choice,reference,query,accessKind]};
    const plan = callbacks.current.bridge()?.getPlan();
    const refs =
      plan && reference
        ? [
            {
              layer: "plan" as const,
              id: reference,
              revision: planVersion(plan),
            },
          ]
        : [];
    try {
      await act(
        {
          action,
          reply: "",
          references: refs,
          facts:
            accessKind && reference
              ? {
                  access: {
                    id: reference,
                    kind: accessKind,
                    evidence:
                      accessKind === "both"
                        ? "已核对双向出入口"
                        : accessKind === "exit"
                          ? "已核对出口"
                          : "已核对入口",
                  },
                }
              : {},
          ...(choice !== undefined ? { choice } : {}),
          ...(query ? { query } : {}),
        },
        accessKind === "both"
          ? "已核对双向出入口"
          : accessKind === "exit"
            ? "已核对出口"
            : accessKind
              ? "已核对入口"
              : "",
      );
    } catch (error) {
      status(
        error instanceof Error ? error.message : "未执行当前动作。",
        "blocked",
        error instanceof OutdoorStepBlocked ? { fix: error.fix } : {},
      );
      setBusy(false);
    }
  }
  async function approvePlan(expected: PendingPlan) {
    if (pendingPlanRef.current !== expected || !live(expected.job)) return;
    updatePendingPlan(null);
    const bridge = callbacks.current.bridge();
    if (JSON.stringify(bridge?.getPlan()) !== expected.base ||
        JSON.stringify(bridge?.selectedIds?.() ?? []) !== expected.selected) {
      status("画布或选中对象已变化，请按当前画布重新拟计划。", "blocked");
      return;
    }
    try {
      await act(expected.turn, expected.message, true, expected.documents, expected.imageCount);
    } catch (error) {
      status(error instanceof Error ? error.message : "未能执行已批准的计划。", "blocked");
    }
  }
  /** 登录完成后恢复这条等待的需求；原账户与规划版本守卫保持原样。 */
  async function resumeAfterLogin(): Promise<void> {
    if (
      renderedScope !== scopeRef.current ||
      renderedToken !== token.current
    ) {
      status("这张恢复卡已过期，未恢复其他任务。", "blocked");
      return;
    }
    const pending = stateRef.current.pendingLogin,
      plan = callbacks.current.bridge()?.getPlan();
    if (!pending || !plan) return;
    if (
      pending.ownerId &&
      callbacks.current.controller()?.getSnapshot?.().user?.id !==
        pending.ownerId
    ) {
      status("请以原账户登录后恢复这条需求；未跨账户执行。", "blocked");
      return;
    }
    if (pending.planVersion !== planVersion(plan)) {
      status(
        "登录期间活动规划已变化；原需求仍保留，请结合当前场地重新说明，未自动恢复旧操作。",
        "blocked",
      );
      return;
    }
    const request=lastRequestRef.current;
    await handle(pending.message,request?.message===pending.message?request.clarification:undefined,
      request?.message===pending.message?request.images:undefined,request?.message===pending.message?request.documents:undefined);
  }
  // 2026-11-16 用户指令：登录后不要再让人点一次「继续这次搜索」——待续需求自动接上，
  // 「已登录 · 可以继续」那张卡不再存在。每条等待只自动续一次；过期/跨账户等守卫失败时
  // resumeAfterLogin 只落一句 blocked 提示，不重复触发。
  const autoResumedLogin = useRef<string | null>(null);
  const accountReady = (() => {
    const viewer = callbacks.current.controller()?.getSnapshot?.().user;
    return Boolean(viewer && !viewer.is_anonymous);
  })();
  useEffect(() => {
    const pending = stateRef.current.pendingLogin;
    if (!pending) {
      autoResumedLogin.current = null;
      return;
    }
    if (!accountReady) return;
    const key = `${pending.planVersion}\u0000${pending.message}`;
    if (autoResumedLogin.current === key) return;
    autoResumedLogin.current = key;
    void resumeAfterLogin();
  }, [state.pendingLogin, accountReady]);
  /** 发布状态的现值：报告、卡片、快照都从这里取，避免同一轮各算一遍而说法不一。 */
  const currentRelease = () => {
    const metrics = summarizeMetrics(metricsBook.current);
    const rows = assessAcceptance(
      buildSessionReport({ turns: traceBook.current.list(), metrics }),
    );
    const book = walkthroughBook.current;
    const cloud = cloudPass.current;
    const bundle = releaseStatusBundle({
      rows,
      metrics,
      evidence: bookToRecord(book),
      cloudPass: cloud,
    });
    return { rows, metrics, bundle, book, cloud };
  };
  /** 报告里带的发布块：快照 + 卡片 + 走查原件 + 云端声明 + 逐条判断，全部同源。 */
  const releaseBlock = () => {
    const { bundle, book, cloud } = currentRelease();
    return {
      snapshot: bundle.snapshot,
      card: bundle.card,
      walkthrough: bookToRecord(book),
      cloud,
      // 判断只认台账：`isAllGreen()` 是全局唯一判据，不从标记推。
      verdicts: bundle.ledger.map((row) => ({ id: row.id, allGreen: isAllGreen(row) })),
      // 待补清单与面板上那块同源：都是 `missingEvidence()` 的行。
      gaps: missingEvidence(bundle.ledger).map((gap) => gap.line),
      sources: { fixedDataIds: FIXED_DATA_CASES, walkthroughAsOf: book.asOf },
    };
  };
  return {
    state,
    retryLastRequest: async ():Promise<boolean> => {
      const request=lastRequestRef.current;
      const previous=request??lastActionRef.current;
      if(!previous||previous.scope!==scopeRef.current||renderedScope!==scopeRef.current)return false;
      if(previous.ownerId!==currentActorId()){
        status('账号已变化，请在当前账号重新发送需求；没有重放原账号请求。','blocked');return true;
      }
      if(request)return handle(request.message,request.clarification,request.images,request.documents);
      await action(...lastActionRef.current!.args);return true;
    },
    designSteps,
    canvasNote: state.scope === input.scope ? canvasNote : null,
    thought: state.scope === input.scope ? thought : null,
    thoughtMs: state.scope === input.scope ? thoughtMs : null,
    thoughtRequest: state.scope === input.scope ? thoughtRequest : null,
    awaitingThought: state.scope === input.scope && busy && awaitingThought,
    thoughtDraft: state.scope === input.scope && busy && awaitingThought ? thoughtDraft : "",
    noticeSticky,
    drawingMode,
    cardRecords: state.scope === input.scope ? cardRecords : [],
    mapGap,
    /** M7.1：只读导出——最近几轮指标（不发请求、不落盘，只拿走数字）。 */
    metricsSummary: () => summarizeMetrics(metricsBook.current),
    /** 把汇总打到控制台并尽量写进剪贴板；返回值说明剪贴板是否发起成功。 */
    exportMetrics: () => exportMetricsReport(summarizeMetrics(metricsBook.current)),
    /** 轨迹 + 指标一份导出；带上发布块（快照/卡片/走查原件/云端声明），四处同源。 */
    sessionReport: () =>
      buildSessionReport({
        turns: traceBook.current.list(),
        metrics: summarizeMetrics(metricsBook.current),
        release: releaseBlock(),
      }),
    /** 把会话报告存成本地 .txt（Web 下载）；导不出时只返回 ok:false，不抛。 */
    downloadReport: () =>
      downloadSessionReport(
        buildSessionReport({
          turns: traceBook.current.list(),
          metrics: summarizeMetrics(metricsBook.current),
          release: releaseBlock(),
        }),
      ),
    /** 报告段落自检：只数标题在不在（缺段≠没问题，也≠可发布）。 */
    reportSections: () =>
      formatSectionCheck(
        buildSessionReport({
          turns: traceBook.current.list(),
          metrics: summarizeMetrics(metricsBook.current),
          release: releaseBlock(),
        }).text,
      ),
    /** 发布前自检：这份报告能判哪几条验收用例、缺什么信号（不产生“通过”结论）。 */
    acceptanceCheck: () => {
      const rows = assessAcceptance(buildSessionReport({ turns: traceBook.current.list(), metrics: summarizeMetrics(metricsBook.current) }));
      return { rows, totals: summarizeAssessment(rows) };
    },
    /** 一行可粘进 PR 的验收声明（固定收尾“三类全绿 0 条，未验部分不作通过”）。 */
    acceptanceStatement: () => formatAcceptanceStatement(assessAcceptance(buildSessionReport({ turns: traceBook.current.list(), metrics: summarizeMetrics(metricsBook.current) }))),
    /** 把整张发布前状态卡打到控制台（前缀 [outdoor-release]，只读，不产生结论）。
     *  台账只算一次：`bundle.ledger` 同时用于打日志与返回快照，
     *  所以不会出现“卡片说 1 条、快照说 0 条”。
     */
    logReleaseStatus: () => {
      const { rows, metrics, bundle } = currentRelease();
      // 用同一份台账再格式一次：日志里那段文本与 `bundle.card` 逐字相同。
      const card = logReleaseStatus({ rows, metrics, ledger: bundle.ledger });
      return { ...bundle, card };
    },
    /** 待补清单：哪几条还差什么，一条一行（空台账写“没有台账”，不写“无缺口”）。 */
    releaseGaps: () => formatGapList(currentRelease().bundle.ledger),
    /** 下一步干哪条：号最小的待补用例 + 先补哪个信号（不下发布结论）。 */
    nextGap: () => formatNextGap(currentRelease().bundle.ledger),
    /** 台账 CSV：表头 + 11 行，五列无“结论”（结论只由状态卡算）。 */
    releaseCsv: () => ledgerToCsv(currentRelease().bundle.ledger),
    /** 把台账存成本地 .csv（带 BOM）；导不出时只返回 ok:false，不抛。 */
    downloadLedgerCsv: () =>
      saveLedgerCsv(currentRelease().bundle.ledger, {
        asOf: walkthroughBook.current.asOf,
        today: new Date().toISOString().slice(0, 10),
      }),
    /** 逐条标一次走查：返回 null 表示编号不合法（这一标没生效）。 */
    recordWalkthrough: (id: number, state: BrowserEvidence) => {
      const next = markSeen(walkthroughBook.current, id, state);
      if (next === walkthroughBook.current) return null;
      walkthroughBook.current = next;
      // 落盘失败（隐私模式/配额）不影响本轮继续标；只是刷新后会丢。
      saveBook(next);
      return next;
    },
    /** 走查进度一行话（只报“看了几条”，不下“可发布”结论）。 */
    walkthroughLine: () => summarizeWalkthrough(walkthroughBook.current).line,
    /** 改走查日期：空串就是“没填”（删字段，不存空串）。 */
    setWalkthroughAsOf: (value: string) => {
      const next = setAsOf(walkthroughBook.current, value);
      walkthroughBook.current = next;
      saveBook(next);
      return next;
    },
    /** 当前记录本（受控面板需要它才能渲染按压态）。 */
    walkthroughBook: () => walkthroughBook.current,
    /** 声明某条用例的云端证据是否真跑过；编号不合法返回 null（不生效）。 */
    declareCloud: (id: number, pass: boolean) => {
      if (!CASE_IDS.includes(id)) return null;
      const next = new Set(cloudPass.current);
      if (pass) next.add(id);
      else next.delete(id);
      cloudPass.current = [...next].sort((a, b) => a - b);
      // 落盘失败（隐私模式/配额）不影响本轮继续声明；只是刷新后会丢。
      saveCloud(cloudPass.current);
      return cloudPass.current;
    },
    /** 当前已声明的云端通过用例号（升序）。 */
    cloudPass: () => cloudPass.current,
    scopeConfirmed: () => {
      const plan = callbacks.current.bridge()?.getPlan();
      return !!plan && (stateRef.current.confirmedBoundary === boundaryKey(plan)
        || (currentSupervision() !== "strict" && !stateRef.current.pendingBoundary && checkBoundaryRing(plan.boundary).ok));
    },
    reconcileCanvasStage,
    proposal,
    pendingPlan: state.scope === input.scope ? pendingPlan : null,
    approvePlan,
    appliedHighlight: state.scope === input.scope ? appliedHighlight : null,
    models,
    busy,
    /** scope 阶段画布上已有合法用地红线（卡片据此直接给核对卡，没红线才教怎么画）。 */
    boundaryReady,
    simulating,
    libraryChoices,
    selectedLibraryId,
    importLibraryGlb,
    chooseLibrary: (id: string) => {
      if (renderedToken !== token.current || renderedScope !== scopeRef.current)
        return;
      if (!libraryChoices.some((c) => c.id === id)) return;
      setSelectedLibraryId(id);
      status("已选定真实库候选，尚未摆放；请补充对应分区和总数量。", "ready");
    },
    notice,
    noticeKind,
    /** 低风险提示条倒计时收场用：只清提示文本，不动任务状态。 */
    dismissNotice: () => {
      setNotice("");
      setNoticeKind("info");
      setNoticeFix(null);
    },
    noticeView,
    /** 缺前置条件时红卡上的「下一步」；null 时卡片仍按原口径提供「重试」。 */
    noticeFix,
    applyNoticeFix,
    loginRequired: Boolean(state.pendingLogin),
    // 2026-11-16：登录卡只在真的没登录时出现（见 outdoor-workflow-card）；登录一旦到位就由
    // 上面的自动恢复 effect 直接续上。loginSatisfied 仍给输入框锁定（agent-panel 的 loginBlocked）用。
    loginSatisfied:
      Boolean(state.pendingLogin) &&
      (() => {
        const user = callbacks.current.controller()?.getSnapshot?.().user;
        return Boolean(user && !user.is_anonymous);
      })(),
    // 2026-11-18 M4 离线切片：面板用它区分「确认没登录」与「会话快照拿不到」。只有前者才允许
    // 把分区/活动句拦截到本地确定性模板（见 agent-panel layout 分支）；快照未知时维持模型路径，
    // 「模型不可用显式报暂未启用、不偷跑旧模板」的生产口径不变。
    viewerKnownAnonymous: (() => {
      const session = callbacks.current.controller();
      if (!session?.getSnapshot) return false;
      const viewer = session.getSnapshot().user;
      return !viewer || Boolean(viewer.is_anonymous);
    })(),
    authChanged: (nextActor: string | null) => {
      setThought(null);
      setThoughtRequest(null);
      const pending = stateRef.current.pendingLogin;
      cancel({
        preservePendingLogin: Boolean(
          pending &&
            (!pending.ownerId || !nextActor || pending.ownerId === nextActor),
        ),
      });
    },
    resumeAfterLogin,
    unverifiedEntrances: (
      callbacks.current.bridge()?.getPlan()?.nodes ?? []
    ).filter(
      (n) =>
        n.verification !== "user-confirmed" ||
        (stateRef.current.stage === "people" && n.kind === "entry"),
    ),
    clarify,
    startLux3dGeneration,
    handle,
    action,
    cancel,
    /** 2026-11-18 用户指令「随画随出卡」：画布分区清单（800ms 快照同步）+ 分区卡编辑动作。 */
    drawnZones,
    /** 2026-11-19 T1-d2：真实用地红线（已过 checkBoundaryRing）；null = 还没有或不合格。 */
    boundaryRing,
    zoneEdits,
    /** 2026-11-19 用户反馈：精修卡不空挂——画布上选中的设施（快照同步），没有则出引导句。 */
    selectedFacility,
    /**
     * 2026-11-20 P1：一版方案的结果卡数据。null = 还没出过婚礼方案。
     * 只在这里组装展示模型；真源仍是 design state + 画布 plan。
     */
    designResult: design
      ? {
          title: design.title,
          summary: design.summary,
          state: design.state,
          change: design.change ? { headline: design.change.headline, details: design.change.details } : null,
          pending: designPending ? { why: designPending.why } : null,
          selection: designSelectionView(),
          compare: designCompare
            ? {
                activeId: designCompare.activeId,
                candidates: designCompare.candidates.map((candidate) => ({
                  id: candidate.id,
                  label: candidate.label,
                  seats: `观礼 ${candidate.summary.capacity.ceremonySeats} · 宴席 ${candidate.summary.capacity.banquetSeats} · 目标 ${candidate.summary.capacity.target} 人`,
                  // 取舍用这一版自己算出来的数（面积 / 席位 / 通道 / 路线交叉），
                  // 不用摘要里那条通用理由——那条两版常常一模一样，看不出差别。
                  tradeoff: candidate.tradeoffs.join("；"),
                  diff: candidate.diff,
                })),
              }
            : null,
          compareBusy,
          compareNote,
          locateNote,
        }
      : null,
    /** 没有结果卡时（比如只对选中对象做了一次位移），确认条仍然要看得见。 */
    designPendingApply: designPending ? { label: designPending.label, why: designPending.why } : null,
    /** 打开候选比较（异步算另一版）；面板与测试都可以直接用这个入口。 */
    openDesignCompare,
    designActions: {
      onLocateZone: (zoneId: string) => {
        const plan = callbacks.current.bridge()?.getPlan();
        locateDesignEntities(plan ? plan.facilities.filter((facility) => facility.zoneId === zoneId).map((facility) => facility.id) : []);
      },
      onLocateSelection: () => {
        setSelectionDetached(false);
        locateDesignEntities(selectionIds);
      },
      onClearSelection: () => {
        setSelectionDetached(true);
        status("已清除下一句的对象引用；画布上的选中不变，重新点选可再次带上。", "ready");
      },
      onUndo: undoDesignApply,
      onConfirmPending: confirmDesignPending,
      onDismissPending: dismissDesignPending,
      onOpenCompare: () => void openDesignCompare(),
      onCloseCompare: () => {
        setDesignCompare(null);
        setCompareNote(null);
      },
      onSelectCandidate: (id: string) => {
        if (id === "A" || id === "B") selectDesignCandidate(id);
      },
      onAdoptCandidate: adoptDesignCandidate,
    },
    confirmProposal: confirm,
    previewStyle,
    offerBoundary,
    manualBoundary,
    manualCanceled,
    manualApplied,
    cycleObjectsLayout,
    active: token.current !== null && callbacks.current.current(token.current),
  };
}
