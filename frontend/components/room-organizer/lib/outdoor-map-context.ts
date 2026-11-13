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
import {
  boundaryKey,
  planVersion,
  type OutdoorMapContext,
  type OutdoorTurn,
  type OutdoorBrief,
} from "./outdoor-agent-contract";
export type OutdoorEvidenceHighlight = ReturnType<
  typeof evidenceHighlights
>["highlights"][number];
/** Shared map module is the only geometry/evidence implementation. Adapter owns bounded model serialization. */
export function createOutdoorMapContext() {
  let cached: { key: string; at: number; evidence: MapEvidenceResult } | null =
    null;
  let snapshot: SiteSnapshot | null = null;
  const loader = createEvidenceLoader();
  return {
    async load(
      projectId: string,
      plan: SitePlanData,
      selectedIds: string[],
      confirmedBoundary: boolean,
      signal: AbortSignal,
    ): Promise<OutdoorMapContext> {
      const key = `${projectId}:${boundaryKey(plan)}`;
      const requestKey = `${projectId}:${planVersion(plan)}`;
      loader.invalidate(requestKey);
      let evidence =
        cached?.key === key && Date.now() - cached.at < 60000
          ? cached.evidence
          : undefined;
      if (!evidence && plan.anchor) {
        const xs = plan.boundary.map((p) => p.x),
          ys = plan.boundary.map((p) => p.y);
        const radiusM = Math.min(
          750,
          Math.max(150, ...xs.map(Math.abs), ...ys.map(Math.abs)) + 50,
        );
        evidence = await loader.load(requestKey, {
          anchor: plan.anchor,
          radiusM,
          semanticEndpoint: "/api/site-context",
          signal,
        });
        if (
          signal.aborted ||
          evidence.status === "stale" ||
          evidence.status === "cancelled"
        )
          throw new DOMException("Cancelled", "AbortError");
        if (evidence.status === "ready" || evidence.status === "partial")
          cached = { key, at: Date.now(), evidence };
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
      const issue = (maxChars: number) =>
        buildModelContext(sourceSnapshot, {
          maxObjects: 8,
          maxRelations: 8,
          maxChars,
          compact: true,
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
        )
          throw new Error(
            "引用区域缺少可用的室外开放空间边界；建筑轮廓不是室内活动平面，请依图纸/实测画出区域后确认。",
          );
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
              notes: `地图开放空间候选${feature.id}；尚不代表活动使用授权`,
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
        return [
          "基础地图证据未取得；建筑门/障碍/通行权限仍需核对，不代表无冲突。",
        ];
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
          if (other.kind === "entrance" && object.kind === "route") continue; // A pedestrian access line may intentionally connect a known door.
          const threshold =
            other.kind === "entrance"
              ? 1.5
              : object.widthM / 2 + (other.kind === "barrier" ? 0.1 : 0);
          if (geometryDistance(object.geometry, other.geometry) <= threshold)
            throw new Error(
              `“${object.name}”与地图依据“${other.name || other.id}”${other.kind === "entrance" ? "门前净空" : "建筑/障碍"}冲突。请核对室内层级/真实通道，或调整物件/路线后重算；未应用。`,
            );
        }
      }
      return cached.evidence.complete
        ? [
            "地图为OSM结构化证据，不含底图像素阅读，也不代表权属、现场通行或安全认证。",
          ]
        : [
            "结构化地图覆盖不完整；已知障碍参与检查，未知门/室内连接仍需用户核对。",
          ];
    },
    invalidate() {
      loader.invalidate("invalidated");
      cached = null;
      snapshot = null;
    },
  };
}
