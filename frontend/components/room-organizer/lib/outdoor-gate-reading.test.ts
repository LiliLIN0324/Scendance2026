import { describe, expect, it } from "vitest";
import { gateFactsForCard, gateFactsFrom, readGates } from "./outdoor-gate-reading";

/** 轮次 53 在提交树 3e376b41 上的真实输出（原文摘录，用作固定数据）。 */
const REAL_TSC = "";
const REAL_TESTS = `
 Test Files  52 passed (52)
      Tests  608 passed (608)
   Duration  9.64s (transform 20.37s, setup 6.24s, import 42.78s, tests 11.39s, environment 15.92s)
`;

describe("readGates · 三项门禁读数", () => {
  it("轮次 53 的真实输出读成一行：三项都过，但仍写明不等于可发布", () => {
    const gate = readGates({
      types: REAL_TSC,
      tests: REAL_TESTS,
      build: { exitCode: 0 },
    });
    expect(gate.verdict).toBe("green");
    expect(gate.tests.detail).toContain("608 条全过");
    expect(gate.tests.detail).toContain("52 文件");
    expect(gate.line).toBe(
      "门禁：类型 过 / 用例 过 / 构建 过（三项门禁都绿，不等于可发布）",
    );
  });

  it("类型没跑（undefined）与跑过干净（空串）是两件事", () => {
    const notRun = readGates({ tests: REAL_TESTS, build: { exitCode: 0 } });
    expect(notRun.types.state).toBe("unverified");
    expect(notRun.line).toContain("类型 未验");
    expect(notRun.verdict).toBe("unverified");

    const clean = readGates({ types: "", tests: REAL_TESTS, build: { exitCode: 0 } });
    expect(clean.types.state).toBe("pass");
    expect(clean.verdict).toBe("green");
  });

  it("类型报错就变红，并数清几条", () => {
    const gate = readGates({
      types: [
        "components/a.ts(1,1): error TS2322: 类型不匹配",
        "components/b.ts(2,3): error TS7006: 隐式 any",
      ].join("\n"),
      tests: REAL_TESTS,
      build: { exitCode: 0 },
    });
    expect(gate.types).toEqual({ state: "fail", detail: "2 个类型错误" });
    expect(gate.verdict).toBe("red");
    expect(gate.line).toContain("（1 项失败）");
  });

  it("用例有失败就变红，并同时报通过数", () => {
    const gate = readGates({
      types: "",
      tests: `
 Test Files  1 failed | 51 passed (52)
      Tests  2 failed | 606 passed (608)
`,
      build: { exitCode: 0 },
    });
    expect(gate.tests.state).toBe("fail");
    expect(gate.tests.detail).toContain("2 个用例失败");
    expect(gate.tests.detail).toContain("606");
    expect(gate.verdict).toBe("red");
  });

  it("构建非零退出即红", () => {
    const gate = readGates({ types: "", tests: REAL_TESTS, build: { exitCode: 1 } });
    expect(gate.build).toEqual({ state: "fail", detail: "exit 1" });
    expect(gate.line).toContain("构建 红");
  });

  it("什么都没跑：三项都写未验，不说通过", () => {
    const gate = readGates();
    expect(gate.verdict).toBe("unverified");
    expect(gate.line).toBe(
      "门禁：类型 未验 / 用例 未验 / 构建 未验（3 项未跑）",
    );
  });

  it("用例输出里没有汇总行时，不猜通过", () => {
    const gate = readGates({ types: "", tests: "some noise", build: { exitCode: 0 } });
    expect(gate.tests.state).toBe("unverified");
    expect(gate.tests.detail).toContain("没读到用例汇总行");
    expect(gate.verdict).toBe("unverified");
  });

  it("转给状态卡时，没跑的项不出现在对象里（不是 false）", () => {
    const facts = gateFactsFrom(readGates({ types: "", build: { exitCode: 0 } }));
    expect(facts).toEqual({ types: true, build: true });
    expect("tests" in facts).toBe(false);
  });

  it("转给状态卡时，红的项明确是 false", () => {
    const facts = gateFactsFrom(
      readGates({ types: "a.ts(1,1): error TS1: x", tests: REAL_TESTS, build: { exitCode: 0 } }),
    );
    expect(facts).toEqual({ types: false, tests: true, build: true });
  });

  it("给状态卡时字段改成 typecheck，且没跑的项不出现", () => {
    const facts = gateFactsForCard(readGates({ types: "", tests: REAL_TESTS }));
    expect(facts).toEqual({ typecheck: true, tests: true });
    expect("build" in facts).toBe(false);
  });
});
