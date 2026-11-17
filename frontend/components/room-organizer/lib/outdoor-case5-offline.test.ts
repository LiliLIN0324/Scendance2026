import { describe, expect, it } from "vitest";
import {
  createOutdoorMapContext,
  MAP_EVIDENCE_MISSING_NOTE,
} from "./outdoor-map-context";

/**
 * 验收用例 #5「地图部分、离线或无路网」的固定数据证据（轮次 51）。
 *
 * 这一条真实浏览器还没跑（9222 不通），但能先把「没有地图依据时到底怎么表现」
 * 定住：不编造路网、不静默放行，而是明确声明缺证据。这里只断言现状，不改行为。
 */
describe("用例 #5：离线 / 无路网 / 证据缺失", () => {
  it("没有地图快照时 roads() 返回空，不编造路网", () => {
    const adapter = createOutdoorMapContext();
    expect(adapter.roads()).toEqual({ roads: [] });
  });

  it("没有证据时 validate() 如实返回『地图证据没取到』，而不是静默放行", () => {
    const adapter = createOutdoorMapContext();
    const warnings = adapter.validate({} as never, {} as never);
    expect(warnings).toEqual([MAP_EVIDENCE_MISSING_NOTE]);
  });

  it("缺证据的提示说的是人话，不是错误码", () => {
    expect(MAP_EVIDENCE_MISSING_NOTE).toContain("地图证据没取到");
    expect(MAP_EVIDENCE_MISSING_NOTE).not.toMatch(/^[A-Z_]+$/);
  });

  it("连续问两次结论一致（不会先空后满，也不会把空结果当缓存证据）", () => {
    const adapter = createOutdoorMapContext();
    expect(adapter.roads()).toEqual({ roads: [] });
    expect(adapter.roads()).toEqual({ roads: [] });
    expect(adapter.validate({} as never, {} as never)).toEqual([
      MAP_EVIDENCE_MISSING_NOTE,
    ]);
  });
});
