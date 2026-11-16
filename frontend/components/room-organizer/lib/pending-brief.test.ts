// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingBrief,
  normalizeBriefText,
  readPendingBrief,
  shouldResumeBrief,
  writePendingBrief,
} from "./pending-brief";

const SCOPE = "activity:probe-a";
const OTHER = "activity:probe-b";
const TEXT = "在杭州植物园玉泉鱼跃周边做两日市集，六个摊位，签到集章放进摊区，园路留 4 米贯通。";

describe("无地点设计句的待恢复槽", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("原话按活动写进去，读回来一字不改", () => {
    const written = writePendingBrief(SCOPE, TEXT, "place", 1_000);
    expect(written?.text).toBe(TEXT);
    expect(readPendingBrief(SCOPE, 2_000)?.text).toBe(TEXT);
  });

  it("换活动读不到别人的句子", () => {
    writePendingBrief(SCOPE, TEXT, "place", 1_000);
    expect(readPendingBrief(OTHER, 2_000)).toBeNull();
  });

  it("超期不复用，避免隔天接回一句早就不作数的需求", () => {
    writePendingBrief(SCOPE, TEXT, "place", 1_000);
    expect(readPendingBrief(SCOPE, 1_000 + 24 * 60 * 60 * 1000 + 1)).toBeNull();
  });

  it("空白句不占槽", () => {
    expect(writePendingBrief(SCOPE, "   ", "place", 1_000)).toBeNull();
    expect(readPendingBrief(SCOPE, 1_500)).toBeNull();
  });

  it("清掉之后读不到，可以反复写", () => {
    writePendingBrief(SCOPE, TEXT, "place", 1_000);
    clearPendingBrief(SCOPE);
    expect(readPendingBrief(SCOPE, 1_500)).toBeNull();
    writePendingBrief(SCOPE, "换个说法：签到放摊区西侧。", "place", 3_000);
    expect(readPendingBrief(SCOPE, 3_500)?.text).toBe("换个说法：签到放摊区西侧。");
  });

  it("坏数据不抛错，当作没有", () => {
    localStorage.setItem(`scendance:outdoor-pending-brief:${SCOPE}`, "{not json");
    expect(readPendingBrief(SCOPE, 1_000)).toBeNull();
    localStorage.setItem(
      `scendance:outdoor-pending-brief:${SCOPE}`,
      JSON.stringify({ text: "", at: 1, stage: "place" }),
    );
    expect(readPendingBrief(SCOPE, 1_000)).toBeNull();
  });

  it("折叠空白但不改字面", () => {
    expect(normalizeBriefText("  排入口\n和后勤动线  ")).toBe("排入口 和后勤动线");
  });

  it("范围刚确认时接回，同一边界不重复接", () => {
    writePendingBrief(SCOPE, TEXT, "place", 1_000);
    const pending = readPendingBrief(SCOPE, 2_000);
    expect(shouldResumeBrief({ pending, boundary: "b1", lastBoundary: null })).toBe(true);
    expect(shouldResumeBrief({ pending, boundary: "b1", lastBoundary: "b1" })).toBe(false);
    expect(shouldResumeBrief({ pending, boundary: "b2", lastBoundary: "b1" })).toBe(true);
  });

  it("没槽或没边界都不接，避免开局自动跑一句", () => {
    expect(shouldResumeBrief({ pending: null, boundary: "b1", lastBoundary: null })).toBe(false);
    writePendingBrief(SCOPE, TEXT, "place", 1_000);
    const pending = readPendingBrief(SCOPE, 2_000);
    expect(shouldResumeBrief({ pending, boundary: null, lastBoundary: null })).toBe(false);
    expect(shouldResumeBrief({ pending, boundary: undefined, lastBoundary: null })).toBe(false);
  });
});
