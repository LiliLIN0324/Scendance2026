// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOCAL_PROJECT_BACKUP_BYTES, MAX_LOCAL_PROJECT_BACKUP_V4_BYTES, serializeLocalProjectBackup, serializeLocalProjectBackupV3, serializeLocalProjectBackupV4 } from '@/lib/local-project-backup';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { downloadSceneDelivery } from '../lib/scene-delivery';
import { createOperation } from '../lib/event-operations';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { RoomLayout } from '../lib/types';
import type { CreativeBriefState, LocalProjectBackupActions } from './creative-studio';
import { LocalProjectBackupPanel } from './local-project-backup-panel';

vi.mock('../lib/scene-delivery', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/scene-delivery')>(), downloadSceneDelivery: vi.fn(),
}));
const layout = makeLayout({ id: 'backup-review-a', name: 'A-原布局', roof: { style: 'none' } });
const brief = { event: '恢复演练', guests: 0, description: 'A-旧草稿', mustHave: '', allowIdeas: false };
const briefState: CreativeBriefState = { brief, ready: true, error: null, hasSavedBrief: true };
function fileText(next: RoomLayout = { ...layout, name: 'A-文件布局' }, status: 'present' | 'absent' = 'present'): string {
  return serializeLocalProjectBackup(next, { state: 'ready', scope: next.id ?? 'local', brief: status === 'present'
    ? { status, value: { ...brief, description: 'A-文件恢复' } } : { status } }, '2026-10-07T09:30:00.000Z');
}
async function sourceFileText(withImages = true, withForm = true): Promise<string> {
  const next = { ...layout, id: layout.id!, name: 'A-图纸备份' };
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), value => value.charCodeAt(0));
  return serializeLocalProjectBackupV4(next, { state: 'ready', scope: next.id, brief: { status: 'present', value: brief } },
    { state: 'ready', scope: next.id, materialCheckins: { status: 'absent' } },
    { scope: next.id, sources: withImages ? (['floorplan', 'photo'] as const).map((kind, index) => ({
      id: `source-${index}`, scope: next.id, name: `${kind}.png`, kind, width: 1, height: 1, blob: new Blob([png], { type: 'image/png' }),
    })) : [], form: withForm ? { width: '8', depth: '8', registration: { sourceId: 'source-0', points: [{ x: 0, z: 0 }] } } : undefined },
    '2026-10-09T09:30:00.000Z');
}
function file(text: string, read?: () => Promise<string>, size?: number, name = '场景与活动备份.json'): File {
  const chosen = new File([text], name, { type: 'application/json' });
  Object.defineProperty(chosen, 'text', { value: read ?? (() => Promise.resolve(text)) });
  if (size !== undefined) Object.defineProperty(chosen, 'size', { value: size });
  return chosen;
}
function select(chosen: File): void { fireEvent.change(screen.getByLabelText('选择备份文件'), { target: { files: [chosen] } }); }
function setup(overrides: Partial<LocalProjectBackupActions> = {}) {
  const actions: LocalProjectBackupActions = { prepareBackup: vi.fn().mockResolvedValue(fileText()), restoreBackup: vi.fn().mockResolvedValue(undefined),
    undoRestore: vi.fn().mockResolvedValue(undefined), backupPending: false, canUndoRestore: false, ...overrides };
  const view = render(<LocalProjectBackupPanel layout={layout} briefState={briefState} actions={actions}/>);
  fireEvent.click(screen.getByText('场景与活动备份'));
  return { actions, view };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob); vi.mocked(downloadSceneDelivery).mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('local scene and activity backup', () => {
  it.each([1, 2, 3, 'legacy'] as const)('preserves existing source documents when prechecking %s', async version => {
    const { actions } = setup();
    let text = fileText();
    if (version === 1) { const older = JSON.parse(text); older.version = 1; delete older.coverage.productionPlan; text = JSON.stringify(older); }
    if (version === 3) text = serializeLocalProjectBackupV3({ ...layout, name: 'A-文件布局' },
      { state: 'ready', scope: layout.id!, brief: { status: 'present', value: brief } },
      { state: 'ready', scope: layout.id!, materialCheckins: { status: 'absent' } });
    if (version === 'legacy') text = JSON.stringify(layout);
    select(file(text)); await screen.findByLabelText('备份预检');
    expect(screen.getByText('文件未含图纸资料，保留目标项目已有图纸与对应点')).toBeTruthy();
    expect(screen.queryByText(/这份文件的图纸、照片与对应点替换/)).toBeNull();
    expect(actions.restoreBackup).not.toHaveBeenCalled();
  });

  it('prechecks V4 image count and source form without loading resources, then uses the existing restore action', async () => {
    const fetch = vi.fn(), decode = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubGlobal('createImageBitmap', decode);
    const { actions } = setup(); select(file(await sourceFileText())); await screen.findByText('完整项目备份 V4');
    expect(screen.getByText('2 张图片 · 已包含图纸表单')).toBeTruthy();
    expect(screen.getByText(/替换目标项目的原资料/)).toBeTruthy();
    expect(actions.restoreBackup).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(decode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认替换布局与活动需求' })); await screen.findByRole('status');
    expect(actions.restoreBackup).toHaveBeenCalledOnce();
    expect(vi.mocked(actions.restoreBackup).mock.calls[0][0].sourceDocuments).toMatchObject({ status: 'present', sources: [{ id: 'source-0' }, { id: 'source-1' }] });
    expect(screen.getByRole('status').textContent).toContain('本机图纸资料已保存并核实');
    expect(screen.getByRole('status').textContent).toContain('模型资源仍需另行加载');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('warns that a V4 backup with no images or form clears the target source documents before confirmation', async () => {
    const { actions } = setup(); select(file(await sourceFileText(false, false))); await screen.findByText('完整项目备份 V4');
    expect(screen.getByText('0 张图片 · 未包含图纸表单')).toBeTruthy();
    expect(screen.getByText(/目标项目原表单及对应点将清除/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消恢复' })); expect(actions.restoreBackup).not.toHaveBeenCalled();
  });

  it('shows V1 provenance and warns before replacing a current production plan with an older file',async()=>{
    const {actions,view}=setup();
    const current={...layout,productionPlan:productionPlanSchema.parse({})};
    view.rerender(<LocalProjectBackupPanel layout={current} briefState={briefState} actions={actions}/>);
    const older=JSON.parse(fileText());older.version=1;delete older.coverage.productionPlan;
    select(file(JSON.stringify(older)));await screen.findByText('完整项目备份 V1');
    expect(screen.getByText('当前方案未记录制作计划')).toBeTruthy();
    expect(screen.getByText(/恢复后当前制作计划将清除/)).toBeTruthy();
    expect(actions.restoreBackup).not.toHaveBeenCalled();
  });
  it('shows production rows from a V2 file before confirming',async()=>{
    const {actions}=setup();const plan=productionPlanSchema.parse({staffing:[{id:'70000000-0000-4000-8000-000000000001',roleName:'签到'}]});
    select(file(fileText({...layout,productionPlan:plan})));await screen.findByText('完整项目备份 V2');
    expect(screen.getByText('1 项岗位需求 · 0 项物料取得 · 0 项人工估算')).toBeTruthy();
    expect(actions.restoreBackup).not.toHaveBeenCalled();
  });
  it('prechecks the selected file without replacing anything, cancels, then explicitly confirms and awaits verified saving', async () => {
    const pending = deferred<void>(); const { actions } = setup({ restoreBackup: vi.fn(() => pending.promise) });
    const target = { ...layout, name: 'A-文件布局', floors: [makeFloor({ items: [makeItem()] })],
      eventOperations: eventOperationsSchema.parse({ tasks: [createOperation('演练任务', 'preparation')] }) };
    select(file(fileText(target)));
    await screen.findByText('A-文件布局');
    expect(screen.getByText('1 个活动任务 · 1 个物件')).toBeDefined();
    expect(screen.getByText('已包含')).toBeDefined();
    expect(actions.restoreBackup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消恢复' }));
    expect(screen.queryByText('A-文件布局')).toBeNull(); expect(actions.restoreBackup).not.toHaveBeenCalled();
    select(file(fileText(target))); await screen.findByText('A-文件布局');
    fireEvent.click(screen.getByRole('button', { name: '确认替换布局与活动需求' }));
    fireEvent.click(screen.getByRole('button', { name: '正在恢复并核实保存…' }));
    expect(actions.restoreBackup).toHaveBeenCalledOnce();
    expect(screen.queryByText(/备份已恢复/)).toBeNull();
    await act(async () => { pending.resolve(); });
    expect(screen.getByRole('status').textContent).toContain('布局与活动需求已保存并核实');
    expect(screen.queryByLabelText('备份预检')).toBeNull();
  });

  it.each(['absent', 'legacy'] as const)('distinguishes %s from a file containing saved requirements', async status => {
    const { actions } = setup();
    select(file(status === 'legacy' ? JSON.stringify({ id: layout.id, name: '旧布局', width: 8, height: 8, items: [], floorColor: '#fff' }) : fileText(undefined, 'absent')));
    await screen.findByLabelText('备份预检');
    expect(screen.getByText(status === 'legacy' ? '旧文件未包含活动需求' : '备份明确无已保存需求')).toBeDefined();
    expect(screen.getByText(/目标项目原有需求将清除/)).toBeDefined();
    if (status === 'legacy') expect(screen.getByText('旧布局经兼容修复，请核对后再替换。')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消恢复' })); expect(actions.restoreBackup).not.toHaveBeenCalled();
  });

  it('retains a checked candidate after file read failure and native file cancellation', async () => {
    const { actions } = setup(); select(file(fileText(), undefined, undefined, 'A备份.json')); await screen.findByText('A-文件布局');
    select(file('', () => Promise.reject(new Error('读取文件失败，请重新选择。')), undefined, 'B备份.json'));
    expect((await screen.findByRole('alert')).textContent).toContain('新文件未读入，当前仍是上一份「A-文件布局」');
    expect(screen.getByText('已预检 · A-文件布局')).toBeDefined();
    expect(screen.getByText('A备份.json')).toBeDefined(); expect(screen.queryByText('B备份.json')).toBeNull();
    fireEvent.change(screen.getByLabelText('选择备份文件'), { target: { files: [] } });
    expect(screen.getByText('A-文件布局')).toBeDefined();
    expect(actions.restoreBackup).not.toHaveBeenCalled();
  });

  it.each([
    ['坏 JSON', '{broken', undefined, '有效的 JSON'],
    ['未知版本', JSON.stringify({ format: 'scendance-local-project-backup', version: 99 }), undefined, '版本'],
    ['交付封套', JSON.stringify({ format: 'scendance-scene-delivery' }), undefined, '这是交付文件'],
    ['过大文件', '{}', MAX_LOCAL_PROJECT_BACKUP_V4_BYTES + 1, '96 MiB'],
  ] as const)('rejects %s before offering replacement', async (_label, text, size, message) => {
    const { actions } = setup(); const read = vi.fn().mockResolvedValue(text); select(file(text, read, size));
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(screen.queryByRole('button', { name: '确认替换布局与活动需求' })).toBeNull();
    expect(actions.restoreBackup).not.toHaveBeenCalled(); if (size) expect(read).not.toHaveBeenCalled();
  });

  it('keeps the 8 MiB ordinary backup limit while allowing V4 file inspection', async () => {
    const { actions } = setup(), text = fileText() + ' '.repeat(MAX_LOCAL_PROJECT_BACKUP_BYTES);
    const read = vi.fn().mockResolvedValue(text); select(file(text, read));
    expect((await screen.findByRole('alert')).textContent).toContain('8 MiB');
    expect(read).toHaveBeenCalledOnce(); expect(screen.queryByLabelText('备份预检')).toBeNull();
    expect(actions.restoreBackup).not.toHaveBeenCalled();
  });

  it('checks external model dependencies in a design snapshot without fetching or changing its unarchived URL', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const { actions } = setup();
    const url = 'http://127.0.0.1:9/review.glb?token=FAKE_REVIEW_ONLY';
    const target = { ...layout, designBook: { activeId: 'external', variants: [{ id: 'external', name: '外部方案',
      layout: makeLayout({ floors: [makeFloor({ items: [makeItem({ type: 'glb-asset', glbUrl: url })] })] }) }] } };
    select(file(fileText(target))); await screen.findByLabelText('备份预检');
    expect(screen.getByText(/文件或方案快照含未归档模型引用/)).toBeDefined();
    expect(fetch).not.toHaveBeenCalled(); expect(actions.restoreBackup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认替换布局与活动需求' }));
    await screen.findByRole('status');
    expect(vi.mocked(actions.restoreBackup).mock.calls[0][0].layout.designBook!.variants[0].layout.floors[0].items[0]).toMatchObject({ glbUrl: url });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('warns about unarchived relative model references on legacy item types and inside design snapshots without fetching', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const { actions } = setup();
    const target = { ...layout, designBook: { activeId: 'legacy', variants: [{ id: 'legacy', name: '旧物件方案',
      layout: makeLayout({ floors: [makeFloor({ items: [makeItem({ type: 'chair', glbUrl: './models/review.glb?token=FAKE_REVIEW_ONLY' })] })] }) }] } };
    select(file(JSON.stringify(target))); await screen.findByLabelText('备份预检');
    expect(screen.getByText(/文件或方案快照含未归档模型引用/)).toBeDefined();
    expect(fetch).not.toHaveBeenCalled(); expect(actions.restoreBackup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消恢复' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the latest selection when an older read finishes, and ignores an old rejection', async () => {
    setup(); const old = deferred<string>(); select(file('', () => old.promise));
    select(file(fileText({ ...layout, name: '最新文件' }))); await screen.findByText('最新文件');
    await act(async () => { old.resolve(fileText({ ...layout, name: '迟到文件' })); });
    expect(screen.queryByText('迟到文件')).toBeNull(); expect(screen.getByText('最新文件')).toBeDefined();
    const rejected = deferred<string>(); select(file('', () => rejected.promise));
    select(file(fileText({ ...layout, name: '最后文件' }))); await screen.findByText('最后文件');
    await act(async () => { rejected.reject(new Error('迟到错误')); });
    expect(screen.queryByText('迟到错误')).toBeNull();
  });

  it.each(['layout edit', 'brief edit', 'A→B→A'] as const)('discards a read after %s even when the scope returns', async change => {
    const { actions, view } = setup(); const read = deferred<string>(); select(file('', () => read.promise));
    if (change === 'A→B→A') {
      view.rerender(<LocalProjectBackupPanel layout={{ ...layout, id: 'backup-review-b' }} briefState={briefState} actions={actions}/>);
      view.rerender(<LocalProjectBackupPanel layout={layout} briefState={briefState} actions={actions}/>);
    } else view.rerender(<LocalProjectBackupPanel layout={change === 'layout edit' ? { ...layout, width: 10 } : layout}
      briefState={change === 'brief edit' ? { ...briefState, brief: { ...brief, description: '新编辑' } } : briefState} actions={actions}/>);
    await act(async () => { read.resolve(fileText()); });
    expect(screen.queryByLabelText('备份预检')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancels an in-flight read and ignores completion after unmount', async () => {
    const { view } = setup(); select(file(fileText())); await screen.findByText('A-文件布局');
    const read = deferred<string>(); select(file('', () => read.promise));
    fireEvent.click(screen.getByRole('button', { name: '取消恢复' }));
    await act(async () => { read.resolve(fileText()); }); expect(screen.queryByLabelText('备份预检')).toBeNull();
    const late = deferred<string>(); select(file('', () => late.promise)); view.unmount();
    await act(async () => { late.resolve(fileText()); }); expect(screen.queryByLabelText('备份预检')).toBeNull();
  });

  it('starts one download after preparation and reports only that the browser download was initiated', async () => {
    const pending = deferred<string>(); const { actions } = setup({ prepareBackup: vi.fn(() => pending.promise) });
    expect((screen.getByRole('checkbox', { name: '包含图纸、照片与对应点' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '下载场景与活动备份' }));
    fireEvent.click(screen.getByRole('button', { name: '正在准备备份…' })); expect(actions.prepareBackup).toHaveBeenCalledOnce();
    expect(actions.prepareBackup).toHaveBeenCalledWith();
    expect(downloadSceneDelivery).not.toHaveBeenCalled(); await act(async () => { pending.resolve(fileText()); });
    await waitFor(() => expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    expect(downloadSceneDelivery).toHaveBeenCalledWith(fileText(), 'application/json', expect.stringContaining('场景与活动备份'), 'json');
    expect(screen.getByRole('status').textContent).toContain('已发起');
  });

  it('includes source documents only when checked and explains the local privacy and size limits', async () => {
    const text = await sourceFileText(); const { actions } = setup({ prepareBackup: vi.fn().mockResolvedValue(text) });
    expect(screen.getByText(/普通备份.*8 MiB/)).toBeTruthy();
    expect(screen.getByText(/本机.*96 MiB.*客户资料/)).toBeTruthy();
    expect(screen.getByText(/不会下载云端图片.*后台识别任务/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '包含图纸、照片与对应点' }));
    fireEvent.click(screen.getByRole('button', { name: '下载场景与活动备份' }));
    await waitFor(() => expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    expect(actions.prepareBackup).toHaveBeenCalledWith({ includeSourceDocuments: true });
    expect(downloadSceneDelivery).toHaveBeenCalledWith(text, 'application/json', expect.stringContaining('场景与活动备份'), 'json');
  });

  it('resets source document inclusion when switching projects', () => {
    const { actions, view } = setup(); fireEvent.click(screen.getByRole('checkbox', { name: '包含图纸、照片与对应点' }));
    view.rerender(<LocalProjectBackupPanel layout={{ ...layout, id: 'backup-review-b' }} briefState={briefState} actions={actions}/>);
    expect((screen.getByRole('checkbox', { name: '包含图纸、照片与对应点' }) as HTMLInputElement).checked).toBe(false);
  });

  it.each(['prepare', 'download', 'changed baseline'] as const)('preserves the project when %s prevents a download', async reason => {
    const pending = deferred<string>(); const { actions, view } = setup({ prepareBackup: vi.fn(() => pending.promise) });
    if (reason === 'download') vi.mocked(downloadSceneDelivery).mockImplementationOnce(() => { throw new Error('下载被阻止'); });
    fireEvent.click(screen.getByRole('button', { name: '下载场景与活动备份' }));
    if (reason === 'changed baseline') view.rerender(<LocalProjectBackupPanel layout={{ ...layout, name: '新布局' }} actions={actions} briefState={briefState}/>);
    await act(async () => { if (reason === 'prepare') pending.reject(new Error('活动需求保存失败')); else pending.resolve(fileText()); });
    if (reason !== 'changed baseline') expect((await screen.findByRole('alert')).textContent).toContain(reason === 'prepare' ? '保存失败' : '下载被阻止');
    else expect(downloadSceneDelivery).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull(); expect(actions.restoreBackup).not.toHaveBeenCalled();
  });

  it('retains the checked candidate and accurate transaction error for retry, cancellation or replacement', async () => {
    const { actions } = setup({ restoreBackup: vi.fn().mockRejectedValueOnce(new Error('目标活动需求回滚失败，请保留原草稿。')).mockResolvedValue(undefined) });
    select(file(fileText())); await screen.findByText('A-文件布局');
    fireEvent.click(screen.getByRole('button', { name: '确认替换布局与活动需求' }));
    expect((await screen.findByRole('alert')).textContent).toContain('回滚失败');
    expect(screen.getByText('A-文件布局')).toBeDefined(); expect(screen.queryByRole('status')).toBeNull();
    expect((screen.getByLabelText('选择备份文件') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认替换布局与活动需求' }));
    await screen.findByRole('status'); expect(actions.restoreBackup).toHaveBeenCalledTimes(2);
  });

  it('uses the verified restore promise after its own layout change and exposes undo only while the provider permits it', async () => {
    const restore = deferred<void>(), undo = deferred<void>(); const { actions, view } = setup({ restoreBackup: vi.fn(() => restore.promise), undoRestore: vi.fn(() => undo.promise) });
    select(file(fileText())); await screen.findByText('A-文件布局');
    fireEvent.click(screen.getByRole('button', { name: '确认替换布局与活动需求' }));
    const restored = { ...layout, name: 'A-文件布局' };
    view.rerender(<LocalProjectBackupPanel layout={restored} actions={{ ...actions, canUndoRestore: true }} briefState={{ ...briefState, brief: { ...brief, description: 'A-文件恢复' } }}/>);
    await act(async () => { restore.resolve(); }); expect(screen.getByRole('status').textContent).toContain('已保存并核实');
    fireEvent.click(screen.getByRole('button', { name: '撤销本次恢复' })); fireEvent.click(screen.getByRole('button', { name: '正在撤销并核实保存…' }));
    expect(actions.undoRestore).toHaveBeenCalledOnce();
    await act(async () => { undo.reject(new Error('恢复后已有新编辑，不能撤销覆盖。')); });
    expect(screen.getByRole('alert').textContent).toContain('已有新编辑'); expect(screen.queryByRole('status')).toBeNull();
    view.rerender(<LocalProjectBackupPanel layout={restored} actions={actions} briefState={briefState}/>);
    expect(screen.queryByRole('button', { name: '撤销本次恢复' })).toBeNull();
  });

  it('disables changes during a provider transaction', async () => {
    const { actions, view } = setup(); select(file(fileText())); await screen.findByText('A-文件布局');
    view.rerender(<LocalProjectBackupPanel layout={layout} actions={{ ...actions, backupPending: true }} briefState={briefState}/>);
    for (const name of ['下载场景与活动备份', '确认替换布局与活动需求', '取消恢复']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('选择备份文件') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: '包含图纸、照片与对应点' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('reports undo completion only after the provider verifies the original saved layout and requirements', async () => {
    const pending = deferred<void>(); const { actions, view } = setup({ canUndoRestore: true, undoRestore: vi.fn(() => pending.promise) });
    fireEvent.click(screen.getByRole('button', { name: '撤销本次恢复' }));
    expect(screen.queryByRole('status')).toBeNull();
    view.rerender(<LocalProjectBackupPanel layout={{ ...layout, name: '原布局' }} briefState={{ ...briefState, brief: { ...brief } }} actions={{ ...actions, canUndoRestore: false }}/>);
    await act(async () => { pending.resolve(); });
    expect(screen.getByRole('status').textContent).toContain('原布局与活动需求已保存并核实');
    expect(screen.queryByRole('button', { name: '撤销本次恢复' })).toBeNull();
  });

  it.each(['restore', 'undo'] as const)('suppresses a canceled %s and its old candidate after a human switches project', async kind => {
    const pending = deferred<void>(), onComplete = vi.fn();
    const { actions, view } = setup({ restoreBackup: vi.fn(() => pending.promise), undoRestore: vi.fn(() => pending.promise), canUndoRestore: kind === 'undo' });
    view.rerender(<LocalProjectBackupPanel layout={layout} actions={actions} briefState={briefState} onComplete={onComplete}/>);
    if (kind === 'restore') { select(file(fileText())); await screen.findByText('A-文件布局'); }
    fireEvent.click(screen.getByRole('button', { name: kind === 'restore' ? '确认替换布局与活动需求' : '撤销本次恢复' }));
    view.rerender(<LocalProjectBackupPanel layout={{ ...layout, id: 'backup-review-b', name: 'B-原布局' }} actions={actions} briefState={briefState} onComplete={onComplete}/>);
    await act(async () => { pending.reject(new Error('A-项目已切换，旧恢复停止。')); });
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByLabelText('备份预检')).toBeNull(); expect(onComplete).not.toHaveBeenCalled();
  });

  it('returns to delivery only after successful restore and undo even when their own commits change scope', async () => {
    const restored = deferred<void>(), undone = deferred<void>(), onComplete = vi.fn();
    const { actions, view } = setup({ restoreBackup: vi.fn(() => restored.promise), undoRestore: vi.fn(() => undone.promise) });
    view.rerender(<LocalProjectBackupPanel layout={layout} actions={actions} briefState={briefState} onComplete={onComplete}/>);
    select(file(fileText({ ...layout, id: 'backup-review-b', name: 'B-文件布局' }))); await screen.findByText('B-文件布局');
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认替换布局与活动需求' }));
    view.rerender(<LocalProjectBackupPanel layout={{ ...layout, id: 'backup-review-b', name: 'B-文件布局' }} actions={{ ...actions, canUndoRestore: true }} briefState={briefState} onComplete={onComplete}/>);
    expect(onComplete).not.toHaveBeenCalled(); await act(async () => { restored.resolve(); }); expect(onComplete).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '撤销本次恢复' }));
    view.rerender(<LocalProjectBackupPanel layout={layout} actions={actions} briefState={briefState} onComplete={onComplete}/>);
    expect(onComplete).toHaveBeenCalledOnce(); await act(async () => { undone.resolve(); }); expect(onComplete).toHaveBeenCalledTimes(2);
  });
});
