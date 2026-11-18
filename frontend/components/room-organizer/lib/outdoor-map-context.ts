import {
  buildSiteSnapshot,
  buildModelContext,
  createEvidenceLoader,
  planObjectId,
  evidenceHighlights,
  validateSnapshotReferences,
} from "@/lib/site-intelligence";
import type {
  MapEvidenceResult,
  SiteSnapshot,
} from "@/lib/site-intelligence/types";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import { clearForObject, proposeUseZones } from "./outdoor-agent-planning";
import {
  outdoorCorridorStrips,
  outdoorRingsOverlap,
  outdoorRouteInsideRingLength,
} from "./outdoor-event-logic";
import {
  facilityPlacementIssues,
  facilityFootprintRing,
} from "./site-plan-facilities";
import {
  bounds,
  boundsIntersect,
  geometryDistance,
  isValidGeometry,
} from "@/lib/site-intelligence/geometry";
import type { Geometry } from "@/lib/site-intelligence/types";
import { enuToLngLat } from "./outdoor-plan-canvas";
import { planPointInRing } from "./site-plan-editing";
import { fetchOfmEvidence } from "./openfreemap-evidence";
import {
  MAP_EVIDENCE_MISSING_NOTE,
  boundaryKey,
  planVersion,
  type OutdoorMapContext,
  type OutdoorTurn,
  type OutdoorBrief,
} from "./outdoor-agent-contract";
import { buildLayoutEvidence } from "./outdoor-layout-weights";

export { MAP_EVIDENCE_MISSING_NOTE };
export type OutdoorEvidenceHighlight = ReturnType<
  typeof evidenceHighlights
>["highlights"][number];

function mapAbortError(): DOMException {
  return new DOMException("Cancelled", "AbortError");
}

/**
 * 障碍的可读标签（2026-11-17 生产实测补）。
 * OSM 的建筑要素绝大多数没有 name，直接把内部 id 甩给用户等于让用户没法核对。
 */
function obstacleLabel(feature: {
  kind: string;
  name: string;
}): string {
  if (feature.name.trim()) return feature.name.trim();
  return feature.kind === "building" ? "未命名建筑足迹" : "未命名地图要素";
}

/**
 * 这个地图要素是不是「用户已确认活动范围之内/包住活动范围」的建筑本体。
 *
 * 2026-11-17 生产实测（杭州湖滨银泰in77）：OSM 把整个综合体画成**一块 800+ 环**的建筑
 * 多边形，站内的步行街、广场、连廊全被包在这块多边形里。拿「场地自己的建筑足迹」当障碍，
 * 会让任何综合体场馆的主通道都必然被判「建筑/障碍冲突」——而地图并不提供室内/连廊事实，
 * 不能拿它反推「这里是室内、不可通行」。
 *
 * 判定：要素顶点落在已确认范围内，或该要素把范围中心点包住 → 视为场地本体，不当障碍。
 * 真正落在范围**之外**的相邻建筑仍然阻断（那是越界占用，不是场地本体）。
 */
function isVenueBuilding(
  geometry: Geometry,
  venue: Geometry["points"],
): boolean {
  if (venue.length < 3) return false;
  if (geometry.points.some((p) => planPointInRing(p, venue))) return true;
  let cx = 0;
  let cy = 0;
  for (const p of venue) {
    cx += p.x;
    cy += p.y;
  }
  cx /= venue.length;
  cy /= venue.length;
  return planPointInRing({ x: cx, y: cy }, geometry.points);
}

/**
 * 障碍相对已确认活动范围的位置（用户要在地图上找它，光给一个内部 id 没法核对）。
 * 2026-11-17 生产实测：OSM 建筑多数没有 name，id 又是内部串，用户根本没法找。
 */
function venueHint(geometry: Geometry, venue: Geometry["points"]): string {
  if (venue.length < 3) return "";
  const xs = venue.map((p) => p.x),
    ys = venue.map((p) => p.y);
  const bx = (Math.min(...xs) + Math.max(...xs)) / 2,
    by = (Math.min(...ys) + Math.max(...ys)) / 2;
  const cx =
    geometry.points.reduce((n, p) => n + p.x, 0) / geometry.points.length,
    cy =
      geometry.points.reduce((n, p) => n + p.y, 0) / geometry.points.length;
  const dx = cx - bx,
    dy = cy - by;
  const ns = dy >= 0 ? "北" : "南",
    ew = dx >= 0 ? "东" : "西";
  const dir =
    Math.abs(dx) > Math.abs(dy) * 2
      ? ew
      : Math.abs(dy) > Math.abs(dx) * 2
        ? ns
        : `${ns}${ew}`;
  return `（活动范围${dir}侧约${Math.round(Math.hypot(dx, dy))}m）`;
}

/**
 * 只取消这一路的等待。共享证据请求继续，缓存仍写入，其它并发 load 不受影响。
 */
function followMapAbort<T>(shared: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(mapAbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(mapAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    const finish = (settle: () => void) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(mapAbortError());
      else settle();
    };
    shared.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/** Shared map module is the only geometry/evidence implementation. Adapter owns bounded model serialization. */
export function createOutdoorMapContext() {
  let cached: { key: string; at: number; evidence: MapEvidenceResult } | null =
    null;
  let snapshot: SiteSnapshot | null = null;
  const loader = createEvidenceLoader();
  let lastInvalidateKey: string | null = null;
  const inflightEvidence = new Map<
    string,
    Promise<MapEvidenceResult | undefined>
  >();
  // docs/47 A3 断线修复（A2 轮注的结构性发现）：这两个 accessor 此前只挂在外层 adapter 对象上，
  // 而 hook 经 bridge.mapContext→load() 拿到的是内层 issued 对象——生产路径
  // `mapRef.current.water?.()` 恒为 undefined，沿岸/沿线预览永远拿空数组。
  // 现抽成闭包实现、内外两层统一挂载，修前红测走真实 load 管线拦住这个洞。
  const waterFeatures = () => {
    // 2026-11-17：水岸排布的输入。快照坐标已经是 plan 同基准的 ENU 米，直接交给排布层。
    return (snapshot?.features ?? [])
      .filter(
        (f) =>
          f.kind === "water" &&
          f.geometry.points.length >= 2 &&
          f.geometry.points.every(
            (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
          ),
      )
      .map((f) => ({
        id: f.id,
        name: f.name,
        points: f.geometry.points.map((p) => ({ x: p.x, y: p.y })),
        closed: f.geometry.type === "polygon",
      }));
  };
  const roadLineFeatures = () => {
    // 2026-11-17：沿线排布的参照输入。快照道路坐标已是 plan 同基准的 ENU 米，直接交给排布层。
    return (snapshot?.features ?? [])
      .filter(
        (f) =>
          f.kind === "road" &&
          f.geometry.type === "line" &&
          f.geometry.points.length >= 2 &&
          f.geometry.points.every(
            (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
          ),
      )
      .map((f) => ({
        id: f.id,
        name: f.name,
        points: f.geometry.points.map((p) => ({ x: p.x, y: p.y })),
      }));
  };
  return {
    async load(
      projectId: string,
      plan: SitePlanData,
      selectedIds: string[],
      confirmedBoundary: boolean,
      signal: AbortSignal,
    ): Promise<OutdoorMapContext> {
      // 进来时已经取消：不要 invalidate，也不要新开证据请求，避免打断其它 key 的兜底。
      if (signal.aborted) throw mapAbortError();
      const key = `${projectId}:${boundaryKey(plan)}`;
      const requestKey = `${projectId}:${planVersion(plan)}`;
      // 同一 plan 版本并发 load 不要反复 invalidate，避免 9 路同时打空缓存。
      if (lastInvalidateKey !== requestKey) {
        loader.invalidate(requestKey);
        lastInvalidateKey = requestKey;
      }
      let evidence =
        cached?.key === key && Date.now() - cached.at < 60000
          ? cached.evidence
          : undefined;
      if (!evidence && plan.anchor) {
        const inflightKey = `${key}:${requestKey}`;
        let shared = inflightEvidence.get(inflightKey);
        if (!shared) {
          // 已取消且没有可加入的共享请求：不要为了这一路去打 OFM / 兜底。
          if (signal.aborted) throw mapAbortError();
          const xs = plan.boundary.map((p) => p.x),
            ys = plan.boundary.map((p) => p.y);
          const radiusM = Math.min(
            750,
            Math.max(150, ...xs.map(Math.abs), ...ys.map(Math.abs)) + 50,
          );
          const anchor = plan.anchor;
          const cacheKey = key;
          let task!: Promise<MapEvidenceResult | undefined>;
          task = (async () => {
            let next: MapEvidenceResult | undefined;
            // 共享证据请求不绑调用方 AbortSignal，避免一路取消把其它 8 路一起毒死。
            try {
              next = (await fetchOfmEvidence(anchor, radiusM)) ?? undefined;
            } catch {
              next = undefined;
            }
            if (!next) {
              next = await loader.load(requestKey, {
                anchor,
                radiusM,
                semanticEndpoint: "/api/site-context",
              });
            }
            if (
              next &&
              (next.status === "ready" || next.status === "partial")
            )
              cached = { key: cacheKey, at: Date.now(), evidence: next };
            return next;
          })().finally(() => {
            if (inflightEvidence.get(inflightKey) === task)
              inflightEvidence.delete(inflightKey);
          });
          inflightEvidence.set(inflightKey, task);
          shared = task;
        }
        const next = await followMapAbort(shared, signal);
        if (next?.status === "stale" || next?.status === "cancelled")
          throw mapAbortError();
        evidence = next;
      }
      const selected = selectedIds.flatMap((id) =>
        ["zone", "facility", "route", "entrance", "worker"].map((kind) =>
          planObjectId(projectId, kind, id),
        ),
      );
      snapshot = buildSiteSnapshot({
        projectId,
        geometryRevision: planVersion(plan),
        plan,
        selectedIds: selected,
        ...(evidence ? { mapEvidence: evidence } : {}),
        confirmations: {
          boundary: confirmedBoundary,
          featureIds: plan.nodes
            .filter((n) => n.verification === "user-confirmed")
            .map((n) => planObjectId(projectId, "entrance", n.id)),
        },
      });
      const sourceSnapshot = snapshot;
      // docs/47 A2：证据分级——摘要（一行式）随 issued 上下文给模型，明细分档留给排布引擎（A3）。
      const layout = buildLayoutEvidence(snapshot.features, plan.boundary);
      const issue = (maxChars: number) =>
        buildModelContext(sourceSnapshot, {
          maxObjects: 8,
          maxRelations: 8,
          maxChars,
          compact: true,
          layoutEvidence: layout.summary,
        });
      const issued = issue(3400);
      return {
        version: snapshot.revision,
        status:
          snapshot.coverage.mapStatus === "ready"
            ? "ready"
            : snapshot.coverage.mapStatus === "failed"
              ? "unavailable"
              : "partial",
        text: JSON.stringify(issued),
        issued,
        issue,
        featureIds: issued.objects
          .filter((o) => !o.reference.id.startsWith("plan:"))
          .map((o) => o.reference.id),
        planIds: issued.objects
          .filter((o) => o.reference.id.startsWith("plan:"))
          .map((o) => o.reference.id),
        sourceIds: Object.fromEntries(
          snapshot.features
            .filter((f) => f.highlight.layer === "plan")
            .map((f) => [f.id, f.highlight.sourceId]),
        ),
        unknowns: snapshot.coverage.unknowns,
        // docs/47 A3 断线修复：water/roadLines 统一挂内外两层——hook 持有的是本内层对象，
        // 沿岸/沿线预览在生产路径终于能取到真实要素（修前红测见 outdoor-map-context.test.ts）。
        water: () => waterFeatures(),
        roadLines: () => roadLineFeatures(),
        // docs/47 A2：分档明细随本轮 load 结果走（hook/A3 从这里读），没有证据就回空档。
        layoutEvidence: () => layout,
      };
    },
    highlights(
      references: OutdoorTurn["references"],
    ): OutdoorEvidenceHighlight[] {
      if (!snapshot) return [];
      const refs = references.map(({ id, revision }) => ({ id, revision }));
      return evidenceHighlights(snapshot, refs).highlights;
    },
    zones(plan: SitePlanData, brief: OutdoorBrief): SitePlanData {
      let source = { ...plan, zones: [...plan.zones] };
      const zones = brief.zones.map((need) => {
        if (!need.referenceId) return need;
        const known = source.zones.find((z) => z.id === need.referenceId);
        if (known) return need;
        const feature = snapshot?.features.find(
          (f) => f.id === need.referenceId,
        );
        if (feature?.highlight.layer === "plan" && feature.kind === "zone")
          return { ...need, referenceId: feature.highlight.sourceId };
        if (
          !feature ||
          feature.kind !== "open-space" ||
          feature.geometry.type !== "polygon" ||
          need.environment !== "outdoor"
        ) {
          // 2026-11-14 用户拍板「以第一个选区为准」后实测：理解模型爱把用途分区锚到商场建筑轮廓上，
          // 建筑轮廓当分区形状确实不可用（原硬抛错「建筑轮廓不是室内活动平面」），但一票否决把
          // 「边界内自动排布」这条合法路径也堵死了。改为丢弃无效引用 → 退回 proposeUseZones 的
          // 活动边界内自动排布；产物仍是提案卡，用户确认前不写入。
          return { ...need, referenceId: undefined };
        }
        const matching = source.zones.filter((z) => z.name === need.name);
        if (matching.length > 1)
          throw new Error("区域名称有歧义，不能替换为地图形状。");
        const id = matching[0]?.id ?? crypto.randomUUID();
        source = {
          ...source,
          zones: [
            ...source.zones.filter((z) => z.id !== id),
            {
              id,
              name: need.name,
              semantic: "reserved",
              polygon: feature.geometry.points,
              geometrySource: "map-unverified",
              notes: `开放空间候选${feature.id}：先当可用空地，能不能用你确认后我再往里排`,
            },
          ],
        };
        return { ...need, referenceId: id };
      });
      return proposeUseZones(source, { ...brief, zones });
    },
    roads() {
      return {
        roads: snapshot?.anchor
          ? snapshot.features
              .filter(
                (f) =>
                  f.kind === "road" &&
                  f.geometry.type === "line" &&
                  f.tags.bridge !== "yes" &&
                  f.tags.tunnel !== "yes" &&
                  (!f.tags.layer || f.tags.layer === "0") &&
                  !["no", "private"].includes(f.tags.access ?? "") &&
                  f.tags.foot !== "no" &&
                  (f.tags.highway !== "cycleway" ||
                    ["yes", "designated"].includes(f.tags.foot ?? "")),
              )
              .map((f) => ({
                id: f.id,
                highway: f.tags.highway ?? "",
                name: f.name,
                points: f.geometry.points.map((p) => {
                  const ll = enuToLngLat(
                    p.x,
                    p.y,
                    snapshot!.anchor!.lng,
                    snapshot!.anchor!.lat,
                  );
                  return [ll.lng, ll.lat] as [number, number];
                }),
              }))
          : [],
      };
    },
    water() {
      return waterFeatures();
    },
    roadLines() {
      return roadLineFeatures();
    },
    spatial(turn: OutdoorTurn, plan: SitePlanData): SitePlanData {
      if (!snapshot || !turn.operation)
        throw new Error(
          "缺少本轮真实对象引用与空间关系；请说明目标和相邻参照。",
        );
      if (
        !validateSnapshotReferences(
          {
            references: turn.references.map(({ id, revision }) => ({
              id,
              revision,
            })),
          },
          snapshot,
        ).ok
      )
        throw new Error("空间操作引用已过期，未执行。");
      const op = turn.operation;
      const refs = new Set(turn.references.map((r) => r.id));
      if (!refs.has(op.targetId) || !refs.has(op.referenceId))
        throw new Error("空间操作对象不在本轮已验证引用中，未执行。");
      const target = snapshot.features.find((f) => f.id === op.targetId),
        reference = snapshot.features.find((f) => f.id === op.referenceId);
      if (!target || !reference) throw new Error("空间参照已失效。");
      if (turn.action === "adjust") {
        const f = plan.facilities.find(
            (f) => f.id === target.highlight.sourceId,
          ),
          zone = f ? plan.zones.find((z) => z.id === f.zoneId) : undefined;
        if (!f || !zone)
          throw new Error("只能调整已绑定具体分区的真实设施；没有猜目标。");
        const pts = reference.geometry.points,
          cx = pts.reduce((n, p) => n + p.x, 0) / pts.length,
          cy = pts.reduce((n, p) => n + p.y, 0) / pts.length;
        const directions =
          op.relation === "east"
            ? [{ x: 1, y: 0 }]
            : op.relation === "west"
              ? [{ x: -1, y: 0 }]
              : op.relation === "north"
                ? [{ x: 0, y: 1 }]
                : op.relation === "south"
                  ? [{ x: 0, y: -1 }]
                  : [
                      { x: 1, y: 0 },
                      { x: -1, y: 0 },
                      { x: 0, y: 1 },
                      { x: 0, y: -1 },
                      { x: 1, y: 1 },
                      { x: -1, y: 1 },
                      { x: 1, y: -1 },
                      { x: -1, y: -1 },
                    ];
        const candidates = [];
        for (const distance of [3, 5, 8, 12, 20])
          for (const d of directions)
            candidates.push({
              ...f,
              position: { x: cx + d.x * distance, y: cy + d.y * distance },
            });
        candidates.sort(
          (a, b) =>
            Math.hypot(
              a.position.x - f.position.x,
              a.position.y - f.position.y,
            ) -
            Math.hypot(
              b.position.x - f.position.x,
              b.position.y - f.position.y,
            ),
        );
        for (const candidate of candidates) {
          if (
            !clearForObject(
              candidate,
              {
                ...plan,
                facilities: plan.facilities.filter((o) => o.id !== f.id),
              },
              zone,
            )
          )
            continue;
          const next = {
            ...plan,
            facilities: plan.facilities.map((o) =>
              o.id === f.id ? candidate : o,
            ),
          };
          try {
            this.validate(plan, next);
            return next;
          } catch {
            /* try the next physically valid candidate, never bypass a hazard */
          }
        }
        throw new Error(
          "该真实对象周围没有满足区域/门前净空/通道/占地约束的位置，请扩大可用分区或选择更小物料；未移动。",
        );
      }
      if (turn.action === "connect") {
        const node = plan.nodes.find((n) => n.id === target.highlight.sourceId);
        if (
          !node ||
          !["road", "route"].includes(reference.kind) ||
          reference.geometry.type !== "line"
        )
          throw new Error(
            "需引用一个规划入口和一条真实道路/已有流线，不把几何相邻当已连通。",
          );
        if (
          node.verification === "unverified" ||
          ["no", "private"].includes(reference.tags.access ?? "") ||
          reference.tags.foot === "no"
        )
          throw new Error(
            "入口/道路权限尚未核对或禁止通行，请先确认；未连接。",
          );
        const hits = [];
        for (let i = 1; i < reference.geometry.points.length; i++) {
          const a = reference.geometry.points[i - 1]!,
            b = reference.geometry.points[i]!,
            dx = b.x - a.x,
            dy = b.y - a.y,
            t = Math.max(
              0,
              Math.min(
                1,
                ((node.position.x - a.x) * dx + (node.position.y - a.y) * dy) /
                  (dx * dx + dy * dy || 1),
              ),
            );
          hits.push({ x: a.x + dx * t, y: a.y + dy * t });
        }
        hits.sort(
          (a, b) =>
            Math.hypot(a.x - node.position.x, a.y - node.position.y) -
            Math.hypot(b.x - node.position.x, b.y - node.position.y),
        );
        for (const hit of hits) {
          if (
            Math.hypot(hit.x - node.position.x, hit.y - node.position.y) < 0.1
          )
            continue;
          const points = [node.position, hit],
            strips = outdoorCorridorStrips(points, 3);
          if (
            strips.some(
              (s) => facilityPlacementIssues(s, plan.boundary).length,
            ) ||
            plan.facilities.some((f) =>
              strips.some((s) =>
                outdoorRingsOverlap(s, facilityFootprintRing(f)),
              ),
            )
          )
            continue;
          const next = {
            ...plan,
            routes: [
              ...plan.routes,
              {
                id: crypto.randomUUID(),
                kind: "pedestrian" as const,
                name: `${node.name}接${reference.name || reference.id}`.slice(
                  0,
                  60,
                ),
                points,
                startNodeId: node.id,
                widthM: 3,
                oneWay: false,
                notes: `真实引用接驳提案；依据${reference.id}，尚非现场通行/疏散认证`,
              },
            ],
          };
          try {
            this.validate(plan, next);
            return next;
          } catch {}
        }
        throw new Error(
          "入口到该道路的3m接驳穿越物件/障碍或活动授权范围外；请调整范围/入口并核对通行授权，不硬连。",
        );
      }
      throw new Error("当前不支持该空间操作，未执行。");
    },
    validateReferences(references: OutdoorTurn["references"]) {
      return Boolean(
        snapshot &&
          validateSnapshotReferences(
            {
              references: references.map(({ id, revision }) => ({
                id,
                revision,
              })),
            },
            snapshot,
          ).ok,
      );
    },
    validate(base: SitePlanData, next: SitePlanData): string[] {
      if (
        !snapshot ||
        !cached ||
        cached.key !== `${snapshot.projectId}:${boundaryKey(base)}`
      )
        return [MAP_EVIDENCE_MISSING_NOTE];
      const changed = new Set([
        ...next.facilities
          .filter((f) => {
            const old = base.facilities.find((o) => o.id === f.id);
            return (
              !old ||
              JSON.stringify([old.position, old.rotationDeg, old.size]) !==
                JSON.stringify([f.position, f.rotationDeg, f.size])
            );
          })
          .map((f) => planObjectId(snapshot!.projectId, "facility", f.id)),
        ...next.routes
          .filter((r) => {
            const old = base.routes.find((o) => o.id === r.id);
            return (
              !old ||
              JSON.stringify([old.points, old.widthM]) !==
                JSON.stringify([r.points, r.widthM])
            );
          })
          .map((r) => planObjectId(snapshot!.projectId, "route", r.id)),
      ]);
      // Safety is intentionally independent of the 240-object/relationship/model-context limits.
      // Read every accepted known map obstacle, not the limited reasoning snapshot.
      if (
        changed.size &&
        (!snapshot.coverage.scope ||
          cached.evidence.warnings.some((w) =>
            /omitted|feature limit|element_limit_reached|query.limited|upstream_query_incomplete|oversized|budget exhausted/i.test(
              w,
            ),
          ))
      )
        throw new Error(
          "相关地图安全证据被截断或未对齐，不能按缺失即无障碍放行；请缩小范围重新取得完整证据并核对后再安排。",
        );
      const planned: Array<{
        id: string;
        name: string;
        kind: "facility" | "route";
        geometry: Geometry;
        widthM: number;
      }> = [
        ...next.facilities
          .filter((f) =>
            changed.has(planObjectId(snapshot!.projectId, "facility", f.id)),
          )
          .map((f) => ({
            id: f.id,
            name: f.name,
            kind: "facility" as const,
            geometry: {
              type: "polygon" as const,
              points: facilityFootprintRing(f),
            },
            widthM: 0,
          })),
        ...next.routes
          .filter((r) =>
            changed.has(planObjectId(snapshot!.projectId, "route", r.id)),
          )
          .map((r) => ({
            id: r.id,
            name: r.name,
            kind: "route" as const,
            geometry: { type: "line" as const, points: r.points },
            widthM: r.widthM ?? 3,
          })),
      ];
      let cost = 0;
      // 用户已确认的活动范围（用地红线）= 场地本体判定的基准。
      const venueRing = (
        next.boundary.length >= 3 ? next.boundary : base.boundary
      ) as Geometry["points"];
      let skippedVenueBuilding = false;
      const conflicts: string[] = [];
      for (const object of planned) {
        const box = bounds(object.geometry),
          clearance = Math.max(1.5, object.widthM / 2 + 0.1);
        for (const other of cached.evidence.features.filter((f) =>
          ["building", "barrier", "entrance"].includes(f.kind),
        )) {
          if (!isValidGeometry(other.geometry))
            throw new Error("地图安全证据无效，未应用；请重新核对相关障碍。");
          if (
            !boundsIntersect(
              {
                minX: box.minX - clearance,
                minY: box.minY - clearance,
                maxX: box.maxX + clearance,
                maxY: box.maxY + clearance,
              },
              bounds(other.geometry),
            )
          )
            continue;
          cost += object.geometry.points.length * other.geometry.points.length;
          if (cost > 2000000)
            throw new Error(
              "相关地图安全证据检查预算已截断，未应用；请缩小本轮安排范围。",
            );
          const indoors = next.zones.some(
            (z) =>
              z.environment === "indoor" &&
              z.geometrySource === "user-confirmed" &&
              object.geometry.points.every((p) =>
                planPointInRing(p, z.polygon),
              ),
          );
          if (other.kind === "building" && indoors) continue;
          // 场地本体的建筑足迹不当障碍（见 isVenueBuilding 注释）：综合体是一整块多边形，
          // 拿它当障碍会让站内主通道永远排不出来。
          if (other.kind === "building" && isVenueBuilding(other.geometry, venueRing)) {
            skippedVenueBuilding = true;
            continue;
          }
          if (other.kind === "entrance" && object.kind === "route") continue; // A pedestrian access line may intentionally connect a known door.
          /**
           * 2026-11-17 生产实测（杭州湖滨路）：OSM 道路中心线与 OSM 建筑轮廓会互相打架——
           * 湖滨路的 way 与两块无名建筑在墙角共享顶点，还真的从足迹里穿过去几十米。
           * 两边都是同一份 OSM 的粗几何，app 判不出谁对；拿它一票否决整轮，
           * 结果是「主要入口与通道」永远排不出流线，而用户连提案都看不到、无从在画布上改。
           *
           * 所以分级处置：
           *  ① 流线 × 建筑足迹 → 提案级警告（写清在哪、多长、怎么改），不再整轮否掉；
           *  ② 物件（用户摆的）× 建筑/障碍/门前净空 → 照旧硬拦，那才是真占位。
           * 判据从「中心线离墙多近」换成「中心线是否真的走进足迹内部」：贴墙共顶点不算穿楼。
           */
          if (other.kind === "building" && object.kind === "route") {
            const overlapM = outdoorRouteInsideRingLength(
              object.geometry.points,
              other.geometry.points,
            );
            if (overlapM > 0)
              conflicts.push(
                `“${object.name}”有一段约${Math.round(overlapM)}m走进地图依据“${obstacleLabel(other)}”${venueHint(other.geometry, venueRing)}的足迹内。路网中心线与建筑轮廓同出 OSM、可能互有出入；该段未自动判定为可通行，请在画布上绕开或现场核对后再确认。`,
              );
            continue;
          }
          const threshold =
            other.kind === "entrance"
              ? 1.5
              : object.widthM / 2 + (other.kind === "barrier" ? 0.1 : 0);
          if (geometryDistance(object.geometry, other.geometry) <= threshold)
            throw new Error(
              `“${object.name}”与地图依据“${obstacleLabel(other)}”${other.kind === "entrance" ? "门前净空" : "建筑/障碍"}冲突。请核对室内层级/真实通道，或调整物件/路线后重算；未应用。`,
            );
        }
      }
      const notes: string[] = [...conflicts];
      if (skippedVenueBuilding)
        notes.push(
          "已确认活动范围内的建筑足迹未计入障碍（可能是商场裙房/连廊/上盖）；未计入不等于确认可通行，室内通道仍需现场核对。",
        );
      if (cached.evidence.complete)
        notes.push(
          "用 OSM 的结构化路网/水域判断周边；哪些路真能走，以你在地图上的确认为准。",
        );
      else
        notes.push(
          "结构化地图覆盖不完整；已知障碍参与检查，未知门/室内连接仍需用户核对。",
        );
      return notes;
    },
    invalidate() {
      loader.invalidate("invalidated");
      cached = null;
      snapshot = null;
    },
  };
}
