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
  );
  if (response.status !== "ok") {
    const error = new Error(
      response.status === "disabled"
        ? "当前环境未开启 Agent 理解模型（本机未配置 AGENT_CHAT），规划未变；可用当前任务卡继续，或为本机配置模型后重试。"
        : `当前Agent理解不可用（${response.status}），规划未变；点「重试」再试一次，或用当前任务卡选择下一步。`,
    );
    // 2026-11-14 用户指令：模型未配置不是登录问题——打标记码让工作流把登录卡摘掉，终止「登录→重试→还不行」循环。
    if (response.status === "disabled") (error as Error & { code?: string }).code = "AGENT_UNDERSTANDING_DISABLED";
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
    if (!checked.ok)
      throw new Error(
        `地图/规划引用无效或不是本轮发出对象：${checked.errors.join("；")}`,
      );
  } else
    for (const ref of turn.references) {
      if (
        ref.layer === "plan" &&
        (ref.revision !== version || !compact.some((o) => o.id === ref.id))
      )
        throw new Error("规划对象引用已过期或不明确，未执行，请重新选中。");
      if (ref.layer === "map")
        throw new Error("当前没有已发出的地图上下文，无法接受地图引用。");
    }
  return turn;
}
