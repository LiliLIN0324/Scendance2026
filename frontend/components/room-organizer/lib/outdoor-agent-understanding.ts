import { validateModelReferences } from "@/lib/site-intelligence";
import type { ModelContext } from "@/lib/site-intelligence/context";
import type { BackendSession } from "@/lib/backend-session";
import {
  outdoorTurnSchema,
  planVersion,
  type OutdoorFlowState,
  type OutdoorMapContext,
  type OutdoorTurn,
} from "./outdoor-agent-contract";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import type { ChatProviderId } from "../../../../supabase/functions/_shared/chat-provider";

import { OUTDOOR_AGENT_RULES as RULES } from "../../../../supabase/functions/_shared/outdoor-agent-response-contract";

export function outdoorClarificationQuestion(
  message: string,
  plan: SitePlanData,
  selected: readonly string[],
): string | null {
  const straight = /(?:全程|整条路)(?:都|必须|要|保持|是|为|走|的|\s)*直线/u;
  const turn = /(?:拐|转)[^，。；]{0,8}(?:直角|90\s*[°度])/u;
  const positiveClauses = message.split(/[，。；,;]|但是?/u)
    .filter(clause => !/不用|不需要|不必|不要求|无需|不能|禁止|不要/u.test(clause));
  if (/(?:同一条|但|又要|同时|还要)/u.test(message) &&
      positiveClauses.some(clause => straight.test(clause)) &&
      positiveClauses.some(clause => turn.test(clause))) {
    return "同一条路线无法既全程走直线，又在中途拐直角。你想保留整条直线，还是允许分段转弯？";
  }

  const vagueMove = /(?:它|这个|那个)(?:(?:往|向|朝)(?:这边|那边)(?:挪|移|搬)|(?:挪|移|搬)到(?:这边|那边))/u;
  if (!vagueMove.test(message)) return null;
  const targets = plan.facilities.filter(facility => message.includes(facility.name));
  const selectedFacilities = plan.facilities.filter(facility => selected.includes(facility.id));
  const target = targets.length === 1 ? targets[0] : targets.length === 0 && selectedFacilities.length === 1 ? selectedFacilities[0] : undefined;
  return target
    ? `你想把「${target.name}」挪到哪个位置？可以说方向和距离，或者指明它要靠近哪个设施。`
    : "你想挪动哪个设施、挪到哪个位置？可以说设施名、方向和距离，例如「把签到台往东挪两米」。";
}

export type OutdoorClarification = { request: string; question: string };

export async function understandOutdoorTurn(input: {
  message: string;
  state: OutdoorFlowState;
  plan: SitePlanData;
  selected: string[];
  map: OutdoorMapContext;
  clarification?: OutdoorClarification | undefined;
  libraryChoices?: Array<{
    id: string;
    name: string;
    width: number;
    depth: number;
    height: number;
  }>;
  selectedLibraryId?: string;
  proposal?: { label: string; baseVersion: string };
  controller:
    | (Pick<BackendSession, "assistantChat"> & Partial<Pick<BackendSession, "assistantChatStream">> & {
        getSnapshot?: () => {
          user: { id: string; is_anonymous?: boolean } | null;
        };
      })
    | null;
  signal: AbortSignal;
  onRequest?: () => void;
  onThought?: (text: string) => void;
  provider?: ChatProviderId | undefined;
  model?: string | null | undefined;
}): Promise<OutdoorTurn> {
  if (!input.controller)
    throw new Error(
      "当前Agent模型理解尚未连接。需求与规划已保留；可先用对话卡明确选择下一步，不会冒充已经理解或布置。",
    );
  if (input.controller.getSnapshot) {
    const user = input.controller.getSnapshot().user;
    if (!user || user.is_anonymous)
      throw Object.assign(new Error("UNAUTHENTICATED"), {
        code: "UNAUTHENTICATED",
      });
  }
  const version = planVersion(input.plan);
  const objects = [
    ...input.plan.zones.map((z) => ({
      id: z.id,
      type: "zone",
      name: z.name,
      event: z.event,
      environment: z.environment,
    })),
    ...input.plan.facilities.map((f) => ({
      id: f.id,
      type: "facility",
      name: f.name,
      zoneId: f.zoneId,
    })),
    ...input.plan.routes.map((r) => ({
      id: r.id,
      type: "route",
      name: r.name,
      kind: r.kind,
    })),
    ...input.plan.nodes.map((n) => ({ id: n.id, type: "node", name: n.name })),
  ];
  const selected = new Set(input.selected);
  const compact = objects
    .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)))
    .slice(0, 25);
  // ── 上下文预算（docs/47 E1，2026-11-17）：优先整份发出；装不下按三级降级，绝不静默丢约束 ──
  // 级0与旧逻辑一致（预算够则照旧 issue 整份证据）；级①把地图证据压成摘要视图（issued 本体
  // 不改写，引用仍按整份 issued 校验）；级②精简 fixedContext 的候选/提示（brief/selected/version
  // 等约束字段原样保留）；连最小可行上下文都装不下时仍明确拒绝。凡降级，声明追加进 reply。
  const CHANNEL_LIMIT = 6000;
  const clarification = input.clarification ? { clarification: input.clarification } : {};
  const clarificationCost = JSON.stringify(clarification).length;
  const ruleChunks = RULES.match(/[\s\S]{1,1100}/g) ?? [];

  const buildFixedContext = (level: 0 | 1 | 2) => {
    const staging =
      input.plan.zones.length === 0
        ? "同时要求分区和设计主通道或排布物料时，action 保留 main-routes 或 objects，本句明确的分区写入 facts.zones。补答分区问题时延续原请求的设计目标；先预览分区，确认后再做详细预览。"
        : undefined;
    const base = {
      stage: input.state.stage,
      pendingProposal: input.proposal,
      selectedLibraryId: input.selectedLibraryId,
      brief: input.state.brief,
      version,
      selected: [...selected],
      map: {
        version: input.map.version,
        status: input.map.status,
        unknowns: input.map.issued ? undefined : input.map.unknowns,
      },
    };
    if (level === 0)
      return {
        ...base,
        staging,
        libraryChoices: input.libraryChoices,
        objects: input.map.planIds ? undefined : compact,
      };
    if (level === 1)
      return {
        ...base,
        staging,
        // 候选名截断保留 id/尺寸——choose-model 仍可按 id 选，不受长文案挤占。
        libraryChoices: input.libraryChoices?.map((c) => ({
          id: c.id,
          name: c.name.slice(0, 24),
          width: c.width,
          depth: c.depth,
          height: c.height,
        })),
        objects: input.map.planIds ? undefined : compact,
      };
    return base;
  };
  const fixedLenAt = (level: 0 | 1 | 2) =>
    JSON.stringify({ ...buildFixedContext(level), mapContext: null }).length;

  type EvidencePlan = {
    mapContext: unknown;
    issuedForTurn: ModelContext | undefined;
    note: string | null;
  };
  const freshIssue = (maxChars: number): EvidencePlan => {
    const issuedForTurn = input.map.issue!(maxChars);
    return { mapContext: issuedForTurn, issuedForTurn, note: null };
  };
  // 证据摘要：issued 的压缩视图，保留 id/revision/kind/名称/边界，几何与关系省略；
  // 校验仍对整份 issued 做，所以摘要里看不见的对象引用会被如实追问而不是误放行。
  const issuedSummaryView = (
    issued: ModelContext,
    budget: number,
  ): Record<string, unknown> | null => {
    const summaryObjects = issued.objects.map((o) => ({
      reference: o.reference,
      kind: o.kind,
      name: o.name.slice(0, 40),
      boundsM: o.boundsM,
      geometryOmitted: true,
      selected: o.selected,
    }));
    const base = {
      schemaVersion: 1 as const,
      projectId: issued.projectId,
      revision: issued.revision,
      crs: issued.crs,
      ...(issued.anchor ? { anchor: issued.anchor } : {}),
      coverage: issued.coverage,
      warnings: issued.warnings.slice(0, 2),
      relations: [],
      instruction:
        "证据已压缩为摘要：仅保留对象ID/名称/边界，几何与关系已省略；引用仍按ID+revision。",
    };
    let kept = 0;
    while (kept < summaryObjects.length) {
      const view = {
        ...base,
        objects: summaryObjects.slice(0, kept + 1),
        omittedObjects: issued.objects.length - kept - 1,
        truncated: true,
      };
      if (JSON.stringify(view).length > budget) break;
      kept++;
    }
    const view = {
      ...base,
      objects: summaryObjects.slice(0, kept),
      omittedObjects: issued.objects.length - kept,
      truncated: true,
    };
    return JSON.stringify(view).length <= budget ? view : null;
  };
  const summaryEvidence = (budget: number): EvidencePlan => {
    const full = input.map.issued
      ? JSON.stringify(input.map.issued)
      : input.map.text;
    if (full.length <= Math.max(0, budget))
      return {
        mapContext: input.map.issued ?? input.map.text,
        issuedForTurn: input.map.issued,
        note: null,
      };
    if (input.map.issued) {
      const view = issuedSummaryView(input.map.issued, Math.max(0, budget));
      if (view)
        return {
          mapContext: view,
          issuedForTurn: input.map.issued,
          note: "地图证据已压缩为摘要",
        };
    }
    return {
      mapContext: {
        version: input.map.version,
        status: input.map.status,
        unknowns: input.map.unknowns,
      },
      issuedForTurn: input.map.issued,
      note: "地图证据未随本轮携带，仅保留覆盖声明",
    };
  };

  const fitsChannel = (history: Array<{ text: string }>) =>
    history.length <= 8 &&
    history.every((h) => h.text.length <= 1200) &&
    input.message.length + history.reduce((n, h) => n + h.text.length, 0) <=
      CHANNEL_LIMIT;

  type Attempt = {
    history: Array<{ role: "user"; text: string }>;
    issuedForTurn: ModelContext | undefined;
    notes: string[];
  };
  const attempt = (
    level: 0 | 1 | 2,
    evidence: EvidencePlan,
    withClarification: boolean,
  ): Attempt => {
    const context = JSON.stringify({
      ...buildFixedContext(level),
      ...(withClarification ? clarification : {}),
      mapContext: evidence.mapContext,
    });
    const history = [
      ...ruleChunks,
      ...(context.match(/[\s\S]{1,1100}/g) ?? []),
    ].map((text) => ({ role: "user" as const, text }));
    return {
      history,
      issuedForTurn: evidence.issuedForTurn,
      notes: [
        ...(evidence.note ? [evidence.note] : []),
        ...(level === 1 ? ["候选名称已精简"] : level === 2 ? ["候选与提示已精简"] : []),
      ],
    };
  };

  // 级0保持旧决策：follow-up 不得挤占下一轮校验所需的地图证据预算。
  const baseMapBudget0 =
    CHANNEL_LIMIT -
    RULES.length -
    input.message.length -
    fixedLenAt(0) -
    32;
  const requiredMapBudget0 = input.map.issue
    ? 1200
    : JSON.stringify(input.map.issued ?? input.map.text).length;
  const includeClarification0 =
    input.clarification !== undefined &&
    baseMapBudget0 - clarificationCost >= requiredMapBudget0;
  const evidenceBudget0 =
    baseMapBudget0 - (includeClarification0 ? clarificationCost : 0);
  const evidence0 =
    input.map.issue && evidenceBudget0 >= 1200
      ? freshIssue(Math.min(3400, evidenceBudget0))
      : summaryEvidence(evidenceBudget0);
  const first = attempt(0, evidence0, includeClarification0);

  let chosen: Attempt;
  if (fitsChannel(first.history)) {
    chosen = first;
  } else {
    // 分级降级：①证据摘要（fixed 不动）→ ②fixedContext 精简两级；澄清问题能在预算内就带上。
    const budgetAt = (level: 0 | 1 | 2) =>
      CHANNEL_LIMIT - RULES.length - input.message.length - fixedLenAt(level) - 32;
    const hasClar = input.clarification !== undefined;
    const ladder: Array<{ level: 0 | 1 | 2; evidence: EvidencePlan; clar: boolean }> = [];
    for (const level of [0, 1, 2] as const) {
      if (hasClar)
        ladder.push({
          level,
          evidence: summaryEvidence(budgetAt(level) - clarificationCost),
          clar: true,
        });
      ladder.push({ level, evidence: summaryEvidence(budgetAt(level)), clar: false });
    }
    const matched = ladder
      .map(({ level, evidence, clar }) => attempt(level, evidence, clar))
      .find((candidate) => fitsChannel(candidate.history));
    if (!matched)
      throw new Error(
        "本场内容超出单轮上下文上限，无法在不丢约束的前提下理解；请拆成多轮逐步说明，或缩小范围/减少分区数量后重试；未执行。",
      );
    chosen = matched;
  }
  const provider = input.provider && input.provider !== "default" ? input.provider : undefined;
  const model = input.model ?? null;
  input.onRequest?.();
  const response = input.onThought && input.controller.assistantChatStream
    ? await input.controller.assistantChatStream(input.message, chosen.history, input.signal, input.onThought, provider, model, "outdoor_v1")
    : await input.controller.assistantChat(input.message, chosen.history, input.signal, "outdoor_v1", provider, model, true);
  if (response.status !== "ok") {
    const error = new Error(
      response.status === "disabled"
        ? "当前环境未开启 Agent 理解模型（本机未配置 AGENT_CHAT），规划未变；可用当前任务卡继续，或为本机配置模型后重试。"
        : `当前Agent理解不可用（${response.status}），规划未变；点「重试」再试一次，或用当前任务卡选择下一步。`,
    ) as Error & { code?: string; status?: string };
    // 透出后端失败状态，供工作流按四档错误卡归类；机器码只在内部流转，不再裸进用户文案。
    error.status = response.status;
    // 2026-11-14 用户指令：模型未配置不是登录问题——打标记码让工作流把登录卡摘掉，终止「登录→重试→还不行」循环。
    if (response.status === "disabled") error.code = "AGENT_UNDERSTANDING_DISABLED";
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(response.answer.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error(
      "Agent没有返回可核对的操作结构，未执行；请补充具体对象或用任务卡选择。",
    );
  }
  let turn = outdoorTurnSchema.parse(raw);
  // E1：降级必须在 reply 里如实声明，绝不静默丢约束。
  if (chosen.notes.length) {
    const notice = `本场内容较多，已按精简后的范围理解（${chosen.notes.join("；")}）；你的需求与约束全部保留。`;
    turn = { ...turn, reply: turn.reply ? `${turn.reply}\n${notice}` : notice };
  }
  const issuedForTurn = chosen.issuedForTurn;
  if (issuedForTurn) {
    const checked = validateModelReferences(
      {
        references: turn.references.map(({ id, revision }) => ({
          id,
          revision,
        })),
      },
      issuedForTurn,
    );
    if (!checked.ok) {
      // 2026-11-14 用户拍板「引用无效不该是死路，要有追问」：
      // ①剥掉无效引用与悬空 referenceId（下游 zones() 能兜底自动排布），能继续就继续；
      // ②动作本身绑着坏对象（operation 的 target/reference）时无法安全继续 → 转成
      //   action=ask 的追问回复，不再甩红错卡卡死对话。
      const validIds = new Set(issuedForTurn.objects.map(o => o.reference.id));
      const validRefs = turn.references.filter(ref => ref.revision === issuedForTurn.revision && validIds.has(ref.id));
      const sanitizedFacts = turn.facts?.zones
        ? {
            ...turn.facts,
            zones: turn.facts.zones.map(zone =>
              zone.referenceId && !validIds.has(zone.referenceId)
                ? { ...zone, referenceId: undefined }
                : zone,
            ),
          }
        : turn.facts;
      const sanitized: OutdoorTurn = {
        ...turn,
        references: validRefs,
        ...(turn.facts?.zones ? { facts: sanitizedFacts } : {}),
      };
      const targetBad = turn.operation?.targetId ? !validIds.has(turn.operation.targetId) : false;
      const refBad = turn.operation?.referenceId ? !validIds.has(turn.operation.referenceId) : false;
      if (targetBad || refBad) {
        return {
          ...sanitized,
          operation: undefined,
          action: "ask",
          reply: `${turn.reply || "这句话里有我没找到的对象"}——你提到的对象在当前地图/规划里不存在（可能是旧引用）。请用名称再说一次，或先在画布上选中它；刚才这句我没有执行。`,
        };
      }
      return sanitized;
    }
  } else
    for (const ref of turn.references) {
      if (
        ref.layer === "plan" &&
        (ref.revision !== version || !compact.some((o) => o.id === ref.id))
      )
        // 2026-11-14 同口径：引用过期转追问，不死路。
        return {
          ...turn,
          operation: undefined,
          action: "ask",
          reply: `${turn.reply || "这句话里有我没找到的对象"}——你引用的规划对象已过期或不在当前方案，请重新说明，或先在画布上选中它；刚才这句我没有执行。`,
        };
      if (ref.layer === "map")
        return {
          ...turn,
          operation: undefined,
          action: "ask",
          reply: "当前没有可用的地图上下文，处理不了地图引用；请先用文字说明对象，或重新定位场地后再说一次。",
        };
    }
  return turn;
}
