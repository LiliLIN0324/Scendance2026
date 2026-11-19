/**
 * 户外「设计师模式」默认需求：用户只说「随便 / 你看着办 / 做一版」时，
 * 不再回头要「各区需要哪些物件、各多少」，而是按分区用途 + 分区真实面积 + 人数
 * 确定性地生成一份默认清单，交给已有的 proposeInventoryObjects 去落位。
 *
 * 2026-11-17 用户拍板：「用户是讲不清楚需要什么的，他希望 AI 就是设计师，先出一个方案他看看。」
 * 所以这一层只做「先生成需求」，不做任何写画布：调用方拿到 items 后一律走预览，确认才应用。
 *
 * 三条红线：
 * 1. 默认值必须自证是默认值——evidence 里写明「按分区用途与面积估算」，不冒充用户说的数字；
 *    这些 items 也永远不进 mergeOutdoorFacts，用户亲口说的数量仍逐条要求本句依据。
 * 2. 数量由**面积反算**，不从人数正推，也不为了「看起来装得下」凑数：算出来几个就是几个。
 * 3. 协议上限：单行 count ≤ 200、清单 ≤ 20 行；超过就如实说「本区最多可放约 N 件，本次按 200 件出草案」。
 */
import type { PlanPoint, PlanZone, SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import type { OutdoorBrief } from "./outdoor-agent-contract";

/** 协议硬上限（outdoor-agent-response-contract：count max 200、items max 20）。 */
export const OUTDOOR_DRAFT_MAX_LINE = 200;
export const OUTDOOR_DRAFT_MAX_ITEMS = 20;

/**
 * 单件占地的**包络**（平方米，已含摊间与主通道），不是物料本身的尺寸：
 * 真实尺寸由物料库给，这里只用来反算"这块地能放多少个"。
 */
const ENVELOPE_M2 = {
  /** 2×2m 摊位 + 两侧摊间/主通道。 */
  market: 8,
  /** 3×3m 展位 + 通道。 */
  exhibition: 9,
  /** 单把座椅 + 排距。 */
  seat: 0.8,
} as const;

/** 演出舞台的默认占地（8×6m）；分区小于这个就不硬塞舞台，改为如实说明。 */
const STAGE_FOOTPRINT_M2 = 48;

export interface OutdoorDraftLine {
  zone: string;
  query: string;
  count: number;
  evidence: string;
}

export interface OutdoorDraftZoneFact {
  zone: string;
  purpose: string;
  areaM2: number;
  /** 按包络反算的容纳上限（未按协议 200 截断）。 */
  capacity: number;
  /** 本次草案实际给出的数量。 */
  drawn: number;
}

export interface OutdoorDraftDesign {
  items: OutdoorDraftLine[];
  /** 需要让用户看到的说明：为什么这么排、哪里截了上限、哪些区没排。 */
  notes: string[];
  zones: OutdoorDraftZoneFact[];
}

/** 多边形面积（平方米，ENU 局部坐标；与 plan 同一基准）。 */
export function ringAreaM2(ring: readonly PlanPoint[]): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

const PURPOSES: Record<string, string> = {
  market: "市集摊位区",
  performance: "演出区",
  audience: "观众区",
  exhibition: "展览区",
  service: "服务区",
};

const evidence = (text: string): string =>
  // 协议要求 evidence 非空且 ≤200 字；这条只标记"默认来源"，不当作本句原文引用。
  text.slice(0, 200);

/** 每摊约 4 人（沿用市集模板口径），只用于"人够不够/摊够不够"的如实提示。 */
const PEOPLE_PER_STALL = 4;

/**
 * 按分区生成默认物料清单。
 *
 * 只读 plan + brief，不改任何状态；同一输入永远同一输出（无随机、无时钟）。
 * 调用方负责把它当"草案"：进预览、进提案卡的说明，不直接落盘成用户需求。
 */
export function draftDemand(
  plan: SitePlanData,
  brief: Pick<OutdoorBrief, "guests" | "event">,
  options?: {
    maxLine?: number;
    maxItems?: number;
    /** 调用方已知库里有某件物料时用它改默认选品（如展览区有「展板」就不推摊位）；不知道就不传。 */
    hasMaterial?: (name: string) => boolean;
  },
): OutdoorDraftDesign {
  if (!plan.zones.length && ringAreaM2(plan.boundary) >= 4) {
    const event = brief.event ?? "";
    const purpose = /市集|集市|摆摊/u.test(event) ? "market"
      : /演出|表演|音乐/u.test(event) ? "performance"
      : /展览|展会/u.test(event) ? "exhibition" : "service";
    const area: PlanZone = { id: "activity-boundary", name: "活动场地", semantic: "reserved", polygon: plan.boundary, purpose, notes: "" };
    const draft = draftDemand({ ...plan, zones: [area] }, brief, { ...options, maxLine: Math.min(options?.maxLine ?? 12, 12) });
    return { ...draft, items: draft.items.map(item => ({ ...item, zone: "" })) };
  }
  const maxLine = Math.min(OUTDOOR_DRAFT_MAX_LINE, options?.maxLine ?? OUTDOOR_DRAFT_MAX_LINE);
  const maxItems = Math.max(1, options?.maxItems ?? OUTDOOR_DRAFT_MAX_ITEMS);
  const items: OutdoorDraftLine[] = [];
  const notes: string[] = [];
  const zones: OutdoorDraftZoneFact[] = [];
  const guests = brief.guests && brief.guests > 0 ? brief.guests : null;
  const push = (zone: PlanZone, query: string, count: number, why: string) => {
    const drawn = Math.max(1, Math.min(count, maxLine));
    if (items.length >= maxItems) return;
    items.push({
      zone: zone.name,
      query,
      count: drawn,
      evidence: evidence(`默认方案：${why}；按分区用途与可用面积估算，未使用你给的数量。`),
    });
  };

  for (const zone of plan.zones) {
    const area = ringAreaM2(zone.polygon);
    const purpose = zone.purpose ?? "unknown";
    if (area <= 0) {
      notes.push(`「${zone.name}」轮廓无效，未排物料。`);
      continue;
    }
    const label = PURPOSES[purpose];
    if (!label) {
      notes.push(`「${zone.name}」还没有用途，本版不猜它放什么；先在分区属性里选一个用途，或直接说要放什么。`);
      continue;
    }

    if (purpose === "market" || purpose === "exhibition") {
      const envelope = purpose === "market" ? ENVELOPE_M2.market : ENVELOPE_M2.exhibition;
      const capacity = Math.floor(area / envelope);
      if (capacity < 1) {
        notes.push(`「${zone.name}」约 ${Math.round(area)}㎡，按每件 ${envelope}㎡（含通道）放不下 1 件，未排。`);
        continue;
      }
      // 展览区优先用库里真实存在的「展板」；没有就退回 2×2 展位模块（同一套真实尺寸，不编新物料）。
      const exhibitionBoard = purpose === "exhibition" && options?.hasMaterial?.("展板") === true;
      const query = exhibitionBoard ? "展板" : "市集摊位";
      const unit = purpose === "market" ? "摊" : "个展位";
      push(zone, query, capacity, `「${zone.name}」约 ${Math.round(area)}㎡，按每${unit} ${envelope}㎡（含间隙与主通道）`);
      zones.push({ zone: zone.name, purpose, areaM2: Math.round(area), capacity, drawn: Math.min(capacity, maxLine) });
      if (capacity > maxLine)
        notes.push(`「${zone.name}」最多可放约 ${capacity} 件；单次清单上限 ${maxLine} 件，本版按 ${maxLine} 件出草案，可再要一版继续补。`);
      if (guests && purpose === "market") {
        const serves = capacity * PEOPLE_PER_STALL;
        notes.push(serves < guests
          ? `「${zone.name}」约 ${capacity} 摊、每摊约 ${PEOPLE_PER_STALL} 人，可服务约 ${serves} 人，低于同时 ${guests} 人；要么加摊位区，要么分时入场（不是安全容量结论）。`
          : `「${zone.name}」约 ${capacity} 摊、每摊约 ${PEOPLE_PER_STALL} 人，可服务约 ${serves} 人，覆盖同时 ${guests} 人的摊位需求（不是安全容量结论）。`);
      }
      continue;
    }

    if (purpose === "performance") {
      if (area >= STAGE_FOOTPRINT_M2) {
        push(zone, "舞台", 1, `「${zone.name}」约 ${Math.round(area)}㎡，舞台按 8×6m 落在面向观众区的一侧（没有观众区才按区心落台）`);
        zones.push({ zone: zone.name, purpose, areaM2: Math.round(area), capacity: 1, drawn: 1 });
      } else {
        notes.push(`「${zone.name}」约 ${Math.round(area)}㎡，放不下 8×6m 舞台；本版不塞舞台，可换小舞台或扩区。`);
      }
      // 演出区兼作站位/坐席：留一半给舞台与前场，其余按 0.8㎡/座。
      const seatCapacity = Math.floor(((area - STAGE_FOOTPRINT_M2 > 0 ? (area - STAGE_FOOTPRINT_M2) * 0.6 : 0) / ENVELOPE_M2.seat) + 1e-9);
      const seatCount = guests ? Math.min(seatCapacity, guests) : seatCapacity;
      if (seatCount >= 1) {
        const drawnSeats = Math.min(seatCount, maxLine);
        push(zone, "椅子", seatCount, `「${zone.name}」扣掉舞台后按 ${ENVELOPE_M2.seat}㎡/座排座${guests ? "，并受同时人数约束" : ""}`);
        notes.push(
          `「${zone.name}」观众座席本版 ${drawnSeats} 座`
          + (seatCount > drawnSeats ? `（按面积可排约 ${seatCount} 座，单次清单上限 ${maxLine} 件）` : "")
          + (guests && drawnSeats < guests ? `，低于同时 ${guests} 人：其余按站位，站位密度需现场核定` : "")
          + "。",
        );
      }
      continue;
    }

    if (purpose === "audience") {
      const capacity = Math.floor((area * 0.7) / ENVELOPE_M2.seat + 1e-9);
      if (capacity < 1) {
        notes.push(`「${zone.name}」约 ${Math.round(area)}㎡，按 ${ENVELOPE_M2.seat}㎡/座不足 1 座，未排。`);
        continue;
      }
      const count = guests ? Math.min(capacity, guests) : capacity;
      const drawn = Math.min(count, maxLine);
      push(zone, "椅子", count, `「${zone.name}」约 ${Math.round(area)}㎡，按 70% 可排面积、${ENVELOPE_M2.seat}㎡/座`);
      zones.push({ zone: zone.name, purpose, areaM2: Math.round(area), capacity, drawn });
      if (capacity > maxLine)
        notes.push(`「${zone.name}」按面积可排约 ${capacity} 座，单次清单上限 ${maxLine} 件，本版按 ${drawn} 座出草案。`);
      if (guests && drawn < guests)
        notes.push(`「${zone.name}」本版排 ${drawn} 座，比同时 ${guests} 人少 ${guests - drawn} 个；差额需要站位或加观众区。`);
      continue;
    }

    // service：签到/医疗/补给这类小件，按"有没有空间"给最小可用套件，不按面积堆数量。
    if (purpose === "service") {
      if (area < 4) {
        notes.push(`「${zone.name}」约 ${Math.round(area)}㎡，太小，未排服务设施。`);
        continue;
      }
      push(zone, "桌子", 1, `「${zone.name}」约 ${Math.round(area)}㎡，按 1 张签到/服务桌`);
      push(zone, "垃圾桶", 2, `「${zone.name}」按最小服务套件配 2 个垃圾桶`);
      push(zone, "指示牌", 2, `「${zone.name}」按最小服务套件配 2 块指示牌`);
      zones.push({ zone: zone.name, purpose, areaM2: Math.round(area), capacity: 5, drawn: 5 });
      continue;
    }
  }

  if (!plan.zones.length && !items.length)
    notes.push("请画出活动范围，我就可以在里面布置物料。");

  return { items, notes, zones };
}
