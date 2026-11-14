import { personnelAccess } from "./outdoor-personnel-access";
import type {
  PlanPoint,
  PlanZone,
  SitePlanData,
  PlanFacility,
  PlanWorker,
  PlanNode,
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
/** 2026-11-14 用户指令「给我几个方案」：分区物件排布策略——行列铺排 / 居中紧凑 / 沿边环形。 */
export type ObjectsLayoutStrategy = "rows" | "center" | "perimeter";
export const OBJECTS_LAYOUT_STRATEGIES: ObjectsLayoutStrategy[] = ["rows", "center", "perimeter"];
export const OBJECTS_LAYOUT_LABELS: Record<ObjectsLayoutStrategy, string> = {
  rows: "行列铺排",
  center: "居中紧凑",
  perimeter: "沿边环形",
};

/** 分区内的候选落位（按策略排序）：grid=行列扫、center=离分区中心螺旋、perimeter=贴边一圈+网格兜底。 */
/** 简易包围盒（min/max），禁区预筛用。 */
function bboxLoose(ring: readonly PlanPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;let minY = Infinity;let maxX = -Infinity;let maxY = -Infinity;
  for (const p of ring) {if (p.x < minX) minX = p.x;if (p.y < minY) minY = p.y;if (p.x > maxX) maxX = p.x;if (p.y > maxY) maxY = p.y;}
  return { minX, minY, maxX, maxY };
}
function bBoxesIntersect(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
function pointInBBox(p: PlanPoint, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}
function zonePlacementCandidates(
  zone: PlanZone,
  strategy: ObjectsLayoutStrategy,
): PlanPoint[] {
  const b = box(zone.polygon);
  const grid: PlanPoint[] = [];
  for (let iy = 0; iy < 30; iy++)
    for (let ix = 0; ix < 30; ix++)
      grid.push({
        x: b.w + ((ix + 0.5) * (b.e - b.w)) / 30,
        y: b.s + ((iy + 0.5) * (b.n - b.s)) / 30,
      });
  const cx = (b.w + b.e) / 2;
  const cy = (b.s + b.n) / 2;
  if (strategy === "center")
    return [...grid].sort(
      (p, q) =>
        Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy),
    );
  if (strategy === "perimeter") {
    const ring: PlanPoint[] = [];
    for (let i = 0; i < zone.polygon.length; i++) {
      const a = zone.polygon[i]!;
      const b2 = zone.polygon[(i + 1) % zone.polygon.length]!;
      const len = Math.hypot(b2.x - a.x, b2.y - a.y);
      const steps = Math.max(1, Math.round(len / 2.5));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const px = a.x + (b2.x - a.x) * t;
        const py = a.y + (b2.y - a.y) * t;
        const d = Math.max(1, Math.hypot(cx - px, cy - py));
        ring.push({
          x: px + ((cx - px) / d) * 1.5,
          y: py + ((cy - py) / d) * 1.5,
        });
      }
    }
    return [...ring, ...grid];
  }
  return grid;
}

export async function proposeInventoryObjects(
  plan: SitePlanData,
  brief: OutdoorBrief,
  library: OutdoorLibraryItem[],
  id: () => string = () => crypto.randomUUID(),
  options?: {
    strategy?: ObjectsLayoutStrategy;
    buildings?: PlanPoint[][] | undefined;
    /** 2026-11-14 用户指令「进度条要显示在干嘛」：逐区落位的真实进度回调（async 化让出主线程刷新 UI）。 */
    onPhase?: ((phase: string) => void) | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<{ plan: SitePlanData; used: OutdoorLibraryItem[] }> {
  if (!brief.items.length)
    throw new Error(
      "各区需要哪些物件、各多少？例如“展览区6个展板、表演区1个舞台2只音响”。将先检索你的真实物料库，不自动生成。",
    );
  const strategy = options?.strategy ?? "rows";
  // 2026-11-14 用户指令「建筑给室内分区，设计别做进室内」：落位候选在建筑足迹内、或占地与建筑相交的一律跳过。
  const buildings = options?.buildings ?? [];
  // 室内区域（用户手画的 indoor 语义分区）同样是禁区。
  const indoorZones = plan.zones.filter(z => z.environment === "indoor");
  // 2026-11-14 性能：禁区包围盒预筛——逐候选只对 bbox 相交的少数禁区做环运算（323 栋×900 候选×39 物件的逐顶点环运算实测冻结主线程）。
  const buildingBBoxes = buildings.map(ring => ({ ring, bbox: bboxLoose(ring) }));
  const indoorZoneBBoxes = indoorZones.map(zone => ({ zone, bbox: bboxLoose(zone.polygon) }));
  let next = { ...plan, facilities: [...plan.facilities] };
  const used: OutdoorLibraryItem[] = [];
  for (const need of brief.items) {
    // 2026-11-14 用户指令「进度条要显示在干嘛」：每区让出主线程一帧，让状态文字与进度条真实刷新。
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (options?.signal?.aborted)
      throw new Error("已取消本次物件排布。");
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
    let matches = library.filter(
      (item) =>
        // 2026-11-14 用户指令「按主题排物件」：内置 OnePlan 物件库（source='built-in'）与个人库同权参与。
        (item.source === "personal" || item.source === "built-in") &&
        item.available &&
        (item.name.toLowerCase().includes(need.query.toLowerCase()) ||
          item.id === need.query),
    );
    // 2026-11-14 消歧：子串撞上一组相近物件（指示牌/指示牌架·双面/…）时，精确同名优先收窄。
    const exact = matches.filter((m) => m.name === need.query);
    if (exact.length) matches = exact;
    if (!matches.length)
      throw new Error(
        `你的真实物料库中尚未找到尺寸与模型可用的“${need.query}”。可改名称检索/选真实候选或上传；未自动创建收费生成。`,
      );
    if (matches.length > 1) {
      // 同名多候选（如 manifest 里 icon/scale 两条「市集摊位」）按名称归组：组内同一物件不追问；
      // 只有出现「不同名」真歧义时才要求用户给具体名称。
      const nameGroups = new Map<string, typeof matches>();
      for (const item of matches) {
        const list = nameGroups.get(item.name) ?? [];
        list.push(item);
        nameGroups.set(item.name, list);
      }
      if (nameGroups.size > 1)
        throw new Error(
          `你的库里有${matches.length}个“${need.query}”候选：${[...nameGroups.keys()].join("、")}。请给具体名称或ID，不替你随便选第一个。`,
        );
    }
    const material = matches[0]!;
    used.push(material);
    options?.onPhase?.(`正在落位：${zone.name} · ${material.name} × ${need.count}`);
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
      // 2026-11-14：Agent 摆的库物件（notes 有签名、非 generated 模型）随清单缩减自动回收；
      // 用户深化过的（generated 模型）仍要求逐个确认，不批量丢件。
      if (
        removed.some(
          (f) =>
            !f.modelOverride?.startsWith("generated:library-") &&
            !f.notes?.startsWith("复用我的物料库真实模型"),
        )
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
      // 2026-11-14 用户指令「给我几个方案」：候选落位顺序随策略变化（行列/居中/沿边），换策略=换方案。
      const candidates = zonePlacementCandidates(zone, strategy);
      for (const rotationDeg of [0, 90]) {
        if (found) break;
        for (const position of candidates) {
          if (found) break;
          const facility: PlanFacility = {
            id: id(),
            // 2026-11-14 修复：用规范的 oneplan: 前缀（原 library: 前缀贴纸/取色查找都认不出，
            // Agent 摆的物件在画布上全是裸矩形）。
            templateId: `oneplan:${material.id}`.slice(0, 64),
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
          if (clearForObject(facility, next, zone)) {
            // 建筑禁区 + 室内区域：包围盒预筛后仅对相交者做环运算（性能，见 bboxLoose）。
            const footprint = facilityFootprintRing(facility);
            const footprintBBox = bboxLoose(footprint);
            if (buildingBBoxes.some(b => pointInBBox(position, b.bbox) && planPointInRing(position, b.ring))) continue;
            if (indoorZoneBBoxes.some(z => pointInBBox(position, z.bbox) && planPointInRing(position, z.zone.polygon))) continue;
            if (buildingBBoxes.some(b => bBoxesIntersect(footprintBBox, b.bbox) && outdoorRingsOverlap(footprint, b.ring))) continue;
            if (indoorZoneBBoxes.some(z => bBoxesIntersect(footprintBBox, z.bbox) && outdoorRingsOverlap(footprint, z.zone.polygon))) continue;
            found = facility;
          }
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
  // 2026-11-14 用户拍板「流线可以从场地外延伸到场内」：路线不再强制全宽落在活动边界内
  //（到场段天然在界外，入口=道路与边界交点）；仅保留「不压现有设施」。
  for (const route of next.routes.filter(
    (r) =>
      JSON.stringify(base.boundary) !== JSON.stringify(next.boundary) ||
      JSON.stringify(base.routes.find((old) => old.id === r.id)) !==
        JSON.stringify(r),
  )) {
    const strips = outdoorCorridorStrips(route.points, route.widthM ?? 3);
    if (
      next.facilities.some((f) =>
        strips.some((strip) =>
          outdoorRingsOverlap(strip, facilityFootprintRing(f)),
        ),
      )
    )
      throw new Error(
        "新路线全宽占地穿越现有设施，请调整路线/物件；未应用。",
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
/** 2026-11-14 用户拍板「以第一个选区为准」：换活动边界（候选轮廓/手画闭合）时，
 * 旧边界下的内容按新边界重新安置——装不下的分区/物件/流线随场淘汰（提案整批可撤销），
 * 人员/出入口的悬空 zoneId、岗位的悬空路线引用就地清空；不再用「分区越出」硬报错阻断换场。
 * 若地理锚点本身位移（≥1cm，与 canReanchorOutdoorPlan 同口径），旧坐标系内容整体随场清空——
 * 跨坐标系的逐件几何比较没有意义，换场=新场地。
 * 产出保证能通过 validateWorkflowPlan（分区必须整体在新边界内、物件必须可归入保留分区、流线全宽不得越界或压物件）。 */
export function prunePlanForBoundary(
  base: SitePlanData,
  boundary: SitePlanData["boundary"],
  anchor?: NonNullable<SitePlanData["anchor"]>,
): { next: SitePlanData; droppedZones: string[]; droppedFacilities: string[]; droppedRoutes: string[]; swept: boolean } {
  const movedMeters = base.anchor && anchor
    ? Math.hypot(
        (anchor.lng - base.anchor.lng) * 111320 * Math.cos(anchor.lat * Math.PI / 180),
        (anchor.lat - base.anchor.lat) * 110540,
      )
    : 0;
  if (movedMeters >= 0.01) {
    const name = (items: { name: string }[]) => items.map((item) => item.name);
    return {
      next: { ...base, zones: [], facilities: [], routes: [], workers: [], nodes: [], annotations: [], measurements: [] },
      droppedZones: name(base.zones),
      droppedFacilities: name(base.facilities),
      droppedRoutes: name(base.routes),
      swept: true,
    };
  }
  const zones = base.zones.filter(
    (zone) => !facilityPlacementIssues(zone.polygon, boundary).length,
  );
  const droppedZoneIds = new Set(
    base.zones
      .filter((zone) => facilityPlacementIssues(zone.polygon, boundary).length)
      .map((zone) => zone.id),
  );
  const droppedZones = base.zones
    .filter((zone) => droppedZoneIds.has(zone.id))
    .map((zone) => zone.name);
  const skeleton: SitePlanData = { ...base, boundary, zones };
  // 物件：validateWorkflowPlan 在边界变化时会逐件重查（必须归进一个保留分区且落位干净），
  // 归不进去的随场淘汰；能归入的换挂到保留分区。
  const droppedFacilities: string[] = [];
  const facilities: PlanFacility[] = [];
  for (const facility of base.facilities) {
    const ring = facilityFootprintRing(facility);
    const host = zones.find(
      (zone) => !facilityPlacementIssues(ring, zone.polygon).length,
    );
    if (!host || !clearForObject(facility, { ...skeleton, facilities }, host)) {
      droppedFacilities.push(facility.name);
      continue;
    }
    facilities.push({ ...facility, zoneId: host.id });
  }
  // 流线：全宽走廊越出新边界或压到保留物件的一律淘汰（与 validateWorkflowPlan 同口径）。
  const droppedRoutes: string[] = [];
  const routes = base.routes.filter((route) => {
    const strips = outdoorCorridorStrips(route.points, route.widthM ?? 3);
    const inside =
      !strips.some((strip) => facilityPlacementIssues(strip, boundary).length) &&
      !facilities.some((f) =>
        strips.some((strip) =>
          outdoorRingsOverlap(strip, facilityFootprintRing(f)),
        ),
      );
    if (!inside) droppedRoutes.push(route.name);
    return inside;
  });
  // 人员/出入口：归属分区没了就清引用（点保留）；岗位路线被淘汰就清引用。
  const droppedRouteIds = new Set(
    base.routes
      .filter((route) => !routes.some((kept) => kept.id === route.id))
      .map((route) => route.id),
  );
  const clearZoneRef = <T extends { zoneId?: string | undefined }>(items: T[]): T[] =>
    items.map((item) =>
      item.zoneId && droppedZoneIds.has(item.zoneId)
        ? { ...item, zoneId: undefined }
        : item,
    );
  return {
    next: {
      ...skeleton,
      facilities,
      routes,
      workers: clearZoneRef<PlanWorker>(base.workers).map((worker) => ({
        ...worker,
        routeIds: worker.routeIds?.filter((id) => !droppedRouteIds.has(id)) ?? [],
      })),
      nodes: clearZoneRef<PlanNode>(base.nodes),
    },
    droppedZones,
    droppedFacilities,
    droppedRoutes,
    swept: false,
  };
}
