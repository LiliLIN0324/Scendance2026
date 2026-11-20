import { describe, expect, it } from "vitest";
import { buildDesignSummary, meetsTarget, seatedSummary } from "./outdoor-design-summary";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

const zone = (id: string, name: string) => ({
  id,
  name,
  semantic: "audience" as const,
  notes: "",
  polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
});

const plan = (): SitePlanData => ({
  schemaVersion: 1,
  boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
  zones: [zone("z-cer", "仪式观礼区"), zone("z-ban", "宴席区")],
  facilities: [
    { id: "f1", templateId: "oneplan:chair", sourceAssetId: "chair", name: "观礼椅 1", zoneId: "z-cer", position: { x: 1, y: 1 }, rotationDeg: 0, size: { width: 0.5, depth: 0.55 }, notes: "" },
    { id: "f2", templateId: "wedding-placeholder:banquet-table", name: "宴席圆桌 1", zoneId: "z-ban", position: { x: 5, y: 5 }, rotationDeg: 0, size: { width: 1.8, depth: 1.8 }, notes: "" },
  ],
  routes: [],
  nodes: [],
  workers: [],
});

describe("Agent 结果摘要", () => {
  it("把目标人数与实际摆下的席位数分开写，并且推荐理由不超过 3 条", () => {
    const summary = buildDesignSummary({
      plan: plan(),
      quantities: [
        { role: "观礼椅", zone: "仪式观礼区", requested: 60, placed: 48, placeholder: false },
        { role: "宴席座椅", zone: "宴席区", requested: 60, placed: 60, placeholder: false },
        { role: "宴席圆桌", zone: "宴席区", requested: 6, placed: 6, placeholder: true },
      ],
      checks: { collisions: 0, boundary: 0, obstacles: 0, corridors: 0, ceremonySeats: 48, banquetSeats: 60, target: 60, access: "pending", safety: "unverified" },
      notes: [
        "初步规划参数：每桌10人，缺尺寸时圆桌直径1.8m；均为可修改的设计假设，不是安全规范验收。",
        "入场路线从范围内的建议接驳点起稿，尚未识别或确认真实入口；不会把它登记成已核验的门。",
      ],
    });
    expect(summary.capacity).toMatchObject({ target: 60, ceremonySeats: 48, banquetSeats: 60, tables: 6 });
    expect(summary.reasons.length).toBeLessThanOrEqual(3);
    expect(summary.reasons[0]).toContain("观礼 48 席");
    expect(summary.reasons[0]).toContain("没摆满");
    expect(summary.reasons.join(" ")).toContain("复用真实物料");
    expect(summary.reasons.join(" ")).toContain("尺寸占位");
    expect(meetsTarget(summary)).toBe(false);
    expect(seatedSummary(summary)).toBe("观礼 48 / 宴席 60 / 目标 60 人");
  });

  it("关键假设只收原 notes 里明确标了未确认/假设的句子，不自行加工", () => {
    const summary = buildDesignSummary({
      plan: plan(),
      quantities: [],
      checks: { collisions: 0, boundary: 0, obstacles: 0, corridors: 0, ceremonySeats: 60, banquetSeats: 60, target: 60 },
      notes: ["先预留宾客主通道与服务通路", "暂按 60 人做桌椅需求草案，不写成已确认人数", "所有座位都很好看"],
    });
    expect(summary.assumptions).toEqual(["暂按 60 人做桌椅需求草案，不写成已确认人数"]);
  });

  it("几何硬冲突单独列出并要求处理后才算合格", () => {
    const summary = buildDesignSummary({
      plan: plan(),
      quantities: [],
      checks: { collisions: 2, boundary: 1, obstacles: 0, corridors: 3, ceremonySeats: 60, banquetSeats: 60, target: 60 },
      notes: [],
    });
    expect(summary.issues).toEqual(["物件互相压占 2 处", "越出分区或活动范围 1 件", "占用通道 3 件"]);
    expect(summary.issues.join(" ")).not.toContain("障碍");
  });

  it("给出分区到设施 id 的映射，供摘要与画布双向定位", () => {
    const summary = buildDesignSummary({
      plan: plan(),
      quantities: [],
      checks: { collisions: 0, boundary: 0, obstacles: 0, corridors: 0, ceremonySeats: 0, banquetSeats: 0, target: 0 },
      notes: [],
    });
    expect(summary.zoneFacilities).toEqual({ "z-cer": ["f1"], "z-ban": ["f2"] });
    expect(summary.zones.map((item) => item.facilityCount)).toEqual([1, 1]);
  });

  it("草案内部没接通的分区按分区名原样列出，与几何硬冲突分开", () => {
    const summary = buildDesignSummary({
      plan: plan(),
      quantities: [],
      checks: { collisions: 0, boundary: 0, obstacles: 0, corridors: 0, ceremonySeats: 60, banquetSeats: 60, target: 60 },
      notes: [],
      reachability: { connected: false, zonesWithoutRoute: ["仪式观礼区", "后勤备物区"] },
    });
    expect(summary.unreachableZones).toEqual(["仪式观礼区", "后勤备物区"]);
    // 没接通道不等于几何不合格，更不能被当成现场安全结论。
    expect(summary.issues).toEqual([]);
  });

  it("没给 reachability 时列表为空，不据此声称已连通", () => {
    const summary = buildDesignSummary({
      plan: plan(),
      quantities: [],
      checks: { collisions: 0, boundary: 0, obstacles: 0, corridors: 0, ceremonySeats: 60, banquetSeats: 60, target: 60 },
      notes: [],
    });
    expect(summary.unreachableZones).toEqual([]);
  });

  it("连通时列表为空，不给摘要添噪声", () => {
    const summary = buildDesignSummary({
      plan: plan(),
      quantities: [],
      checks: { collisions: 0, boundary: 0, obstacles: 0, corridors: 0, ceremonySeats: 60, banquetSeats: 60, target: 60 },
      notes: [],
      reachability: { connected: true, zonesWithoutRoute: [] },
    });
    expect(summary.unreachableZones).toEqual([]);
  });
});
