import { z } from 'zod';
import { MAX_PROJECT_REVIEW_IMAGE_BYTES } from './project-review';
import { readSourceRecord, updateSourceForm } from './source-storage';

export const MAX_PROJECT_REVIEW_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_PROJECT_REVIEW_LIBRARY_BYTES = 96 * 1024 * 1024;
export const MAX_PROJECT_REVIEW_FILES = 20;
const text = z.string().min(1).max(4000).refine(value => value.trim().length > 0);
const timestamp = z.iso.datetime({ offset: true }).max(32);
const draftInputSchema = z.strictObject({ summary: z.string().max(1000), pending: z.string().max(1000) });
const draftSchema = draftInputSchema.extend({ revision: text, savedAt: timestamp });
const fileInputSchema = z.strictObject({ id: text, title: z.string().min(1).max(1000), generatedAt: timestamp,
  source: z.strictObject({ scope: text, revision: text }), html: z.string().min(1).max(MAX_PROJECT_REVIEW_FILE_BYTES) });
const fileSchema = fileInputSchema.extend({ savedAt: timestamp });
const librarySchema = z.strictObject({ version: z.literal(1), draft: draftSchema.nullable(), files: z.array(fileSchema) });
export type ProjectReviewDraft = z.infer<typeof draftSchema>;
export type SavedReviewFile = z.infer<typeof fileSchema>;
export type ProjectReviewLibrary = z.infer<typeof librarySchema>;

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const key = (identityKey: string): [string, string] => ['project-review-library', text.parse(identityKey)];
const htmlTags = new Set('html head body meta title style main header footer section article h1 h2 h3 h4 p span div dl dt dd table thead tbody tr th td figure figcaption details summary img br strong em'.split(' '));
const svgTags = new Set('svg title g rect path line polygon polyline circle ellipse text tspan'.split(' '));
const htmlAttributes = new Set('lang charset name content http-equiv class id open alt width height colspan rowspan role aria-label'.split(' '));
const svgAttributes = new Set('xmlns viewbox width height class id x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray font-family font-size font-weight text-anchor dy dx opacity role aria-label'.split(' '));
const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";

function assertData(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 64) throw new Error('本机评审资料嵌套过深。');
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value || ancestors.has(value) || Object.getOwnPropertySymbols(value).length) throw new Error('本机评审资料包含非普通数据。');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('本机评审资料包含非普通对象。');
  if (array && (Object.keys(value).length !== value.length || Object.keys(value).some((name, index) => name !== String(index)))) throw new Error('本机评审资料包含非普通数组字段。');
  ancestors.add(value);
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (array && name === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('本机评审资料不能包含取值器或隐藏字段。');
    assertData(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function checkCss(css: string): void {
  // The app emits simple static CSS. Reject escapes/comments as well as every resource-loading syntax.
  if (/\\|\/\*|\*\/|\burl\b|image(?:-set)?\s*\(|expression\s*\(|behavior\s*:|-moz-binding|@(?!(?:media|page)\b)|https?:|\/\//i.test(css)) {
    throw new Error('评审文件包含外部资源或活动样式，未保存或打开。');
  }
}

function checkImage(url: string): void {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match || match[2].length % 4 || match[2].length > Math.ceil(MAX_PROJECT_REVIEW_IMAGE_BYTES / 3) * 4) throw new Error('评审图片须为 4 MiB 以内的内嵌 PNG、JPEG 或 WebP。');
  let bytes: string;
  try { bytes = atob(match[2]); } catch { throw new Error('评审图片编码无效。'); }
  if (bytes.length > MAX_PROJECT_REVIEW_IMAGE_BYTES || btoa(bytes) !== match[2]) throw new Error('评审图片编码或大小无效。');
  const valid = match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
    : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9')
      : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!valid) throw new Error('评审图片格式与实际字节不一致。');
}

/** Validate an inert template, never a live document that could request external image resources. */
export function validateProjectReviewFileHtml(html: string, expected?: Pick<SavedReviewFile, 'id' | 'title' | 'generatedAt'>): void {
  if (typeof html !== 'string' || byteLength(html) > MAX_PROJECT_REVIEW_FILE_BYTES) throw new Error('每份评审文件最多 40 MiB，请减少画面后重新生成。');
  if (!/^\s*<!doctype html>/i.test(html) || !/<\/html>\s*$/i.test(html) || /<!--|<\?|<!\s*(?!doctype html>)/i.test(html)) throw new Error('仅可保存工作台生成的静态客户评审 HTML。');
  if (typeof DOMParser === 'undefined') throw new Error('当前环境无法核验评审 HTML，请在浏览器中重试。');
  const inert = new DOMParser().parseFromString('<!doctype html><html><body></body></html>', 'text/html');
  const template = inert.createElement('template');
  // Fragment parsing drops html/head/body attributes. Preserve them on inert containers so root handlers are checked too.
  template.innerHTML = html.replace(/<(\/?)(?:html|head|body)(?=[\s/>])/gi, '<$1div');
  const root = template.content;
  let imageCount = 0, imageBytes = 0;
  for (const element of root.querySelectorAll('*')) {
    const tag = element.localName.toLowerCase(), svg = element.namespaceURI === 'http://www.w3.org/2000/svg';
    if (!(svg ? svgTags : htmlTags).has(tag) || !svg && element.namespaceURI !== 'http://www.w3.org/1999/xhtml') throw new Error('评审文件包含不支持或可执行的内容，未保存或打开。');
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (tag === 'img' && name === 'src') {
        checkImage(attribute.value); imageCount++; imageBytes += attribute.value.length;
        if (imageCount > 6 || imageBytes > 12 * 1024 * 1024) throw new Error('评审画面最多 6 张，内嵌画面总量不能超过 12 MiB。');
        continue;
      }
      if (!(svg ? svgAttributes : htmlAttributes).has(name)) throw new Error('评审文件包含活动属性或外部资源，未保存或打开。');
      if (svg && ['fill', 'stroke', 'font-family'].includes(name)) checkCss(attribute.value);
    }
    if (tag === 'style') checkCss(element.textContent ?? '');
    if (tag === 'meta') {
      const directive = element.getAttribute('http-equiv');
      if (directive !== null && (directive.toLowerCase() !== 'content-security-policy' || element.getAttribute('content') !== policy)) throw new Error('评审文件包含无效安全策略或页面跳转，未保存或打开。');
      if (directive === null && !(element.getAttribute('charset')?.toLowerCase() === 'utf-8' || element.getAttribute('name') === 'viewport')) throw new Error('评审文件包含不支持的页面声明。');
    }
  }
  if (root.querySelector('header .eyebrow')?.textContent !== '幕景 · 客户方案评审文件' ||
      !root.querySelector('footer .review-id')?.textContent?.startsWith('评审编号：') ||
      root.querySelectorAll('meta[http-equiv]').length !== 1 || root.querySelector('meta[http-equiv]')?.getAttribute('content') !== policy) {
    throw new Error('仅可保存工作台生成的静态客户评审 HTML。');
  }
  if (expected) {
    const provenance = root.querySelector('details.appendix > p.text')?.textContent ?? '';
    const frozenAt = provenance.split('\n').find(line => line.startsWith('冻结时间：'));
    if (root.querySelector('footer .review-id')?.textContent !== `评审编号：${expected.id}` ||
        root.querySelector('header h1')?.textContent !== expected.title || frozenAt !== `冻结时间：${expected.generatedAt}`) {
      throw new Error('评审文件正文与记录的编号、标题或冻结时间不一致，未保存或打开。');
    }
  }
}

function checkedLibrary(value: unknown): ProjectReviewLibrary {
  if (value === undefined) return { version: 1, draft: null, files: [] };
  assertData(value);
  const parsed = librarySchema.safeParse(value);
  if (!parsed.success) throw new Error('本机评审库格式损坏，原记录未覆盖。');
  const library = parsed.data;
  if (library.files.length > MAX_PROJECT_REVIEW_FILES || byteLength(JSON.stringify(library)) > MAX_PROJECT_REVIEW_LIBRARY_BYTES) {
    throw new Error('本机评审库最多保存 20 份、合计 96 MiB；请删除不再需要的旧副本后重试。');
  }
  if (new Set(library.files.map(file => file.id)).size !== library.files.length) throw new Error('本机评审库存在重复文件编号，原记录未覆盖。');
  for (const file of library.files) validateProjectReviewFileHtml(file.html, file);
  return library;
}

export async function readProjectReviewLibrary(identityKey: string): Promise<ProjectReviewLibrary> {
  return checkedLibrary(await readSourceRecord(key(identityKey)));
}

export async function saveProjectReviewDraft(identityKey: string, input: { summary: string; pending: string }, expectedRevision: string | null): Promise<ProjectReviewDraft> {
  assertData(input);
  const content = draftInputSchema.safeParse(input);
  if (!content.success) throw new Error('评审草稿的方案说明与待确认项各最多 1000 字，不能保存其他开关。');
  if (expectedRevision !== null) text.parse(expectedRevision);
  const result = await updateSourceForm(key(identityKey), current => {
    const library = checkedLibrary(current);
    if ((library.draft?.revision ?? null) !== expectedRevision) throw new Error('另一页面已更新评审草稿，请重新读取后再保存；当前输入未覆盖。');
    return checkedLibrary({ ...library, draft: { ...content.data, revision: crypto.randomUUID(), savedAt: new Date().toISOString() } });
  });
  return result.draft!;
}

export async function saveProjectReviewFile(identityKey: string, input: Omit<SavedReviewFile, 'savedAt'>): Promise<SavedReviewFile> {
  assertData(input);
  const parsed = fileInputSchema.safeParse(input);
  if (!parsed.success) throw new Error('评审文件信息无效或文件超过 40 MiB，未保存。');
  validateProjectReviewFileHtml(parsed.data.html, parsed.data);
  const file = { ...parsed.data, savedAt: new Date().toISOString() };
  const result = await updateSourceForm(key(identityKey), current => {
    const library = checkedLibrary(current), previous = library.files.find(entry => entry.id === file.id);
    if (previous) {
      if (previous.title !== file.title || previous.generatedAt !== file.generatedAt || previous.source.scope !== file.source.scope ||
          previous.source.revision !== file.source.revision || previous.html !== file.html) throw new Error('相同评审编号已有不同内容，请重新生成新版本；旧副本未覆盖。');
      return library;
    }
    return checkedLibrary({ ...library, files: [...library.files, file] });
  });
  return result.files.find(entry => entry.id === file.id)!;
}

export async function removeProjectReviewFile(identityKey: string, id: string): Promise<ProjectReviewLibrary> {
  text.parse(id);
  return updateSourceForm(key(identityKey), current => {
    const library = checkedLibrary(current);
    return { ...library, files: library.files.filter(file => file.id !== id) };
  });
}
