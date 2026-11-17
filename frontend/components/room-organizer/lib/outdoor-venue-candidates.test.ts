import { describe, expect, it } from "vitest";
import { pickVenueCandidate, type VenueCandidate } from "./outdoor-venue-candidates";

/** 两个真的同名：杭州有两家「湖滨银泰 in77」分在 A/B 区，相差约 150 米。 */
const SAME_NAME: VenueCandidate[] = [
  { id: "v-a", name: "湖滨银泰 in77", position: { x: 0, y: 0 } },
  { id: "v-b", name: "湖滨银泰  IN77", position: { x: 150, y: 0 } },
];

describe("pickVenueCandidate · 用例 #2 同名地点", () => {
  it("只有一个同名地点时直接就是它", () => {
    const pick = pickVenueCandidate(
      [{ id: "v-1", name: "西湖文化广场", position: { x: 3, y: 4 } }],
      { name: "西湖文化广场" },
    );
    expect(pick.kind).toBe("single");
    if (pick.kind === "single") expect(pick.candidate.id).toBe("v-1");
  });

  it("两个同名时不猜，把两个都摆出来问一句", () => {
    const pick = pickVenueCandidate(SAME_NAME, { name: "湖滨银泰 in77" });
    expect(pick.kind).toBe("ambiguous");
    if (pick.kind === "ambiguous") {
      expect(pick.candidates.map((c) => c.id)).toEqual(["v-a", "v-b"]);
      expect(pick.question).toContain("2 个都叫");
      expect(pick.question).toContain("(150, 0)");
    }
  });

  it("给了点击位置就取最近的那个", () => {
    const pick = pickVenueCandidate(SAME_NAME, {
      name: "湖滨银泰 in77",
      near: { x: 140, y: 6 },
    });
    expect(pick.kind).toBe("single");
    if (pick.kind === "single") expect(pick.candidate.id).toBe("v-b");
  });

  it("点击位置离同名地点都太远，仍然要问，不退回第一个", () => {
    const pick = pickVenueCandidate(SAME_NAME, {
      name: "湖滨银泰 in77",
      near: { x: 900, y: 900 },
    });
    expect(pick.kind).toBe("ambiguous");
    if (pick.kind === "ambiguous") expect(pick.question).toContain("超过 30 米");
  });

  it("两个同名地点几乎重合时也算说不清", () => {
    const pick = pickVenueCandidate(
      [
        { id: "x1", name: "同名点", position: { x: 10, y: 10 } },
        { id: "x2", name: "同名点", position: { x: 10.2, y: 10 } },
      ],
      { name: "同名点", near: { x: 10, y: 10 } },
    );
    expect(pick.kind).toBe("ambiguous");
    if (pick.kind === "ambiguous") expect(pick.question).toContain("几乎重合");
  });

  it("名字大小写、空格不同也算同名（不因排版差异错过）", () => {
    const pick = pickVenueCandidate(SAME_NAME, { name: " 湖滨银泰IN77 " });
    expect(pick.kind).toBe("ambiguous");
  });

  it("一个都没有就明说没有，不拿别的顶替", () => {
    const pick = pickVenueCandidate(SAME_NAME, { name: "杭州大剧院" });
    expect(pick.kind).toBe("none");
    if (pick.kind === "none") expect(pick.reason).toContain("没有叫");
  });

  it("没给名字时先要名字", () => {
    const pick = pickVenueCandidate(SAME_NAME, { name: "   " });
    expect(pick.kind).toBe("none");
    if (pick.kind === "none") expect(pick.reason).toContain("先说");
  });
});
