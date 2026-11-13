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
export interface OutdoorFlowState {
  scope: string;
  stage: OutdoorStage;
  brief: OutdoorBrief;
  confirmedBoundary: string | null;
  completed: OutdoorStage[];
  pendingBoundary?: { anchor: NonNullable<SitePlanData["anchor"]>; boundary: SitePlanData["boundary"]; name: string; base: string } | undefined;
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
function evidencedCount(evidenceText: string, value: number): boolean {
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
): OutdoorFlowState {
  const facts = turn.facts;
  const proven = (value: { evidence: string }) =>
    message.includes(value.evidence);
  for (const value of [
    facts.access,
    facts.event,
    facts.guests,
    ...(facts.zones ?? []),
    ...(facts.items ?? []),
    ...(facts.people ?? []),
  ])
    if (value && !proven(value))
      throw new Error("模型提取缺少本句原文依据，请重新说明；没有修改规划。");
  if (
    facts.guests &&
    !evidencedCount(facts.guests.evidence, facts.guests.value)
  )
    throw new Error("人数与本句原文数量不一致，请明确人数；未采用模型猜测值。");
  for (const item of [...(facts.items ?? []), ...(facts.people ?? [])])
    if (!evidencedCount(item.evidence, item.count))
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
      items: merge(
        state.brief.items,
        facts.items,
        (i) => `${i.zone}:${i.query}`,
      ),
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
  exportPlanDraft?(expected: string, context: import("./outdoor-plan-handoff").OutdoorDraftContext): boolean;
  applyPlan?(next: SitePlanData, expected: string): boolean;
  previewBoundary?(
    anchor: NonNullable<SitePlanData["anchor"]>,
    boundary: SitePlanData["boundary"],
  ): void;
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
      >
    > & { size?: { width: number; depth: number } },
  ): boolean;
  inspectFacility?(id: string): boolean;
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
