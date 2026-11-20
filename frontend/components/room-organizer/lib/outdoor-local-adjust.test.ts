import { describe, expect, it } from "vitest";
import {
  applyLocalAdjust,
  parseLocalAdjustment,
  parseRightBasisAnswer,
  readDistance,
  screenRightVector,
} from "./outdoor-local-adjust";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

const plan = (): SitePlanData => ({
  schemaVersion: 1,
  boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
  zones: [{
    id: "z1", name: "宴席区",
    semantic: "audience" as const,
    notes: "",
    polygon: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 15 }, { x: 0, y: 15 }],
  }],
  facilities: [
    { id: "t1", templateId: "oneplan:table", name: "宴席圆桌 1", zoneId: "z1", position: { x: 4, y: 4 }, rotationDeg: 0, size: { width: 1.8, depth: 1.8 }, notes: "" },
    { id: "c1", templateId: "oneplan:chair", name: "宴席 1 桌 1 座", zoneId: "z1", position: { x: 5.5, y: 4 }, rotationDeg: 90, size: { width: 0.5, depth: 0.55 }, notes: "" },
    { id: "c2", templateId: "oneplan:chair", name: "宴席 1 桌 2 座", zoneId: "z1", position: { x: 2.5, y: 4 }, rotationDeg: -90, size: { width: 0.5, depth: 0.55 }, notes: "" },
    { id: "other", templateId: "oneplan:chair", name: "别的椅", zoneId: "z1", position: { x: 9, y: 9 }, rotationDeg: 0, size: { width: 0.5, depth: 0.55 }, notes: "" },
  ],
  routes: [],
  nodes: [],
  workers: [],
});

describe("一句话局部调整", () => {
  it("读距离：数字优先，中文数字兜底，读不到不默认 1 米", () => {
    expect(readDistance("向右移 2 米")).toBe(2);
    expect(readDistance("往北 1.5m")).toBe(1.5);
    expect(readDistance("往左移两米")).toBe(2);
    expect(readDistance("往左移半米")).toBe(0.5);
    expect(readDistance("往左挪一下")).toBeNull();
  });

  it("没有选中对象时只澄清目标，不猜「这里」", () => {
    const parse = parseLocalAdjustment("向右移 2 米", { selectedCount: 0 });
    expect(parse).toMatchObject({ kind: "clarify", reason: "no-selection" });
    if (parse.kind === "clarify") expect(parse.question).toContain("先点选");
  });

  it("正北朝上的 2D 里「向右」有明确坐标语义：+x（东）", () => {
    const parse = parseLocalAdjustment("这组桌椅向右移 2 米", { selectedCount: 3, screenBearingDeg: 0, view: "2d" });
    expect(parse).toMatchObject({
      kind: "adjust",
      request: { kind: "move", dx: 2, dy: 0 },
    });
    if (parse.kind === "adjust") expect(parse.request.basisLabel).toContain("正东");
  });

  it("画布转过角度且尚未记住口径时，只澄清这一件事", () => {
    const parse = parseLocalAdjustment("向右移 2 米", { selectedCount: 3, screenBearingDeg: 30, view: "2d" });
    expect(parse).toMatchObject({ kind: "clarify", reason: "no-basis-bearing" });
    if (parse.kind === "clarify") {
      expect(parse.question).toContain("按屏幕");
      expect(parse.question).toContain("按东侧");
      expect(parse.question.match(/？/gu)).toHaveLength(1);
    }
  });

  it("读不到画布朝向时不假装正北朝上：先问一次口径", () => {
    const parse = parseLocalAdjustment("向右移 2 米", { selectedCount: 2, screenBearingDeg: null, view: "3d" });
    expect(parse).toMatchObject({ kind: "clarify", reason: "no-basis-bearing" });
  });

  it("记住「按东侧」后，转角也不再追问，按场地 +x 走", () => {
    const parse = parseLocalAdjustment("向右移 2 米", { selectedCount: 3, rightBasis: "east", screenBearingDeg: 30 });
    expect(parse).toMatchObject({ kind: "adjust", request: { dx: 2, dy: 0 } });
  });

  it("记住「按屏幕」后按画布转角换算", () => {
    expect(screenRightVector(90)).toEqual({ x: 0, y: -1 });
    const parse = parseLocalAdjustment("向右移 2 米", { selectedCount: 3, rightBasis: "screen", screenBearingDeg: 90 });
    expect(parse).toMatchObject({ kind: "adjust", request: { dx: 0, dy: -2 } });
  });

  it("只移动显式选中的那一组，其它物件与分区原样保留", () => {
    const before = plan();
    const parse = parseLocalAdjustment("这组向右移 2 米", { selectedCount: 3, screenBearingDeg: 0 });
    expect(parse.kind).toBe("adjust");
    if (parse.kind !== "adjust") return;
    const result = applyLocalAdjust(before, ["t1", "c1", "c2"], parse.request);
    expect(result.movedIds.sort()).toEqual(["c1", "c2", "t1"]);
    expect(result.plan.facilities.find((item) => item.id === "t1")!.position).toEqual({ x: 6, y: 4 });
    expect(result.plan.facilities.find((item) => item.id === "other")!.position).toEqual({ x: 9, y: 9 });
    expect(result.plan.zones).toBe(before.zones);
    expect(result.plan.boundary).toBe(before.boundary);
    expect(result.conflicts).toBe(0);
    expect(result.note).toContain("只移动了选中的 3 件");
  });

  it("移出分区时如实计数，不静默夹回", () => {
    const before = plan();
    const result = applyLocalAdjust(before, ["other"], { kind: "move", dx: 8, dy: 0, distanceM: 8, basisLabel: "x" });
    expect(result.conflicts).toBe(1);
    expect(result.plan.facilities.find((item) => item.id === "other")!.position).toEqual({ x: 17, y: 9 });
    expect(result.note).toContain("越出");
  });

  it("「松一点」按组中心各自向外 0.5 m，单件不动", () => {
    const before = plan();
    const parse = parseLocalAdjustment("这里松一点", { selectedCount: 2 });
    expect(parse).toMatchObject({ kind: "adjust", request: { kind: "spread", distanceM: 0.5 } });
    const result = applyLocalAdjust(before, ["t1"], { kind: "spread", dx: 0, dy: 0, distanceM: 0.5, basisLabel: "" });
    expect(result.movedIds).toEqual([]);
  });

  it("认出「按屏幕 / 按东侧」的回答", () => {
    expect(parseRightBasisAnswer("按东侧")).toBe("east");
    expect(parseRightBasisAnswer("按屏幕")).toBe("screen");
    expect(parseRightBasisAnswer("好的")).toBeNull();
  });

  it("与移动无关的句子不接管", () => {
    expect(parseLocalAdjustment("把宴席区改成蓝色", { selectedCount: 3 })).toEqual({ kind: "none" });
  });
});

describe("3D 视角里「右」的语义", () => {
  it.each(["不要向右移 2 米", "向右移 2 米会不会越界？", "在北侧放一个 2 米宽的背景", "把第 2 桌向右移 3 米"])("不接管需要理解的句子：%s", (message) => {
    expect(parseLocalAdjustment(message, { selectedCount: 1, screenBearingDeg: 0 }).kind).not.toBe("adjust");
  });
  it("3D 里不把「向右」默认成东，先把口径问一次", () => {
    const parse = parseLocalAdjustment("这组向右移 2 米", { selectedCount: 2, view: "3d", screenBearingDeg: 0 });
    expect(parse.kind).toBe("clarify");
    if (parse.kind !== "clarify") return;
    expect(parse.reason).toBe("no-basis-bearing");
    expect(parse.question).toContain("3D");
  });

  it("3D 里记住了「按屏幕」也不拿 2D 转角硬算", () => {
    const parse = parseLocalAdjustment("这组向右移 2 米", {
      selectedCount: 2, view: "3d", rightBasis: "screen", screenBearingDeg: 30,
    });
    expect(parse).toMatchObject({ kind: "clarify", reason: "screen-basis-3d" });
  });

  it("3D 里记住按东侧就老老实实按 +x 走", () => {
    const parse = parseLocalAdjustment("这组向右移 2 米", {
      selectedCount: 2, view: "3d", rightBasis: "east", screenBearingDeg: 0,
    });
    expect(parse.kind).toBe("adjust");
    if (parse.kind !== "adjust") return;
    expect(parse.request.dx).toBe(2);
    expect(parse.request.dy).toBe(0);
  });

  it("2D 正北朝上仍直接按东算，不被 3D 规则带走", () => {
    const parse = parseLocalAdjustment("这组向右移 2 米", { selectedCount: 2, view: "2d", screenBearingDeg: 0 });
    expect(parse.kind).toBe("adjust");
  });
});

describe("局部调整的冲突计数（与问题清单同一套判据）", () => {
  it("压到相邻物料时如实计数，并说出影响的分区", () => {
    // 椅子允许叠到桌子上（K7 的 mayStack），所以要用两张桌子试真冲突。
    const base = plan();
    base.facilities.push({
      id: "t2", templateId: "oneplan:table", name: "宴席圆桌 2", zoneId: "z1",
      position: { x: 10, y: 10 }, rotationDeg: 0, size: { width: 1.8, depth: 1.8 }, notes: "",
    });
    const result = applyLocalAdjust(base, ["t1"], {
      kind: "move", dx: 6, dy: 6, distanceM: 8.49, basisLabel: "测试",
    });
    expect(result.movedIds).toEqual(["t1"]);
    expect(result.conflicts).toBeGreaterThan(0);
    expect(result.note).toContain("压到相邻物料");
    expect(result.affectedZones).toEqual(["宴席区"]);
  });

  it("只位移、不压到东西时报告影响范围，不报告冲突", () => {
    const result = applyLocalAdjust(plan(), ["t1"], {
      kind: "move", dx: 0, dy: 3, distanceM: 3, basisLabel: "测试",
    });
    expect(result.conflicts).toBe(0);
    expect(result.note).toContain("宴席区");
  });
});
