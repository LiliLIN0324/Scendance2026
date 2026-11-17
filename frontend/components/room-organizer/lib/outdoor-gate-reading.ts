/**
 * 门禁读数（轮次 54）。
 *
 * 每轮收工都要把「类型 / 用例 / 构建」三项数字抄进进度文件，靠手抄迟早抄错，
 * 而且抄错不会有人发现。这里把三项的原始输出收进来，只做一件事：
 * 判定每项是通过、失败还是没跑，并压成一行可贴的结论。
 *
 * 硬规矩：三项全绿也只说「门禁绿」，**不等于可发布**——发布还要真实浏览器与真实云端。
 */

export type GateState = "pass" | "fail" | "unverified";

export interface GateEntry {
  state: GateState;
  /** 人话原因，例如「0 个类型错误」「2 个用例失败」「没跑」。 */
  detail: string;
}

export interface GateReading {
  types: GateEntry;
  tests: GateEntry;
  build: GateEntry;
  /** green 仅指三项门禁都过；red 指至少一项失败；其余 unverified。 */
  verdict: "green" | "red" | "unverified";
  /** 一行结论，可直接贴进进度文件。 */
  line: string;
}

export interface GateInput {
  /**
   * `tsc --noEmit` 的原始输出。`undefined` = 没跑；`""` = 跑过且一行报错都没有。
   * 这两者绝不能混为一谈。
   */
  types?: string;
  /** `vitest` 的汇总行所在的原始输出。 */
  tests?: string;
  /** 构建的原始输出与退出码（退出码 null = 没跑）。 */
  build?: { output?: string; exitCode?: number | null };
}

const TS_ERROR = /\berror TS\d+/g;
/** vitest 默认带色：0x1B[...m 夹在 `Tests` 与数字之间，不先剥掉就永远读不到汇总行。 */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

function countMatches(text: string, re: RegExp): number {
  const found = text.match(re);
  return found ? found.length : 0;
}

function readTypes(raw: string | undefined): GateEntry {
  if (raw === undefined) return { state: "unverified", detail: "没跑" };
  const errors = countMatches(raw, TS_ERROR);
  if (errors === 0) return { state: "pass", detail: "0 个类型错误" };
  return { state: "fail", detail: `${errors} 个类型错误` };
}

function readTests(raw: string | undefined): GateEntry {
  if (raw === undefined) return { state: "unverified", detail: "没跑" };
  const text = stripAnsi(raw);
  const failed = /Tests\s+(\d+) failed/.exec(text);
  const passed = /Tests\s+(?:\d+ failed \| )?(\d+) passed/.exec(text);
  const files = /Test Files\s+(?:(\d+) failed[^|]*\| )?(\d+) passed/.exec(text);
  if (!passed) return { state: "unverified", detail: "没读到用例汇总行" };
  const failedCount = failed ? Number(failed[1]) : 0;
  const passedCount = Number(passed[1]);
  const fileText = files ? ` / ${files[2]} 文件` : "";
  if (failedCount > 0) {
    return {
      state: "fail",
      detail: `${failedCount} 个用例失败（通过 ${passedCount}${fileText}）`,
    };
  }
  return { state: "pass", detail: `${passedCount} 条全过${fileText}` };
}

function readBuild(raw: GateInput["build"]): GateEntry {
  if (!raw || raw.exitCode === undefined || raw.exitCode === null) {
    return { state: "unverified", detail: "没跑" };
  }
  if (raw.exitCode === 0) return { state: "pass", detail: "exit 0" };
  return { state: "fail", detail: `exit ${raw.exitCode}` };
}

/**
 * 直接给发布前状态卡用的事实：卡里的字段叫 `typecheck`（不是 `types`），
 * 这里做一次改名，免得每个调用方各写一遍映射。同样：没跑的项不出现在对象里。
 */
export function gateFactsForCard(reading: GateReading): {
  typecheck?: boolean;
  tests?: boolean;
  build?: boolean;
} {
  const facts = gateFactsFrom(reading);
  const card: { typecheck?: boolean; tests?: boolean; build?: boolean } = {};
  if (facts.types !== undefined) card.typecheck = facts.types;
  if (facts.tests !== undefined) card.tests = facts.tests;
  if (facts.build !== undefined) card.build = facts.build;
  return card;
}

function cell(entry: GateEntry): string {
  if (entry.state === "pass") return "过";
  if (entry.state === "fail") return "红";
  return "未验";
}

export function readGates(input: GateInput = {}): GateReading {
  const types = readTypes(input.types);
  const tests = readTests(input.tests);
  const build = readBuild(input.build);
  const entries = [types, tests, build];
  const failed = entries.filter((e) => e.state === "fail").length;
  const unverified = entries.filter((e) => e.state === "unverified").length;
  const verdict: GateReading["verdict"] =
    failed > 0 ? "red" : unverified > 0 ? "unverified" : "green";
  const head = `门禁：类型 ${cell(types)} / 用例 ${cell(tests)} / 构建 ${cell(build)}`;
  const tail =
    verdict === "green"
      ? "（三项门禁都绿，不等于可发布）"
      : verdict === "red"
        ? `（${failed} 项失败）`
        : `（${unverified} 项未跑）`;
  return { types, tests, build, verdict, line: head + tail };
}

/**
 * 把读数转成状态卡能吃的布尔事实：过 → true，红 → false，没跑 → 这个键干脆不出现在对象里
 * （`exactOptionalPropertyTypes` 下写 `{ types: undefined }` 与不写不是一回事）。
 */
export function gateFactsFrom(reading: GateReading): {
  types?: boolean;
  tests?: boolean;
  build?: boolean;
} {
  const facts: { types?: boolean; tests?: boolean; build?: boolean } = {};
  for (const key of ["types", "tests", "build"] as const) {
    const state = reading[key].state;
    if (state === "pass") facts[key] = true;
    else if (state === "fail") facts[key] = false;
  }
  return facts;
}
