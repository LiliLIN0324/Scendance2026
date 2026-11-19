import { describe, expect, it } from "vitest";
import { headcountOnlyAdjustment, isHeadcountOnlyMessage } from "./outdoor-headcount-adjustment";
import type { OutdoorTurn } from "./outdoor-agent-contract";

const base = {
  action: "adjust",
  reply: "",
  references: [],
  facts: {
    guests: { value: 150, evidence: "人数改为 150 人" },
  },
} as unknown as OutdoorTurn;

describe("headcountOnlyAdjustment", () => {
  it("人数变更被判成 adjust 且没有空间操作时，按简报人数处理", () => {
    expect(headcountOnlyAdjustment(base, "人数改为 150 人，保持现有分区。")).toBe(150);
  });

  it("真正带 operation 的空间调整不吞掉", () => {
    const withOperation = {
      ...base,
      operation: { targetId: "stage", referenceId: "entrance", relation: "near", evidence: "把舞台移到入口旁" },
    } as OutdoorTurn;
    expect(headcountOnlyAdjustment(withOperation, "把舞台移到入口旁，人数改为 150 人")).toBeNull();
  });

  it("事实原话不在本句时不采用", () => {
    expect(headcountOnlyAdjustment(base, "保持现有分区。")).toBeNull();
  });

  it("非 adjust/connect 动作不在这里处理", () => {
    expect(headcountOnlyAdjustment({ ...base, action: "objects" } as OutdoorTurn, "人数改为 150 人")).toBeNull();
  });
});

describe("isHeadcountOnlyMessage", () => {
  it("只改人数，尾句只是保持现有分区", () => {
    expect(isHeadcountOnlyMessage("人数改为 150 人，保持现有分区。")).toBe(true);
    expect(isHeadcountOnlyMessage("改成 150 人")).toBe(true);
    expect(isHeadcountOnlyMessage("活动人数调整到 80 人")).toBe(true);
  });

  it("带空间或物料动作时不走这条路径", () => {
    expect(isHeadcountOnlyMessage("舞台加 150 人")).toBe(false);
    expect(isHeadcountOnlyMessage("人数改为 150 人，并把舞台挪到东侧")).toBe(false);
    expect(isHeadcountOnlyMessage("人数改为 150 人，增加 10 张桌子")).toBe(false);
    expect(isHeadcountOnlyMessage("分区 150 人")).toBe(false);
  });

  it("没有人数变更时不误判", () => {
    expect(isHeadcountOnlyMessage("预算改成 20 万")).toBe(false);
    expect(isHeadcountOnlyMessage("150 人")).toBe(false);
  });
});