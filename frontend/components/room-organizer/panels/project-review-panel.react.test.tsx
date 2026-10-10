// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readProjectReviewLibrary } from '@/lib/project-review-library';
import { flushSourceScope } from '@/lib/source-storage';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { downloadTextFile } from '../lib/plan-export/download';
import { ProjectReviewPanel, type ProjectReviewPanelProps } from './project-review-panel';
import type { ProjectReviewCapture, ProjectReviewSnapshot, ProjectReviewSource } from '@/lib/project-review';
import type { ProjectReviewBase, ProjectReviewPanelActions } from '@/lib/project-review-workflow';

// The preparation/approval workflow is real; only the final browser download is intercepted.
vi.mock('../lib/plan-export/download', () => ({ downloadTextFile: vi.fn() }));
vi.mock('@/lib/project-review-library', async original => ({ ...await original<object>(), readProjectReviewLibrary: vi.fn() }));
const initialSource = { scope: 'review-panel-a', revision: 'content-1' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ioAAAAASUVORK5CYII=';
const approval = '我已核对这张画面，可以放入评审文件';
function base(source: ProjectReviewSource = initialSource): ProjectReviewBase {
  return {
    source: { ...source }, dataState: 'saved', dataKind: 'rehearsal',
    layout: makeLayout({ id: source.scope, name: '30人演练方案', roof: { style: 'none' },
      eventOperations: eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [] }),
      floors: [makeFloor({ items: [makeItem({ id: 'review-chair', type: 'chair', notes: 'PRIVATE_ITEM_NOTE',
        glbUrl: 'https://private.example/model.glb?token=PRIVATE_TOKEN' })] })] }),
    briefSnapshot: { state: 'ready', scope: source.scope, brief: { status: 'present', value: {
      event: '工作坊', guests: 30, description: '允许公开的需求原文', mustHave: '入口待实测', allowIdeas: false,
    } } },
  };
}
function picture(snapshot: ProjectReviewSnapshot, caption = '二维演练画面'): ProjectReviewCapture {
  return { snapshotId: snapshot.snapshot.id, source: { ...snapshot.source }, capturedAt: snapshot.snapshot.generatedAt,
    kind: 'editor-capture', sourceLabel: caption, caption, dataUrl: png, target: 'current' };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<ProjectReviewPanelActions> = {}, storageIdentity?: string) {
  let live: ProjectReviewSource = { ...initialSource };
  const actions: ProjectReviewPanelActions = {
    getSource: vi.fn(() => live), prepare: vi.fn(async () => base(live)),
    capture: vi.fn(async snapshot => picture(snapshot)), ...overrides,
  };
  let props: ProjectReviewPanelProps = { source: live, actions, ...(storageIdentity?{storageIdentity}:{}) };
  const view = render(<ProjectReviewPanel {...props}/>);
  return { actions, view,
    setLive(next: ProjectReviewSource, rerender = true) {
      live = next;
      if (rerender) { props = { ...props, source: next }; view.rerender(<ProjectReviewPanel {...props}/>); }
    },
    setDisabled(disabled: boolean) { props = { ...props, disabled }; view.rerender(<ProjectReviewPanel {...props}/>); },
    setStorageIdentity(identity: string) { props = { ...props, storageIdentity: identity }; view.rerender(<ProjectReviewPanel {...props}/>); },
    rerender() { view.rerender(<ProjectReviewPanel {...props}/>); },
  };
}
const generate = () => fireEvent.click(screen.getByRole('button', { name: '生成评审包' }));
const includeImage = () => fireEvent.click(screen.getByRole('checkbox', { name: '包含当前画面' }));
const approveFirst = () => fireEvent.click(screen.getAllByRole('checkbox', { name: approval })[0]);
const preview = () => screen.queryByTitle('客户评审预览') as HTMLIFrameElement | null;
function previewDocument(): Document { return new DOMParser().parseFromString(preview()!.srcdoc, 'text/html'); }
function expectNoFile(): void {
  expect(preview()).toBeNull();
  expect(screen.queryByRole('button', { name: '下载评审文件' })).toBeNull();
  expect(screen.queryByRole('button', { name: '下载评审文件（HTML）' })).toBeNull();
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn()); vi.mocked(downloadTextFile).mockReset();
  vi.mocked(readProjectReviewLibrary).mockReset().mockResolvedValue({version:1,draft:null,files:[]}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('independent customer review panel', () => {
  it('loads only saved text and clears every disclosure and capture permission', async () => {
    vi.mocked(readProjectReviewLibrary).mockResolvedValue({version:1,files:[],draft:{revision:'draft-1',summary:'保存的方案说明',pending:'保存的待确认项',savedAt:'2026-10-09T00:00:00Z'}});
    setup({},JSON.stringify(['api','account-a',initialSource.scope]));
    fireEvent.click(screen.getByText('本机草稿与文件',{exact:true}));
    for(const name of ['包含当前活动需求','包含当前设计说明','包含当前画面','允许在评审画面中包含当前参考底图'])fireEvent.click(screen.getByLabelText(name,{exact:true}));
    const load=await screen.findByRole('button',{name:'载入已保存说明'});await waitFor(()=>expect((load as HTMLButtonElement).disabled).toBe(false));fireEvent.click(load);
    await waitFor(()=>expect((screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement).value).toBe('保存的方案说明'));
    expect((screen.getByLabelText('待确认项（选填）') as HTMLTextAreaElement).value).toBe('保存的待确认项');
    for(const checkbox of screen.getAllByRole('checkbox'))expect((checkbox as HTMLInputElement).checked).toBe(false);
    expectNoFile();await expect(flushSourceScope(initialSource.scope)).resolves.toBeUndefined();
  });
  it('clears the same-project review and permissions when account/API identity changes', async () => {
    const current=setup({},JSON.stringify(['api','account-a',initialSource.scope]));
    fireEvent.change(screen.getByLabelText('简短方案说明（选填）'),{target:{value:'旧身份未保存说明'}});
    fireEvent.click(screen.getByLabelText('包含当前活动需求',{exact:true}));generate();await screen.findByTitle('客户评审预览');
    current.setStorageIdentity(JSON.stringify(['other-api','account-b',initialSource.scope]));
    await waitFor(()=>expect((screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement).value).toBe(''));
    expectNoFile();expect((screen.getByLabelText('包含当前活动需求',{exact:true}) as HTMLInputElement).checked).toBe(false);
    await waitFor(()=>expect(readProjectReviewLibrary).toHaveBeenLastCalledWith(JSON.stringify(['other-api','account-b',initialSource.scope])));
    await expect(flushSourceScope(initialSource.scope)).resolves.toBeUndefined();
  });
  it('starts with no disclosure or picture permission and explicitly prepares, previews and downloads a detached file', async () => {
    const { actions } = setup();
    for (const checkbox of screen.getAllByRole('checkbox')) expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement).maxLength).toBe(1000);
    expect((screen.getByLabelText('待确认项（选填）') as HTMLTextAreaElement).maxLength).toBe(1000);
    fireEvent.click(screen.getByRole('checkbox', { name: '包含当前活动需求' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '包含当前设计说明' }));
    fireEvent.change(screen.getByLabelText('简短方案说明（选填）'), { target: { value: '演练团队说明，尚未现场核验。' } });
    fireEvent.change(screen.getByLabelText('待确认项（选填）'), { target: { value: '日期和供电待确认。' } });
    expectNoFile(); generate();
    const frame = await screen.findByTitle('客户评审预览') as HTMLIFrameElement;
    expect(actions.prepare).toHaveBeenCalledOnce(); expect(actions.capture).not.toHaveBeenCalled();
    expect(frame.getAttribute('sandbox')).toBe('');
    const document = previewDocument();
    expect(document.body.textContent).toContain('允许公开的需求原文');
    expect(document.body.textContent).toContain('演练团队说明，尚未现场核验。');
    expect(document.body.textContent).toContain('日期和供电待确认。');
    expect(document.body.textContent).toContain('真实客户意见／确认：尚未记录，待补');
    expect(frame.srcdoc).not.toContain('PRIVATE_');
    expect(frame.srcdoc).not.toContain('private.example');
    expect(downloadTextFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '下载评审文件（HTML）' }));
    expect(downloadTextFile).toHaveBeenCalledWith(expect.stringMatching(/^幕景_评审_[a-z0-9_-]+\.html$/i), 'text/html;charset=utf-8', frame.srcdoc);
    expect(screen.getByText('已发起下载，请确认文件已保存。')).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps requirements private by default and does not invent design reasons or customer confirmation', async () => {
    setup(); generate(); await screen.findByTitle('客户评审预览');
    expect(preview()!.srcdoc).not.toContain('允许公开的需求原文');
    expect(previewDocument().body.textContent).toContain('需求原文未获准公开');
    expect(previewDocument().body.textContent).toContain('本次没有可公开的设计理由');
    expect(previewDocument().body.textContent).toContain('采用版本：未记录');
  });

  it('captures only after preparation and requires a separate image approval before any preview or download', async () => {
    const pending = deferred<ProjectReviewCapture>();
    const { actions } = setup({ capture: vi.fn(() => pending.promise) }); includeImage(); generate();
    await waitFor(() => expect(actions.capture).toHaveBeenCalledOnce());
    expectNoFile();
    const snapshot = vi.mocked(actions.capture!).mock.calls[0][0];
    expect(vi.mocked(actions.capture!).mock.calls[0][1]).toEqual({ includeReference: false });
    await act(async () => { pending.resolve(picture(snapshot)); });
    expect(screen.getByAltText('待核对的评审画面 1').getAttribute('src')).toBe(png);
    expect((screen.getByRole('checkbox', { name: approval }) as HTMLInputElement).checked).toBe(false);
    expectNoFile(); expect(downloadTextFile).not.toHaveBeenCalled();
    approveFirst(); await screen.findByTitle('客户评审预览');
    expect(previewDocument().querySelectorAll('img')).toHaveLength(1);
    approveFirst(); expectNoFile();
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it('treats reference-image permission separately from permission to put a captured picture in the file', async () => {
    const { actions } = setup(); includeImage();
    fireEvent.click(screen.getByRole('checkbox', { name: '允许在评审画面中包含当前参考底图' }));
    generate(); await screen.findByAltText('待核对的评审画面 1');
    expect(vi.mocked(actions.capture!).mock.calls[0][1]).toEqual({ includeReference: true });
    expectNoFile(); expect((screen.getByRole('checkbox', { name: approval }) as HTMLInputElement).checked).toBe(false);
  });

  it('appends another view of the same snapshot without replacing or auto-approving an earlier picture', async () => {
    const { actions } = setup({ capture: vi.fn(async snapshot => picture(snapshot, '三维演练画面')) });
    includeImage(); generate(); await screen.findByAltText('待核对的评审画面 1'); approveFirst();
    await screen.findByTitle('客户评审预览');
    const first = vi.mocked(actions.capture!).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '补充当前画面' }));
    await screen.findByAltText('待核对的评审画面 2');
    expect(vi.mocked(actions.capture!).mock.calls[1][0].snapshot.id).toBe(first.snapshot.id);
    expect(vi.mocked(actions.capture!).mock.calls[1][0].source).toEqual(first.source);
    const checkboxes = screen.getAllByRole('checkbox', { name: approval }) as HTMLInputElement[];
    expect(checkboxes.map(checkbox => checkbox.checked)).toEqual([true, false]);
    expectNoFile();
    fireEvent.click(checkboxes[1]); await screen.findByTitle('客户评审预览');
    expect(previewDocument().querySelectorAll('img')).toHaveLength(2);
    expect(actions.prepare).toHaveBeenCalledOnce();
  });

  it('caps same-snapshot captures at six and keeps every explicitly approved image', async () => {
    const { actions } = setup(); includeImage(); generate(); await screen.findByAltText('待核对的评审画面 1');
    for (let index = 2; index <= 6; index++) {
      fireEvent.click(screen.getByRole('button', { name: '补充当前画面' }));
      await screen.findByAltText(`待核对的评审画面 ${index}`);
    }
    const button = screen.getByRole('button', { name: '补充当前画面' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button);
    expect(actions.capture).toHaveBeenCalledTimes(6);
    for (const checkbox of screen.getAllByRole('checkbox', { name: approval })) fireEvent.click(checkbox);
    await screen.findByTitle('客户评审预览');
    expect(previewDocument().querySelectorAll('img')).toHaveLength(6);
    expect(new Set(vi.mocked(actions.capture!).mock.calls.map(([snapshot]) => snapshot.snapshot.id)).size).toBe(1);
  });

  it('requires an explicit no-image exit after an initial capture failure and hides the private error', async () => {
    const { actions } = setup({ capture: vi.fn().mockRejectedValue(new Error('https://private.example/image?token=PRIVATE_CAPTURE_ERROR')) });
    includeImage(); generate(); await screen.findByText(/画面未能捕获/);
    expectNoFile(); expect(document.body.textContent).not.toContain('PRIVATE_CAPTURE_ERROR');
    expect(document.body.textContent).not.toContain('private.example');
    const snapshotId = vi.mocked(actions.capture!).mock.calls[0][0].snapshot.id;
    fireEvent.click(screen.getByRole('button', { name: '改为无图评审' }));
    await screen.findByTitle('客户评审预览');
    expect(previewDocument().querySelectorAll('img')).toHaveLength(0);
    expect(preview()!.srcdoc).toContain(snapshotId);
    expect(actions.prepare).toHaveBeenCalledOnce();
    expect((screen.getByRole('checkbox', { name: '包含当前画面' }) as HTMLInputElement).checked).toBe(false);
  });

  it.each(['failure', 'cancel'] as const)('retains an approved original picture after append %s without claiming a new capture', async reason => {
    const next = deferred<ProjectReviewCapture>();
    const capture = vi.fn(async (snapshot: ProjectReviewSnapshot) => picture(snapshot)).mockImplementationOnce(async snapshot => picture(snapshot));
    const { actions } = setup({ capture }); includeImage(); generate(); await screen.findByAltText('待核对的评审画面 1');
    approveFirst(); await screen.findByTitle('客户评审预览'); const original = preview()!.srcdoc;
    vi.mocked(actions.capture!).mockImplementationOnce(() => next.promise);
    fireEvent.click(screen.getByRole('button', { name: '补充当前画面' }));
    if (reason === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消补充画面' }));
    await act(async () => { next.reject(new Error('PRIVATE_APPEND_ERROR')); });
    expect(preview()!.srcdoc).toBe(original);
    expect(screen.queryByAltText('待核对的评审画面 2')).toBeNull();
    expect(document.body.textContent).not.toContain('PRIVATE_APPEND_ERROR');
    expect(document.body.textContent).not.toContain('补充成功');
    fireEvent.click(screen.getByRole('button', { name: '下载评审文件（HTML）' }));
    expect(downloadTextFile).toHaveBeenCalledOnce();
  });

  it('rejects an appended picture over the combined limit while retaining the earlier approved file', async () => {
    // Signature-valid synthetic PNG data exercises the byte limit, not real canvas fidelity.
    const largePng = `data:image/png;base64,${btoa('\x89PNG\r\n\x1a\n' + '\0'.repeat(3 * 1024 * 1024))}`;
    const { actions } = setup({ capture: vi.fn(async snapshot => ({ ...picture(snapshot), dataUrl: largePng })) });
    includeImage(); generate(); await screen.findByAltText('待核对的评审画面 1'); approveFirst();
    await screen.findByTitle('客户评审预览');
    fireEvent.click(screen.getByRole('button', { name: '补充当前画面' }));
    await screen.findByAltText('待核对的评审画面 2');
    fireEvent.click(screen.getAllByRole('checkbox', { name: approval })[1]);
    await screen.findByTitle('客户评审预览'); const original = preview()!.srcdoc;
    fireEvent.click(screen.getByRole('button', { name: '补充当前画面' }));
    await screen.findByText(/补充画面未完成，原评审内容已保留/);
    expect(screen.queryByAltText('待核对的评审画面 3')).toBeNull();
    expect(screen.getAllByRole('checkbox', { name: approval }).map(checkbox => (checkbox as HTMLInputElement).checked)).toEqual([true, true]);
    expect(preview()!.srcdoc).toBe(original);
    expect(actions.capture).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: '下载评审文件（HTML）' }));
    expect(downloadTextFile).toHaveBeenCalledWith(expect.any(String), 'text/html;charset=utf-8', original);
  }, 20000);

  it.each(['summary', 'pending', 'brief', 'design', 'image', 'reference'] as const)('invalidates the old file when %s changes', async field => {
    setup(); generate(); await screen.findByTitle('客户评审预览');
    if (field === 'summary' || field === 'pending') fireEvent.change(screen.getByLabelText(field === 'summary' ? '简短方案说明（选填）' : '待确认项（选填）'), { target: { value: '新内容' } });
    else fireEvent.click(screen.getByRole('checkbox', { name: { brief: '包含当前活动需求', design: '包含当前设计说明', image: '包含当前画面', reference: '允许在评审画面中包含当前参考底图' }[field] }));
    expectNoFile(); expect(screen.getByText('评审内容已过期，请重新生成。')).toBeDefined();
  });

  it('drops an old preview and hand-written text when the project changes, including A→B→A', async () => {
    const { setLive } = setup();
    fireEvent.change(screen.getByLabelText('简短方案说明（选填）'), { target: { value: 'PRIVATE_OLD_PROJECT_TEXT' } });
    generate(); await screen.findByTitle('客户评审预览');
    setLive({ scope: 'review-panel-b', revision: 'content-1' });
    expectNoFile(); expect((screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement).value).toBe('');
    expect(document.body.textContent).not.toContain('PRIVATE_OLD_PROJECT_TEXT');
    setLive(initialSource); expectNoFile();
  });

  it.each(['source', 'disabled', 'unmount', 'cancel', 'settings'] as const)('ignores a preparation that finishes after %s and does not launch a canceled capture', async stop => {
    const pending = deferred<ProjectReviewBase>();
    const { actions, view, setLive, setDisabled } = setup({ prepare: vi.fn(() => pending.promise) });
    includeImage(); generate();
    if (stop === 'source') setLive({ ...initialSource, revision: 'content-2' });
    if (stop === 'disabled') setDisabled(true);
    if (stop === 'unmount') view.unmount();
    if (stop === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消本次准备' }));
    if (stop === 'settings') fireEvent.change(screen.getByLabelText('待确认项（选填）'), { target: { value: '修改中' } });
    await act(async () => { pending.resolve(base()); });
    expectNoFile(); expect(screen.queryByAltText('待核对的评审画面 1')).toBeNull();
    expect(actions.capture).not.toHaveBeenCalled(); expect(downloadTextFile).not.toHaveBeenCalled();
    if (stop === 'disabled') { setDisabled(false); expectNoFile(); }
  });

  it.each(['source', 'disabled', 'unmount', 'cancel'] as const)('ignores a captured image that arrives after %s', async stop => {
    const pending = deferred<ProjectReviewCapture>();
    const { actions, view, setLive, setDisabled } = setup({ capture: vi.fn(() => pending.promise) }); includeImage(); generate();
    await waitFor(() => expect(actions.capture).toHaveBeenCalledOnce());
    const snapshot = vi.mocked(actions.capture!).mock.calls[0][0];
    if (stop === 'source') setLive({ scope: 'review-panel-b', revision: 'content-1' });
    if (stop === 'disabled') setDisabled(true);
    if (stop === 'unmount') view.unmount();
    if (stop === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消本次准备' }));
    await act(async () => { pending.resolve(picture(snapshot)); });
    expectNoFile(); expect(screen.queryByAltText('待核对的评审画面 1')).toBeNull();
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it('does not let a canceled old preparation overwrite the next completed review', async () => {
    const pending = deferred<ProjectReviewBase>();
    const prepare = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(base());
    setup({ prepare }); generate(); fireEvent.click(screen.getByRole('button', { name: '取消本次准备' }));
    fireEvent.change(screen.getByLabelText('简短方案说明（选填）'), { target: { value: '第二轮内容' } });
    generate(); await screen.findByTitle('客户评审预览'); const html = preview()!.srcdoc;
    await act(async () => { pending.resolve(base()); });
    expect(preview()!.srcdoc).toBe(html); expect(html).toContain('第二轮内容');
  });

  it.each(['approval', 'download'] as const)('checks an unrendered source change again before %s', async step => {
    const { setLive } = setup();
    if (step === 'approval') includeImage();
    generate();
    if (step === 'approval') await screen.findByAltText('待核对的评审画面 1'); else await screen.findByTitle('客户评审预览');
    setLive({ ...initialSource, revision: 'content-2' }, false);
    if (step === 'approval') approveFirst(); else fireEvent.click(screen.getByRole('button', { name: '下载评审文件（HTML）' }));
    expectNoFile(); expect(downloadTextFile).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('当前内容已变化');
  });

  it.each(['render', 'approval', 'download'] as const)('handles getSource throwing during %s without showing a private URL or preserving the old preview', async step => {
    let broken = false;
    const { rerender } = setup({ getSource: vi.fn(() => { if (broken) throw new Error('https://private.example/?token=PRIVATE_GETTER_ERROR'); return initialSource; }) });
    if (step === 'approval') includeImage(); generate();
    if (step === 'approval') await screen.findByAltText('待核对的评审画面 1'); else await screen.findByTitle('客户评审预览');
    broken = true;
    if (step === 'render') rerender();
    if (step === 'approval') approveFirst();
    if (step === 'download') fireEvent.click(screen.getByRole('button', { name: '下载评审文件（HTML）' }));
    expectNoFile(); expect(downloadTextFile).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('暂时无法读取当前内容');
    expect(document.body.textContent).not.toContain('PRIVATE_GETTER_ERROR');
    expect(document.body.textContent).not.toContain('private.example');
  });

  it('shows only a controlled message when preparation or browser download fails', async () => {
    const { actions } = setup({ prepare: vi.fn().mockRejectedValueOnce(new Error('PRIVATE_PREPARE_ERROR')).mockResolvedValue(base()) });
    generate(); expect((await screen.findByRole('alert')).textContent).toBe('评审包未能生成，请稍后重试。');
    expect(document.body.textContent).not.toContain('PRIVATE_PREPARE_ERROR');
    generate(); await screen.findByTitle('客户评审预览');
    vi.mocked(downloadTextFile).mockImplementationOnce(() => { throw new Error('PRIVATE_DOWNLOAD_ERROR'); });
    fireEvent.click(screen.getByRole('button', { name: '下载评审文件（HTML）' }));
    expect(screen.getByRole('alert').textContent).toBe('下载未能发起，请重试。');
    expect(document.body.textContent).not.toContain('PRIVATE_DOWNLOAD_ERROR');
    expect(actions.prepare).toHaveBeenCalledTimes(2);
  });
});
