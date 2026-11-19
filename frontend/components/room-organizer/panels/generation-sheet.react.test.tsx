// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, SceneApiError, getBackendConfig, type GenerationJob } from '@/lib/backend-session';
import { GenerationSheetHost } from './generation-sheet';
import { closeGenerationSheet, openGenerationSheet, resetGenerationSheetForTests } from '../lib/generation-sheet';
import { clearGeneratedFacilityModelsForTests, consumeFacilityGenerateLink } from '../lib/facility-generated-models';
import { clearStagedMaterialGenerateForTests, stageMaterialGenerate } from '../lib/material-generate';
import { setAgentSupervision } from '../lib/agent-supervision-store';

/**
 * 面板的两件事：① 来路决定标题与首层；② 模型这条是真提交（额度确认是提交前的闸门）。
 * 创作来路在同一页两张卡片上提交文生 / 图生，不再打开第二层窗口。重建只做本地预览。
 */
const job: GenerationJob = {
  id: 'task-1', owner_id: 'member', prompt: '一把沙滩椅', state: 'queued', asset_id: null,
  provider_job_id: null, next_poll_at: '2026-11-16T00:00:00Z', attempts: 0, error_code: null,
  provider_usage: null, created_at: '2026-11-16T00:00:00Z', updated_at: '2026-11-16T00:00:00Z',
};

let controller: BackendSession;
let create: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetGenerationSheetForTests();
  clearStagedMaterialGenerateForTests();
  sessionStorage.clear();
  localStorage.clear();
  clearGeneratedFacilityModelsForTests();
  controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  vi.spyOn(controller, 'getSnapshot').mockReturnValue({
    ...controller.getSnapshot(),
    user: { id: 'member' },
    project: { id: 'project' } as NonNullable<ReturnType<BackendSession['getSnapshot']>['project']>,
    writeBlocked: false,
  } as ReturnType<BackendSession['getSnapshot']>);
  Object.assign(controller, {
    getGenerationCapabilities: vi.fn().mockResolvedValue({
      model: 'hy-3d-3.0', textToModel: true, imageToModel: true,
      texture: false, textureRequiresImage: true, aholoTextToModel: false, aholoImageToModel: false,
    }),
    uploadGenerationReference: vi.fn().mockResolvedValue({ id: 'ref-1' }),
  });
  vi.spyOn(controller, 'listGenerationJobs').mockResolvedValue([]);
  create = vi.fn().mockResolvedValue(job);
  Object.assign(controller, { createGenerationJob: create });
});

afterEach(() => { cleanup(); controller.dispose(); vi.restoreAllMocks(); });

describe('统一生成面板', () => {
  it('创作入口：同一页两张卡片，文生和图生在卡片上切换，不打开第二层窗口', () => {
    const onOpenCapture = vi.fn();
    render(<GenerationSheetHost controller={controller} onOpenCapture={onOpenCapture} />);
    expect(screen.queryByTestId('generation-sheet')).toBeNull();

    act(() => openGenerationSheet({ scope: 'venue' }));
    expect(screen.queryByText('你想做什么？')).toBeNull();
    expect(screen.queryByText('生成新场景')).toBeNull();
    expect(screen.queryByText('暂未开放')).toBeNull();
    expect(screen.queryByText('一座带檐的小亭，暖白墙面')).toBeNull();
    expect(screen.queryByRole('button', { name: '导入' })).toBeNull();
    expect(screen.queryByRole('button', { name: '开始创作' })).toBeNull();
    expect(screen.queryByRole('button', { name: /返回/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    expect(screen.queryByTestId('generation-primary')).toBeNull();
    expect(screen.queryByText('保存到「我的生成」')).toBeNull();
    expect(screen.queryByText('文字生成 3D 模型')).toBeNull();
    expect(screen.queryByText('图片生成 3D 模型')).toBeNull();
    expect(screen.getByRole('complementary', { name: '创作' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '重建真实场地' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '生成 3D 模型' })).toBeTruthy();
    expect(screen.getByText('实地重建')).toBeTruthy();
    expect(screen.getByText('生成 3D')).toBeTruthy();
    expect(screen.getByText('拍摄现场，或上传已有的照片、视频。')).toBeTruthy();
    expect(screen.getByText('描述一件要放进场地的物件。')).toBeTruthy();
    expect(screen.queryByText('上传一张参考图，生成可布置的模型。')).toBeNull();
    expect(screen.getByText('完成后进入空间')).toBeTruthy();
    expect(screen.getByText('完成后放进物料')).toBeTruthy();
    expect(screen.getByText('重建后在这里预览')).toBeTruthy();
    expect(screen.getByText('现场照片或视频都可以')).toBeTruthy();
    const textMode = screen.getByRole('button', { name: '文生 3D' });
    const imageMode = screen.getByRole('button', { name: '图生 3D' });
    expect(textMode.getAttribute('aria-pressed')).toBe('true');
    expect(textMode.textContent?.replace(/\s/g, '')).toBe('T文生3D');
    expect(imageMode.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('textbox', { name: '描述' })).toBeTruthy();
    expect(screen.getByPlaceholderText('一句话描述物件，如：一把户外折叠椅')).toBeTruthy();
    expect(screen.queryByTestId('creation-image-drop')).toBeNull();
    expect((screen.getByLabelText(/消耗额度/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('creation-generate') as HTMLButtonElement).disabled).toBe(true);
    expect(onOpenCapture).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(imageMode);
    expect(screen.getByRole('complementary', { name: '创作' })).toBeTruthy();
    expect(screen.getByText('上传一张参考图，生成可布置的模型。')).toBeTruthy();
    expect(screen.queryByText('描述一件要放进场地的物件。')).toBeNull();
    expect(screen.queryByRole('textbox', { name: '描述' })).toBeNull();
    expect(screen.getByTestId('creation-image-drop').textContent).toContain('选一张参考图，或拖进来');
    expect(screen.getByTestId('creation-image-drop').textContent).toContain('照片即可，主体清楚');
    expect(screen.queryByText('补充描述')).toBeNull();
    expect(screen.queryByRole('button', { name: /返回/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    expect(screen.queryByTestId('generation-primary')).toBeNull();
    expect(imageMode.getAttribute('aria-pressed')).toBe('true');
    expect(textMode.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(textMode);
    expect(screen.getByRole('textbox', { name: '描述' })).toBeTruthy();
    expect(screen.queryByTestId('creation-image-drop')).toBeNull();
    expect(screen.getByRole('complementary', { name: '创作' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭生成面板' }));
    expect(screen.queryByTestId('generation-sheet')).toBeNull();
  });

  it('创作来路即使被标成模型任务，也不打开第二层窗口', () => {
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'venue', source: 'image' }));
    expect(screen.getByRole('complementary', { name: '创作' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '生成 3D 模型' })).toBeTruthy();
    expect(screen.getByTestId('creation-image-drop')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /返回/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    expect(screen.queryByTestId('generation-primary')).toBeNull();
    expect(screen.queryByText('保存到「我的生成」')).toBeNull();
  });

  it('文生在卡片上提交，结果去我的生成，不离开创作面板', async () => {
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ scope: 'venue' }));
    await waitFor(() => expect(screen.queryByText(/正在读取可用的生成模型/)).toBeNull());
    fireEvent.change(screen.getByRole('textbox', { name: '描述' }), { target: { value: '一把户外折叠椅' } });
    expect((screen.getByTestId('creation-generate') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('creation-generate'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toBe('一把户外折叠椅');
    expect(create.mock.calls[0]![2]).toEqual({ kind: 'text' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('我的生成'));
    expect(screen.getByRole('complementary', { name: '创作' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /返回/ })).toBeNull();
    expect(screen.queryByTestId('generation-primary')).toBeNull();
    expect(screen.getByText('完成后放进物料')).toBeTruthy();
  });

  it('重建卡：拍摄和上传是同一个口，选中后在预览台显出', () => {
    const previousCreate = URL.createObjectURL;
    const previousRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => `blob:${(blob as File).name || 'media'}`) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    const asList = (files: File[]): FileList => {
      const list = {
        length: files.length,
        item: (index: number) => files[index] ?? null,
        *[Symbol.iterator]() { yield* files; },
      } as FileList;
      files.forEach((file, index) => { Object.defineProperty(list, index, { value: file }); });
      return list;
    };
    try {
      render(<GenerationSheetHost controller={controller} />);
      act(() => openGenerationSheet({ scope: 'venue' }));
      const shoot = screen.getByLabelText('拍摄现场') as HTMLInputElement;
      const upload = screen.getByLabelText('上传照片或视频') as HTMLInputElement;
      expect(shoot.getAttribute('capture')).toBe('environment');
      expect(shoot.multiple).toBe(true);
      expect(upload.multiple).toBe(true);
      expect(upload.hasAttribute('capture')).toBe(false);
      expect(shoot.accept).toBe(upload.accept);
      for (const token of ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.m4v', '.mov', '.qt', '.insv', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime']) {
        expect(shoot.accept).toContain(token);
      }
      expect(screen.getByText('完成后进入空间')).toBeTruthy();
      expect(screen.getByTestId('creation-entry').textContent).not.toMatch(/Insta360|insta360|云盘|至少 ?20/);

      const png = new File(['png'], 'hall.png', { type: 'image/png' });
      Object.defineProperty(upload, 'files', { configurable: true, value: asList([png]) });
      fireEvent.change(upload);
      expect(screen.getByRole('img', { name: 'hall.png' }).getAttribute('src')).toBe('blob:hall.png');

      const insv = new File(['i'], 'spin.insv', { type: 'application/octet-stream' });
      const clip = new File(['v'], 'walk.mp4', { type: 'video/mp4' });
      Object.defineProperty(shoot, 'files', { configurable: true, value: asList([insv, clip]) });
      fireEvent.change(shoot);
      const stage = screen.getByTestId('creation-recon-stage');
      expect(stage.querySelector('video')?.getAttribute('src')).toBe('blob:walk.mp4');
      expect(stage.textContent).toContain('已选 2 个');
      expect(screen.queryByRole('img', { name: 'hall.png' })).toBeNull();

      const pdf = new File(['%'], 'notes.pdf', { type: 'application/pdf' });
      Object.defineProperty(upload, 'files', { configurable: true, value: asList([pdf]) });
      fireEvent.change(upload);
      expect(screen.getByRole('status').textContent).toContain('请选择照片或视频');
      expect(stage.querySelector('video')).toBeNull();
      expect(create).not.toHaveBeenCalled();
    } finally {
      URL.createObjectURL = previousCreate;
      URL.revokeObjectURL = previousRevoke;
    }
  });

  it('自主权限：自动档也必须在属性卡单独确认额度才创建付费任务', async () => {
    setAgentSupervision('auto');
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'facility', facility: { id: 'f-1', name: '沙滩椅' } }));

    expect(screen.getByRole('complementary', { name: '生成模型' })).toBeTruthy();
    expect(screen.getByTestId('generation-target').textContent).toContain('用于「沙滩椅」');

    fireEvent.change(screen.getByPlaceholderText('沙滩椅（材质、颜色、尺寸都写上）'), { target: { value: '一把沙滩椅' } });
    // 能力表读完才能提交：读的过程中点主按钮只会说「正在读取」。
    await waitFor(() => expect(screen.queryByText(/正在读取可用的生成模型/)).toBeNull());
    // 未勾额度时主按钮就是灰的，不弹任何提示句。
    expect((screen.getByTestId('generation-primary') as HTMLButtonElement).disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/消耗额度/));
    expect((screen.getByTestId('generation-primary') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('generation-primary'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    // HY-3D 是服务端默认通道：不带 provider，kind 是 text。
    expect(create.mock.calls[0]![0]).toBe('一把沙滩椅');
    expect(create.mock.calls[0]![2]).toEqual({ kind: 'text' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('回填到「沙滩椅」'));
  });

  it('物料星入口：标题「生成物料」，目标是模型库；导入不出现额度确认', () => {
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'material' }));

    expect(screen.getByRole('complementary', { name: '生成物料' })).toBeTruthy();
    expect(screen.getByTestId('generation-target').textContent).toContain('保存到「我的生成」');

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    expect(screen.getByTestId('generation-primary').textContent).toBe('导入');
    expect(screen.queryByLabelText(/消耗额度/)).toBeNull();
  });

  it('活动对话点名生成物料：原话直接带进面板，不再弹旧的物料星菜单', () => {
    render(<GenerationSheetHost controller={controller} />);
    act(() => stageMaterialGenerate({ kind: 'text', prompt: '一把藤编躺椅' }));
    expect(screen.getByRole('complementary', { name: '生成物料' })).toBeTruthy();
    expect((screen.getByPlaceholderText('一句话描述物件，如：一把户外折叠椅') as HTMLTextAreaElement).value).toBe('一把藤编躺椅');
  });

  it('没登录云项目时主按钮禁用，原因写在面板里', () => {
    render(<GenerationSheetHost />);
    act(() => openGenerationSheet({ task: 'model', scope: 'material' }));
    fireEvent.change(screen.getByPlaceholderText('一句话描述物件，如：一把户外折叠椅'), { target: { value: '折叠椅' } });
    expect((screen.getByLabelText(/消耗额度/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    const primary = screen.getByTestId('generation-primary') as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.title).toContain('登录云项目');
    expect(screen.getByTestId('generation-block-reason').textContent).toContain('登录云项目后即可生成模型。');
    expect(screen.getByText('登录云项目后即可生成模型。')).toBeTruthy();
  });

  it('能力表读失败时，禁用原因写在面板里', async () => {
    Object.assign(controller, {
      getGenerationCapabilities: vi.fn().mockRejectedValue(new Error('offline')),
    });
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'material' }));
    fireEvent.change(screen.getByPlaceholderText('一句话描述物件，如：一把户外折叠椅'), { target: { value: '折叠椅' } });
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    const reason = await screen.findByText('暂时连不上云端，没读到可用的生成模型。');
    expect(reason).toBe(screen.getByTestId('generation-block-reason'));
    const primary = screen.getByTestId('generation-primary') as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.title).toContain('暂时连不上云端');
    expect(create).not.toHaveBeenCalled();
  });

  it('没有可用服务商时，勾了额度主按钮仍禁用，原因写在面板里', async () => {
    Object.assign(controller, {
      getGenerationCapabilities: vi.fn().mockResolvedValue({
        model: '', textToModel: false, imageToModel: false,
        texture: false, textureRequiresImage: true, aholoTextToModel: false, aholoImageToModel: false,
      }),
    });
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'material' }));
    fireEvent.change(screen.getByPlaceholderText('一句话描述物件，如：一把户外折叠椅'), { target: { value: '折叠椅' } });
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    const reason = await screen.findByText('生成能力尚未连接服务商。在设置里填入自定义服务商地址和密钥后即可开始。');
    expect(reason).toBe(screen.getByTestId('generation-block-reason'));
    const primary = screen.getByTestId('generation-primary') as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.title).toContain('尚未连接服务商');
    expect(create).not.toHaveBeenCalled();
  });

  it('成功提交：显示任务号，回执与链接都带 projectId，重开面板仍可核对', async () => {
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'facility', facility: { id: 'f-1', name: '沙滩椅' } }));
    fireEvent.change(screen.getByPlaceholderText('沙滩椅（材质、颜色、尺寸都写上）'), { target: { value: '一把沙滩椅' } });
    await waitFor(() => expect((screen.getByTestId('generation-primary') as HTMLButtonElement).title).toBe(''));
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('generation-primary'));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('任务号 task-1'));
    expect(screen.getByTestId('generation-receipt').textContent).toContain('task-1');

    const requestId = create.mock.calls[0]![1] as string;
    expect(JSON.parse(localStorage.getItem('scendance:generation-submissions')!)[0]).toMatchObject({
      requestId, state: 'submitted', taskid: 'task-1', projectId: 'project', facilityId: 'f-1',
    });
    expect(JSON.parse(localStorage.getItem('scendance:facility-generate-links')!)[0]).toMatchObject({
      taskid: 'task-1', projectId: 'project', facilityId: 'f-1',
    });

    // 重开面板：临时提示被清掉，但回执（taskid + requestId）仍在，刷新后同样可核对。
    act(() => closeGenerationSheet());
    act(() => openGenerationSheet({ task: 'model', scope: 'facility', facility: { id: 'f-1', name: '沙滩椅' } }));
    expect(screen.getByTestId('generation-receipt').textContent).toContain('task-1');
    expect(screen.getByTestId('generation-receipt').textContent).toContain(requestId);
  });

  it('网络中断：进入 unknown 锁，禁止二次提交，重开仍提醒先查记录', async () => {
    create.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'facility', facility: { id: 'f-1', name: '沙滩椅' } }));
    fireEvent.change(screen.getByPlaceholderText('沙滩椅（材质、颜色、尺寸都写上）'), { target: { value: '一把沙滩椅' } });
    await waitFor(() => expect((screen.getByTestId('generation-primary') as HTMLButtonElement).title).toBe(''));
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('generation-primary'));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('不重试'));
    expect(screen.getByRole('status').textContent).toContain('先查任务记录与费用');
    const primary = screen.getByTestId('generation-primary') as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.title).toContain('先查任务记录与费用');
    fireEvent.click(primary);
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('generation-receipt').textContent).toContain('上次提交结果未知');

    // 失败清 staged：之后的生成不会被错挂到沙滩椅。
    expect(consumeFacilityGenerateLink('later-task', 'x')).toBe(false);
    expect(JSON.parse(localStorage.getItem('scendance:generation-submissions')!)[0]).toMatchObject({
      state: 'unknown', projectId: 'project', facilityId: 'f-1',
    });

    // 模拟刷新：卸载重开后锁从持久化回执读回，不给人第二次点击的机会。
    cleanup();
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'facility', facility: { id: 'f-1', name: '沙滩椅' } }));
    expect((screen.getByTestId('generation-primary') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('generation-receipt').textContent).toContain('先查任务记录与费用');
  });

  it('服务端明确拒绝：落 failed 回执、清 staged，但不产生 unknown 锁', async () => {
    create.mockRejectedValueOnce(new SceneApiError('BUDGET_EXCEEDED', 402, null));
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'facility', facility: { id: 'f-1', name: '沙滩椅' } }));
    fireEvent.change(screen.getByPlaceholderText('沙滩椅（材质、颜色、尺寸都写上）'), { target: { value: '一把沙滩椅' } });
    await waitFor(() => expect((screen.getByTestId('generation-primary') as HTMLButtonElement).title).toBe(''));
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('generation-primary'));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('预算'));
    expect(consumeFacilityGenerateLink('later-task', 'x')).toBe(false);
    // 明确拒绝后额度勾选被清掉，主按钮先灰着；不是未知锁，重新勾上仍能再提交。
    expect((screen.getByLabelText(/消耗额度/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('generation-primary') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/上次提交结果未知/)).toBeNull();
    fireEvent.click(screen.getByTestId('generation-again'));
    expect(create).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/消耗额度/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    expect((screen.getByTestId('generation-primary') as HTMLButtonElement).disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem('scendance:generation-submissions')!)[0]).toMatchObject({
      state: 'failed', projectId: 'project', facilityId: 'f-1',
    });
  });

  it('只读项目把禁用原因写在面板里，不只挂在按钮 title 上', async () => {
    vi.spyOn(controller, 'getSnapshot').mockReturnValue({
      ...controller.getSnapshot(),
      user: { id: 'member' },
      project: { id: 'project' } as NonNullable<ReturnType<BackendSession['getSnapshot']>['project']>,
      writeBlocked: true,
    } as ReturnType<BackendSession['getSnapshot']>);
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'material' }));
    fireEvent.change(screen.getByPlaceholderText('一句话描述物件，如：一把户外折叠椅'), { target: { value: '折叠椅' } });
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    const reason = await screen.findByText('当前项目是只读状态，拿到编辑权后才能生成。');
    expect(reason).toBe(screen.getByTestId('generation-block-reason'));
    const primary = screen.getByTestId('generation-primary') as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.title).toContain('只读');
    expect(create).not.toHaveBeenCalled();
  });

  it('图生没有参考图时不提交；文生没有描述时也不提交', async () => {
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ scope: 'venue' }));
    fireEvent.click(screen.getByRole('button', { name: '图生 3D' }));
    await waitFor(() => expect(screen.queryByText(/正在读取可用的生成模型/)).toBeNull());
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('creation-generate'));
    expect(screen.getByRole('status').textContent).toContain('先选一张参考图');
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /返回/ })).toBeNull();
    expect(screen.queryByTestId('generation-primary')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '文生 3D' }));
    fireEvent.change(screen.getByRole('textbox', { name: '描述' }), { target: { value: '' } });
    const credit = screen.getByLabelText(/消耗额度/) as HTMLInputElement;
    if (!credit.checked) fireEvent.click(credit);
    fireEvent.click(screen.getByTestId('creation-generate'));
    expect(screen.getByRole('status').textContent).toContain('先写一句描述');
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: '创作' })).toBeTruthy();
  });

  it('图生把参考图拖进卡片后，用原有图片任务提交到我的生成', async () => {
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ scope: 'venue' }));
    fireEvent.click(screen.getByRole('button', { name: '图生 3D' }));
    await waitFor(() => expect(screen.queryByText(/正在读取可用的生成模型/)).toBeNull());
    const file = new File(['img'], 'folding-chair.png', { type: 'image/png' });
    fireEvent.drop(screen.getByTestId('creation-image-drop'), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('creation-image-drop').textContent).toContain('已上传'));
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('creation-generate'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toBe('folding-chair');
    expect(create.mock.calls[0]![2]).toEqual({ kind: 'image', referenceImageAssetId: 'ref-1' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('我的生成'));
    expect(screen.getByRole('complementary', { name: '创作' })).toBeTruthy();
    expect(screen.queryByTestId('generation-primary')).toBeNull();
  });

  it('创作去向标签是浅底，选中分段是纸白，近黑只留给生成和拍摄', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'generation-sheet.css'), 'utf8');
    const chip = css.slice(css.indexOf('.sc-generation-card .gs-create-chip {'), css.indexOf('.sc-generation-card .gs-create-stage {'));
    expect(chip).toContain('background: #F4F5F7');
    expect(chip).not.toMatch(/#4a7c59|#35624a|#eef3ef|#3c6a4d/i);
    const selected = css.slice(css.indexOf(".gs-create-switch button[aria-pressed='true']"), css.indexOf('.gs-create-t'));
    expect(selected).toContain('background: #fff');
    expect(selected).not.toContain('background: #141416');
    expect(selected).not.toMatch(/#4a7c59|#35624a/i);
    const go = css.slice(css.indexOf('.sc-generation-card .gs-create-go {'), css.indexOf('.gs-create-go:hover'));
    expect(go).toContain('background: #141416');
    const disabled = css.slice(css.indexOf('.gs-create-go[disabled]'), css.indexOf('.gs-create-credit'));
    expect(disabled).toContain('opacity: 1');
    expect(disabled).toContain('background: #141416');
    const shoot = css.slice(css.indexOf('.sc-generation-card .gs-create-shoot {'), css.indexOf('.gs-create-shoot:hover'));
    expect(shoot).toContain('background: #141416');
  });

  it('配了 Aholo 时文字生成走 Lux3D，没配才回 HY-3D', async () => {
    Object.assign(controller, {
      getGenerationCapabilities: vi.fn().mockResolvedValue({
        model: 'hy-3d-3.0', textToModel: true, imageToModel: true,
        texture: false, textureRequiresImage: true, aholoTextToModel: true, aholoImageToModel: true,
      }),
    });
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'material' }));
    fireEvent.change(screen.getByPlaceholderText('一句话描述物件，如：一把户外折叠椅'), { target: { value: '一把藤椅' } });
    await waitFor(() => expect(screen.queryByText(/正在读取可用的生成模型/)).toBeNull());
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('generation-primary'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![2]).toEqual({ kind: 'text', provider: 'aholo' });
  });

  it('再次生成留在同一张表单，不自动勾额度，也不自动再提交', async () => {
    render(<GenerationSheetHost controller={controller} />);
    act(() => openGenerationSheet({ task: 'model', scope: 'material', prompt: '一把藤编躺椅' }));
    await waitFor(() => expect(screen.queryByText(/正在读取可用的生成模型/)).toBeNull());
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('generation-primary'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('generation-again')).toBeTruthy());
    expect((screen.getByRole('textbox', { name: '描述' }) as HTMLTextAreaElement).value).toBe('一把藤编躺椅');
    expect((screen.getByLabelText(/消耗额度/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('generation-primary') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('我的生成');

    fireEvent.click(screen.getByTestId('generation-again'));
    expect(create).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/消耗额度/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('textbox', { name: '描述' }) as HTMLTextAreaElement).value).toBe('一把藤编躺椅');

    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('generation-primary'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]![0]).toBe('一把藤编躺椅');

    act(() => closeGenerationSheet());
    act(() => openGenerationSheet({ task: 'model', scope: 'material' }));
    expect((screen.getByRole('textbox', { name: '描述' }) as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByTestId('generation-again'));
    expect(create).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText(/消耗额度/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('textbox', { name: '描述' }) as HTMLTextAreaElement).value).toBe('一把藤编躺椅');
  });

  it('接入左栏双卡堆栈：外部类名、排序、标题抓取与独立小窗装饰都落在同一张卡上', () => {
    const onHeaderPointerDown = vi.fn();
    render(<GenerationSheetHost
      controller={controller}
      className="is-stack-second"
      style={{ order: 2 }}
      onHeaderPointerDown={onHeaderPointerDown}
      floatBar={<div data-testid="generation-float-bar">独立小窗</div>}
      floatFooter={<div data-testid="generation-float-resize" role="separator" />}
    />);
    act(() => openGenerationSheet({ scope: 'venue' }));
    const card = screen.getByTestId('generation-sheet');
    expect(card.className).toContain('is-stack-second');
    expect(card.style.order).toBe('2');
    expect(screen.getByTestId('generation-float-bar')).toBeTruthy();
    expect(screen.getByTestId('generation-float-resize')).toBeTruthy();
    fireEvent.pointerDown(screen.getByText('创作'));
    expect(onHeaderPointerDown).toHaveBeenCalledTimes(1);
  });
});
