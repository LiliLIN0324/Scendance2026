/**
 * Agent 结果摘要（2026-11-20 场地自主规划交互 P1）。
 *
 * 目标：用户看完一版方案，能在三行内知道「为什么这样排、实际摆下多少、哪些是我猜的」。
 * 这里只做**纯展示归纳**——不重算布局、不改 plan、不碰婚礼布局算法；
 * 输入是规划器已经产出的 quantities / checks / notes，输出是可直接渲染的结构。
 *
 * 口径（与 docs/05-设计规范 §五.4「不确定性诚实」一致）：
 * - 目标人数与**实际摆下**分开写，绝不把「目标 60 人」写成「已满足 60 人」。
 * - 推荐理由最多 3 条，每条都要能落到真实数字或真实分区名。
 * - 假设只收原 notes 里明确标了未确认/占位/假设的句子，不自行补充「应该没问题」。
 * - 几何硬冲突（碰撞/越界/障碍/占道）单独列出，且写明「处理后才算合格」。
 */
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

export interface DesignQuantity {
  role: string;
  zone: string;
  requested: number;
  placed: number;
  placeholder?: boolean;
}

export interface DesignChecks {
  collisions: number;
  boundary: number;
  obstacles: number;
  corridors: number;
  ceremonySeats: number;
  banquetSeats: number;
  target: number;
  access?: string;
  safety?: string;
}

export interface DesignSummaryInput {
  plan: SitePlanData;
  quantities: readonly DesignQuantity[];
  checks: DesignChecks;
  notes: readonly string[];
  strategy?: "ceremony-first" | "banquet-first";
  guests?: number;
}

export interface DesignSummaryZone {
  id: string;
  name: string;
  facilityCount: number;
}

export interface DesignSummary {
  title: string;
  strategyLabel: string;
  /** 推荐理由，最多 3 条。 */
  reasons: string[];
  capacity: {
    target: number;
    ceremonySeats: number;
    banquetSeats: number;
    tables: number;
    placedTotal: number;
    requestedTotal: number;
    placeholders: number;
    reusedMaterials: number;
  };
  /** 需要核对的关键假设，最多 4 条。 */
  assumptions: string[];
  /** 几何硬冲突；空数组代表这一版没有已知硬冲突。 */
  issues: string[];
  zones: DesignSummaryZone[];
  /** 查询用：分区名 → 该区设施 id，用于摘要与画布双向定位。 */
  zoneFacilities: Record<string, string[]>;
}

const STRATEGY_LABELS: Record<NonNullable<DesignSummaryInput["strategy"]>, string> = {
  "ceremony-first": "仪式优先",
  "banquet-first": "宴席优先",
};

const ASSUMPTION_PATTERN = /假设|未提供|未确认|待核对|占位|待选型|不推断|未识别|尚未|未找到|留到|未取得|未知|暂按|草案|不写成/u;

function unique(list: readonly string[]): string[] {
  return [...new Set(list.map((item) => item.trim()).filter(Boolean))];
}

function countFacilities(plan: SitePlanData, zoneId: string): number {
  return plan.facilities.filter((facility) => facility.zoneId === zoneId).length;
}

/** 从规划报告归纳出一张结果摘要；对缺失字段保持保守（不补默认值）。 */
export function buildDesignSummary(input: DesignSummaryInput): DesignSummary {
  const { plan, checks } = input;
  const quantities = input.quantities;
  const guests = input.guests ?? checks.target;
  const ceremonySeats = checks.ceremonySeats;
  const banquetSeats = checks.banquetSeats;
  const tables = quantities.find((quantity) => quantity.role === "宴席圆桌")?.placed ?? 0;
  const placedTotal = quantities.reduce((sum, quantity) => sum + quantity.placed, 0);
  const requestedTotal = quantities.reduce((sum, quantity) => sum + quantity.requested, 0);
  const placeholders = plan.facilities.filter((facility) => facility.templateId.startsWith("wedding-placeholder:")).length;
  const reusedMaterials = plan.facilities.filter((facility) => Boolean(facility.sourceAssetId)).length;

  const reasons: string[] = [];
  const bothFit = ceremonySeats >= guests && banquetSeats >= guests;
  reasons.push(
    `观礼 ${ceremonySeats} 席、宴席 ${banquetSeats} 席（目标 ${guests} 人）${bothFit
      ? "，两个环节都摆得下"
      : "，没摆满的差额留在清单里，不降低人数"}`,
  );
  const zoneNames = plan.zones.slice(0, 4).map((zone) => zone.name);
  if (zoneNames.length) {
    reasons.push(
      `按「${zoneNames.join("、")}」${plan.zones.length > 4 ? "等" : ""}分区摆放，桌椅留在各自分区内`,
    );
  }
  if (reusedMaterials || placeholders) {
    reasons.push(
      `${reusedMaterials} 件复用真实物料${placeholders ? `，${placeholders} 件是标注过的尺寸占位` : ""}`,
    );
  }

  const assumptions = unique(input.notes.filter((note) => ASSUMPTION_PATTERN.test(note))).slice(0, 4);

  const issues: string[] = [];
  if (checks.collisions > 0) issues.push(`物件互相压占 ${checks.collisions} 处`);
  if (checks.boundary > 0) issues.push(`越出分区或活动范围 ${checks.boundary} 件`);
  if (checks.obstacles > 0) issues.push(`压到已知障碍 ${checks.obstacles} 件`);
  if (checks.corridors > 0) issues.push(`占用通道 ${checks.corridors} 件`);

  return {
    title: `婚礼布置 · ${STRATEGY_LABELS[input.strategy ?? "ceremony-first"]}`,
    strategyLabel: STRATEGY_LABELS[input.strategy ?? "ceremony-first"],
    reasons: reasons.slice(0, 3),
    capacity: {
      target: guests,
      ceremonySeats,
      banquetSeats,
      tables,
      placedTotal,
      requestedTotal,
      placeholders,
      reusedMaterials,
    },
    assumptions,
    issues,
    zones: plan.zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      facilityCount: countFacilities(plan, zone.id),
    })),
    zoneFacilities: Object.fromEntries(
      plan.zones.map((zone) => [
        zone.id,
        plan.facilities.filter((facility) => facility.zoneId === zone.id).map((facility) => facility.id),
      ]),
    ),
  };
}

/** 实际摆下的座椅数（观礼与宴席分开，不合并成一个更好看的数字）。 */
export function seatedSummary(summary: DesignSummary): string {
  const { ceremonySeats, banquetSeats, target } = summary.capacity;
  return `观礼 ${ceremonySeats} / 宴席 ${banquetSeats} / 目标 ${target} 人`;
}

/** 这一版能否直接说「满足人数」——两处都摆满才算，缺一处就照实说。 */
export function meetsTarget(summary: DesignSummary): boolean {
  const { ceremonySeats, banquetSeats, target } = summary.capacity;
  return ceremonySeats >= target && banquetSeats >= target;
}
