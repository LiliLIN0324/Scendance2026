/** Product-side public web research. No model-generated search results. */
export interface VenueWebSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  excerpt: string;
  contentStatus: 'read' | 'snippet-only';
}
export interface VenueWebResearch {
  status: 'ok' | 'empty' | 'unavailable' | 'not-configured';
  query: string;
  searchedAt: string;
  sources: VenueWebSource[];
}

export function publicResearchUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')
      || /(?:^|\.)(?:localhost|local|internal|test|example|invalid)$/.test(host)
      || /(?:token|secret|password|signature|api[_-]?key)/i.test(url.search)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.ok || !response.body) throw new Error('upstream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('too-large');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export interface VenueResearchEnv { TAVILY_API_KEY?: string | undefined }
export async function handleVenueResearch(request: Request, env: VenueResearchEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (query.length < 2 || query.length > 160 || /https?:|[\u0000-\u001f]/i.test(query))
    return Response.json({ error: 'invalid_query' }, { status: 400 });
  const result: VenueWebResearch = { status: 'unavailable', query, searchedAt: new Date().toISOString(), sources: [] };
  const apiKey = env.TAVILY_API_KEY?.trim();
  if (!apiKey) return Response.json({ ...result, status: 'not-configured' }, { headers: { 'Cache-Control': 'no-store' } });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(22000)]);
  try {
    const response = await fetcher('https://api.tavily.com/search', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_raw_content: 'text', include_answer: false }) });
    const body: unknown = JSON.parse(await boundedText(response, 500000));
    if (!body || typeof body !== 'object' || !('results' in body) || !Array.isArray(body.results)) throw new Error('invalid_results');
    const seen = new Set<string>();
    for (const item of body.results.slice(0, 10)) {
      if (!item || typeof item !== 'object' || typeof item.url !== 'string' || typeof item.title !== 'string') continue;
      const url = publicResearchUrl(item.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const raw = typeof item.raw_content === 'string' ? item.raw_content.trim() : '';
      const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
      const lines = raw.split(/\n+/).filter((line: string) => /草坪|婚礼|婚宴|户外|场地|面积|容纳|仪式|宴会/.test(line));
      result.sources.push({ id: `W${result.sources.length + 1}`, title: clean(item.title).slice(0, 140), url,
        snippet: typeof item.content === 'string' ? clean(item.content).slice(0, 700) : '',
        excerpt: clean(lines.length ? lines.slice(0, 10).join('\n') : raw).slice(0, 1400),
        contentStatus: raw.length > 30 ? 'read' : 'snippet-only' });
      if (result.sources.length === 5) break;
    }
    result.status = result.sources.length ? 'ok' : 'empty';
  } catch { result.status = 'unavailable'; }
  return Response.json(result, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export const onRequestGet = ({ request, env }: { request: Request; env: VenueResearchEnv }): Promise<Response> => handleVenueResearch(request, env);
