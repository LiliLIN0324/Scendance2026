import { describe, expect, it } from "vitest";
import { emptyOutdoorFlow, mergeOutdoorFacts, type OutdoorTurn } from "./outdoor-agent-contract";

const turnOf = (items: NonNullable<OutdoorTurn["facts"]["items"]>): OutdoorTurn => ({
  action: "objects",
  reply: "",
  references: [],
  facts: { items },
});

const guestsTurn = (value: number, evidence: string): OutdoorTurn => ({
  action: "ask",
  reply: "",
  references: [],
  facts: { guests: { value, evidence } },
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

  // 2026-11-17 断点修复：增量改口（「再加3个」）按已确认数量折算，模型把增量当总量回也不会清场。
  it("「再加3个」按增量折算：20→23，不是把 20 抹成 3", () => {
    const state = emptyOutdoorFlow("d1");
    const confirmed = {
      ...state,
      brief: {
        ...state.brief,
        items: [{ zone: "摆摊区", query: "市集摊位", count: 20, evidence: "20个摊位" }],
      },
    };
    const next = mergeOutdoorFacts(
      confirmed,
      turnOf([{ zone: "摆摊区", query: "市集摊位", count: 3, evidence: "加3个" }]),
      "再加3个",
    );
    expect(next.brief.items[0]).toMatchObject({ query: "市集摊位", count: 23 });
  });

  it("「减5个」按增量折算：20→15", () => {
    const state = emptyOutdoorFlow("d2");
    const confirmed = {
      ...state,
      brief: {
        ...state.brief,
        items: [{ zone: "摆摊区", query: "市集摊位", count: 20, evidence: "20个摊位" }],
      },
    };
    const next = mergeOutdoorFacts(
      confirmed,
      turnOf([{ zone: "摆摊区", query: "市集摊位", count: 5, evidence: "减5个" }]),
      "减5个",
    );
    expect(next.brief.items[0]).toMatchObject({ query: "市集摊位", count: 15 });
  });

  it("「改成2个」仍是绝对数：20→2，不折算", () => {
    const state = emptyOutdoorFlow("d3");
    const confirmed = {
      ...state,
      brief: {
        ...state.brief,
        items: [{ zone: "摆摊区", query: "市集摊位", count: 20, evidence: "20个摊位" }],
      },
    };
    const next = mergeOutdoorFacts(
      confirmed,
      turnOf([{ zone: "摆摊区", query: "市集摊位", count: 2, evidence: "改成2个" }]),
      "改成2个",
    );
    expect(next.brief.items[0]).toMatchObject({ query: "市集摊位", count: 2 });
  });

  it("「摊位都撤了」：count=0 凭本句原话放行，清空该区需求", () => {
    const state = emptyOutdoorFlow("d4");
    const confirmed = {
      ...state,
      brief: {
        ...state.brief,
        items: [{ zone: "摆摊区", query: "市集摊位", count: 20, evidence: "20个摊位" }],
      },
    };
    const next = mergeOutdoorFacts(
      confirmed,
      turnOf([{ zone: "摆摊区", query: "市集摊位", count: 0, evidence: "都撤了" }]),
      "摊位都撤了",
    );
    expect(next.brief.items[0]).toMatchObject({ query: "市集摊位", count: 0 });
  });

  it("人数：本句原话带数字且一致，落 brief.guests", () => {
    const state = emptyOutdoorFlow("g1");
    const next = mergeOutdoorFacts(state, guestsTurn(30, "30人"), "现场来30人");
    expect(next.brief.guests).toBe(30);
  });

  it("人数：两句话里都没有该数字，拒编依据", () => {
    const state = emptyOutdoorFlow("g2");
    expect(() =>
      mergeOutdoorFacts(state, guestsTurn(500, "500人"), "安排休息区", "先圈范围"),
    ).toThrow("模型提取缺少本句原文依据");
  });

  it("人数：证据数字与模型取值不一致，拒绝猜测值", () => {
    const state = emptyOutdoorFlow("g3");
    expect(() =>
      mergeOutdoorFacts(state, guestsTurn(500, "30人"), "现场来30人"),
    ).toThrow("人数与本句原文数量不一致");
  });

  it("人数：沿用已确认人数（carried）时不要求本句再带数字", () => {
    const state = {
      ...emptyOutdoorFlow("g4"),
      brief: { ...emptyOutdoorFlow("g4").brief, guests: 30 },
    };
    const next = mergeOutdoorFacts(state, guestsTurn(30, "30人"), "把休息区再调大些");
    expect(next.brief.guests).toBe(30);
  });
});
