import { describe, expect, it } from "vitest";
import {
  MAP_EVIDENCE_MISSING_NOTE,
  proposalMapWarnings,
} from "./outdoor-agent-contract";

/**
 * 2026-11-16：确认卡只留能指导动作的信息。
 * 「地图证据没取到」在 scope 阶段边界还没定、必然对不上，摆上去是噪声；
 * 排设施（zones）之后才是"要不要据此放东西"的依据，必须保留。
 */
describe("地图证据缺口提示的展示时机", () => {
  it("范围卡（scope）不展示", () => {
    expect(
      proposalMapWarnings("scope", [MAP_EVIDENCE_MISSING_NOTE, "换场地已清空旧内容"]),
    ).toEqual(["换场地已清空旧内容"]);
  });

  it.each(["zones", "main-routes", "objects", "sub-routes", "people"])(
    "%s 阶段保留",
    (kind) => {
      expect(proposalMapWarnings(kind, [MAP_EVIDENCE_MISSING_NOTE])).toEqual([
        MAP_EVIDENCE_MISSING_NOTE,
      ]);
    },
  );

  it("不修改传入数组", () => {
    const input = [MAP_EVIDENCE_MISSING_NOTE];
    proposalMapWarnings("scope", input);
    expect(input).toHaveLength(1);
  });
});
