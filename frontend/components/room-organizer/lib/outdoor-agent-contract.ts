import { z } from "zod";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

export const outdoorStages = [
  "place",
  "scope",
  "zones",
  "main-routes",
  "objects",
  "sub-routes",
  "people",
  "refine-3d",
] as const;
export type OutdoorStage = (typeof outdoorStages)[number];
export type OutdoorMapEditHighlight =
  | { kind: "scope" }
  | { kind: "zones"; zoneIds: readonly string[] }
  | { kind: "main-routes"; routeIds: readonly string[]; nodeIds: readonly string[] };
import { outdoorTurnSchema } from "../../../../supabase/functions/_shared/outdoor-agent-response-contract";
export { outdoorTurnSchema };
export type OutdoorTurn = z.infer<typeof outdoorTurnSchema>;
export interface OutdoorBrief {
  event?: string;
  guests?: number;
  zones: NonNullable<OutdoorTurn["facts"]["zones"]>;
  items: NonNullable<OutdoorTurn["facts"]["items"]>;
  people: NonNullable<OutdoorTurn["facts"]["people"]>;
}
/**
 * 地图证据对不上时的提示。2026-11-16：scope 阶段边界还没定，证据天然对不上，
 * 用户在圈范围时无法据此做任何事；这条只在排设施、画流线这种真靠证据判断的步骤展开。
 */
export const MAP_EVIDENCE_MISSING_NOTE =
  "地图证据没取到，先按你给的场地参数排；门、障碍、通行补进地图后再核冲突。";

/** scope 卡过滤掉地图证据缺口；其它 kind 原样保留。 */
export function proposalMapWarnings(
  kind: string,
  warnings: readonly string[],
): string[] {
  return kind === "scope"
    ? warnings.filter((warning) => warning !== MAP_EVIDENCE_MISSING_NOTE)
    : [...warnings];
}

export interface OutdoorFlowState {
  scope: string;
  stage: OutdoorStage;
  brief: OutdoorBrief;
  confirmedBoundary: string | null;
  completed: OutdoorStage[];
  pendingBoundary?: { anchor: NonNullable<SitePlanData["anchor"]>; boundary: SitePlanData["boundary"]; name: string; base: string; basis?: import('./agent-venue-range').VenueRangeBasis } | undefined;
  rangeBasis?: import('./agent-venue-range').VenueRangeBasis;
  pendingLogin?: { message: string; planVersion: string; ownerId?: string };
}
export function emptyOutdoorFlow(scope: string): OutdoorFlowState {
  return {
    scope,
    stage: "place",
    brief: { zones: [], items: [], people: [] },
    confirmedBoundary: null,
    completed: [],
  };
}
export function evidencedCount(evidenceText: string, value: number): boolean {
  const normalized = evidenceText
    .normalize("NFKC")
    .replace(/第[零〇一二两三四五六七八九十百千万\d]+[个项]/gu, "");
  const numbers = (normalized.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const units: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1000,
    万: 10000,
  };
  for (const token of normalized.match(
    /[零〇一二两三四五六七八九十百千万]+/g,
  ) ?? []) {
    let total = 0,
      section = 0,
      n = 0;
    for (const c of token) {
      if (c in digits) n = digits[c]!;
      else {
        const unit = units[c]!;
        if (unit === 10000) {
          total += (section + n || 1) * unit;
          section = 0;
          n = 0;
        } else {
          section += (n || 1) * unit;
          n = 0;
        }
      }
    }
    numbers.push(total + section + n);
  }
  return numbers.includes(value);
}
export function mergeOutdoorFacts(
  state: OutdoorFlowState,
  turn: OutdoorTurn,
  message: string,
  /**
   * 上一轮用户原话。2026-11-17：补答上一问时（「1000 张摊位」→「放在摆摊区」），
   * 数量是用户上一句亲口说的，不是模型编的；只放宽“引用出处”，不放宽“必须是用户说的”。
   */
  priorMessage = "",
): OutdoorFlowState {
  const facts = turn.facts;
  // 2026-11-14 实测：多物件长句里模型引用原文时常差空格/全半角，严格 includes 频繁误杀。
  // 归一化（去所有空白 + NFKC）后仍要求连续逐字引用——防编造性质不变，只是不再被排版差异卡死。
  const normalizeEvidence = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
  const normalizedMessage = normalizeEvidence(message);
  const normalizedPrior = normalizeEvidence(priorMessage);
  const proven = (value: { evidence: string }) =>
    normalizedMessage.includes(normalizeEvidence(value.evidence)) ||
    (normalizedPrior.length > 0 &&
      normalizedPrior.includes(normalizeEvidence(value.evidence)));
  // 2026-11-14 实测：模型会把上一轮记住的事实原样重发（evidence 还是更早句子的原文），
  // 本句溯源对「顺带重发且与上一轮完全一致」的事实不适用——跳过；只有新增/变化的事实才要求本句依据。
  const semanticValue = (value: unknown) => value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'evidence' && key !== 'sourceId').sort(([a],[b]) => a.localeCompare(b))) : value;
  const carriedOver = (value: unknown, before: unknown) =>
    before !== undefined && JSON.stringify(semanticValue(before)) === JSON.stringify(semanticValue(value));
  for (const value of [...(facts.zones ?? []), ...(facts.items ?? []), ...(facts.people ?? [])]) {
    if (!value) continue;
    const before = [...state.brief.zones, ...state.brief.items, ...state.brief.people].find(
      (b) => carriedOver(value, b),
    );
    if (before !== undefined) continue;
    if (!proven(value))
      throw new Error("模型提取缺少本句原文依据，请重新说明；没有修改规划。");
  }
  if (facts.guests) {
    const carried = state.brief.guests === facts.guests.value;
    if (!carried && !proven(facts.guests))
      throw new Error("模型提取缺少本句原文依据，请重新说明；没有修改规划。");
    if (!carried && !evidencedCount(facts.guests.evidence, facts.guests.value))
      throw new Error("人数与本句原文数量不一致，请明确人数；未采用模型猜测值。");
  }
  if (facts.event) {
    const carried = state.brief.event === facts.event.value;
    if (!carried && !proven(facts.event))
      throw new Error("模型提取缺少本句原文依据，请重新说明；没有修改规划。");
  }
  if (facts.access && !proven(facts.access))
    throw new Error("模型提取缺少本句原文依据，请重新说明；没有修改规划。");
  // 2026-11-17 增量改口兜底：「再加2个」这种增量说法，模型常把增量当总量回——
  // 现值 25 个回 count=2，需求就从 25 变 2，把摆好的场清掉。这里按已确认数量做确定性折算：
  // 增/减词 + 数量不超过现值 → prev±count；「改成/换成/只要」仍是绝对数；count=0（清空）是绝对数。
  const plusDelta =
    /(再加?|多[放摆加]|添|补[上充])/u.test(message) && !/(改成|换成|改为|只要|就放)/u.test(message);
  const minusDelta =
    /(减[少去掉]?|少[放摆]|拿掉|撤掉|去掉|清空)/u.test(message) && !/(改成|换成|改为)/u.test(message);
  const itemsAfterDelta = (facts.items ?? []).map((item) => {
    if (typeof item.count !== "number" || typeof item.query !== "string" || item.count === 0)
      return item;
    if (plusDelta === minusDelta) return item; // 都不是或都是：不猜，按绝对数走原校验
    const prev = state.brief.items.find(
      (i) =>
        i.query === item.query &&
        typeof i.count === "number" &&
        (i.zone === item.zone || !i.zone || !item.zone),
    );
    if (!prev || item.count > prev.count) return item;
    return {
      ...item,
      count: plusDelta ? prev.count + item.count : Math.max(0, prev.count - item.count),
    };
  });
  const deltaAdjusted = new Set<unknown>(
    itemsAfterDelta.filter((item, index) => item !== (facts.items ?? [])[index]),
  );
  // 同一分区同一物料、数量与已确认的完全一致时，视为沿用旧数字（不是在编新数字）；
  // 只有数量变了才要求本句依据。用户补一句「放在摆摊区」不该把上一句的 1000 张抹掉。
  const sameQuantity = (item: { zone?: string; query?: string; count?: number }) =>
    typeof item.query === "string" &&
    typeof item.count === "number" &&
    state.brief.items.some(
      (i) =>
        i.query === item.query &&
        i.count === item.count &&
        (i.zone === item.zone || !i.zone),
    );
  for (const item of [...itemsAfterDelta, ...(facts.people ?? [])])
    if (
      !deltaAdjusted.has(item) &&
      item.count !== 0 &&
      !evidencedCount(item.evidence, item.count) &&
      !sameQuantity(item) &&
      // An unquantified request to add a named object starts with one editable instance.
      !(facts.items?.includes(item as NonNullable<OutdoorTurn["facts"]["items"]>[number]) &&
        item.count === 1 && "query" in item && item.evidence.includes(item.query) &&
        /加|放|摆|添|布置|装饰|种/u.test(item.evidence) &&
        !/[0-9零一二两三四五六七八九十百千万几多]/u.test(item.evidence))
    )
      throw new Error(
        "物件/岗位数量缺少本句数字依据，请明确总数量，未猜测或应用。",
      );
  const merge = <T>(
    before: T[],
    after: T[] | undefined,
    key: (item: T) => string,
  ): T[] =>
    after
      ? [
          ...before.filter((a) => !after.some((b) => key(a) === key(b))),
          ...after,
        ]
      : before;
  return {
    ...state,
    brief: {
      ...state.brief,
      ...(facts.event ? { event: facts.event.value } : {}),
      ...(facts.guests ? { guests: facts.guests.value } : {}),
      zones: merge(state.brief.zones, facts.zones, (z) => z.name),
      // 2026-11-14：分区物件清单是「整区语义」——本轮提到哪个分区，该区清单整区替换
      //（「舞台区放 1 个舞台」意味着该区就这 1 项，残留的旧物件如被撤掉的音响不清会一直报错）。
      items: (() => {
        const touchedZones = new Set(itemsAfterDelta.map((i) => i.zone));
        // 2026-11-17：还没定分区的占位条目（zone=""）在补上分区后被吸收，
        // 不然会留下一条「不在画布上」的幽灵需求，每轮都报同一个错。
        const absorbed = (i: { zone: string; query: string }) =>
          !i.zone && itemsAfterDelta.some((f) => f.query === i.query);
        return [
          ...state.brief.items.filter((i) => !touchedZones.has(i.zone) && !absorbed(i)),
          ...itemsAfterDelta,
        ];
      })(),
      people: merge(
        state.brief.people,
        facts.people,
        (p) => `${p.zone}:${p.role}:${p.audience}`,
      ),
    },
  };
}
export function boundaryKey(plan: SitePlanData): string {
  return JSON.stringify({
    anchor: plan.anchor ?? null,
    boundary: plan.boundary,
  });
}
export function planVersion(plan: SitePlanData): string {
  // Public reference token only. Confirmation additionally compares the entire base JSON.
  const text = JSON.stringify(plan);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `plan:${(hash >>> 0).toString(16)}`;
}
export interface OutdoorMapContext {
  buildingAreas?(): SitePlanData['boundary'][];
  openAreas?(): Array<{ id: string; name: string; ring: SitePlanData['boundary']; tags: Record<string, string> }>;
  version: string;
  status: "ready" | "partial" | "unavailable";
  /** Structured map module supplies this. Never raster pixels or a claim of visual reading. */
  text: string;
  featureIds: string[];
  planIds?: string[];
  issued?: import("@/lib/site-intelligence/context").ModelContext;
  /** Issue a fresh immutable context within the whole request budget; never trim an issued object. */
  issue?(
    maxChars: number,
  ): import("@/lib/site-intelligence/context").ModelContext;
  sourceIds?: Record<string, string>;
  unknowns: string[];
  /**
   * 2026-11-17「就沿着水岸线」：地图里的水体/水道几何（局部 ENU 米，与 plan 同基准）。
   * 没有就回空数组——岸线缺失要如实说，不能拿底图像素冒充。
   */
  water?: () => import("./outdoor-shoreline-layout").Shoreline[];
  /**
   * 2026-11-17「沿线摆补给站」：地图道路折线（局部 ENU 米，与 plan 同基准），供沿线参照排布。
   * 没有就回空数组——线路缺失要如实说，不拿底图像素冒充。
   */
  roadLines?: () => import("./outdoor-route-line-layout").RouteLine[];
  /**
   * 2026-11-19 docs/47 A2：证据分级明细（hard-block 禁区 / soft-avoid 可摆但有代价 /
   * info 利好）。一行式摘要已随 issued 上下文发给模型；明细供排布引擎（A3）按档消费。
   * 没有就回空档——没有证据就如实说没有，不拿底图像素冒充。
   */
  layoutEvidence?: () => import("./outdoor-layout-weights").LayoutEvidence;
  /**
   * 2026-11-20 docs/47 B1：可布置域（边界 − 建筑足迹 − 道路走廊缓冲 − hard 块）的
   * 网格基底 + 轴对齐矩形集合与指标（可用面积/最大内接矩形）。B2 分区分配的消费点。
   * 轮廓无效时抛明确错误——不猜，不拿包围盒冒充可布置域。
   */
  placeableDomain?: () => import("./outdoor-placeable-domain").PlaceableDomain;
}
export interface OutdoorLibraryItem {
  id: string;
  name: string;
  source: "personal" | "built-in";
  width: number;
  depth: number;
  height: number;
  modelSlug: string;
  available: boolean;
}
export interface OutdoorModelChoice {
  slug: string;
  name: string;
  source: string;
  width?: number;
  depth?: number;
  height?: number;
}
export interface OutdoorAgentBridge {
  getPlan(): SitePlanData | null;
  projectId?(): string;
  selectedIds?(): string[];
  /**
   * 2026-11-20 P1：「向右」的坐标语义要靠这两个只读事实——画布当前朝向与 2D/3D。
   * 未实现时调用方按「读不到朝向」处理并先澄清一次，不假设正北朝上。
   */
  /**
   * 画布相机的方位角（度，0 = 正北，顺时针）。读不到就回 null，不要编一个 0。
   */
  viewBearingDeg?(): number | null;
  currentView?(): "2d" | "3d";
  exportPlanDraft?(expected: string, context: import("./outdoor-plan-handoff").OutdoorDraftContext): boolean;
  applyPlan?(next: SitePlanData, expected: string): boolean;
  previewBoundary?(
    anchor: NonNullable<SitePlanData["anchor"]>,
    boundary: SitePlanData["boundary"],
  ): void;
  /**
   * 地图上看得见、但还没写进 `plan.boundary` 的闭合活动范围（搜索选区）。
   * 没有、或只是道路折线时返回 null。核对用它走现有确认卡，不另起一套写入。
   */
  visibleActivityRange?(): {
    anchor: NonNullable<SitePlanData["anchor"]>;
    boundary: SitePlanData["boundary"];
    name: string;
  } | null;
  applyVenue(
    anchor: NonNullable<SitePlanData["anchor"]>,
    boundary: SitePlanData["boundary"],
  ): boolean;
  beginDrawing?(kind: "zone" | "route" | "node"): boolean;
  beginVenueBoundary(anchor: NonNullable<SitePlanData["anchor"]>): boolean;
  cancelVenueBoundary?(): void;
  clearVenuePreview?(): void;
  previewVenuePoint?(place: { lng: number; lat: number; name: string }): void;
  applyRoutes(
    routes: SitePlanData["routes"],
    nodes: SitePlanData["nodes"],
  ): boolean;
  applyZoneProposal(
    zones: SitePlanData["zones"],
    facilities: SitePlanData["facilities"],
    routes?: SitePlanData["routes"],
    nodes?: SitePlanData["nodes"],
  ): boolean;
  applyWorkers?(workers: SitePlanData["workers"]): boolean;
  applyMeasurements?(
    measurements: NonNullable<SitePlanData["measurements"]>,
  ): boolean;
  applyAnnotations?(
    annotations: NonNullable<SitePlanData["annotations"]>,
  ): boolean;
  getLevels?(): NonNullable<SitePlanData["levels"]>;
  setActiveLevel?(levelId: string): boolean;
  addFacility?(facility: SitePlanData["facilities"][number]): boolean;
  removeFacility?(id: string): boolean;
  updateFacility?(
    id: string,
    patch: Partial<
      Pick<
        SitePlanData["facilities"][number],
        | "name"
        | "notes"
        | "rotationDeg"
        | "color"
        | "opacity"
        | "strokeStyle"
        | "modelOverride"
        | "vendorName"
        | "vendorZone"
        | "inDate"
        | "inTime"
        | "outDate"
        | "outTime"
        | "electricKw"
        | "heightM"
        | "locked"
        | "groupId"
        | "shape"
        | "finish"
      >
    > & { size?: { width: number; depth: number } },
  ): boolean;
  inspectFacility?(id: string): boolean;
  /** 2026-11-20 P1：把一组设施整组塞进视口；只动视图，不改 plan 与选中。 */
  focusEntities?(ids: readonly string[]): boolean;
  /**
   * 2026-11-20 P1：设施层是否锁定。锁定层上的对象不改位移/尺寸；
   * 调用方在写入前拦下并说明原因，不静默跳过。
   */
  facilityLayerLocked?(): boolean;
  models?(id: string): Promise<OutdoorModelChoice[]>;
  selectModel?(id: string, slug: string, expected: string): boolean;
  openGenerate?(id: string, kind: "text" | "image"): boolean;
  openUpload?(id: string): boolean;
  setView?(view: "2d" | "3d"): void;
  readLibrary?(
    queries: string[],
    signal: AbortSignal,
  ): Promise<OutdoorLibraryItem[]>;
  mapContext?(signal: AbortSignal): Promise<OutdoorMapContext>;
  proposeZones?(plan: SitePlanData, brief: OutdoorBrief): SitePlanData;
  roadNetwork?(): import("./road-network").RoadNetwork;
  proposeSpatialEdit?(turn: OutdoorTurn, plan: SitePlanData): SitePlanData;
  validateCurrentReferences?(references: OutdoorTurn["references"]): boolean;
  validateMapPlan?(base: SitePlanData, next: SitePlanData): string[];
  highlightReferences?(references: OutdoorTurn["references"]): void;
}
