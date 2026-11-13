import { personnelAccess } from "./outdoor-personnel-access";
import type {
  PlanPoint,
  PlanZone,
  SitePlanData,
  PlanFacility,
  PlanWorker,
} from "../../../../supabase/functions/_shared/site-plan";
import { sitePlanDataSchema } from "../../../../supabase/functions/_shared/site-plan";
import {
  checkBoundaryRing,
  planPointInRing,
  planRingsOverlap,
} from "./site-plan-editing";
import {
  facilityFootprintRing,
  facilityPlacementIssues,
} from "./site-plan-facilities";
import {
  outdoorCorridorStrips,
  outdoorRingsOverlap,
} from "./outdoor-event-logic";
import type {
  OutdoorBrief,
  OutdoorLibraryItem,
} from "./outdoor-agent-contract";

const box = (p: readonly PlanPoint[]) => ({
  w: Math.min(...p.map((p) => p.x)),
  e: Math.max(...p.map((p) => p.x)),
  s: Math.min(...p.map((p) => p.y)),
  n: Math.max(...p.map((p) => p.y)),
});
/** Convex half-plane clipping only; disconnected/invalid results are subsequently rejected. */
function clipX(ring: PlanPoint[], x: number, keepRight: boolean): PlanPoint[] {
  const result: PlanPoint[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!,
      inside = (p: PlanPoint) => (keepRight ? p.x >= x : p.x <= x);
    if (inside(a)) result.push(a);
    if (inside(a) !== inside(b)) {
      const t = (x - a.x) / (b.x - a.x);
      result.push({ x, y: a.y + t * (b.y - a.y) });
    }
  }
  return result.filter(
    (p, i) =>
      !i || Math.hypot(p.x - result[i - 1]!.x, p.y - result[i - 1]!.y) > 0.001,
  );
}
export function proposeUseZones(
  plan: SitePlanData,
  brief: OutdoorBrief,
  id: () => string = () => crypto.randomUUID(),
): SitePlanData {
  if (!brief.zones.length)
    throw new Error(
      "这块活动场地要分哪些用途？例如展览区、表演区；同时告诉我各区室内/室外，尚不放物件。",
    );
  if (brief.zones.some((z) => z.environment === "unknown"))
    throw new Error(
      "请先明确待布置分区是室内还是室外；未知室内信息不会从地图猜。",
    );
  const existing = brief.zones.map((z) => {
    const matches = plan.zones.filter((p) =>
      z.referenceId ? p.id === z.referenceId : p.name === z.name,
    );
    if (matches.length > 1)
      throw new Error("分区名称有歧义，请用当前具体对象引用确认。");
    return matches[0];
  });
  if (brief.zones.some((z, i) => z.environment === "indoor" && !existing[i]))
    throw new Error(
      "室内分区尚无可核对边界。请提供图纸或在同一画布画出并命名该分区，再确认；商场轮廓不能代表室内活动空间。",
    );
  if (plan.zones.length && existing.some((z) => !z))
    throw new Error(
      "已有分区与新用途不完全对应。请先选中要修改的分区并明确名称，不会新增重叠区域或清旧分区。",
    );
  const b = box(plan.boundary),
    width = (b.e - b.w) / brief.zones.length;
  const zones: PlanZone[] = brief.zones.map((need, i) => {
    const old = existing[i];
    const sliced = clipX(
      clipX(plan.boundary, b.w + i * width + 2, true),
      b.w + (i + 1) * width - 2,
      false,
    );
    const trimY = (ring: PlanPoint[], y: number, right: boolean) =>
      clipX(
        ring.map((p) => ({ x: p.y, y: p.x })),
        y,
        right,
      ).map((p) => ({ x: p.y, y: p.x }));
    const polygon =
      old?.polygon ?? trimY(trimY(sliced, b.s + 3, true), b.n - 3, false);
    if (
      !checkBoundaryRing(polygon).ok ||
      facilityPlacementIssues(polygon, plan.boundary).length
    )
      throw new Error(
        "当前不规则边界无法可靠自动划分这版区域，请先画出分区或调整用途/范围；没有用bbox跨越凹口。",
      );
    return {
      ...(old ?? {}),
      id: old?.id ?? id(),
      semantic:
        need.purpose === "performance"
          ? "stage"
          : need.purpose === "audience"
            ? "audience"
            : "reserved",
      name: need.name,
      event:
        need.purpose === "exhibition"
          ? "展览"
          : need.purpose === "performance"
            ? "表演"
            : need.purpose === "market"
              ? "市集"
              : need.purpose === "service"
                ? "服务"
                : "观众",
      environment: need.environment,
      purpose: need.purpose,
      geometrySource: "user-confirmed",
      polygon,
      notes:
        old?.notes ??
        "用途分区几何草案：保留外围与区间通道余量，非物件布局或容量/疏散认证。",
    };
  });
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++)
      if (planRingsOverlap(zones[i]!.polygon, zones[j]!.polygon))
        throw new Error("分区占地重叠，请核对真实分区。");
  return {
    ...plan,
    zones: [
      ...plan.zones.filter((z) => !zones.some((n) => n.id === z.id)),
      ...zones,
    ],
  };
}
export function clearForObject(
  facility: PlanFacility,
  plan: SitePlanData,
  zone: PlanZone,
): boolean {
  const ring = facilityFootprintRing(facility);
  if (
    facilityPlacementIssues(ring, plan.boundary).length ||
    facilityPlacementIssues(ring, zone.polygon).length
  )
    return false;
  if (
    plan.facilities.some((f) =>
      outdoorRingsOverlap(ring, facilityFootprintRing(f)),
    )
  )
    return false;
  if (
    plan.routes.some((r) =>
      outdoorCorridorStrips(r.points, (r.widthM ?? 3) + 1).some((strip) =>
        outdoorRingsOverlap(ring, strip),
      ),
    )
  )
    return false;
  if (
    plan.nodes.some(
      (n) =>
        Math.hypot(
          n.position.x - facility.position.x,
          n.position.y - facility.position.y,
        ) <
        Math.hypot(facility.size.width, facility.size.depth) / 2 + 2,
    )
  )
    return false;
  if (plan.workers.some((w) => planPointInRing(w.position, ring))) return false;
  return true;
}
/** Explicit real inventory entries only; no guessed GLB, dimensions, booth or stage defaults. */
/** Conservative draft-only floor-space lower bound, not a legal capacity/egress certificate. */
export function validateWorkflowDemand(
  plan: SitePlanData,
  brief: OutdoorBrief,
): void {
  if (!brief.guests) return;
  if (
    plan.zones.some((z) => z.purpose === "performance") &&
    !plan.zones.some((z) => z.purpose === "audience")
  )
    throw new Error(
      "有表演区但未明确观众区域/朝向。请先增加或指定观众区，再核对舞台与观众关系，不把观众塞进表演/展位占地。",
    );
  const audience = plan.zones.filter((z) =>
    ["audience", "market", "exhibition"].includes(z.purpose ?? ""),
  );
  if (!audience.length)
    throw new Error(
      "缺少来宾活动区域，请先明确观众/市集/展览区域，不用服务/舞台区域冒充容量。",
    );
  const area = (ring: PlanPoint[]) =>
    Math.abs(
      ring.reduce((n, p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        return n + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2;
  let free = 0;
  for (const zone of audience) {
    let usable = area(zone.polygon);
    for (const f of plan.facilities.filter((f) => f.zoneId === zone.id))
      usable -= f.size.width * f.size.depth;
    for (const route of plan.routes.filter((r) => r.levelId === zone.levelId))
      for (const strip of outdoorCorridorStrips(
        route.points,
        route.widthM ?? 3,
      ))
        if (outdoorRingsOverlap(strip, zone.polygon)) usable -= area(strip);
    free += Math.max(0, usable);
  }
  if (free < brief.guests * 2)
    throw new Error(
      `当前观众/市集/展览区域扣除已知物件和通道后，保守可用面积下界约${Math.floor(free)}㎡；本草案按预留2㎡/人粗筛，${brief.guests}人至少需${brief.guests * 2}㎡。请调整人数/分区/物件；这不是法规容量或疏散认证。`,
    );
}
export function proposeInventoryObjects(
  plan: SitePlanData,
  brief: OutdoorBrief,
  library: OutdoorLibraryItem[],
  id: () => string = () => crypto.randomUUID(),
): { plan: SitePlanData; used: OutdoorLibraryItem[] } {
  if (!brief.items.length)
    throw new Error(
      "各区需要哪些物件、各多少？例如“展览区6个展板、表演区1个舞台2只音响”。将先检索你的真实物料库，不自动生成。",
    );
  let next = { ...plan, facilities: [...plan.facilities] };
  const used: OutdoorLibraryItem[] = [];
  for (const need of brief.items) {
    const matchesZones = plan.zones.filter(
      (z) => z.id === need.zone || z.name === need.zone,
    );
    if (matchesZones.length > 1)
      throw new Error("分区名称重复，请引用唯一真实分区，不自动猜第一个。");
    const zone = matchesZones[0];
    if (!zone)
      throw new Error(
        `“${need.zone}”没有唯一对应分区，请选中并说明分区；未摆放物件。`,
      );
    const matches = library.filter(
      (item) =>
        item.source === "personal" &&
        item.available &&
        (item.name.toLowerCase().includes(need.query.toLowerCase()) ||
          item.id === need.query),
    );
    if (!matches.length)
      throw new Error(
        `你的真实物料库中尚未找到尺寸与模型可用的“${need.query}”。可改名称检索/选真实候选或上传；未自动创建收费生成。`,
      );
    if (matches.length > 1)
      throw new Error(
        `你的库里有${matches.length}个“${need.query}”候选：${matches.map((m) => m.name).join("、")}。请给具体名称或ID，不替你随便选第一个。`,
      );
    const material = matches[0]!;
    used.push(material);
    const b = box(zone.polygon);
    const allocationKey = `${zone.id}:${need.query}`;
    const allocated = next.facilities.filter(
      (f) => f.allocationKey === allocationKey,
    );
    if (allocated.some((f) => f.sourceAssetId !== material.id))
      throw new Error(
        "此项已有其他真实物料，请先明确替换哪个设施；不会重复添加或擅自删除。",
      );
    if (allocated.length > need.count) {
      const removed = allocated.slice(need.count);
      if (
        removed.some((f) => !f.modelOverride?.startsWith("generated:library-"))
      )
        throw new Error(
          "部分设施已有后续模型深化，请明确逐个删除；保留其任务归属，不批量丢件。",
        );
      next = {
        ...next,
        facilities: next.facilities.filter(
          (f) => !removed.some((r) => r.id === f.id),
        ),
      };
    }
    for (let n = Math.min(allocated.length, need.count); n < need.count; n++) {
      let found: PlanFacility | null = null;
      for (const rotationDeg of [0, 90]) {
        if (found) break;
        for (let iy = 0; iy < 30 && !found; iy++)
          for (let ix = 0; ix < 30 && !found; ix++) {
            const position = {
              x: b.w + ((ix + 0.5) * (b.e - b.w)) / 30,
              y: b.s + ((iy + 0.5) * (b.n - b.s)) / 30,
            };
            const facility: PlanFacility = {
              id: id(),
              templateId: `library:${material.id}`.slice(0, 64),
              name: `${material.name} ${n + 1}`.slice(0, 60),
              zoneId: zone.id,
              position,
              rotationDeg,
              size: { width: material.width, depth: material.depth },
              modelOverride: material.modelSlug,
              sourceAssetId: material.id,
              allocationKey,
              notes: "复用我的物料库真实模型与米制尺寸；保留已确认通道/门口。",
            };
            if (clearForObject(facility, next, zone)) found = facility;
          }
      }
      if (!found)
        throw new Error(
          `“${zone.name}”放不下第${n + 1}件“${material.name}”并保留通道与门口；可减数量、选择较小真实物料或调整分区。整版未写入。`,
        );
      next = { ...next, facilities: [...next.facilities, found] };
    }
  }
  validateWorkflowDemand(next, brief);
  return { plan: next, used };
}
export function reachablePedestrianRoutes(
  plan: SitePlanData,
  audience: NonNullable<PlanWorker["audience"]>,
): SitePlanData["routes"] {
  return personnelAccess(plan, audience).routes;
}
/** Clip centre lines into the confirmed activity polygon; geometry is not a right-of-way grant. */
export function clipWorkflowRoutes(
  routes: SitePlanData["routes"],
  boundary: PlanPoint[],
): SitePlanData["routes"] {
  const result: SitePlanData["routes"] = [];
  for (const route of routes) {
    let active: PlanPoint[] = [];
    const flush = () => {
      if (
        active.length >= 2 &&
        outdoorCorridorStrips(active, route.widthM ?? 3).every(
          (s) => !facilityPlacementIssues(s, boundary).length,
        )
      )
        result.push({
          ...route,
          id: crypto.randomUUID(),
          points: active,
          notes: `${route.notes}；仅保留活动范围内的候选段，线宽为设计提案非实测路宽`,
        });
      active = [];
    };
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!,
        b = route.points[i]!,
        dx = b.x - a.x,
        dy = b.y - a.y;
      const ts = [0, 1];
      for (let j = 0; j < boundary.length; j++) {
        const c = boundary[j]!,
          d = boundary[(j + 1) % boundary.length]!,
          ex = d.x - c.x,
          ey = d.y - c.y,
          den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / den,
          u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      }
      ts.sort((x, y) => x - y);
      const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
      for (let j = 1; j < ts.length; j++) {
        const lo = ts[j - 1]!,
          hi = ts[j]!;
        if (hi - lo < 1e-9) continue;
        if (!planPointInRing(at((lo + hi) / 2), boundary)) {
          flush();
          continue;
        }
        const from = at(lo),
          to = at(hi);
        if (
          active.length &&
          Math.hypot(
            active[active.length - 1]!.x - from.x,
            active[active.length - 1]!.y - from.y,
          ) > 0.001
        )
          flush();
        if (!active.length) active.push(from);
        active.push(to);
      }
    }
    flush();
  }
  return result;
}
export function proposeRoleWorkers(
  plan: SitePlanData,
  brief: OutdoorBrief,
  id: () => string = () => crypto.randomUUID(),
): SitePlanData {
  if (!brief.people.length)
    throw new Error(
      "服务、保安、工作人员、表演人员分别多少、负责哪个区？我会按岗位和已确认进出路径安排，不随机撒人。",
    );
  const workers: PlanWorker[] = [...plan.workers];
  for (const need of brief.people) {
    const matchesZones = plan.zones.filter(
      (z) => z.id === need.zone || z.name === need.zone,
    );
    if (matchesZones.length > 1)
      throw new Error("分区名称重复，请引用唯一真实分区，不自动猜第一个。");
    const zone = matchesZones[0];
    if (!zone) throw new Error(`请明确“${need.role}”负责的真实区域。`);
    const access = personnelAccess(plan, need.audience);
    const eligible = access.routes.filter((r) =>
      r.points.some(
        (p) =>
          planPointInRing(p, zone.polygon) &&
          access.paths(p, r.levelId) !== null,
      ),
    );
    if (!eligible.length)
      throw new Error(
        `“${zone.name}”尚无同时满足入场与出场的${need.audience === "service" ? "后勤" : "人行"}接驳，请先安排子流线/子入口；不会把岗位放到不连通的区域。`,
      );
    const point = eligible
      .flatMap((r) => r.points)
      .find(
        (p) =>
          planPointInRing(p, zone.polygon) &&
          access.paths(
            p,
            eligible.find((r) => r.points.includes(p))?.levelId,
          ) !== null &&
          !plan.facilities.some((f) =>
            planPointInRing(p, facilityFootprintRing(f)),
          ),
      );
    if (!point)
      throw new Error(
        `“${zone.name}”的岗位通道被物件占用，请先调整物件/子路线。`,
      );
    const allocationKey = JSON.stringify([
      zone.id,
      need.role.normalize("NFKC").trim(),
      need.audience,
    ]);
    const matches = (w: PlanWorker) =>
      w.allocationKey === allocationKey ||
      (!w.allocationKey &&
        w.zoneId === zone.id &&
        w.role === need.role &&
        w.audience === need.audience &&
        w.notes.startsWith("岗位分配提案"));
    const old = workers.find(matches);
    for (let i = workers.length - 1; i >= 0; i--)
      if (matches(workers[i]!)) workers.splice(i, 1);
    workers.push({
      id: old?.id ?? id(),
      allocationKey,
      role: need.role,
      count: need.count,
      zoneId: zone.id,
      audience: need.audience,
      routeIds: [
        ...new Set([
          ...(access.paths(
            point,
            eligible.find((r) => r.points.includes(point))?.levelId,
          ) ?? []),
          ...eligible.filter((r) => r.points.includes(point)).map((r) => r.id),
        ]),
      ],
      activityZoneIds: [zone.id],
      position: point,
      notes:
        "岗位分配提案；数量来自用户，活动范围为关联分区，进出限关联路线；非排班或安全认证。",
    });
  }
  return { ...plan, workers };
}
export function validateWorkflowPlan(
  base: SitePlanData,
  next: SitePlanData,
): void {
  sitePlanDataSchema.parse(next);
  if (!checkBoundaryRing(next.boundary).ok) throw new Error("活动边界无效。");
  for (const zone of next.zones)
    if (facilityPlacementIssues(zone.polygon, next.boundary).length)
      throw new Error("分区越出已确认活动边界。");
  const changedZones = new Set(
    next.zones
      .filter(
        (z) =>
          JSON.stringify(base.zones.find((o) => o.id === z.id)) !==
          JSON.stringify(z),
      )
      .map((z) => z.id),
  );
  for (let i = 0; i < next.zones.length; i++)
    for (let j = i + 1; j < next.zones.length; j++) {
      const a = next.zones[i]!,
        b = next.zones[j]!;
      if (
        (changedZones.has(a.id) || changedZones.has(b.id)) &&
        a.levelId === b.levelId &&
        planRingsOverlap(a.polygon, b.polygon)
      )
        throw new Error("当前同层分区重叠，请核对边界/层级；未应用。");
    }
  for (const route of next.routes.filter(
    (r) =>
      JSON.stringify(base.boundary) !== JSON.stringify(next.boundary) ||
      JSON.stringify(base.routes.find((old) => old.id === r.id)) !==
        JSON.stringify(r),
  )) {
    const strips = outdoorCorridorStrips(route.points, route.widthM ?? 3);
    if (
      strips.some(
        (strip) => facilityPlacementIssues(strip, next.boundary).length,
      ) ||
      next.facilities.some((f) =>
        strips.some((strip) =>
          outdoorRingsOverlap(strip, facilityFootprintRing(f)),
        ),
      )
    )
      throw new Error(
        "新路线全宽占地越出活动边界或穿越现有设施，请调整路线/物件；未应用。",
      );
  }
  for (const f of next.facilities.filter(
    (f) =>
      JSON.stringify(base.boundary) !== JSON.stringify(next.boundary) ||
      changedZones.has(f.zoneId ?? "") ||
      JSON.stringify(base.facilities.find((b) => b.id === f.id)) !==
        JSON.stringify(f),
  )) {
    const zone = next.zones.find((z) => z.id === f.zoneId);
    if (
      !zone ||
      !clearForObject(
        f,
        {
          ...next,
          facilities: next.facilities.filter((other) => other.id !== f.id),
        },
        zone,
      )
    )
      throw new Error(
        "物件占地/方向与区域、通道、门口或其他物件冲突，未应用。",
      );
  }
  for (const worker of next.workers) {
    if (
      worker.zoneId &&
      (changedZones.has(worker.zoneId) ||
        !base.workers.some((w) => w.id === worker.id))
    ) {
      const zone = next.zones.find((z) => z.id === worker.zoneId);
      if (!zone || !planPointInRing(worker.position, zone.polygon))
        throw new Error(
          "岗位所属分区已经变化，请重新核对岗位范围；未把人员留在区外。",
        );
    }
    if (worker.routeIds?.some((id) => !next.routes.some((r) => r.id === id)))
      throw new Error("岗位进出路线已失效，请重新安排；未应用。");
  }
}
