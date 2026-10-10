// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectReviewSnapshot, projectReviewHtml, type ProjectReviewSource } from '@/lib/project-review';
import { readProjectReviewLibrary, removeProjectReviewFile, saveProjectReviewDraft, saveProjectReviewFile,
  type ProjectReviewLibrary, type SavedReviewFile } from '@/lib/project-review-library';
import { flushSourceScope } from '@/lib/source-storage';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { downloadTextFile } from '../lib/plan-export/download';
import { ProjectReviewLibraryPanel, type ProjectReviewLibraryPanelProps } from './project-review-library';

vi.mock('@/lib/project-review-library', () => ({ MAX_PROJECT_REVIEW_FILES: 20, MAX_PROJECT_REVIEW_FILE_BYTES: 40 * 1024 * 1024, MAX_PROJECT_REVIEW_LIBRARY_BYTES: 96 * 1024 * 1024,
  readProjectReviewLibrary: vi.fn(), saveProjectReviewDraft: vi.fn(), saveProjectReviewFile: vi.fn(), removeProjectReviewFile: vi.fn() }));
vi.mock('../lib/plan-export/download', () => ({ downloadTextFile: vi.fn() }));
const source = { scope: 'activity-a', revision: 'current-content' };
const savedAt = '2026-10-09T08:00:00.000Z';
const draft = { revision: 'draft-1', summary: '已保存说明', pending: '现场待确认', savedAt };
const empty = (): ProjectReviewLibrary => ({ version: 1, draft: null, files: [] });
let stored: ProjectReviewLibrary;
function review(current: ProjectReviewSource = source, id = 'current-review') {
  const snapshot = createProjectReviewSnapshot({ layout: makeLayout({ id: current.scope, name: '30人方案', roof: { style: 'none' } }),
    source: current, briefSnapshot: { state: 'ready', scope: current.scope, brief: { status: 'absent' } },
    snapshot: { id, generatedAt: '2026-10-08T07:00:00.000Z' }, dataState: 'saved', dataKind: 'rehearsal', disclosure: { brief: false, design: false } });
  return { snapshot, html: projectReviewHtml(snapshot) };
}
function history(overrides: Partial<SavedReviewFile> = {}): SavedReviewFile {
  const file = review({ ...source, revision: 'old-content' }, 'old-review');
  return { id: 'old-review', title: '历史评审', generatedAt: file.snapshot.snapshot.generatedAt,
    source: { ...file.snapshot.source }, html: file.html, savedAt, ...overrides };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
function setup(overrides: Partial<ProjectReviewLibraryPanelProps> = {}) {
  let live = { ...source };
  let props: ProjectReviewLibraryPanelProps;
  const onLoadDraft = vi.fn((value: ProjectReviewLibraryPanelProps['draft']) => update({ draft: value }));
  props = { identityKey: 'identity-a', scope: source.scope, draft: { summary: '', pending: '' },
    onLoadDraft, file: review(), getSource: vi.fn(() => live), disabled: false, ...overrides };
  const view = render(<ProjectReviewLibraryPanel {...props}/>);
  function update(next: Partial<ProjectReviewLibraryPanelProps>): void { props = { ...props, ...next }; view.rerender(<ProjectReviewLibraryPanel {...props}/>); }
  return { view, update, onLoadDraft, setLive(value: ProjectReviewSource) { live = value; } };
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
async function ready(): Promise<void> { await waitFor(() => expect(button('保存说明草稿').disabled).toBe(false)); }
function openHistory(): void { fireEvent.click(screen.getByText(/本机评审文件（/)); }
const storedButton = (name: string) => screen.getAllByRole('button', { name, hidden: true })[0]!;
beforeEach(() => {
  stored = empty();
  vi.mocked(readProjectReviewLibrary).mockReset().mockImplementation(async () => structuredClone(stored));
  vi.mocked(saveProjectReviewDraft).mockReset().mockImplementation(async (_key, text, expectedRevision) => {
    if ((stored.draft?.revision ?? null) !== expectedRevision) throw new Error('Concurrent draft change');
    const next = { ...text, revision: 'draft-saved', savedAt }; stored = { ...stored, draft: next }; return next;
  });
  vi.mocked(saveProjectReviewFile).mockReset().mockImplementation(async (_key, file) => {
    const next = { ...file, savedAt }; stored = { ...stored, files: [next, ...stored.files.filter(value => value.id !== file.id)] }; return next;
  });
  vi.mocked(removeProjectReviewFile).mockReset().mockImplementation(async (_key, id) => {
    stored = { ...stored, files: stored.files.filter(value => value.id !== id) }; return structuredClone(stored);
  });
  vi.mocked(downloadTextFile).mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('local review library panel', () => {
  it('recovers the initial read after StrictMode replay and ignores the late first read for its draft CAS', async () => {
    const first = deferred<ProjectReviewLibrary>();
    const freshDraft = { ...draft, revision: 'strict-fresh-revision', savedAt: '2026-10-09T10:15:00.000Z' };
    stored = { ...empty(), draft: freshDraft };
    vi.mocked(readProjectReviewLibrary).mockReturnValueOnce(first.promise).mockResolvedValueOnce(structuredClone(stored));
    const input = { summary: 'StrictMode当前说明', pending: '当前待确认' };
    render(<StrictMode><ProjectReviewLibraryPanel identityKey="identity-a" scope={source.scope} draft={input}
      onLoadDraft={vi.fn()} file={null} getSource={() => source} disabled={false}/></StrictMode>);
    try {
      await waitFor(() => expect(readProjectReviewLibrary).toHaveBeenCalledTimes(2));
      await ready();
      expect(screen.getByText(/本机草稿保存于/).textContent).toContain(new Date(freshDraft.savedAt).toLocaleString());
      await act(async () => { first.resolve({ ...empty(), draft: { ...draft, revision: 'strict-old-revision', savedAt: '2026-10-09T06:00:00.000Z' } }); });
      expect(screen.getByText(/本机草稿保存于/).textContent).toContain(new Date(freshDraft.savedAt).toLocaleString());
      fireEvent.click(button('保存说明草稿'));
      await screen.findByText('说明草稿已保存到本机。');
      expect(saveProjectReviewDraft).toHaveBeenCalledExactlyOnceWith('identity-a', input, freshDraft.revision);
    } finally {
      await act(async () => { first.resolve(empty()); });
    }
  });

  it('does not save before the first read succeeds or treat an un-loaded stored draft as unsaved editing', async () => {
    const read = deferred<ProjectReviewLibrary>(); vi.mocked(readProjectReviewLibrary).mockReturnValueOnce(read.promise); setup();
    expect(button('保存说明草稿').disabled).toBe(true); expect(button('保存当前评审文件').disabled).toBe(true);
    fireEvent.click(button('保存说明草稿')); expect(saveProjectReviewDraft).not.toHaveBeenCalled();
    await expect(flushSourceScope(source.scope)).resolves.toBeUndefined();
    await act(async () => { read.resolve({ ...empty(), draft }); }); await ready();
    expect(screen.queryByText('当前说明有未保存修改。')).toBeNull();
    expect(saveProjectReviewDraft).not.toHaveBeenCalled(); await expect(flushSourceScope(source.scope)).resolves.toBeUndefined();
  });

  it('preserves a failed initial read, allows retry, and never writes an empty replacement', async () => {
    vi.mocked(readProjectReviewLibrary).mockRejectedValueOnce(new Error('UNTRUSTED_ERROR_INSTRUCTION')); setup();
    expect((await screen.findByRole('alert')).textContent).not.toContain('UNTRUSTED_ERROR_INSTRUCTION');
    expect(button('保存说明草稿').disabled).toBe(true); expect(saveProjectReviewDraft).not.toHaveBeenCalled();
    await expect(flushSourceScope(source.scope)).resolves.toBeUndefined();
    fireEvent.click(button('重试读取本机资料')); await ready(); expect(readProjectReviewLibrary).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull(); expect(saveProjectReviewDraft).not.toHaveBeenCalled();
  });

  it('saves exactly the two strings with the revision read from storage and keeps later edits dirty', async () => {
    stored = { ...empty(), draft }; const ui = setup(); await ready();
    ui.update({ draft: { summary: '新说明', pending: '新待确认' } });
    await expect(flushSourceScope(source.scope)).rejects.toThrow('评审说明有未保存修改，请先保存或放弃修改');
    fireEvent.click(button('保存说明草稿')); await screen.findByText('说明草稿已保存到本机。');
    expect(saveProjectReviewDraft).toHaveBeenCalledExactlyOnceWith('identity-a', { summary: '新说明', pending: '新待确认' }, 'draft-1');
    await expect(flushSourceScope(source.scope)).resolves.toBeUndefined();
    ui.update({ draft: { summary: '再修改', pending: '新待确认' } });
    await expect(flushSourceScope(source.scope)).rejects.toThrow('未保存修改');
    fireEvent.click(button('放弃说明修改'));
    expect(ui.onLoadDraft).toHaveBeenCalledWith({ summary: '新说明', pending: '新待确认' });
    await expect(flushSourceScope(source.scope)).resolves.toBeUndefined();
  });

  it('uses null for a new draft and keeps new typing after an earlier save completes', async () => {
    const pending = deferred<NonNullable<ProjectReviewLibrary['draft']>>(); vi.mocked(saveProjectReviewDraft).mockReturnValueOnce(pending.promise);
    const ui = setup(); await ready(); ui.update({ draft: { summary: '提交时说明', pending: '' } });
    fireEvent.click(button('保存说明草稿')); ui.update({ draft: { summary: '保存中又编辑', pending: '' } });
    await expect(flushSourceScope(source.scope)).rejects.toThrow('未保存修改');
    expect(saveProjectReviewDraft).toHaveBeenCalledWith('identity-a', { summary: '提交时说明', pending: '' }, null);
    await act(async () => { const saved = { ...draft, summary: '提交时说明', pending: '' }; stored = { ...stored, draft: saved }; pending.resolve(saved); });
    await screen.findByText('已保存本次提交的说明；当前输入仍有未保存修改。');
    await expect(flushSourceScope(source.scope)).rejects.toThrow('未保存修改');
    fireEvent.click(button('放弃说明修改')); expect(ui.onLoadDraft).toHaveBeenCalledWith({ summary: '提交时说明', pending: '' });
    await expect(flushSourceScope(source.scope)).resolves.toBeUndefined();
  });

  it('blocks scope flushing while a save is pending even when the submitted text matches the baseline', async () => {
    const pending = deferred<NonNullable<ProjectReviewLibrary['draft']>>(); vi.mocked(saveProjectReviewDraft).mockReturnValueOnce(pending.promise);
    setup({ draft: { summary: '挂载时说明', pending: '' } }); await ready(); fireEvent.click(button('保存说明草稿'));
    await expect(flushSourceScope(source.scope)).rejects.toThrow('正在保存');
    await act(async () => { const saved = { ...draft, summary: '挂载时说明', pending: '' }; stored = { ...stored, draft: saved }; pending.resolve(saved); });
    await expect(flushSourceScope(source.scope)).resolves.toBeUndefined();
  });

  it('retains input after a concurrent draft rejection and obtains a fresh CAS revision on retry', async () => {
    stored = { ...empty(), draft };
    vi.mocked(saveProjectReviewDraft).mockRejectedValueOnce(new Error('Concurrent draft change'));
    const ui = setup(); await ready(); ui.update({ draft: { summary: '不丢的说明', pending: '' } }); fireEvent.click(button('保存说明草稿'));
    await screen.findByRole('alert'); expect(screen.getByText(/当前说明有未保存修改/)).toBeTruthy();
    expect(ui.onLoadDraft).not.toHaveBeenCalled(); await expect(flushSourceScope(source.scope)).rejects.toThrow('未保存修改');
    stored = { ...empty(), draft: { ...draft, revision: 'draft-2' } };
    fireEvent.click(button('重新读取本机资料')); await ready(); fireEvent.click(button('保存说明草稿'));
    await screen.findByText('说明草稿已保存到本机。');
    expect(vi.mocked(saveProjectReviewDraft).mock.calls.at(-1)?.[2]).toBe('draft-2');
  });

  it('loads fresh saved text only with explicit replacement confirmation and never includes permissions or HTML', async () => {
    vi.mocked(readProjectReviewLibrary).mockResolvedValueOnce({ ...empty(), draft }).mockResolvedValue({ ...empty(), draft: { ...draft, summary: '另一页面最新说明' } });
    const ui = setup({ draft: { summary: '尚在编辑', pending: '' } }); await ready(); vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(button('载入已保存说明')); await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce());
    expect(ui.onLoadDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(button('载入已保存说明').disabled).toBe(false)); fireEvent.click(button('载入已保存说明'));
    await screen.findByText('已载入本机说明，请重新选择本次允许公开的内容。');
    expect(ui.onLoadDraft).toHaveBeenCalledExactlyOnceWith({ summary: '另一页面最新说明', pending: '现场待确认' });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('重置所有公开选项'));
    await expect(flushSourceScope(source.scope)).resolves.toBeUndefined();
  });

  it('keeps unapproved or absent current files unsavable', async () => {
    const ui = setup({ file: null }); await ready(); expect(button('保存当前评审文件').disabled).toBe(true);
    fireEvent.click(button('保存当前评审文件')); expect(saveProjectReviewFile).not.toHaveBeenCalled();
    // The parent passes null until every included picture has explicit approval.
    ui.update({ draft: { summary: '画面仍待核对', pending: '' }, file: null });
    expect(button('保存当前评审文件').disabled).toBe(true); expect(saveProjectReviewFile).not.toHaveBeenCalled();
  });

  it('saves only a still-current approved file and keeps its original metadata', async () => {
    const current = review(); setup({ file: current }); await ready(); fireEvent.click(button('保存当前评审文件'));
    await screen.findByText('当前评审文件已保存为本机冻结副本。');
    expect(saveProjectReviewFile).toHaveBeenCalledExactlyOnceWith('identity-a', {
      id: current.snapshot.snapshot.id, title: current.snapshot.current.layout.name,
      generatedAt: current.snapshot.snapshot.generatedAt, source: current.snapshot.source, html: current.html,
    });
    expect(screen.getByText('本机评审文件（1）')).toBeTruthy(); expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it('keeps the edit baseline dirty when the saved draft cannot be read back', async () => {
    vi.mocked(readProjectReviewLibrary).mockResolvedValueOnce(empty()).mockRejectedValueOnce(new Error('Read-back failure'));
    const ui = setup(); await ready(); ui.update({ draft: { summary: '不能丢的说明', pending: '' } }); fireEvent.click(button('保存说明草稿'));
    await screen.findByRole('alert'); expect(screen.queryByText('说明草稿已保存到本机。')).toBeNull();
    expect(screen.getByText(/当前说明有未保存修改/)).toBeTruthy(); expect(ui.onLoadDraft).not.toHaveBeenCalled();
    await expect(flushSourceScope(source.scope)).rejects.toThrow('未保存修改');
  });

  it('does not mark its submitted text saved when another page has already replaced it before read-back', async () => {
    vi.mocked(saveProjectReviewDraft).mockImplementationOnce(async (_key, text) => {
      const saved = { ...text, revision: 'own-saved', savedAt }; stored = { ...empty(), draft: { ...draft, revision: 'other-newer' } }; return saved;
    });
    const ui = setup(); await ready(); ui.update({ draft: { summary: '我的提交', pending: '' } }); fireEvent.click(button('保存说明草稿'));
    await screen.findByRole('alert'); expect(screen.queryByText('说明草稿已保存到本机。')).toBeNull();
    await expect(flushSourceScope(source.scope)).rejects.toThrow('未保存修改');
    fireEvent.click(button('保存说明草稿')); await screen.findByRole('alert');
    expect(vi.mocked(saveProjectReviewDraft).mock.calls.at(-1)?.[2]).toBe(null);
    expect(stored.draft?.revision).toBe('other-newer'); expect(stored.draft?.summary).toBe(draft.summary);
    expect(screen.queryByText('说明草稿已保存到本机。')).toBeNull();
    fireEvent.click(button('重新读取本机资料')); await ready(); fireEvent.click(button('保存说明草稿'));
    await screen.findByText('说明草稿已保存到本机。');
    expect(vi.mocked(saveProjectReviewDraft).mock.calls.at(-1)?.[2]).toBe('other-newer');
  });

  it.each(['file-save', 'download', 'remove'] as const)('does not silently accept another page draft revision through %s', async operation => {
    const old = history(); stored = { ...empty(), draft, files: [old] };
    const ui = setup(); await ready(); stored = { ...stored, draft: { ...draft, revision: 'peer-newer', summary: '另一页修改' } };
    if (operation === 'file-save') {
      fireEvent.click(button('保存当前评审文件')); await screen.findByText('当前评审文件已保存为本机冻结副本。');
    } else {
      openHistory();
      if (operation === 'download') { fireEvent.click(storedButton('下载')); await screen.findByText('已发起冻结文件下载，请确认文件已保存。'); }
      else { fireEvent.click(storedButton('查看')); fireEvent.click(button('删除本机副本')); await screen.findByText('所选本机副本已删除。'); }
    }
    ui.update({ draft: { summary: '我的未保存输入', pending: '' } }); fireEvent.click(button('保存说明草稿')); await screen.findByRole('alert');
    expect(saveProjectReviewDraft).toHaveBeenCalledWith('identity-a', { summary: '我的未保存输入', pending: '' }, 'draft-1');
    expect(stored.draft?.summary).toBe('另一页修改'); expect(ui.onLoadDraft).not.toHaveBeenCalled();
  });

  it('refreshes the saved-file list rather than dropping a file another page added during the save', async () => {
    vi.mocked(saveProjectReviewFile).mockImplementationOnce(async (_key, file) => {
      const saved = { ...file, savedAt }; stored = { ...empty(), files: [saved, history({ id: 'parallel-file', title: '另一页面新增' })] }; return saved;
    });
    setup(); await ready(); fireEvent.click(button('保存当前评审文件')); await screen.findByText('当前评审文件已保存为本机冻结副本。');
    expect(screen.getByText('本机评审文件（2）')).toBeTruthy(); expect(screen.getByText('另一页面新增')).toBeTruthy();
    expect(readProjectReviewLibrary).toHaveBeenCalledTimes(2);
  });

  it('does not claim success when a file save returns but the file cannot be read back', async () => {
    vi.mocked(saveProjectReviewFile).mockImplementationOnce(async (_key, file) => ({ ...file, savedAt }));
    setup(); await ready(); fireEvent.click(button('保存当前评审文件')); await screen.findByRole('alert');
    expect(screen.queryByText('当前评审文件已保存为本机冻结副本。')).toBeNull(); expect(screen.getByText('本机评审文件（0）')).toBeTruthy();
  });

  it('rechecks the live file source after the post-save read has completed', async () => {
    const readback = deferred<ProjectReviewLibrary>(); vi.mocked(readProjectReviewLibrary).mockResolvedValueOnce(empty()).mockReturnValueOnce(readback.promise);
    const ui = setup(); await ready(); fireEvent.click(button('保存当前评审文件'));
    await waitFor(() => expect(readProjectReviewLibrary).toHaveBeenCalledTimes(2)); ui.setLive({ ...source, revision: 'changed-during-readback' });
    await act(async () => { readback.resolve(stored); });
    await screen.findByRole('alert'); expect(screen.queryByText('当前评审文件已保存为本机冻结副本。')).toBeNull();
    expect(screen.getByText('本机评审文件（0）')).toBeTruthy();
  });

  it.each(['before', 'during'] as const)('does not claim a stale file was saved when source changes %s saving', async when => {
    const pending = deferred<SavedReviewFile>(); vi.mocked(saveProjectReviewFile).mockReturnValueOnce(pending.promise);
    const ui = setup(); await ready();
    if (when === 'before') ui.setLive({ ...source, revision: 'new-content' });
    fireEvent.click(button('保存当前评审文件'));
    if (when === 'during') {
      ui.setLive({ ...source, revision: 'new-content' }); ui.update({ file: null });
      await act(async () => { pending.resolve(history()); });
    }
    await screen.findByRole('alert'); expect(screen.queryByText('当前评审文件已保存为本机冻结副本。')).toBeNull();
    expect(screen.getByText('本机评审文件（0）')).toBeTruthy();
    expect(saveProjectReviewFile).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
  });

  it('previews and freshly downloads an old frozen file independently from the current review source', async () => {
    const old = history(); vi.mocked(readProjectReviewLibrary).mockResolvedValue({ ...empty(), files: [old] });
    const ui = setup({ file: null }); await ready(); ui.setLive({ ...source, revision: 'different-live-content' }); openHistory();
    fireEvent.click(storedButton('查看')); const iframe = screen.getByTitle('本机评审文件预览') as HTMLIFrameElement;
    expect(iframe.srcdoc).toBe(old.html); expect(iframe.getAttribute('sandbox')).toBe('');
    expect(screen.getByText(/冻结文件，未与当前内容自动比对/)).toBeTruthy(); expect(ui.onLoadDraft).not.toHaveBeenCalled();
    fireEvent.click(storedButton('下载')); await waitFor(() => expect(downloadTextFile).toHaveBeenCalledOnce());
    expect(readProjectReviewLibrary).toHaveBeenCalledTimes(2);
    expect(downloadTextFile).toHaveBeenCalledWith('幕景_评审_old-review.html', 'text/html;charset=utf-8', old.html);
    expect(button('保存当前评审文件').disabled).toBe(true); expect(saveProjectReviewFile).not.toHaveBeenCalled();
  });

  it.each(['changed', 'missing', 'foreign'] as const)('refuses a %s historical download after fresh validation', async state => {
    const old = history(); vi.mocked(readProjectReviewLibrary).mockResolvedValueOnce({ ...empty(), files: [old] }).mockResolvedValue({ ...empty(), files:
      state === 'missing' ? [] : [{ ...old, ...(state === 'changed' ? { html: old.html + '\n' } : { source: { ...old.source, scope: 'another-activity' } }) }] });
    setup({ file: null }); await ready(); openHistory(); fireEvent.click(storedButton('查看')); fireEvent.click(storedButton('下载'));
    await screen.findByRole('alert'); expect(downloadTextFile).not.toHaveBeenCalled();
    expect((screen.getByTitle('本机评审文件预览') as HTMLIFrameElement).srcdoc).toBe(old.html);
  });

  it('deletes only the selected local copy after confirmation and preserves the list and preview after failure', async () => {
    const old = history(), second = history({ id: 'second', title: '另一份评审' });
    vi.mocked(readProjectReviewLibrary).mockResolvedValue({ ...empty(), files: [old, second] });
    vi.mocked(removeProjectReviewFile).mockRejectedValueOnce(new Error('Storage failure')).mockResolvedValue({ ...empty(), files: [second] });
    setup(); await ready(); openHistory(); fireEvent.click(storedButton('查看')); vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(button('删除本机副本')); expect(removeProjectReviewFile).not.toHaveBeenCalled();
    fireEvent.click(button('删除本机副本')); await screen.findByRole('alert');
    expect(screen.getByTitle('本机评审文件预览')).toBeTruthy(); expect(screen.getByText('本机评审文件（2）')).toBeTruthy();
    fireEvent.click(button('删除本机副本')); await screen.findByText('所选本机副本已删除。');
    expect(removeProjectReviewFile).toHaveBeenLastCalledWith('identity-a', 'old-review');
    expect(screen.getByText('本机评审文件（1）')).toBeTruthy(); expect(screen.queryByTitle('本机评审文件预览')).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('ignores a late first-identity read %s after A→B→A', async completion => {
    const old = deferred<ProjectReviewLibrary>(); vi.mocked(readProjectReviewLibrary).mockReturnValueOnce(old.promise).mockResolvedValueOnce(empty()).mockResolvedValue(empty());
    const ui = setup(); ui.update({ identityKey: 'identity-b', file: null }); await ready(); ui.update({ identityKey: 'identity-a' }); await ready();
    await act(async () => { if (completion === 'resolve') old.resolve({ ...empty(), files: [history({ title: '不能露出的旧身份文件' })] }); else old.reject(new Error('Late old error')); });
    expect(screen.queryByText('不能露出的旧身份文件')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('本机评审文件（0）')).toBeTruthy();
  });

  it('cancels a historical download and clears its preview immediately when the identity changes', async () => {
    const old = history(), freshRead = deferred<ProjectReviewLibrary>();
    vi.mocked(readProjectReviewLibrary).mockResolvedValueOnce({ ...empty(), files: [old] }).mockReturnValueOnce(freshRead.promise).mockResolvedValue(empty());
    const ui = setup({ file: null }); await ready(); openHistory(); fireEvent.click(storedButton('查看')); fireEvent.click(storedButton('下载'));
    ui.update({ identityKey: 'identity-b' }); expect(screen.queryByTitle('本机评审文件预览')).toBeNull(); await ready();
    await act(async () => { freshRead.resolve({ ...empty(), files: [old] }); });
    expect(downloadTextFile).not.toHaveBeenCalled(); expect(screen.getByText('本机评审文件（0）')).toBeTruthy();
  });

  it('ignores a completed old-identity draft save without altering the new identity baseline or list', async () => {
    const pending = deferred<NonNullable<ProjectReviewLibrary['draft']>>(); vi.mocked(saveProjectReviewDraft).mockReturnValueOnce(pending.promise);
    const ui = setup(); await ready(); ui.update({ draft: { summary: '旧身份提交', pending: '' } }); fireEvent.click(button('保存说明草稿'));
    ui.update({ identityKey: 'identity-b', draft: { summary: '', pending: '' }, file: null }); await ready();
    await act(async () => { pending.resolve({ ...draft, summary: '旧身份提交' }); });
    expect(screen.queryByText('说明草稿已保存到本机。')).toBeNull(); expect(screen.getByText('本机评审文件（0）')).toBeTruthy();
    await expect(flushSourceScope(source.scope)).resolves.toBeUndefined(); expect(readProjectReviewLibrary).toHaveBeenCalledTimes(2);
  });

  it('rejects a foreign-scope library before exposing files or enabling writes', async () => {
    vi.mocked(readProjectReviewLibrary).mockResolvedValue({ ...empty(), files: [history({ title: '外活动私有文件', source: { scope: 'foreign', revision: 'old' } })] });
    setup(); await screen.findByRole('alert'); expect(screen.queryByText('外活动私有文件')).toBeNull();
    expect(button('保存说明草稿').disabled).toBe(true); expect(saveProjectReviewDraft).not.toHaveBeenCalled();
    expect(downloadTextFile).not.toHaveBeenCalled();
  });
});
