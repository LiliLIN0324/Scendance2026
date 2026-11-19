import { afterEach, describe, expect, it, vi } from "vitest";
import { answerAssistantChat } from "../../../../supabase/functions/_shared/assistant-chat";
import { assistantChatRequestSchema } from "../../../../supabase/functions/_shared/assistant-chat-contract";
import { emptyOutdoorFlow } from "./outdoor-agent-contract";
import { createStarterOutdoorPlan } from "./outdoor-project-store";
import { understandOutdoorTurn } from "./outdoor-agent-understanding";
import { compactResearchCitations, isVenueResearchRequest, localWeddingNotes, researchVenues } from "./venue-research";

afterEach(() => vi.unstubAllGlobals());
const message = "我想在杭州办一个婚礼，在西湖附近，你能联网帮我搜搜吗";
const map = { version: "none", status: "unavailable" as const, text: "未提供地图几何", featureIds: [], unknowns: [] };
const settings: Record<string, string> = { AGENT_CHAT_BASE_URL: "https://model.example/v1", AGENT_CHAT_KEY: "fixture", AGENT_CHAT_MODEL: "fixture" };

describe("第一步场地调研", () => {
  it("原句得到本地来源和实际地图结果，并通过真实服务端输入校验", async () => {
    const placeFetch = vi.fn(async (url: string) => {
      const keywords = new URL(url, "https://workbench.example").searchParams.get("keywords")!;
      return Response.json({ places: [{ id: keywords, name: keywords.replace("杭州 ", ""), address: "杭州西湖景区", lng: 120.1, lat: 30.2 }] });
    });
    vi.stubGlobal("fetch", placeFetch);
    const reply = "建议先比较西子宾馆（本地来源 R16）与华北饭店（R24），前者有婚宴酒店线索，后者标题提到西湖景观；金溪山庄（R27）可作为第三处备选。你想先看哪一处？";
    const provider = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ action: "ask", reply, references: [], facts: {} }) } }] }));
    const assistantChat = vi.fn(async (text: string, history: Array<{ role: "user" | "assistant"; text: string }>) => {
      const request = { message: text, history, responseMode: "outdoor_v1" as const };
      expect(assistantChatRequestSchema.safeParse(request).success).toBe(true);
      const context = JSON.parse(history.map(item => item.text).join(""));
      expect(context.venueResearch.localNotes.map((note: { id: string }) => note.id)).toEqual(["R16", "R24", "R27"]);
      expect(context.venueResearch.searches.every((search: { status: string }) => search.status === "results")).toBe(true);
      expect(context.rebuiltScenes[0]).toMatchObject({ isDemo: true, placeConfirmed: false });
      return answerAssistantChat({ ...request, enabled: true, env: key => settings[key], fetcher: provider });
    });
    const turn = await understandOutdoorTurn({ message, state: emptyOutdoorFlow("research"), plan: createStarterOutdoorPlan(), selected: [], map, controller: { assistantChat }, signal: new AbortController().signal });
    expect(assistantChat).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledOnce();
    expect(placeFetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(turn).toMatchObject({ action: "ask", facts: {}, references: [] });
    expect(turn.reply).toContain(reply);
    expect(turn.reply).toContain("https://www.xiaohongshu.com/explore/6939444d000000001e00745c");
    expect(turn.reply).toContain("本地资料不代表已联网核实");
    const prompt = JSON.parse(String(provider.mock.calls[0]![1]?.body)).messages[0].content;
    expect(prompt).toContain("venueResearch.localNotes");
    expect(prompt).toContain("不要先要求圈范围");
  });

  it("联网无结果仍保留本地调研，但不声称验证了场地", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    const evidence = await researchVenues(message, { local: false, fetchImpl });
    expect(evidence.localNotes).toHaveLength(3);
    expect(evidence.searches.every(search => search.status === "no-evidence" && !search.places.length)).toBe(true);
  });

  it("取消后不返回迟到的调研结果", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(researchVenues(message, { local: false, signal: controller.signal, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ places: [] })) })).rejects.toThrow();
  });

  it("不会把物料建议或外地婚礼误路由到杭州场地清单", () => {
    expect(isVenueResearchRequest(message)).toBe(true);
    expect(isVenueResearchRequest("推荐一个婚礼拱门")).toBe(false);
    expect(isVenueResearchRequest("西湖附近婚礼布置有什么建议")).toBe(false);
    expect(isVenueResearchRequest("不用真实地点，设计一个虚拟场地")).toBe(false);
    expect(localWeddingNotes("帮我找上海的婚礼场地")).toEqual([]);
  });

  it("下一轮保留来源编号，不把自己生成的引用链接触发成 invalid", async () => {
    const citation = "https://www.xiaohongshu.com/explore/6939444d000000001e00745c";
    const assistantChat = vi.fn(async (_text: string, history: Array<{ text: string }>) => {
      const text = history.map(item => item.text).join("");
      expect(text).not.toContain(citation);
      expect(text).toContain("本地来源 R16");
      return { status: "ok" as const, answer: JSON.stringify({ action: "search", query: "杭州 西子宾馆", reply: "查找西子宾馆。", references: [], facts: {} }) };
    });
    await understandOutdoorTurn({ message: "先看西子宾馆", clarification: { request: message, question: `西子宾馆可作为候选，来源：${citation}` }, state: emptyOutdoorFlow("research"), plan: createStarterOutdoorPlan(), selected: [], map, controller: { assistantChat }, signal: new AbortController().signal });
    expect(assistantChat).toHaveBeenCalledOnce();
    expect(compactResearchCitations("https://unknown.example/private")).toBe("https://unknown.example/private");
  });
});
