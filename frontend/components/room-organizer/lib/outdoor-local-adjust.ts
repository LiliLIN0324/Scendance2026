/**
 * 一句话局部调整（2026-11-20 P1）。
 *
 * 只处理「把选中的这一组挪一点」：
 *   「向右移 2 米」「往北 1.5 m」「往左移两米」「这里松一点」
 *
 * 三条硬口径：
 * 1. **只作用于显式选中的对象**。没有选中就问「先点选哪一组」，不猜「这里」。
 * 2. **方向必须有坐标语义**。「右」在正北朝上的 2D 画布里 = +x（东）；画布转过角度或
 *    进了 3D，屏幕右与场地东侧就不是一回事——此时只澄清这一件事，并把答案记住。
 * 3. **不重排整个场**。只改选中物件的坐标/间距，边界、分区、流线一律不动；
 *    越界、压到相邻物料如实计数，不静默夹回原位。锁定层由调用方写入前拦（本函数不读锁）。
 */
import { facilityOverlapPairs } from "./plan-facility-overlap";
import { facilityFootprintRing, facilityPlacementIssues } from "./site-plan-facilities";
import type { PlanFacility, SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

export type DirectionBasis = "east" | "screen";

export interface LocalAdjustRequest {
  kind: "move" | "spread";
  dx: number;
  dy: number;
  distanceM: number;
  /** 这句话最终按什么解读方向；用于回话里写清「右＝东侧」这类语义。 */
  basisLabel: string;
}

export type LocalAdjustParse =
  | { kind: "adjust"; request: LocalAdjustRequest }
  | { kind: "clarify"; question: string; reason: "no-selection" | "direction-basis" | "no-distance" | "no-direction" | "no-basis-bearing" | "screen-basis-3d" }
  | { kind: "none" };

const CN_NUMBERS: Record<string, number> = {
  半: 0.5, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 读「2」「1.5」「两」「半」；读不到返回 null（不默认 1 米）。 */
export function readDistance(text: string): number | null {
  const digits = text.match(/(\d+(?:\.\d+)?)\s*(?:米|m|M|公尺)?/u);
  if (digits) {
    const value = Number(digits[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const chinese = text.match(/(半|[一二两三四五六七八九十])\s*(?:米|公尺)/u);
  if (chinese) return CN_NUMBERS[chinese[1]] ?? null;
  return null;
}

type Axis = "east" | "west" | "north" | "south";

function readAxis(text: string): { axis: Axis; explicit: boolean } | null {
  if (/向东|朝东|往东|正东|东侧|东边/u.test(text)) return { axis: "east", explicit: true };
  if (/向西|朝西|往西|正西|西侧|西边/u.test(text)) return { axis: "west", explicit: true };
  if (/向北|朝北|往北|正北|北侧|北边/u.test(text)) return { axis: "north", explicit: true };
  if (/向南|朝南|往南|正南|南侧|南边/u.test(text)) return { axis: "south", explicit: true };
  if (/向右|往右|右移|靠右|右边/u.test(text)) return { axis: "east", explicit: false };
  if (/向左|往左|左移|靠左|左边/u.test(text)) return { axis: "west", explicit: false };
  if (/向上|往上|上移|往上边/u.test(text)) return { axis: "north", explicit: false };
  if (/向下|往下|下移|往下边/u.test(text)) return { axis: "south", explicit: false };
  return null;
}

/** 「按东侧」「按屏幕」这类回答——记住一次，后面同义句不再重复问。 */
export function parseRightBasisAnswer(message: string): DirectionBasis | null {
  const text = message.trim();
  if (/按?(?:场地|地图|实际|真实|正)?东侧|按坐标|按场地|东边为准/u.test(text)) return "east";
  if (/按屏幕|屏幕右边|我看到|按我这边|按视角/u.test(text)) return "screen";
  return null;
}

/** 屏幕右在场地坐标里的单位向量：正北朝上 = 东；否则按顺时针转角还原。 */
export function screenRightVector(bearingDeg: number): { x: number; y: number } {
  const rad = (bearingDeg * Math.PI) / 180;
  // 90° 的 cos 会给出 6.1e-17：数学上没错，但落进坐标就成了无意义的浮点尾巴。
  const snap = (value: number) => (Math.abs(value) < 1e-12 ? 0 : value);
  return { x: snap(Math.cos(rad)), y: snap(-Math.sin(rad)) };
}

export interface LocalAdjustContext {
  /** 当前显式选中的对象数（未被用户移除上下文引用）。 */
  selectedCount: number;
  /** 已记住的「右」口径；尚未确定时给 null。 */
  rightBasis?: DirectionBasis | null;
  /** 画布顺时针转角；null/0 表示正北朝上。 */
  screenBearingDeg?: number | null;
  view?: "2d" | "3d";
}

const SPREAD_PATTERN = /松一点|松一些|松点|拉开|别挤|太挤|间距大一点/u;

export function parseLocalAdjustment(message: string, context: LocalAdjustContext): LocalAdjustParse {
  const text = message.normalize("NFKC").trim();
  if (!text) return { kind: "none" };
  // 只有明确的选中组调整才走本地快捷执行，否定、询问与指定其它目标交回理解路径。
  if (/不要|不必|不需要|先不|不用|取消|停止|别(?:再|把|将|向|往|移|动|挪|拉)|[?？]|会不会|能不能|能否|是否|可以吗|^(?:怎么|如何|为什么)/u.test(text)
    || /第\s*[\d一二两三四五六七八九十]+\s*(?:桌|组|排|把|件)|编号|桌号|另一|其他|所有|全部|全场/u.test(text)) return { kind: "none" };

  const spread = SPREAD_PATTERN.test(text);
  if (!spread && !/(?:向|往|朝)[东南西北左右上下](?:侧|边)?\s*(?:移(?:动)?|挪(?:动)?|走)?\s*(?:\d|半|[一二两三四五六七八九十])|(?:移(?:动)?|挪(?:动)?)[\s\S]*(?:向|往|朝|侧|边)|[左右上下]移/u.test(text)) return { kind: "none" };
  const axisInfo = readAxis(text);
  const distance = readDistance(text);
  // 既没有方向词也没有「松一点」：不属于局部调整，交回原理解路径。
  if (!axisInfo && !spread) return { kind: "none" };

  if (context.selectedCount <= 0) {
    return {
      kind: "clarify",
      reason: "no-selection",
      question: "先点选要调整的桌椅（可以框选一整组），再说“向右移 2 米”；我不会猜“这里”是哪一组。",
    };
  }

  if (spread) {
    return {
      kind: "adjust",
      request: {
        kind: "spread",
        dx: 0,
        dy: 0,
        distanceM: 0.5,
        basisLabel: "按组中心各自向外 0.5 m",
      },
    };
  }

  if (!axisInfo) {
    return { kind: "clarify", reason: "no-direction", question: "往哪个方向？可以说东/南/西/北，或“向右 2 米”。" };
  }
  if (distance === null) {
    return { kind: "clarify", reason: "no-distance", question: "移多少米？请给一个数，例如“向右移 2 米”。" };
  }

  let basisLabel = "";
  let sign = { x: 0, y: 0 };
  const rawSign: Record<Axis, { x: number; y: number }> = {
    east: { x: 1, y: 0 },
    west: { x: -1, y: 0 },
    north: { x: 0, y: 1 },
    south: { x: 0, y: -1 },
  };

  const needsBasis = !axisInfo.explicit && (axisInfo.axis === "east" || axisInfo.axis === "west");
  if (needsBasis && context.rightBasis !== "east") {
    const bearing = context.screenBearingDeg;
    const bearingKnown = typeof bearing === "number";
    const viewIs3d = context.view === "3d";
    const northUp = bearingKnown && !viewIs3d && Math.abs(bearing) < 1e-6;
    if (!context.rightBasis) {
      if (northUp) {
        // 正北朝上的 2D：屏幕右就是东，可以直接给坐标语义并写进回话。
        sign = rawSign[axisInfo.axis];
        basisLabel = `${axisInfo.axis === "east" ? "右" : "左"}＝画布正东/正西（${axisInfo.axis === "east" ? "+x" : "−x"}）`;
      } else {
        return {
          kind: "clarify",
          reason: "no-basis-bearing",
          // 3D 里「右」全看相机，不能拿 2D 罗盘口径兜底——先把这一个问题问清。
          question: viewIs3d
            ? "现在是 3D 视角，“向右”随相机转，不是固定的场地东侧。按屏幕右边算，还是按场地东侧？回“按屏幕”或“按东侧”，我记住这个口径。"
            : "当前画布朝向读不到（转过角度），“向右”按屏幕右边还是按场地东侧？回一句“按屏幕”或“按东侧”，我记住这个口径。",
        };
      }
    } else {
      if (viewIs3d) {
        // 已记住「按屏幕」但现在是 3D：2D 转角在这里不成立，不能拿它硬算一个方向。
        return {
          kind: "clarify",
          reason: "screen-basis-3d",
          question: "3D 里“屏幕右”随相机转，落不成固定方向。这次说成“往东/往西 几米”，或切回 2D 平面再说“往右”。",
        };
      }
      // 已记住「按屏幕」：没有转角就按东侧算，有转角才换算；始终把依据写进回话。
      if (bearingKnown && Math.abs(bearing) > 1e-6) {
        const vector = screenRightVector(bearing);
        sign = axisInfo.axis === "east" ? vector : { x: -vector.x, y: -vector.y };
        basisLabel = `按屏幕${axisInfo.axis === "east" ? "右" : "左"}（画布转角 ${bearing.toFixed(0)}°）`;
      } else {
        sign = rawSign[axisInfo.axis];
        basisLabel = bearingKnown
          ? `按屏幕${axisInfo.axis === "east" ? "右" : "左"}，当前正北朝上`
          : `按屏幕${axisInfo.axis === "east" ? "右" : "左"}，画布朝向未读到，按正北朝上换算`;
      }
    }
  } else {
    sign = rawSign[axisInfo.axis];
    basisLabel = axisInfo.explicit
      ? `按场地${axisInfo.axis === "east" ? "东" : axisInfo.axis === "west" ? "西" : axisInfo.axis === "north" ? "北" : "南"}侧`
      : `按屏幕${axisInfo.axis === "east" ? "右" : "左"}，当前正北朝上`;
  }

  return {
    kind: "adjust",
    request: {
      kind: "move",
      dx: sign.x * distance,
      dy: sign.y * distance,
      distanceM: distance,
      basisLabel,
    },
  };
}

export interface LocalAdjustResult {
  plan: SitePlanData;
  movedIds: string[];
  /** 移动后越界/压物料的件数与处数之和（如实计数，不静默夹回）。 */
  conflicts: number;
  /** 这次动到的分区名（去重），用于说清「影响范围」。 */
  affectedZones: string[];
  note: string;
}

/** 只移动 ids 里的设施；其余实体、边界、锚点原样保留（同一引用，不复制）。 */
export function applyLocalAdjust(
  plan: SitePlanData,
  ids: readonly string[],
  request: LocalAdjustRequest,
): LocalAdjustResult {
  const wanted = new Set(ids);
  const selected = plan.facilities.filter((facility) => wanted.has(facility.id));
  if (!selected.length) {
    return { plan, movedIds: [], conflicts: 0, affectedZones: [], note: "选中的对象已不在画布上，没有移动。" };
  }

  const centroid = selected.reduce(
    (acc, facility) => ({ x: acc.x + facility.position.x / selected.length, y: acc.y + facility.position.y / selected.length }),
    { x: 0, y: 0 },
  );

  const moved = new Map<string, PlanFacility>();
  for (const facility of selected) {
    if (request.kind === "move") {
      moved.set(facility.id, {
        ...facility,
        position: { x: facility.position.x + request.dx, y: facility.position.y + request.dy },
      });
      continue;
    }
    // spread：离开组中心 0.5 m；已在中心的（单件）保持不动，避免除零。
    const vx = facility.position.x - centroid.x;
    const vy = facility.position.y - centroid.y;
    const length = Math.hypot(vx, vy);
    if (length < 1e-6) {
      moved.set(facility.id, facility);
      continue;
    }
    const step = request.distanceM;
    moved.set(facility.id, {
      ...facility,
      position: {
        x: facility.position.x + (vx / length) * step,
        y: facility.position.y + (vy / length) * step,
      },
    });
  }

  const next: SitePlanData = {
    ...plan,
    facilities: plan.facilities.map((facility) => moved.get(facility.id) ?? facility),
  };

  const movedIds = [...moved.keys()].filter(
    (id) => moved.get(id)!.position.x !== plan.facilities.find((f) => f.id === id)!.position.x
      || moved.get(id)!.position.y !== plan.facilities.find((f) => f.id === id)!.position.y,
  );

  let conflicts = 0;
  const affectedZoneIds = new Set<string>();
  for (const id of movedIds) {
    const facility = moved.get(id)!;
    if (facility.zoneId) affectedZoneIds.add(facility.zoneId);
    const ring = facilityFootprintRing(facility);
    const zone = plan.zones.find((item) => item.id === facility.zoneId);
    if (
      facilityPlacementIssues(ring, plan.boundary).length ||
      (zone && facilityPlacementIssues(ring, zone.polygon).length)
    ) {
      conflicts++;
    }
  }

  // 2026-11-20 P1：设施压设施过去只进问题清单（审计 K7），局部调整完必须当场说清，
  // 否则「只挪了一组」看起来永远安全。判据与 K7 同一份，不另写一套。
  const movedSet = new Set(movedIds);
  const overlaps = facilityOverlapPairs(next.facilities).filter(
    (pair) => movedSet.has(pair.a.id) || movedSet.has(pair.b.id),
  ).length;

  const affectedZones = [...affectedZoneIds]
    .map((id) => plan.zones.find((zone) => zone.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const problems: string[] = [];
  if (conflicts) problems.push(`${conflicts} 件越出活动范围或所属分区`);
  if (overlaps) problems.push(`${overlaps} 处压到相邻物料`);
  const note = problems.length
    ? `移动后有 ${problems.join("、")}，已如实标出，没有自动夹回；可撤销。`
    : `只移动了选中的 ${movedIds.length} 件${affectedZones.length ? `（${affectedZones.join("、")}）` : ""}，其余物件与分区未动。`;

  return { plan: next, movedIds, conflicts: conflicts + overlaps, affectedZones, note };
}
