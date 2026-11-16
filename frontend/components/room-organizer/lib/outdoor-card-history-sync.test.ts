import { describe, expect, it, vi } from "vitest";
import {
  CARD_HISTORY_SERVER_LIMIT,
  loadRemoteCardHistory,
  mergeCardHistory,
  pushRemoteCardHistory,
  sanitizeCardHistory,
  type CardHistoryEntry,
} from "./outdoor-card-history-sync";

const entry = (at: number, title = "确认活动范围"): CardHistoryEntry => ({
  at,
  stage: "scope",
  kind: "scope",
  title,
  decision: "confirmed",
  notes: ["说明"],
  actions: ["确认并应用这一版"],
});

describe("引导卡历史的后端同步", () => {
  it("收掉脏数据，不因一条坏记录整份作废", () => {
    const raw = [
      entry(1),
      { at: "x", title: "坏时间" },
      { at: 2 },
      null,
      "junk",
      { at: 3, title: "缺字段", decision: "whatever", notes: "不是数组" },
    ];
    const clean = sanitizeCardHistory(raw);
    expect(clean.map((item) => item.at)).toEqual([1, 3]);
    expect(clean[1]).toMatchObject({
      decision: "confirmed",
      notes: [],
      actions: [],
      stage: "place",
    });
    expect(sanitizeCardHistory({ notAnArray: true })).toEqual([]);
  });

  it("合并取并集、按时间升序、同一时刻同一决策只留一条", () => {
    const merged = mergeCardHistory(
      [entry(3), entry(1)],
      [entry(2), entry(3), entry(1, "另一张卡")],
    );
    expect(merged.map((item) => item.at)).toEqual([1, 1, 2, 3]);
    expect(merged.filter((item) => item.at === 3)).toHaveLength(1);
  });

  it("超过本机上限只留最近的", () => {
    const local = Array.from({ length: 40 }, (_, index) => entry(index));
    const merged = mergeCardHistory(local, []);
    expect(merged).toHaveLength(30);
    expect(merged[0].at).toBe(10);
  });

  it("读回失败、未登录、没有方法都安静退回空数组", async () => {
    expect(await loadRemoteCardHistory(null, "p1")).toEqual([]);
    expect(await loadRemoteCardHistory({}, "p1")).toEqual([]);
    expect(await loadRemoteCardHistory({ getOutdoorCardHistory: vi.fn().mockRejectedValue(new Error("offline")) }, "p1")).toEqual([]);
    expect(await loadRemoteCardHistory({ getOutdoorCardHistory: vi.fn().mockResolvedValue([entry(5)]) }, "p1")).toEqual([
      entry(5),
    ]);
  });

  it("推送失败只返回 false，不抛错；服务端上限前截断", async () => {
    const save = vi.fn().mockResolvedValue([]);
    expect(await pushRemoteCardHistory({ saveOutdoorCardHistory: save }, "p1", [entry(1)])).toBe(true);
    expect(save).toHaveBeenCalledWith("p1", [entry(1)]);

    const many = Array.from({ length: CARD_HISTORY_SERVER_LIMIT + 20 }, (_, index) => entry(index));
    await pushRemoteCardHistory({ saveOutdoorCardHistory: save }, "p1", many);
    expect((save.mock.calls.at(-1)?.[1] as unknown[]).length).toBe(CARD_HISTORY_SERVER_LIMIT);

    expect(
      await pushRemoteCardHistory(
        { saveOutdoorCardHistory: vi.fn().mockRejectedValue(new Error("offline")) },
        "p1",
        [entry(1)],
      ),
    ).toBe(false);
    expect(await pushRemoteCardHistory(null, "p1", [entry(1)])).toBe(false);
  });
});
