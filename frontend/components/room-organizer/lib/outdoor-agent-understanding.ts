import { validateModelReferences } from "@/lib/site-intelligence";
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
export async function understandOutdoorTurn(input: {
  message: string;
  state: OutdoorFlowState;
  plan: SitePlanData;
  selected: string[];
  map: OutdoorMapContext;
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
    | (Pick<BackendSession, "assistantChat"> & {
        getSnapshot?: () => {
          user: { id: string; is_anonymous?: boolean } | null;
        };
      })
    | null;
  signal: AbortSignal;
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
  const fixedContext = {
    stage: input.state.stage,
    pendingProposal: input.proposal,
    libraryChoices: input.libraryChoices,
    selectedLibraryId: input.selectedLibraryId,
    brief: input.state.brief,
    version,
    selected: [...selected],
    objects: input.map.planIds ? undefined : compact,
    map: {
      version: input.map.version,
      status: input.map.status,
      unknowns: input.map.issued ? undefined : input.map.unknowns,
    },
  };
  // Budget the entire unescaped request first, including rules, complete brief and all candidates.
  // A fresh issued context is built at the remaining budget; never trim/relabel an issued object.
  const mapBudget =
    6000 -
    RULES.length -
    input.message.length -
    JSON.stringify({ ...fixedContext, mapContext: null }).length -
    32;
  let issuedForTurn = input.map.issued;
  if (input.map.issue) {
    if (mapBudget < 1200)
      throw new Error(
        "当前需求/候选已接近通道上限，请用卡片选择本轮具体候选；需求约束未删除。",
      );
    issuedForTurn = input.map.issue(Math.min(3400, mapBudget));
  }
  const context = JSON.stringify({
    ...fixedContext,
    mapContext: issuedForTurn ?? input.map.text,
  });
  // Existing authenticated, opt-in, read-only model method. No new provider or undocumented API.
  // Refuse an oversized required context instead of silently dropping constraints.
  const chunks = [
    ...(RULES.match(/[\s\S]{1,1100}/g) ?? []),
    ...(context.match(/[\s\S]{1,1100}/g) ?? []),
  ];
  if (
    chunks.some((c) => c.length > 1200) ||
    chunks.length > 8 ||
    chunks.reduce((n, c) => n + c.length, 0) + input.message.length > 6000
  )
    throw new Error(
      "当前地图与需求上下文过大，请先选中具体区域或物件缩小范围；未省略关键约束、未执行。",
    );
  const response = await input.controller.assistantChat(
    input.message,
    chunks.map((text) => ({ role: "user", text })),
    input.signal,
    "outdoor_v1",
    input.provider && input.provider !== "default" ? input.provider : undefined,
    input.model ?? null,
  );
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
  const turn = outdoorTurnSchema.parse(raw);
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
