// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig, type BackendSnapshot, type Scene, type SceneProposal } from '@/lib/backend-session';
import { backendSceneToLayout, createMeasuredRoomLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { CreativeAssistant, CreativeBriefPanel, CreativeStudioProvider } from './creative-studio';
import type { RoomLayout } from '../lib/types';

vi.mock('../contexts', () => ({ useSelection: () => ({ allSelectedIds: new Set<string>(), selectedItem: null }) }));

const projectId = '10000000-0000-4000-8000-000000000001';
const scene: Scene = {
  schemaVersion: 1,
  venue: { width: 12, depth: 10, height: 3, shape: 'rectangle', entrances: [] },
  objects: [], camera: 'overview', lighting: 'warm',
};
const candidate: Scene = {
  ...scene,
  objects: [{ id: '20000000-0000-4000-8000-000000000001', materialId: 'chair', position: { x: 3, z: 4 }, rotation: 0, size: { width: 0.5, depth: 0.5, height: 0.9 }, color: '#ddc8a2', locked: false, notes: '' }],
};
const proposal: SceneProposal = {
  id: '30000000-0000-4000-8000-000000000001', project_id: projectId, session_id: '40000000-0000-4000-8000-000000000001', user_id: 'test-user',
  generation: 1, base_revision: 1, local_revision: 0, base_hash: 'a'.repeat(64), base_scene: scene, candidate,
  expires_at: '2099-01-01T00:00:00Z', applied_at: null, explanation: '增加一把椅子，保留中心通道。', warnings: [],
};
let controller: BackendSession;
let snapshot: BackendSnapshot;
let layout: RoomLayout;
const onApply = vi.fn<(next: RoomLayout) => void>();
const onPreview = vi.fn<(next: RoomLayout | null) => void>();
const createBitmap = vi.fn();
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
const forbiddenFetch = vi.fn(() => { throw new Error('This UI test must never access the network.'); });
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

function restoreProperty(object: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(object, key, descriptor);
  else Reflect.deleteProperty(object, key);
}

function ui(current = layout) {
  return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply} onPreview={onPreview}>
    <CreativeBriefPanel/><CreativeAssistant/>
  </CreativeStudioProvider>;
}

function connected(): void {
  Object.assign(snapshot, {
    configured: true, user: { id: 'test-user' }, writeBlocked: false, status: 'editing', revision: 1,
    project: { id: projectId, studio_id: 'studio-test', name: '客户方案', revision: 1, scene },
  });
}

function enterBrief(): void {
  fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '给 24 位来宾布置一个交流会，保留中心通道。' } });
}

async function generatePreview(): Promise<void> {
  enterBrief();
  fireEvent.click(screen.getByRole('button', { name: 'Generate 生成布置方案' }));
  await screen.findByText('方案提案 · 尚未应用');
}

function upload(container: HTMLElement, files: File[]): void {
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  onApply.mockReset();
  onPreview.mockReset();
  forbiddenFetch.mockClear();
  vi.stubGlobal('fetch', forbiddenFetch);
  createBitmap.mockReset().mockImplementation(async () => ({ width: 1024, height: 768, close: vi.fn() }));
  createObjectURL.mockReset().mockReturnValue('blob:local-reference');
  revokeObjectURL.mockReset();
  vi.stubGlobal('createImageBitmap', createBitmap);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  snapshot = { ...controller.getSnapshot() };
  vi.spyOn(controller, 'getSnapshot').mockImplementation(() => snapshot);
  vi.spyOn(controller, 'requestProposal').mockResolvedValue(proposal);
  vi.spyOn(controller, 'authorizeAssets').mockResolvedValue({ assetUrls: {}, assetNames: {} });
  vi.spyOn(controller, 'applySceneProposal').mockResolvedValue({ id: projectId, revision: 2, scene: candidate, previousScene: scene, updatedAt: '2026-10-02T10:00:00Z', undoGroup: 'undo-test', acceptedLocally: true });
  layout = backendSceneToLayout(scene, { projectId, name: '客户方案' });
});

afterEach(() => {
  cleanup();
  controller.dispose();
  vi.useRealTimers();
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreProperty(URL, 'createObjectURL', originalCreateObjectURL);
  restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
  restoreProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
});

describe('creative brief and assistant interaction', () => {
  it('renders only the reconstruction Generate action for an existing v2 scene',async()=>{
    render(ui(createMeasuredRoomLayout(layout,{width:12,depth:10,height:3})));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Generate 重建并设计方案'}).hasAttribute('disabled')).toBe(false));
    expect(screen.queryByRole('button',{name:'Generate 生成布置方案'})).toBeNull();
    expect(screen.queryByText('Generate 生成布置方案')).toBeNull();
  });

  it('requires an explicit decision before generating with a missing round table', async () => {
    connected();
    render(ui());
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '需要圆桌和椅子，安排24人交流会' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate 生成布置方案' }));
    expect(controller.requestProposal).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: '圆桌的处理方式' }), { target: { value: 'table' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /已核对以上选择/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate 生成布置方案' }));
    await screen.findByText('方案提案 · 尚未应用');
    expect(controller.requestProposal).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('用户明确同意将「圆桌」改用「桌子」') }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not send missing-asset chat requests as if they were supported', () => {
    connected();
    render(ui());
    fireEvent.click(screen.getByRole('button', { name: '打开幕景助手' }));
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '加入帐篷' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(controller.requestProposal).not.toHaveBeenCalled();
    expect(screen.getAllByText(/这条消息包含当前物料目录缺项/).length).toBeGreaterThan(0);
  });

  it('moves keyboard focus into the assistant and returns it on Escape', () => {
    render(ui());
    const launch = screen.getByRole('button', { name: '打开幕景助手' });
    fireEvent.click(launch);
    const input = screen.getByRole('textbox', { name: '告诉助手你的想法' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '幕景智能助手' })).toBeNull();
    expect(document.activeElement).toBe(launch);
  });

  it('explains the missing AI connection offline without fabricating a proposal or changing the scene', async () => {
    render(ui());
    expect(screen.getByRole('button', { name: 'Generate 生成布置方案' }).hasAttribute('disabled')).toBe(true);
    enterBrief();
    fireEvent.click(screen.getByRole('button', { name: 'Generate 生成布置方案' }));
    expect(await screen.findByRole('region', { name: '幕景智能助手' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('当前尚未连接 AI 服务');
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
    expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull();
    expect(controller.requestProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows local reference images, tells users they are not sent to the model, and releases their URLs', async () => {
    const rendered = render(ui());
    const file = new File(['image fixture'], 'venue.png', { type: 'image/png' });
    upload(rendered.container, [file]);
    const image = await screen.findByRole('img', { name: '现场照片：venue.png' });
    expect(screen.queryByRole('button',{name:'Generate 生成布置方案'})).toBeNull();
    expect(screen.queryByText('Generate 生成布置方案')).toBeNull();
    expect(image.getAttribute('src')).toBe('blob:local-reference');
    expect(screen.getByText(/图片保存在本机；连接项目并生成时会上传至私有存储/)).toBeTruthy();
    expect(controller.requestProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除 venue.png' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-reference');
    upload(rendered.container, [file]);
    await screen.findByRole('img', { name: '现场照片：venue.png' });
    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unsupported format', () => new File(['vector'], 'venue.svg', { type: 'image/svg+xml' }), '请选择 PNG、JPEG 或 WebP 图片。'],
    ['oversized file', () => new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'venue.png', { type: 'image/png' }), '每张图片不能超过 5 MB。'],
  ])('rejects %s before creating a preview or decoding', async (_case, file, message) => {
    const rendered = render(ui());
    upload(rendered.container, [file()]);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(createBitmap).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('closes an oversized decoded bitmap and does not create a preview URL', async () => {
    const close = vi.fn();
    createBitmap.mockResolvedValueOnce({ width: 5000, height: 768, close });
    const rendered = render(ui());
    upload(rendered.container, [new File(['image'], 'wide.png', { type: 'image/png' })]);
    expect(await screen.findByText('图片长宽请控制在 4096 像素以内。')).toBeTruthy();
    expect(close).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('presents the actual proposal for confirmation and applies only after the confirmation request succeeds', async () => {
    connected();
    render(ui());
    await generatePreview();
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: projectId }));
    expect(controller.requestProposal).toHaveBeenCalledWith(expect.objectContaining({ mode: 'layout', scene: layoutToBackendScene(layout), prompt: expect.stringContaining('给 24 位来宾') }));
    expect(onApply).not.toHaveBeenCalled();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认应用' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0]![0].designBook?.variants.map(v => v.name)).toEqual(['原始方案', 'AI 方案 A']);
    expect(controller.applySceneProposal).toHaveBeenCalledWith(proposal, layoutToBackendScene(layout));
    expect(layoutToBackendScene(onApply.mock.calls[0][0])).toEqual(candidate);
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
  });

  it.each(['scene', 'brief', 'lease'] as const)('removes the apply action when the %s changes after a preview', async change => {
    connected();
    const rendered = render(ui());
    await generatePreview();
    if (change === 'scene') rendered.rerender(ui({ ...layout, width: 13 }));
    if (change === 'brief') fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '改成 12 人工作坊。' } });
    if (change === 'lease') {
      snapshot = { ...snapshot, writeBlocked: true };
      rendered.rerender(ui());
    }
    expect(await screen.findByText('场景、需求或编辑权已变化，请重新生成。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('preserves the canvas when the controller reports acceptedLocally false', async () => {
    connected();
    vi.mocked(controller.applySceneProposal).mockResolvedValueOnce({ id: projectId, revision: 2, scene: candidate, previousScene: scene, updatedAt: '2026-10-02T10:00:00Z', undoGroup: 'undo-test', acceptedLocally: false });
    render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '确认应用' }));
    expect(await screen.findByText(/应用期间本地有新修改，已保留本地草稿/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText('提案已应用。你可以继续调整，或用撤销返回应用前的本地方案。')).toBeNull();
  });

  it('discards a pending generation result if the scene changes before its response arrives', async () => {
    connected();
    let finish!: (value: SceneProposal) => void;
    vi.mocked(controller.requestProposal).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const rendered = render(ui());
    enterBrief();
    fireEvent.click(screen.getByRole('button', { name: 'Generate 生成布置方案' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    rendered.rerender(ui({ ...layout, width: 13 }));
    await act(async () => { finish(proposal); });
    expect(screen.getByRole('status').textContent).toContain('生成期间方案或需求已变化');
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('automatically clears the canvas preview at expiration without waiting for a confirm click', async () => {
    connected();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
    vi.mocked(controller.requestProposal).mockResolvedValueOnce({ ...proposal, expires_at: '2026-10-02T10:00:02Z' });
    render(ui());
    enterBrief();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate 生成布置方案' })); });
    expect(screen.getByRole('button', { name: '确认应用' })).toBeTruthy();
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: projectId }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('提案已过期，请重新生成。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('clears the render-only preview when discarded or when its provider unmounts', async () => {
    connected();
    const rendered = render(ui());
    await generatePreview();
    expect(onPreview.mock.calls.at(-1)?.[0]).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onApply).not.toHaveBeenCalled();
    await generatePreview();
    expect(onPreview.mock.calls.at(-1)?.[0]).not.toBeNull();
    rendered.unmount();
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('lists individual overlap and boundary warnings against named objects', async () => {
    connected();
    vi.mocked(controller.requestProposal).mockResolvedValueOnce({ ...proposal, warnings: [
      { code: 'OVERLAP', ids: [candidate.objects[0].id] },
      { code: 'OUT_OF_BOUNDS', ids: [candidate.objects[0].id] },
    ] });
    render(ui());
    await generatePreview();
    expect(screen.getByText('物件重叠：椅子')).toBeTruthy();
    expect(screen.getByText('超出场地边界：椅子')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });
});


describe('context continuity and project isolation', () => {
  it('carries confirmed venue and design requirements into successive assistant requests', async () => {
    connected(); render(ui()); enterBrief();
    fireEvent.change(screen.getByRole('textbox',{name:'已确认的现场条件'}),{target:{value:'北侧入口不得遮挡'}});
    fireEvent.change(screen.getByRole('textbox',{name:'风格要求'}),{target:{value:'简约现代'}});
    fireEvent.change(screen.getByRole('textbox',{name:'配色要求'}),{target:{value:'米白橄榄绿'}});
    fireEvent.change(screen.getByRole('textbox',{name:'氛围要求'}),{target:{value:'温暖聚会'}});
    fireEvent.click(screen.getByRole('button',{name:'打开幕景助手'}));
    const send=async(text:string)=>{
      fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:text}});
      fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
      await waitFor(()=>expect(screen.getByRole('button',{name:'确认应用'})).toBeTruthy());
    };
    await send('把交流区靠近入口');
    fireEvent.click(screen.getByRole('button',{name:'放弃'}));
    await send('再留宽一点');
    const prompt=vi.mocked(controller.requestProposal).mock.calls[1]![0].prompt;
    for(const text of ['北侧入口不得遮挡','简约现代','米白橄榄绿','温暖聚会','把交流区靠近入口','再留宽一点',proposal.explanation]) expect(prompt).toContain(text);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('clears old brief and conversation on project switch and ignores an old in-flight response', async () => {
    connected(); const rendered=render(ui()); enterBrief();
    let finish!:(value:SceneProposal)=>void;
    vi.mocked(controller.requestProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    fireEvent.click(screen.getByRole('button',{name:'Generate 生成布置方案'}));
    await waitFor(()=>expect(controller.requestProposal).toHaveBeenCalledOnce());
    const changed={...layout,id:'10000000-0000-4000-8000-000000000002'};
    rendered.rerender(ui(changed));
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('');
    await act(async()=>{finish(proposal);});
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
    expect(screen.queryByText(proposal.explanation)).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
});
