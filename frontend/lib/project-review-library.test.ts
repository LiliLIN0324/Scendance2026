// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { makeLayout, makeFloor, makeItem } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { createProjectReviewSnapshot, projectReviewHtml, attachProjectReviewImages } from './project-review';
import { MAX_PROJECT_REVIEW_FILE_BYTES, MAX_PROJECT_REVIEW_LIBRARY_BYTES, MAX_PROJECT_REVIEW_FILES,
  readProjectReviewLibrary, saveProjectReviewDraft, saveProjectReviewFile, removeProjectReviewFile,
  validateProjectReviewFileHtml, type SavedReviewFile } from './project-review-library';
import { readSourceRecord, updateSourceForm } from './source-storage';

vi.mock('./source-storage', () => ({ readSourceRecord: vi.fn(), updateSourceForm: vi.fn() }));
const identity = JSON.stringify(['https://api.example', 'user-a', 'project-a']);
const generatedAt = '2026-10-09T04:00:00.000Z';
const source = { scope: 'project-a', revision: 'revision-1' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ioAAAAASUVORK5CYII=';
function snapshot(id = 'review-a', title = '静态客户评审', frozenAt = generatedAt) {
  return createProjectReviewSnapshot({ layout: makeLayout({ id: source.scope, name: title, roof: { style: 'none' },
    floors: [makeFloor({ items: [makeItem()] })] }), briefSnapshot: { state: 'ready', scope: source.scope, brief: { status: 'absent' } },
    snapshot: { id, generatedAt: frozenAt }, source, dataState: 'saved', dataKind: 'rehearsal', disclosure: { brief: false, design: true } });
}
const file = (id = 'review-a'): Omit<SavedReviewFile, 'savedAt'> => ({ id, title: '静态客户评审', generatedAt, source: { ...source }, html: projectReviewHtml(snapshot(id)) });
let stored: Map<string, unknown>;
const address = (key = identity) => JSON.stringify(['project-review-library', key]);
beforeEach(() => {
  stored = new Map();
  vi.mocked(readSourceRecord).mockReset().mockImplementation(async key => structuredClone(stored.get(JSON.stringify(key))) as never);
  vi.mocked(updateSourceForm).mockReset().mockImplementation(async (key, update) => {
    const next = update(structuredClone(stored.get(JSON.stringify(key))));
    stored.set(JSON.stringify(key), structuredClone(next)); return structuredClone(next) as never;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('local customer review library', () => {
  it('starts empty only for an absent record and isolates account/API/project identities with compound keys', async () => {
    expect(await readProjectReviewLibrary(identity)).toEqual({ version: 1, draft: null, files: [] });
    expect(readSourceRecord).toHaveBeenCalledWith(['project-review-library', identity]);
    await saveProjectReviewDraft(identity, { summary: '原始方案说明', pending: '待确认入口' }, null);
    for (const other of [JSON.stringify(['https://api.example', 'user-b', 'project-a']), JSON.stringify(['https://other.example', 'user-a', 'project-a']), JSON.stringify(['https://api.example', 'user-a', 'project-b'])]) {
      expect((await readProjectReviewLibrary(other)).draft).toBeNull();
    }
  });

  it('uses transaction CAS for competing drafts without saving disclosure/image approvals', async () => {
    const first = await saveProjectReviewDraft(identity, { summary: '初稿', pending: '' }, null);
    const edits = await Promise.allSettled([
      saveProjectReviewDraft(identity, { summary: '另页新稿', pending: '新待确认' }, first.revision),
      saveProjectReviewDraft(identity, { summary: '迟到旧稿', pending: '' }, first.revision),
    ]);
    expect(edits.map(edit => edit.status)).toEqual(['fulfilled', 'rejected']);
    expect((await readProjectReviewLibrary(identity)).draft).toMatchObject({ summary: '另页新稿', pending: '新待确认' });
    await expect(saveProjectReviewDraft(identity, { summary: '误覆盖', pending: '' }, null)).rejects.toThrow('另一页面');
    await expect(saveProjectReviewDraft(identity, { summary: '', pending: '', disclosure: { brief: true } } as never, first.revision)).rejects.toThrow('不能保存其他开关');
    expect(stored.get(address())).not.toHaveProperty('disclosure');
  });

  it('preserves whitespace and exact 1000-character drafts while rejecting overflow', async () => {
    const draft = await saveProjectReviewDraft(identity, { summary: '字'.repeat(1000), pending: ' 原文\n ' }, null);
    expect(draft.pending).toBe(' 原文\n '); expect(draft.summary).toHaveLength(1000);
    await expect(saveProjectReviewDraft(identity, { summary: '字'.repeat(1001), pending: '' }, draft.revision)).rejects.toThrow('1000');
    expect((await readProjectReviewLibrary(identity)).draft).toEqual(draft);
  });

  it('keeps frozen files through draft edits and accepts identical retries without changing savedAt', async () => {
    const input = file(), first = await saveProjectReviewFile(identity, input);
    expect(await saveProjectReviewFile(identity, input)).toEqual(first);
    input.html = input.html.replace('静态客户评审', 'later draft edit');
    await expect(saveProjectReviewFile(identity, input)).rejects.toThrow('相同评审编号');
    await saveProjectReviewDraft(identity, { summary: '后改内容', pending: '后改待确认' }, null);
    const library = await readProjectReviewLibrary(identity);
    expect(library.files).toEqual([first]); expect(library.files[0]!.html).not.toContain('后改内容');
    library.files[0]!.title = '调用者改名';
    expect((await readProjectReviewLibrary(identity)).files[0]!.title).toBe(first.title);
  });

  it('preserves both concurrent file additions and removes only the explicitly selected file', async () => {
    await Promise.all([saveProjectReviewFile(identity, file('old')), saveProjectReviewFile(identity, file('new'))]);
    const draft = await saveProjectReviewDraft(identity, { summary: '保留草稿', pending: '' }, null);
    const result = await removeProjectReviewFile(identity, 'new');
    expect(result.files.map(entry => entry.id)).toEqual(['old']); expect(result.draft).toEqual(draft);
    expect(await removeProjectReviewFile(identity, 'not-found')).toEqual(result);
  });

  it.each(['title', 'generatedAt', 'source'] as const)('rejects conflicting %s metadata for an existing frozen id', async field => {
    const original = await saveProjectReviewFile(identity, file()), input = file();
    if (field === 'source') input.source.revision = 'later-revision';
    else input[field] = field === 'generatedAt' ? '2026-10-10T04:00:00.000Z' : '另一个标题';
    input.html = projectReviewHtml(snapshot(input.id, input.title, input.generatedAt));
    await expect(saveProjectReviewFile(identity, input)).rejects.toThrow('相同评审编号');
    expect((await readProjectReviewLibrary(identity)).files).toEqual([original]);
  });

  it.each([null, {}, { version: 2, draft: null, files: [] }, { version: 1, draft: null, files: [], accessToken: 'secret' }])('rejects malformed persisted libraries without replacing them: %j', value => {
    stored.set(address(), value);
    return Promise.all([
      expect(readProjectReviewLibrary(identity)).rejects.toThrow('格式损坏'),
      expect(saveProjectReviewDraft(identity, { summary: '', pending: '' }, null)).rejects.toThrow('格式损坏'),
    ]).then(() => { expect(stored.get(address())).toEqual(value); });
  });

  it('propagates read/write failures and never substitutes an empty successful library', async () => {
    const original = await saveProjectReviewFile(identity, file());
    vi.mocked(readSourceRecord).mockRejectedValueOnce(new Error('读取拒绝'));
    await expect(readProjectReviewLibrary(identity)).rejects.toThrow('读取拒绝');
    vi.mocked(updateSourceForm).mockRejectedValueOnce(new Error('写入拒绝'));
    await expect(saveProjectReviewFile(identity, file('next'))).rejects.toThrow('写入拒绝');
    expect((await readProjectReviewLibrary(identity)).files).toEqual([original]);
  });

  it('retains 20 older files and refuses automatic eviction when a new file exceeds the count limit', async () => {
    const old = Array.from({ length: MAX_PROJECT_REVIEW_FILES }, (_, index) => ({ ...file(String(index)), savedAt: generatedAt }));
    stored.set(address(), { version: 1, draft: null, files: old });
    expect(await saveProjectReviewFile(identity, file('0'))).toEqual(old[0]);
    await expect(saveProjectReviewFile(identity, file('overflow'))).rejects.toThrow('20 份');
    expect((await readProjectReviewLibrary(identity)).files).toEqual(old);
    await removeProjectReviewFile(identity, '0'); await saveProjectReviewFile(identity, file('overflow'));
    expect((await readProjectReviewLibrary(identity)).files.map(entry => entry.id)).toEqual([...old.slice(1).map(entry => entry.id), 'overflow']);
  });

  it('enforces UTF-8 file size and aggregate library size without deleting old records', async () => {
    await expect(saveProjectReviewFile(identity, { ...file(), html: '字'.repeat(Math.floor(MAX_PROJECT_REVIEW_FILE_BYTES / 3) + 1) })).rejects.toThrow('40 MiB');
    expect(stored.size).toBe(0);
    const oversized = { version: 1, draft: null, files: [0, 1, 2].map(index => ({ ...file(String(index)), savedAt: generatedAt,
      html: ' '.repeat(MAX_PROJECT_REVIEW_LIBRARY_BYTES / 3) })) };
    stored.set(address(), oversized);
    await expect(readProjectReviewLibrary(identity)).rejects.toThrow('96 MiB');
    await expect(saveProjectReviewDraft(identity, { summary: '', pending: '' }, null)).rejects.toThrow('96 MiB');
    expect(stored.get(address())).toBe(oversized);
  });
});

describe('persisted customer HTML validation', () => {
  it.each(['id', 'title', 'generatedAt'] as const)('rejects a new %s paired with old frozen HTML on save and read', async field => {
    const input = file();
    input[field] = field === 'generatedAt' ? '2026-10-10T04:00:00.000Z' : '新版本记录';
    await expect(saveProjectReviewFile(identity, input)).rejects.toThrow('正文与记录');
    expect(stored.size).toBe(0);
    const original = { version: 1, draft: null, files: [{ ...input, savedAt: generatedAt }] };
    stored.set(address(), original);
    await expect(readProjectReviewLibrary(identity)).rejects.toThrow('正文与记录');
    expect(stored.get(address())).toBe(original);
  });

  it('requires the explicit appendix freeze timestamp rather than matching a timestamp elsewhere in the file', async () => {
    const input = file(); input.html = input.html.replace(`冻结时间：${generatedAt}`, '冻结时间：未记录');
    await expect(saveProjectReviewFile(identity, input)).rejects.toThrow('正文与记录');
  });

  it('accepts the existing generator including SVG plans and approved raster data images without requests', async () => {
    const original = snapshot(), enriched = attachProjectReviewImages(original, [{ snapshotId: original.snapshot.id, source,
      capturedAt: generatedAt, kind: 'provided-review-image', sourceLabel: '用户许可图片', caption: '现场参考',
      dataUrl: png, approvedForCustomer: true, target: 'current' }], source);
    const html = projectReviewHtml(enriched), network = vi.fn(); vi.stubGlobal('fetch', network);
    expect(() => validateProjectReviewFileHtml(html)).not.toThrow();
    await saveProjectReviewFile(identity, { ...file(), html });
    expect((await readProjectReviewLibrary(identity)).files[0]!.html).toBe(html); expect(network).not.toHaveBeenCalled();
  });

  it.each([
    '<script>alert(1)</script>', '<iframe src="https://evil.example"></iframe>', '<object data="https://evil.example"></object>',
    '<embed src="https://evil.example">', '<form action="https://evil.example"></form>', '<link rel="stylesheet" href="https://evil.example">',
    '<base href="https://evil.example">', '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<img src="https://evil.example/x">', '<img src="//evil.example/x">', '<img src="&#104;ttps://evil.example/x">',
    '<img src="data:image/svg+xml;base64,PHN2Zy8+">', `<img src="${png}" onerror="alert(1)">`, `<img src="${png}" srcset="https://evil.example 2x">`,
    '<a href="javascript:alert(1)">link</a>', '<svg><a xlink:href="https://evil.example">link</a></svg>',
    '<svg><foreignObject><p>hidden</p></foreignObject></svg>', '<svg><animate attributeName="href" values="https://evil.example"/></svg>',
    '<style>@import "https://evil.example";</style>', '<style>p{background:url(https://evil.example)}</style>',
    '<style>p{background:u\\72l(https://evil.example)}</style>', '<style>p{background:u/**/rl(https://evil.example)}</style>',
    '<style>p{background:image-set("https://evil.example" 1x)}</style>', '<p style="background:url(https://evil.example)">x</p>',
    '<svg><rect fill="url(https://evil.example)"/></svg>', '<template><img src="https://evil.example"></template>',
  ])('rejects executable or externally loading markup on save and persisted read: %s', async injection => {
    const input = { ...file(), html: file().html.replace('</main>', `${injection}</main>`) };
    await expect(saveProjectReviewFile(identity, input)).rejects.toThrow(); expect(stored.size).toBe(0);
    stored.set(address(), { version: 1, draft: null, files: [{ ...input, savedAt: generatedAt }] });
    await expect(readProjectReviewLibrary(identity)).rejects.toThrow();
    await expect(saveProjectReviewDraft(identity, { summary: '', pending: '' }, null)).rejects.toThrow();
    expect(stored.get(address())).toMatchObject({ files: [{ html: input.html }] });
  });

  it.each(['html', 'body'])('checks dangerous root %s attributes even though fragment parsers discard those elements', async tag => {
    const input = { ...file(), html: file().html.replace(`<${tag}`, `<${tag} onload="alert(1)"`) };
    await expect(saveProjectReviewFile(identity, input)).rejects.toThrow();
  });

  it('refuses forged generic files, invalid inline raster bytes, and weakened embedded policies', () => {
    expect(() => validateProjectReviewFileHtml('<!doctype html><html><body><p>generic HTML</p></body></html>')).toThrow('工作台生成');
    expect(() => validateProjectReviewFileHtml(file().html.replace('</main>', '<img src="data:image/png;base64,AAAA"></main>'))).toThrow('实际字节');
    expect(() => validateProjectReviewFileHtml(file().html.replace("default-src 'none'", "default-src *"))).toThrow('安全策略');
    expect(() => validateProjectReviewFileHtml(file().html.replace('</main>', `${`<img src="${png}">`.repeat(7)}</main>`))).toThrow('6 张');
  });

  it('does not invoke getters or serializers from runtime records', async () => {
    const getter = vi.fn(() => 'secret'), input = { ...file() };
    Object.defineProperty(input, 'html', { enumerable: true, get: getter });
    await expect(saveProjectReviewFile(identity, input)).rejects.toThrow('取值器');
    expect(getter).not.toHaveBeenCalled();
  });
});
