// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { strToU8, zipSync } from 'fflate';
import { agentDocumentContext, extractAgentDocument, parseDelimitedRows, readAgentDocuments, rememberAgentDocuments } from './agent-documents';

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
});
afterEach(() => { mem?.clear(); vi.unstubAllGlobals(); });

const file = (name: string, bytes: Uint8Array): File => ({ name, size: bytes.byteLength,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) as File;

describe('聊天资料读取和来源', () => {
  it('保留带逗号、换行和双引号的 CSV 单元格', () => {
    expect(parseDelimitedRows('姓名,关系\r\n"张,三","三舅\n同行"\r\n"李""四",朋友'))
      .toEqual([['姓名', '关系'], ['张,三', '三舅\n同行'], ['李"四', '朋友']]);
  });
  it('真实解压 DOCX 段落，并可在后续对话检索来源', async () => {
    const bytes = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>仪式区靠湖，保留人行路</w:t></w:r></w:p><w:p><w:r><w:t>三舅一家三人同桌</w:t></w:r></w:p></w:body></w:document>') });
    const doc = await extractAgentDocument(file('需求.docx', bytes));
    expect(doc.sections).toEqual([{ location: '第 1 段', text: '仪式区靠湖，保留人行路' }, { location: '第 2 段', text: '三舅一家三人同桌' }]);
    rememberAgentDocuments('project-a:chat-a', [doc]);
    expect(readAgentDocuments('project-a:chat-b')).toEqual([]);
    expect(JSON.stringify(agentDocumentContext(readAgentDocuments('project-a:chat-a'), '三舅怎么安排'))).toContain('三舅一家三人同桌');
  });
  it('读取具名 XLSX 工作表和单元格，不丢空列位置', async () => {
    const bytes = zipSync({
      'xl/workbook.xml': strToU8('<workbook xmlns:r="urn:relationships"><sheets><sheet name="宾客" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>男方三舅</t></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2" t="inlineStr"><is><t>一家三人</t></is></c></row></sheetData></worksheet>'),
    });
    const doc = await extractAgentDocument(file('名单.xlsx', bytes));
    expect(doc.sections).toEqual([{ location: '宾客 · 第 2 行', text: 'A2=男方三舅 | C2=一家三人' }]);
  });
  it('凭据和链接不进入模型摘录，资料原文仍然保留', () => {
    const doc = { id: 'doc', name: '资料.txt', format: 'txt', extractedAt: 'today', warnings: [], sections: [{ location: '第 1 行', text: '参考 https://example.com 私有密钥：abc123' }] };
    const context = JSON.stringify(agentDocumentContext([doc], '参考'));
    expect(context).not.toContain('https://');
    expect(context).not.toContain('abc123');
    expect(doc.sections[0].text).toContain('abc123');
  });
  it('坏格式明确失败，不导入伪造的空资料', async () => {
    await expect(extractAgentDocument(file('名单.xlsx', strToU8('not a zip')))).rejects.toThrow();
    expect(() => parseDelimitedRows('"未闭合')).toThrow('引号未闭合');
  });
});
