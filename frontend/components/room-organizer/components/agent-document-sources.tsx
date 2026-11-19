import type { AgentDocument } from '../lib/agent-documents';

export function AgentDocumentSources({ documents }: { documents: AgentDocument[] }): JSX.Element | null {
  if (!documents.length) return null;
  return <details className="ap-document-sources" aria-label="本次对话资料">
    <summary>已读资料 · {documents.length} 份</summary>
    {documents.map(doc => <details key={doc.id} className="ap-document-source">
      <summary>{doc.name} · {doc.sections.length} 段</summary>
      <p>文字已提取，完整内容保留在当前活动对话；每轮只引用相关段落。</p>
      {doc.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <div style={{ maxHeight: 200, overflow: 'auto' }}>{doc.sections.map((section, i) =>
        <p key={i}><strong>{section.location}</strong><br/>{section.text}</p>)}</div>
    </details>)}
  </details>;
}
