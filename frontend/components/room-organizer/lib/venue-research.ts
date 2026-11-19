import { searchPlaces, type PlaceSearchOptions, type PlaceSuggestion } from "./place-search";

/** 摘自用户本地调研 CSV 的具名场地笔记；标题是线索，不是营业/承租核验。 */
const weddingNotes = [
  { id: "R16", name: "西子宾馆", title: "一分钟了解一家婚宴酒店 | 西子宾馆", author: "杭州婚博会", area: "杭州|西湖景区", noteId: "6939444d000000001e00745c" },
  { id: "R24", name: "华北饭店", title: "能看到西湖的户外婚礼｜华北饭店", author: "杭州户外婚礼场地", area: "杭州|西湖景区", noteId: "6766ec9a0000000013009c59" },
  { id: "R27", name: "金溪山庄", title: "杭州备婚 |🔥杭州金溪山庄婚礼场地分享", author: "婚礼闺蜜（酒店版）", area: "杭州|西湖景区", noteId: "685b99a60000000017036a45" },
] as const;

export function isVenueResearchRequest(message: string): boolean {
  return /搜|找|推荐|建议|调研|比较|选址|了解/u.test(message)
    && (/场地|地点|酒店|宾馆|饭店/u.test(message)
      || (/婚礼|婚宴/u.test(message) && /杭州|西湖|附近|周边|哪里|哪儿|选址/u.test(message)))
    && !/拱门|桌椅|花艺|物料|婚礼布置/u.test(message)
    && !/不用真实|不要真实|虚拟场地|不联网/u.test(message);
}

/** 只压缩本功能生成的已知公开引用；未知 URL/凭据仍交给原来的请求闸门。 */
export function compactResearchCitations(text: string): string {
  return weddingNotes.reduce((result, note) => result.replaceAll(
    `https://www.xiaohongshu.com/explore/${note.noteId}`, `[本地来源 ${note.id}]`,
  ), text);
}

export interface VenueResearch {
  collectedAt: string;
  localNotes: Array<{ id: string; name: string; title: string; author: string; area: string }>;
  searches: Array<{ query: string; status: "results" | "no-evidence"; places: PlaceSuggestion[] }>;
}

/** 只在明确杭州/西湖婚礼需求下用这批本地资料，不能拿西湖调研推荐上海场地。 */
export function localWeddingNotes(message: string): VenueResearch["localNotes"] {
  if (!/婚礼|婚宴/u.test(message) || !/杭州|西湖/u.test(message)) return [];
  if (/(?:上海|北京|广州|深圳|青岛|济南|丽水)/u.test(message)) return [];
  return weddingNotes.map(({ noteId: _noteId, ...note }) => note);
}

export async function researchVenues(
  message: string,
  options: PlaceSearchOptions,
): Promise<VenueResearch> {
  const localNotes = localWeddingNotes(message);
  // 有具名调研时逐个核对地点，避免把「西湖附近办婚礼」整句扔给地理编码器。
  const queries = localNotes.length
    ? localNotes.map(note => `杭州 ${note.name}`)
    : [message.trim().slice(0, 80)];
  const searches = await Promise.all(queries.map(async query => {
    const places = await searchPlaces(query, { ...options, limit: 3 });
    return { query, status: places.length ? "results" as const : "no-evidence" as const, places };
  }));
  options.signal?.throwIfAborted();
  return { collectedAt: new Date().toISOString(), localNotes, searches };
}

/** URL 保留在可点验的回复中，不塞进禁止链接的聊天请求历史。 */
export function venueResearchSources(research: VenueResearch): string {
  const sources = research.localNotes.map(note => {
    const source = weddingNotes.find(item => item.id === note.id);
    return source ? `[${note.id}] ${source.title} · ${source.author}\nhttps://www.xiaohongshu.com/explore/${source.noteId}` : "";
  }).filter(Boolean);
  const hits = research.searches.reduce((sum, search) => sum + search.places.length, 0);
  return [
    `本次地图地点检索：${hits ? `取得 ${hits} 条地点记录` : "未取得可核对的地点结果"}；未检索网页正文。`,
    ...(sources.length ? ["本地调研来源（2026-11-19 收录，笔记标题线索）：", ...sources] : []),
  ].join("\n");
}
