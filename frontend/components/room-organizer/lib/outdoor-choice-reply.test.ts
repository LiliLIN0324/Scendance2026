import { describe, expect, it } from "vitest";
import { parseChoiceOptions, resolveChoiceReply, resumeActionForRequest } from "./outdoor-choice-reply";

// 2026-11-17 正式站原句（截图里的那条追问）：用户答「第一个方案」后，
// 模型把这一轮判成 objects，任务卡变成「按用途复用我的物料」并卡在人数红卡上。
const SCREENSHOT_QUESTION =
  "重新分区会覆盖现有 8 个户外分区，想先和你确认一下：你是想（1）保留全部功能但压缩成 3-4 个复合区，还是（2）完全按一套新分区清单来重排？如果是新清单，请把分区名、用途和环境（室内/室外）逐条列出；现有分区我会原样保留直到你确认。";

describe("parseChoiceOptions —— 从追问里认出被列举的选项", () => {
  it("认出正式站那条（1）/（2）追问，且不把后面的补充说明算成选项", () => {
    expect(parseChoiceOptions(SCREENSHOT_QUESTION)).toEqual([
      "保留全部功能但压缩成 3-4 个复合区",
      "完全按一套新分区清单来重排",
    ]);
  });

  it("支持 1. / 1、 / ① 三种列举法", () => {
    expect(parseChoiceOptions("两种做法：1. 先排分区 2. 先排物料")).toEqual(["先排分区", "先排物料"]);
    expect(parseChoiceOptions("你选：①压缩成复合区 ②按新清单重排")).toEqual(["压缩成复合区", "按新清单重排"]);
    expect(parseChoiceOptions("1、保留原样 2、重做")).toEqual(["保留原样", "重做"]);
  });

  it("只有一项列举不当成二选一（交回模型）", () => {
    expect(parseChoiceOptions("只有一条路：（1）先确认场地范围。")).toEqual([]);
    expect(parseChoiceOptions("你想怎么改？")).toEqual([]);
    expect(parseChoiceOptions("")).toEqual([]);
  });

  it("选项过长（把整段说明当选项）时宁可认不出，也不硬切", () => {
    const long = `（1）${"很长的说明".repeat(12)}还是（2）另一条`;
    expect(parseChoiceOptions(long)).toEqual([]);
  });
});

describe("resolveChoiceReply —— 认出用户在选第几个", () => {
  it("「第一个方案」落到第一项（就是截图里那句回答）", () => {
    const reply = resolveChoiceReply("第一个方案", SCREENSHOT_QUESTION);
    expect(reply?.chosen).toEqual({ index: 0, text: "保留全部功能但压缩成 3-4 个复合区" });
    expect(reply?.options).toHaveLength(2);
  });

  it("「第2个」「选二个」「方案二」「2」都认", () => {
    for (const text of ["第2个", "选二个", "方案二", "2", "就第二个吧"]) {
      expect(resolveChoiceReply(text, SCREENSHOT_QUESTION)?.chosen.index, text).toBe(1);
    }
  });

  it("夹带了别的要求就不是纯选项回答，交回模型", () => {
    expect(resolveChoiceReply("第一个方案，但保留舞台区", SCREENSHOT_QUESTION)).toBeNull();
    expect(resolveChoiceReply("第二个分区往东挪两米", SCREENSHOT_QUESTION)).toBeNull();
    expect(resolveChoiceReply("两个都要", SCREENSHOT_QUESTION)).toBeNull();
  });

  it("上一轮没列举选项 / 没有上一轮时一律不认", () => {
    expect(resolveChoiceReply("第一个方案", undefined)).toBeNull();
    expect(resolveChoiceReply("第一个方案", "你想怎么改？")).toBeNull();
    // 越界序号不猜
    expect(resolveChoiceReply("第五个", SCREENSHOT_QUESTION)).toBeNull();
  });
});

describe("resumeActionForRequest —— 原请求本身要哪一步", () => {
  it("明确的重做/调整分区落到 zones（截图里被误判成 objects 的那句）", () => {
    expect(resumeActionForRequest("我希望你把我的分区重新做一遍")).toBe("zones");
    expect(resumeActionForRequest("重新分区")).toBe("zones");
    expect(resumeActionForRequest("把分区压缩成三四个复合区")).toBe("zones");
    expect(resumeActionForRequest("分区重新划分一下")).toBe("zones");
  });

  it("明确的重做物料落到 objects", () => {
    expect(resumeActionForRequest("物料重新排一下")).toBe("objects");
    expect(resumeActionForRequest("重新做物料")).toBe("objects");
  });

  it("通道/人物这类不自动发起（要拉真实路网和岗位依据），认不出就 null", () => {
    expect(resumeActionForRequest("重新排一下主要通道")).toBeNull();
    expect(resumeActionForRequest("安排两个保安")).toBeNull();
    expect(resumeActionForRequest("你好")).toBeNull();
    expect(resumeActionForRequest("")).toBeNull();
  });
});
