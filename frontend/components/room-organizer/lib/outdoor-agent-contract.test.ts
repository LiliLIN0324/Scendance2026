import { describe, expect, it } from "vitest";
import { emptyOutdoorFlow, mergeOutdoorFacts, type OutdoorTurn } from "./outdoor-agent-contract";

const turnOf = (items: NonNullable<OutdoorTurn["facts"]["items"]>): OutdoorTurn => ({
  action: "objects",
  reply: "",
  references: [],
  facts: { items },
});

describe("mergeOutdoorFacts —— 数量依据只看「用户到底说没说」", () => {
  it("补答上一问（「放在摆摊区」）不把上一句的 1000 张抹掉：上一轮原话仍算依据", () => {
    const state = emptyOutdoorFlow("s1");
    const next = mergeOutdoorFacts(
      state,
      turnOf([{ zone: "摆摊区", query: "市集摊位", count: 1000, evidence: "1000张摊位" }]),
      "放在摆摊区",
      "那你搞1000张摊位",
    );
    expect(next.brief.items).toHaveLength(1);
    expect(next.brief.items[0]).toMatchObject({ zone: "摆摊区", count: 1000 });
  });

  it("编出来的数字照样拒：两句话里都没有 500 张", () => {
    const state = emptyOutdoorFlow("s2");
    expect(() =>
      mergeOutdoorFacts(
        state,
        turnOf([{ zone: "摆摊区", query: "市集摊位", count: 500, evidence: "500张摊位" }]),
        "放在摆摊区",
        "那你搞1000张摊位",
      ),
    ).toThrow("模型提取缺少本句原文依据");
  });

  it("数量与已确认的完全一致时，补分区不重罚本句数字依据", () => {
    const state = emptyOutdoorFlow("s3");
    const confirmed = {
      ...state,
      brief: {
        ...state.brief,
        items: [{ zone: "", query: "市集摊位", count: 1000, evidence: "1000张摊位" }],
      },
    };
    const next = mergeOutdoorFacts(
      confirmed,
      turnOf([{ zone: "摆摊区", query: "市集摊位", count: 1000, evidence: "放在摆摊区" }]),
      "放在摆摊区",
    );
    expect(next.brief.items).toHaveLength(1);
    expect(next.brief.items[0]).toMatchObject({ zone: "摆摊区", query: "市集摊位", count: 1000 });
  });

  it("数量变了就要本句数字依据：1000 改 500 但本句没说数字，仍然拒", () => {
    const state = emptyOutdoorFlow("s4");
    const confirmed = {
      ...state,
      brief: {
        ...state.brief,
        items: [{ zone: "摆摊区", query: "市集摊位", count: 1000, evidence: "1000张摊位" }],
      },
    };
    expect(() =>
      mergeOutdoorFacts(
        confirmed,
        turnOf([{ zone: "摆摊区", query: "市集摊位", count: 500, evidence: "放在摆摊区" }]),
        "放在摆摊区",
      ),
    ).toThrow("物件/岗位数量缺少本句数字依据");
  });
});
