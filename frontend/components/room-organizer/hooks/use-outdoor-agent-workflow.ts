import { useEffect, useRef, useState } from "react";
import type { BackendSession } from "@/lib/backend-session";
import type { PlanPoint, SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import type { ChatProviderId } from "../../../../supabase/functions/_shared/chat-provider";
import {
  boundaryKey,
  emptyOutdoorFlow,
  mergeOutdoorFacts,
  planVersion,
  type OutdoorAgentBridge,
  type OutdoorFlowState,
  type OutdoorMapContext,
  type OutdoorModelChoice,
  type OutdoorLibraryItem,
  type OutdoorStage,
  type OutdoorTurn,
} from "../lib/outdoor-agent-contract";
import { understandOutdoorTurn } from "../lib/outdoor-agent-understanding";
import {
  proposeUseZones,
  proposeInventoryObjects,
  proposeRoleWorkers,
  validateWorkflowPlan,
  prunePlanForBoundary,
  OBJECTS_LAYOUT_STRATEGIES,
  OBJECTS_LAYOUT_LABELS,
  type ObjectsLayoutStrategy,
} from "../lib/outdoor-agent-planning";
import { readOutdoorPersonalLibrary, readOutdoorBuiltinLibrary } from "../lib/outdoor-personal-library";
// 2026-11-14：直引纯函数库（原从组件模块引入，会把 three.js 级别的依赖链拖进 hook 且有循环风险）。
import { enuToLngLat, lngLatToEnu } from "../lib/outdoor-plan-canvas";
import { fetchOpenFreeMapBuildings, lngLatRingsToEnu } from "../lib/openfreemap-buildings";
import { planPointInRing } from "../lib/site-plan-editing";
import { planRingAreaM2 } from "../../../../supabase/functions/_shared/site-plan";
import { proposeOutdoorStyle } from "../lib/outdoor-style-preview";
import type { StyleBundle } from "../lib/style-bundles";
import { fetchRoadNetwork } from "../lib/road-network";
import { checkBoundaryRing } from "../lib/site-plan-editing";
import { buildRouteProposal, roadFetchPlanForBoundary } from "../lib/route-proposal";
import { buildSubEntranceProposal } from "../lib/sub-entrance";
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
}
export const OUTDOOR_STAGE_LABELS: Record<OutdoorStage, string> = {
  place: "搜索目标地点",
  scope: "核对具体活动范围",
  zones: "分区用途与室内外依据",
  "main-routes": "主要入口与通道",
  objects: "按用途复用我的物料",
  "sub-routes": "物件间隙的子入口与支线",
  people: "岗位、人数与活动路径",
  "refine-3d": "同规划3D深化",
};
const stages = Object.keys(OUTDOOR_STAGE_LABELS) as OutdoorStage[];
const unknownMap: OutdoorMapContext = {
  version: "map:unavailable",
  status: "unavailable",
  text: "基础地图结构化上下文尚未取得；未向模型提供地图像素，不得声称看图；室内门与通道未知。",
  featureIds: [],
  unknowns: ["建筑/开放空间/入口证据未知", "地图像素没有提交模型"],
};
function readState(scope: string): OutdoorFlowState {
  try {
    const value = JSON.parse(
      localStorage.getItem(`scendance:outdoor-flow:${scope}`) ?? "null",
    ) as OutdoorFlowState | null;
    if (
      value?.scope === scope &&
      stages.includes(value.stage) &&
      Array.isArray(value.brief?.zones) &&
      Array.isArray(value.brief?.items) &&
      Array.isArray(value.brief?.people) &&
      Array.isArray(value.completed)
    )
      return value;
  } catch {}
  return emptyOutdoorFlow(scope);
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
  "annotations",
  "measurements",
] as const;

/**
 * 基座快照是否仍原样在画布上：基座里每个实体都没被删/改，且边界、锚点等非实体字段一字未动。
 * 任何一处变动都算「规划已变化」，绝不拿基座快照覆盖用户内容。
 */
function baseStillIntact(base: SitePlanData, current: SitePlanData): boolean {
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
function carryNewEntities(
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
  return {
    ...next,
    zones: carryList(base.zones, next.zones, current.zones),
    facilities: carryList(base.facilities, next.facilities, current.facilities),
    routes: carryList(base.routes, next.routes, current.routes),
    nodes: carryList(base.nodes, next.nodes, current.nodes),
    workers: carryList(base.workers, next.workers, current.workers),
    annotations: carryList(base.annotations ?? [], next.annotations ?? [], current.annotations ?? []),
    measurements: carryList(base.measurements ?? [], next.measurements ?? [], current.measurements ?? []),
  };
}

export function useOutdoorAgentWorkflow(input: {
  scope: string;
  bridge: () => OutdoorAgentBridge | null;
  controller: () => BackendSession | null;
  begin: () => number;
  current: (epoch: number) => boolean;
  status: (task: OutdoorTaskProgress) => void;
  say: (text: string) => void;
  search: (query: string) => void;
  provider?: () => ChatProviderId | undefined;
  model?: () => string | null;
  simulate?: (active: boolean) => boolean;
}) {
  const [state, setState] = useState(() => readState(input.scope));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [proposal, setProposal] = useState<OutdoorWorkflowProposal | null>(
    null,
  );
  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;
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
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "error">("info");
  const refsRef = useRef<OutdoorTurn["references"]>([]);
  const mapRef = useRef<OutdoorMapContext>(unknownMap);
  const abort = useRef<AbortController | null>(null);
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
    extra: Partial<OutdoorTaskProgress> = {},
  ) {
    const friendly = friendlyErrorNotice(action);
    setNotice(friendly);
    setNoticeKind(phase === "blocked" ? "error" : "info");
    callbacks.current.status({
      intent: OUTDOOR_STAGE_LABELS[stateRef.current.stage],
      state: phase,
      action: friendly,
      steps: stateRef.current.completed.map((s) => OUTDOOR_STAGE_LABELS[s]),
      ...extra,
    });
  }
  function start() {
    setSimulating(false);
    refsRef.current = [];
    abort.current?.abort();
    const epoch = callbacks.current.begin();
    token.current = epoch;
    const controller = new AbortController();
    abort.current = controller;
    setProposal(null);
    proposalRef.current = null;
    setModels(null);
    setBusy(true);
    return { epoch, controller, scope: scopeRef.current };
  }
  function live(job: {
    epoch: number;
    controller: AbortController;
    scope: string;
  }) {
    return (
      token.current === job.epoch &&
      !job.controller.signal.aborted &&
      scopeRef.current === job.scope &&
      callbacks.current.current(job.epoch)
    );
  }
  function cancel(options?: { preservePendingLogin?: boolean }) {
    if (simulating) callbacks.current.simulate?.(false);
    setSimulating(false);
    abort.current?.abort();
    callbacks.current.begin(); // Invalidate the shared outer task epoch as well as this hook.
    token.current = null;
    proposalRef.current = null;
    setProposal(null);
    setModels(null);
    setBusy(false);
    if (!options?.preservePendingLogin) {
      const { pendingLogin: _pendingLogin, ...kept } = stateRef.current;
      persist({ ...kept, pendingBoundary: undefined });
    }
    status("已取消当前预览/请求；已应用规划和需求保留。", "stopped");
  }
  useEffect(() => {
    abort.current?.abort();
    token.current = null;
    setProposal(null);
    proposalRef.current = null;
    setModels(null);
    setLibraryChoices([]);
    setSelectedLibraryId(undefined);
    setBusy(false);
    setSimulating(false);
    const next = readState(input.scope);
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
    const i = stages.indexOf(stage);
    const completed = [...new Set([...stateRef.current.completed, stage])];
    persist({
      ...stateRef.current,
      completed,
      stage: stages[Math.min(stages.length - 1, i + 1)]!,
    });
  }
  function requireScope(plan: SitePlanData) {
    if (stateRef.current.confirmedBoundary !== boundaryKey(plan)) {
      persist({
        ...stateRef.current,
        stage: "scope",
        confirmedBoundary: null,
        completed: stateRef.current.completed.filter((s) => s === "place"),
      });
      throw new Error(
        "先核对地图上具体哪一片是本次活动范围。地点/商场轮廓不是活动授权边界；确认前不会分区或摆物件。",
      );
    }
  }
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
    job: { epoch: number; controller: AbortController; scope: string },
    warnings: string[] = [],
  ) {
    const base = callbacks.current.bridge()?.getPlan();
    if (!base || !live(job)) return;
    validateWorkflowPlan(base, next);
    warnings = [
      ...warnings,
      ...(callbacks.current.bridge()?.validateMapPlan?.(base, next) ?? []),
    ];
    const p = {
      kind,
      label,
      base: JSON.stringify(base),
      mapVersion: kind === "scope" ? "map:unavailable" : mapRef.current.version,
      epoch: job.epoch,
      next,
      warnings,
      references: [...refsRef.current],
    };
    proposalRef.current = p;
    setProposal(p);
    status(`${label}预览已就绪；核对后确认才写入，可整批撤销。`, "confirm");
  }
  async function confirm(expected?: OutdoorWorkflowProposal) {
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
    // 2026-11-14 用户实测：提案基座拍快照之后用户新画的实体（如室内分区）不该让提案整张失效，
    // 也不该在应用时被基座快照冲掉——「纯新增」放行并把新增实体并回提案（一条 undo）；
    // 基座实体被删改、或边界/锚点等非实体字段变了仍然失效（防静默丢失用户内容）。
    const baseObj = JSON.parse(p.base) as SitePlanData;
    const expire = () => {
      proposalRef.current = null;
      setProposal(null);
      status("当前规划已变化，旧提案已失效；请基于最新场地重算。", "blocked");
    };
    if (!baseStillIntact(baseObj, plan)) {
      expire();
      return;
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
    try {
      validateWorkflowPlan(plan, p.next);
      bridge?.validateMapPlan?.(plan, p.next);
    } catch (error) {
      setProposal(null);
      proposalRef.current = null;
      status(
        error instanceof Error
          ? error.message
          : "当前几何依据无法核对，未应用。",
        "blocked",
      );
      return;
    }
    if (!owns()) return;
    const applyBase = bridge?.getPlan();
    // 应用前按最新画布再并一次：新增实体已带进 p.next，所以应用基准就是当前画布（仍是同一条 undo）。
    if (!applyBase || !mergeLatest(applyBase)) return;
    if (!bridge?.applyPlan?.(p.next, JSON.stringify(applyBase))) {
      status("画布当前不可写或保存身份变化，未应用；原规划保留。", "blocked");
      return;
    }
    proposalRef.current = null;
    setProposal(null);
    if (p.kind === "scope") {
      persist({ ...stateRef.current, confirmedBoundary: boundaryKey(p.next), pendingBoundary: undefined });
      nextStage("scope");
    } else if (p.kind === "verify-access") {
      persist({
        ...stateRef.current,
        stage: ["sub-routes", "people", "refine-3d"].includes(
          stateRef.current.stage,
        )
          ? stateRef.current.stage
          : "objects",
      });
    } else if (p.kind === "style") {
      // Cosmetic only: do not advance or confirm any venue/layout stage.
    } else if (p.kind === "model") {
      persist({ ...stateRef.current, stage: "refine-3d" });
    } else nextStage(p.kind);
    status(
      `已应用「${p.label}」。下一步：${OUTDOOR_STAGE_LABELS[stateRef.current.stage]}；也可直接补充要求或回退修改。`,
      "done",
    );
  }
  function offerBoundary(
    anchor: NonNullable<SitePlanData["anchor"]>,
    boundary: SitePlanData["boundary"],
    name: string,
  ) {
    const base = callbacks.current.bridge()?.getPlan();
    if (!base) return;
    const job = start();
    persist({
      ...stateRef.current,
      stage: "scope",
      confirmedBoundary: null,
      completed: ["place"],
      pendingBoundary: { anchor, boundary, name, base: JSON.stringify(base) },
    });
    callbacks.current.bridge()?.previewBoundary?.(anchor, boundary);
    try {
      // 2026-11-14 用户拍板「以第一个选区为准」：换边界时旧内容按新边界重新安置（越界随场淘汰，
      // 整批可撤销），不再让「分区越出已确认活动边界」把换场卡死；锚点位移则旧场内容整体清空。
      const pruned = prunePlanForBoundary(base, boundary, anchor);
      const dropped = [
        pruned.droppedZones.length ? `分区 ${pruned.droppedZones.join("、")}` : "",
        pruned.droppedFacilities.length ? `物件 ${pruned.droppedFacilities.join("、")}` : "",
        pruned.droppedRoutes.length ? `流线 ${pruned.droppedRoutes.join("、")}` : "",
      ].filter(Boolean);
      offer(
        { ...pruned.next, anchor, boundary },
        "scope",
        `核对“${name}”中的具体活动范围`,
        job,
        [
          "地图轮廓只是候选，不代表整座商场均可使用；部分使用请重画。",
          ...(pruned.swept ? ["地理锚点已切换：旧场地内容已全部随场清空（确认后整批可撤销）。"] : []),
          ...(!pruned.swept && dropped.length ? [`按新边界随场淘汰：${dropped.join("；")}（确认后整批可撤销）。`] : []),
        ],
      );
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
      "请在同一地图圈出实际活动范围并闭合；完成后还需在对话核对，不把商场整体当活动场地。",
    );
  }
  // 2026-11-14 用户指令「给我几个方案」：物件排布方案基座（objects 动作时的 plan/候选/当前策略）。
  const objectsLayoutRef = useRef<{
    base: SitePlanData;
    library: OutdoorLibraryItem[];
    strategy: ObjectsLayoutStrategy;
  } | null>(null);
  /** 提案卡「换一种排法」：同一基座换下一策略重排，重新出预览（不写盘，确认才应用）。 */
  async function cycleObjectsLayout() {
    const stored = objectsLayoutRef.current;
    const p = proposalRef.current;
    if (!stored || !p || p.kind !== "objects") {
      status("没有可切换的物件排布预览；先说一次物件清单。", "blocked");
      return;
    }
    const job = start();
    const order = OBJECTS_LAYOUT_STRATEGIES;
    const next = order[(order.indexOf(stored.strategy) + 1) % order.length]!;
    try {
      const result = await proposeInventoryObjects(
        stored.base,
        stateRef.current.brief,
        stored.library,
        undefined,
        {
          strategy: next,
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
    offer(pruned.next, "scope", "手画活动范围核对", job, [
      "手画范围来自用户，仍需核对本次活动可用范围。",
      ...(dropped.length ? [`按新边界随场淘汰：${dropped.join("；")}（确认后整批可撤销）。`] : []),
    ]);
    setBusy(false);
  }
  async function act(turn: OutdoorTurn, message: string) {
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
            ? "2D沿已确认路线的流动示意已启动；不是容量/疏散安全模拟。"
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
        throw new Error("想在哪个地点做？请给地点名或地址。");
      persist({
        ...stateRef.current,
        stage: "place",
        confirmedBoundary: null,
        completed: [],
      });
      callbacks.current.search(turn.query);
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
    persist(mergeOutdoorFacts(stateRef.current, normalized, message));
    if (turn.action === "ask") {
      status(turn.reply || "请补充当前活动需求；没有修改规划。", "blocked");
      return;
    }
    const job = start();
    refsRef.current = turn.references.filter(
      (r) => r.id.startsWith("plan:") || r.id.startsWith("osm:"),
    );
    const original = JSON.stringify(plan);
    try {
      if (turn.action === "scope") {
        const candidate = stateRef.current.pendingBoundary;
        if (candidate && candidate.base === JSON.stringify(plan)) {
          offerBoundary(candidate.anchor, candidate.boundary, candidate.name);
          return;
        }
        if (!checkBoundaryRing(plan.boundary).ok) {
          persist({ ...stateRef.current, stage: "place", pendingBoundary: undefined, completed: [] });
          status("当前没有可核对的活动边界，请重新搜索地点并选择候选，或在地图圈出实际范围。");
          return;
        }
        persist({ ...stateRef.current, stage: "scope" });
        offer(plan, "scope", "当前地图活动范围", job, [
          "确认的是本次活动范围，不是地图产权或消防认证。",
        ]);
        return;
      }
      requireScope(plan);
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
        status(
          mode === "zone"
            ? "已在同一地图启动分区手画。按图纸/实测闭合后，告诉我名称、用途和室内外属性，再预览确认。"
            : mode === "route"
              ? "已启动同一地图的人行主通道绘制；请沿真实可用通道连接入口，不把未知室内通路当真实。"
              : "已启动同一地图的入口标注；位置来自用户意图，仍需核对真实门与通行权限。",
          "ready",
        );
        return;
      }
      await mapContext(job.controller.signal);
      if (!live(job)) return;
      if (turn.action === "adjust" || turn.action === "connect") {
        if (!turn.operation || !message.includes(turn.operation.evidence))
          throw new Error("空间变更没有本句依据，未执行。");
        if (!bridge.proposeSpatialEdit)
          throw new Error("地图空间工具尚未接通，未执行。");
        offer(
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
      if (turn.action === "zones" || turn.action === "revise") {
        persist({ ...stateRef.current, stage: "zones" });
        offer(
          bridge.proposeZones
            ? bridge.proposeZones(plan, stateRef.current.brief)
            : proposeUseZones(plan, stateRef.current.brief),
          "zones",
          "分区用途与室内外属性",
          job,
          [
            "室内边界必须由用户图纸或已有手画分区确认；地图不提供室内通道事实。",
          ],
        );
        return;
      }
      if (!plan.zones.length)
        throw new Error(
          "先明确并确认区域用途和边界，再安排通道/物件；不会跳过分区。",
        );
      if (turn.action === "main-routes") {
        persist({ ...stateRef.current, stage: "main-routes" });
        status("读取真实路网证据，出入口交点只作待核对候选。", "working", {
          stopLabel: "停止查找",
        });
        await mapContext(job.controller.signal);
        if (!live(job)) return;
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
        offer(
          {
            ...plan,
            routes: [...plan.routes, ...clipped],
            nodes: [...plan.nodes, ...nodes],
          },
          "main-routes",
          "主要流线与待核对入口",
          job,
          [
            "道路等级只用于候选分类；真实门与室内连接未证实，需逐个核对，不保证可通行。",
            "界外段是到场流线候选（怎么来的），与边界的交点即待核对入口；写入后可画布编辑。",
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
        offer(
          {
            ...plan,
            nodes: plan.nodes.map((n) =>
              n.id === target
                ? {
                    ...n,
                    ...(turn.facts.access?.kind
                      ? { kind: turn.facts.access.kind }
                      : {}),
                    verification: "user-confirmed" as const,
                  }
                : n,
            ),
          },
          "verify-access",
          "用户核对入口可用",
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
            ? "已读到真实个人库候选与尺寸；选定后告诉我对应分区和数量，仍先预览。"
            : "个人库没有可用匹配；可改名检索或在当前卡导入GLB（本机解析真实尺寸、不上传不收费）。",
          "ready",
        );
        return;
      }
      if (turn.action === "objects") {
        persist({ ...stateRef.current, stage: "objects" });
        if (
          !plan.routes.length ||
          !plan.nodes.some(
            (n) => n.kind !== "exit" && n.verification === "user-confirmed",
          )
        )
          throw new Error(
            "请先核对主入口和主要通道；道路交点不当作已经核实的门。",
          );
        if (!stateRef.current.brief.guests)
          throw new Error(
            "预计同时在场多少人？先保留这个人数需求，再核对分区与设施占地；不从物件数量猜人数。",
          );
        status(
          "检索我的物料库真实候选与尺寸；尚未摆放，也没有启动收费生成。",
          "working",
          { stopLabel: "停止查找" },
        );
        const queries = stateRef.current.brief.items.map((i) => i.query);
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
        // 2026-11-14 用户指令「给我几个方案」：物件排布带策略（行列/居中/沿边），提案卡可「换一种排法」循环预览。
        objectsLayoutRef.current = { base: basePlan, library, strategy: "rows" };
        const result = await proposeInventoryObjects(
          basePlan,
          stateRef.current.brief,
          library,
          undefined,
          {
            strategy: "rows",
            buildings: buildingsEnu.length ? buildingsEnu : undefined,
            // 2026-11-14 用户指令「进度条要显示在干嘛」：落位进度实时上屏（逐区刷新状态文字）。
            onPhase: (phase) => status(`正在落位：${phase}`, "working", { stopLabel: "停止查找" }),
            signal: job.controller.signal,
          },
        );
        offer(result.plan, "objects", "逐区复用库内真实设施", job, [
          "物件来自真实个人库；扣占地后仅按2㎡/人作保守草案粗筛，非合法容量；无障碍与疏散需现场核验，不以排下物件当安全通过。",
          `排布方案：${OBJECTS_LAYOUT_LABELS.rows}——卡上「换一种排法」可切换 ${OBJECTS_LAYOUT_LABELS.center}/${OBJECTS_LAYOUT_LABELS.perimeter}。`,
          `已识别边界内建筑 ${buildingsForPlan?.length ?? 0} 栋${buildingsForPlan?.length ? "：标为室内禁区，排物件自动避开（灰色块 2D/3D 同步）。" : "（地图服务暂未提供建筑数据，稍后重试或用物件库「室内区域」手画）。"}`,
        ]);
        return;
      }
      if (turn.action === "sub-routes") {
        persist({ ...stateRef.current, stage: "sub-routes" });
        if (!plan.facilities.length)
          throw new Error(
            "先确认各区实际物件，再沿物件空隙安排子入口和支线；不能先穿过未来展位/表演区。",
          );
        const proposal = buildSubEntranceProposal(plan);
        if (!proposal)
          throw new Error(
            "现有物件/保护区域之间没有可连通的2m人行支线；请选区调整物件或明确已知入口，不会穿展位/表演区。",
          );
        offer(
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
        offer(
          proposeRoleWorkers(plan, stateRef.current.brief),
          "people",
          "按岗位、数量与通路安排人员",
          job,
          [
            "人员活动范围/路线由关联区域及路径限定，不是随机散布或真实疏散模拟。",
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
        offer(
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
          ["占地与通道仍以同一规划守卫核对；不会重新生成收费。"],
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

  async function handle(message: string): Promise<boolean> {
    if (!callbacks.current.bridge()?.applyPlan) return false;
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
    // 2026-11-14：确定性 objects 预路由（先于理解模型）——「分区名+数量+物件名」清单句直接合成。
    const planForSynth = plan;
    const synthesizedTurn = synthesizeObjectsTurn(message, planForSynth);
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
    const job = start();
    status(
      "结合当前需求、选中对象与结构化地图依据理解本句；未读取地图像素、未执行修改。",
      "working",
      { stopLabel: "停止查找" },
    );
    try {
      const map = await mapContext(job.controller.signal);
      if (!live(job)) return true;
      const turn = await understandOutdoorTurn({
        message,
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
        selected: callbacks.current.bridge()?.selectedIds?.() ?? [],
        map,
        controller: callbacks.current.controller(),
        signal: job.controller.signal,
        provider: callbacks.current.provider?.(),
        model: callbacks.current.model?.() ?? null,
      });
      if (
        !live(job) ||
        JSON.stringify(callbacks.current.bridge()?.getPlan()) !==
          JSON.stringify(plan)
      )
        return true;
      if (stateRef.current.pendingLogin) {
        const { pendingLogin: _pendingLogin, ...kept } = stateRef.current;
        persist(kept);
      }
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
      const constraintBefore = JSON.stringify({brief:stateRef.current.brief,stage:stateRef.current.stage,completed:stateRef.current.completed});
      await act(turn, message);
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
      } else if (live(job))
        status(
          error instanceof Error
            ? error.message
            : "本次理解/提案无法核对，未执行。",
          "blocked",
        );
    } finally {
      if (live(job)) setBusy(false);
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
      offer(proposeOutdoorStyle(base,bundle),'style',`「${bundle.name}」现有设施配色`,job,['仅改设施主色；不新增物件、不改变尺寸/占地/通路，不承诺GLB原材质可换色。']);
    }catch(error){if(live(job))status(error instanceof Error?error.message:'配色预览无法核对，未修改。','blocked');}
    finally{if(live(job))setBusy(false);}
  }
  const renderedToken = token.current;
  const renderedScope = input.scope;
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
      );
      setBusy(false);
    }
  }
  return {
    state,
    proposal,
    models,
    busy,
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
    loginRequired: Boolean(state.pendingLogin),
    // 2026-11-14 用户指令：登录完成后这张卡要跟着变——已登录时切换为「继续这次搜索」。
    loginSatisfied:
      Boolean(state.pendingLogin) &&
      (() => {
        const user = callbacks.current.controller()?.getSnapshot?.().user;
        return Boolean(user && !user.is_anonymous);
      })(),
    authChanged: (nextActor: string | null) => {
      const pending = stateRef.current.pendingLogin;
      cancel({
        preservePendingLogin: Boolean(
          pending &&
            (!pending.ownerId || !nextActor || pending.ownerId === nextActor),
        ),
      });
    },
    resumeAfterLogin: async () => {
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
      await handle(pending.message);
    },
    unverifiedEntrances: (
      callbacks.current.bridge()?.getPlan()?.nodes ?? []
    ).filter(
      (n) =>
        n.verification !== "user-confirmed" ||
        (stateRef.current.stage === "people" && n.kind === "entry"),
    ),
    handle,
    action,
    cancel,
    confirmProposal: confirm,
    previewStyle,
    offerBoundary,
    manualBoundary,
    manualApplied,
    cycleObjectsLayout,
    active: token.current !== null && callbacks.current.current(token.current),
  };
}
