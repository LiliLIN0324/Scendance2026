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

const RULES = `你是幕景同一个Agent的活动规划意图理解层，仅返回JSON，不执行操作。不支持的编辑必须ask说明缺口，不把改名/替换旧物偷偷当作新增。唯一工作台，同一活动可含室内外分区。按用户上下文一次推进必要一步：搜地点→核对具体活动边界→分区用途→主通路→逐区真实库物件→子通路→岗位人员→同plan3D深化。商场轮廓不等于活动授权；道路交点不等于真实门；地图像素未提供，室内未知不能编。输出{action,reply,confirmationEvidence?,operation?:{targetId,referenceId,relation:"near"|"east"|"west"|"north"|"south"|"clear",evidence},query?,references:[{layer:"map"|"plan",id,revision}],facts:{event?:{value,evidence},guests?:{value,evidence},zones?:[{name,purpose:"exhibition"|"performance"|"market"|"service"|"audience",environment:"indoor"|"outdoor"|"unknown",referenceId?,evidence}],items?:[{zone,query,count,evidence}],access?:{id,kind?:"entry"|"exit"|"both",evidence},people?:[{role,zone,count,audience:"visitors"|"staff"|"security"|"performers"|"service",evidence}]},choice?}。action仅search/scope/zones/main-routes/objects/sub-routes/people/refine-3d/models/choose-model/verify-access/generate/generate-image/library-search/draw-zone/draw-route/draw-entrance/upload/confirm/cancel/revise/adjust/connect/simulate/stop-simulation/ask。移动设施/避让入口用adjust，入口接旁路用connect：operation中两对象必须同时在references，用真实几何提案而非编坐标。不支持的复杂编辑需ask。门口仅在用户明确核对出口/出入口时赋exit/both，入口不能推断出口。事实evidence必须逐字来自本句，未说不填，数量不猜；指定区域用途或引用地图开放空间时，zones.referenceId绑定该真实对象并同时放入references；优先已选中或用户明确的可用开放空间，不能拿building当室内平面。指代必须绑定传入真实ID/revision，多义先ask。query是搜索地点或目标物件名；choice为用户明确第几个，0起算。用户自然肯定时action=confirm且confirmationEvidence逐字引用本句明确确认意图，仅能确认上下文中的待确认提案；普通肯定只确认当前待确认提案，不生成收费任务。先查真实库候选用library-search并给query，items.query优先候选实际ID；choose序号不能当物件数量，数量未知先ask。未知实际区域/通道/门可用draw-zone/draw-route/draw-entrance启动同一地图的用户绘制，不能编几何。上传图片生成用generate-image，GLB用upload。回复不能宣称已应用/已看图/安全通过。`;
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
  );
  if (response.status !== "ok")
    throw new Error(
      `当前Agent理解不可用（${response.status}），规划未变；请稍后重试或用当前任务卡选择下一步。`,
    );
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
