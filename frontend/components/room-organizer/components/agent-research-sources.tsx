import type { VenueResearch } from '../lib/venue-research';

export function AgentResearchSources({ research }: { research: VenueResearch | null }): JSX.Element | null {
  if (!research) return null;
  const web = research.web;
  return <details className="ap-document-sources" aria-label="场地调研来源">
    <summary>场地调研来源 · {web?.sources.length ?? 0} 条网页</summary>
    <p>{web?.status === 'not-configured' ? '网页搜索尚未配置；当前依据为本地笔记和地图地点。'
      : web?.status === 'unavailable' ? '这次网页检索未完成；保留本地与地图依据。'
      : web?.status === 'empty' ? '本次网页搜索没有返回可用来源。' : '正文与搜索摘要分别标注，可打开原网页核对。'}</p>
    {web?.sources.map(source => <div key={source.id}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">[{source.id}] {source.title}</a>
      <p>{source.contentStatus === 'read' ? '已取得正文摘录' : '仅搜索摘要'} · {web.searchedAt.slice(0, 10)}</p>
      <p>{source.excerpt || source.snippet}</p>
    </div>)}
    {research.localNotes.map(note => <p key={note.id}>[{note.id}] 本地笔记：{note.title} · {note.author}</p>)}
  </details>;
}
