import { strFromU8, unzipSync } from 'fflate';

export interface AgentDocumentSection { location: string; text: string }
export interface AgentDocument {
  id: string; name: string; format: string; extractedAt: string;
  sections: AgentDocumentSection[]; warnings: string[];
}
export const AGENT_DOCUMENT_ACCEPT = '.pdf,.docx,.xlsx,.csv,.txt';
export const isAgentDocument = (file: Pick<File, 'name'>): boolean => /\.(?:pdf|docx|xlsx|csv|txt)$/i.test(file.name);
const MAX_TEXT = 180000;
const xml = (text: string): Document => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('文档结构损坏，无法读取。');
  return doc;
};
const nodes = (node: Document | Element, local: string): Element[] => Array.from(node.getElementsByTagNameNS('*', local));
const textOf = (node: Element, local: string): string => nodes(node, local).map(item => item.textContent ?? '').join('');

export function parseDelimitedRows(text: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let cell = '', quoted = false;
  const delimiter = text.slice(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n')).includes('\t') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (char === delimiter || char === '\n' || char === '\r')) {
      row.push(cell); cell = '';
      if (char !== delimiter) { rows.push(row.splice(0)); if (char === '\r' && text[i + 1] === '\n') i++; }
    } else cell += char;
  }
  if (quoted) throw new Error('CSV 中的引号未闭合，请修正文件后重传。');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export async function extractAgentDocument(file: File): Promise<AgentDocument> {
  if (!isAgentDocument(file)) throw new Error('支持 PDF、Word DOCX、Excel XLSX、CSV 和 TXT。');
  if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请拆分后上传。');
  const format = file.name.split('.').pop()!.toLowerCase();
  const result: AgentDocument = { id: crypto.randomUUID(), name: file.name, format,
    extractedAt: new Date().toISOString(), sections: [], warnings: [] };
  let length = 0;
  const add = (location: string, text: string) => {
    const value = text.trim(); if (!value) return;
    length += value.length;
    if (length > MAX_TEXT) throw new Error('文档内容超过单份处理上限，请按章节或名单分组拆分，未截断导入。');
    result.sections.push({ location, text: value });
  };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (format === 'txt' || format === 'csv') {
    let content = new TextDecoder('utf-8', { fatal: true });
    let text: string;
    try { text = content.decode(bytes); } catch { content = new TextDecoder('gb18030'); text = content.decode(bytes); }
    const rows = format === 'csv' ? parseDelimitedRows(text.replace(/^\uFEFF/, '')) : text.split(/\r?\n/).map(line => [line]);
    rows.forEach((row, i) => add(`第 ${i + 1} 行`, row.join(' | ')));
  } else if (format === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 80) throw new Error('PDF 超过 80 页，请按章节拆分后上传。');
      for (let page = 1; page <= pdf.numPages; page++) {
        const item = await pdf.getPage(page);
        const content = await item.getTextContent();
        add(`第 ${page} 页`, content.items.map(part => 'str' in part ? part.str + (part.hasEOL ? '\n' : ' ') : '').join(''));
        item.cleanup();
      }
    } finally { await task.destroy(); }
    if (!result.sections.length) throw new Error('这份 PDF 没有可提取文字，可能是扫描件。请将相关页转成截图上传，我会按图片读取。');
  } else {
    let total = 0, entries = 0;
    const archive = unzipSync(bytes, { filter: entry => {
      if (++entries > 3000 || (total += entry.originalSize) > 30 * 1024 * 1024) throw new Error('文档解压内容过大，请拆分后上传。');
      return /^(?:word\/document\.xml|xl\/(?:sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml))$/.test(entry.name);
    } });
    const read = (name: string) => { if (!archive[name]) throw new Error('文档内部文件缺失，请重新另存为标准 DOCX/XLSX。'); return xml(strFromU8(archive[name])); };
    if (format === 'docx') {
      const doc = read('word/document.xml');
      nodes(doc, 'p').forEach((paragraph, i) => add(`第 ${i + 1} 段`, textOf(paragraph, 't')));
      result.warnings.push('段落编号来自文档结构；Word 分页未作推断。');
    } else {
      const shared = archive['xl/sharedStrings.xml'] ? nodes(read('xl/sharedStrings.xml'), 'si').map(item => textOf(item, 't')) : [];
      const relations = read('xl/_rels/workbook.xml.rels');
      for (const sheet of nodes(read('xl/workbook.xml'), 'sheet')) {
        const relation = nodes(relations, 'Relationship').find(item => item.getAttribute('Id') === sheet.getAttribute('r:id'));
        const target = relation?.getAttribute('Target') ?? '';
        const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
        if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) throw new Error('表格工作表引用无法读取。');
        for (const row of nodes(read(path), 'row')) {
          const cells = nodes(row, 'c').map(cell => {
            const value = textOf(cell, 'v'), type = cell.getAttribute('t');
            const text = type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr' ? textOf(cell, 't') : value;
            return `${cell.getAttribute('r') ?? '?'}=${text}${nodes(cell, 'f').length ? '（公式缓存值，未重新计算）' : ''}`;
          });
          add(`${sheet.getAttribute('name') ?? '工作表'} · 第 ${row.getAttribute('r') ?? '?'} 行`, cells.join(' | '));
        }
      }
    }
  }
  if (!result.sections.length) throw new Error('文件中没有读取到文字或表格内容。');
  return result;
}

const key = (scope: string) => `scendance:agent-documents:${scope}`;
export function readAgentDocuments(scope: string): AgentDocument[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(scope)) ?? '[]');
    return Array.isArray(value) ? value.filter((doc): doc is AgentDocument => doc && typeof doc.id === 'string'
      && typeof doc.name === 'string' && Array.isArray(doc.sections) && doc.sections.every((s: AgentDocumentSection) => typeof s.location === 'string' && typeof s.text === 'string')) : [];
  } catch { return []; }
}
export function rememberAgentDocuments(scope: string, additions: AgentDocument[]): AgentDocument[] {
  const docs = [...readAgentDocuments(scope), ...additions];
  if (docs.length > 12 || JSON.stringify(docs).length > 900000) throw new Error('本次对话资料较多，请另开对话或拆分资料；原资料保留。');
  localStorage.setItem(key(scope), JSON.stringify(docs));
  return docs;
}

/** Retrieve bounded, attributed sections. The complete documents remain in project/session storage. */
export function agentDocumentContext(docs: AgentDocument[], query: string, maxChars = 2000): unknown {
  if (!docs.length) return undefined;
  const terms = Array.from(new Set(query.match(/[\p{Script=Han}]{2,4}|[A-Za-z0-9]{2,}/gu) ?? []));
  const ranked = docs.flatMap(doc => doc.sections.map((section, index) => ({ doc, section, index,
    score: terms.filter(term => section.text.includes(term)).length + (index === 0 ? 0.5 : 0) })))
    .sort((a, b) => b.score - a.score);
  const selected: Array<{ sourceId: string; file: string; location: string; text: string }> = [];
  for (const { doc, section, index } of ranked) {
    const text = section.text.replace(/(?:https?:\/\/|www\.)\S+/gi, '[链接已省略]')
      .replace(/(?:api[_ -]?key|access[_ -]?token|secret|password|密码|密钥)\s*[:=：]\s*\S+|\bbearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}/gi, '[凭据已隐藏]');
    const item = { sourceId: `${doc.id}:${index}`, file: doc.name, location: section.location, text: text.slice(0, 800) };
    if (JSON.stringify([...selected, item]).length <= maxChars) selected.push(item);
  }
  return { documents: docs.map(doc => ({ id: doc.id, file: doc.name, sections: doc.sections.length })), sections: selected,
    coverage: '仅本轮相关摘录，完整资料仍保存在当前活动对话中；未选段落不等于不存在。链接与凭据不送入理解模型。' };
}
