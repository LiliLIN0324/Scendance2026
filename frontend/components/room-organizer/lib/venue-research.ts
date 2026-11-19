import { searchPlaces, type PlaceSearchOptions, type PlaceSuggestion } from "./place-search";
import type { VenueWebResearch } from "../../../../functions/api/venue-research";

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
  web?: VenueWebResearch;
}

const researchKey = (scope: string) => `scendance:venue-research:${scope}`;
export function readVenueResearch(scope: string): VenueResearch | null {
  try {
    const value = JSON.parse(localStorage.getItem(researchKey(scope)) ?? 'null') as VenueResearch | null;
    return value && Array.isArray(value.localNotes) && Array.isArray(value.searches) && typeof value.collectedAt === 'string' ? value : null;
  } catch { return null; }
}
export function rememberVenueResearch(scope: string, research: VenueResearch): void {
  try { localStorage.setItem(researchKey(scope), JSON.stringify(research)); } catch { /* Current reply remains usable without persistence. */ }
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
  const webPromise = (async (): Promise<VenueWebResearch> => {
    try {
      const fetcher = options.fetchImpl ?? fetch;
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000);
      const response = await fetcher(`/api/venue-research?q=${encodeURIComponent(message.slice(0, 160))}`, { signal });
      const data: unknown = await response.json();
      if (!response.ok || !data || typeof data !== 'object' || !('sources' in data) || !Array.isArray(data.sources)) throw new Error('unavailable');
      return data as VenueWebResearch;
    } catch { return { status: 'unavailable', query: message, searchedAt: new Date().toISOString(), sources: [] }; }
  })();
  const searches = await Promise.all(queries.map(async query => {
    const places = await searchPlaces(query, { ...options, limit: 3 });
    return { query, status: places.length ? "results" as const : "no-evidence" as const, places };
  }));
  const web = await webPromise;
  options.signal?.throwIfAborted();
  return { collectedAt: new Date().toISOString(), localNotes, searches, web };
}

/** URLs stay in the attributed UI, not the text-only model channel's link guard. */
export function venueResearchContext(research: VenueResearch): unknown {
  const omitLinks = (text: string) => text.replace(/(?:https?:\/\/|www\.)\S+/gi, '[来源链接见资料卡]');
  return { ...research, web: research.web ? { status: research.web.status, searchedAt: research.web.searchedAt,
    sources: research.web.sources.slice(0, 4).map(source => ({ id: source.id, title: omitLinks(source.title).slice(0, 80),
      contentStatus: source.contentStatus, excerpt: omitLinks(source.excerpt || source.snippet).slice(0, 420) })) } : undefined };
}

/** URL 保留在可点验的回复中，不塞进禁止链接的聊天请求历史。 */
export function venueResearchSources(research: VenueResearch): string {
  const sources = research.localNotes.map(note => {
    const source = weddingNotes.find(item => item.id === note.id);
    return source ? `[${note.id}] ${source.title} · ${source.author}\nhttps://www.xiaohongshu.com/explore/${source.noteId}` : "";
  }).filter(Boolean);
  const hits = research.searches.reduce((sum, search) => sum + search.places.length, 0);
  return [
    `本次地图地点检索：${hits ? `取得 ${hits} 条地点记录` : "未取得可核对的地点结果"}。`,
    research.web?.status === 'ok' ? `网页检索：${research.web.sources.length} 条来源，其中 ${research.web.sources.filter(source => source.contentStatus === 'read').length} 条已读取正文。`
      : research.web?.status === 'not-configured' ? '网页搜索服务尚未配置，本次只使用已有本地调研与地图地点结果。'
      : research.web?.status === 'empty' ? '本次网页搜索没有返回可用来源。' : '本次网页检索暂不可用；以下本地资料不代表已联网核实。',
    ...(research.web?.sources.map(source => `[${source.id}] ${source.title}（${source.contentStatus === 'read' ? '正文摘录' : '仅搜索摘要'}）\n${source.url}`) ?? []),
    ...(sources.length ? ["本地调研来源（2026-11-19 收录，笔记标题线索）：", ...sources] : []),
  ].join("\n");
}
