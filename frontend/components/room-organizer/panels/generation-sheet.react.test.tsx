// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, SceneApiError, getBackendConfig, type GenerationJob } from '@/lib/backend-session';
import { GenerationSheetHost } from './generation-sheet';
import { closeGenerationSheet, openGenerationSheet, resetGenerationSheetForTests } from '../lib/generation-sheet';
import { clearGeneratedFacilityModelsForTests, consumeFacilityGenerateLink } from '../lib/facility-generated-models';
import { clearStagedMaterialGenerateForTests, stageMaterialGenerate } from '../lib/material-generate';

/**
 * 面板的两件事：① 来路决定标题与首层；② 模型这条是真提交（额度确认是提交前的闸门）。
 * 场景那条仍是骨架，点主按钮只说明「还没接提交」。
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
  it('场地入口：先问做什么，三个任务都在，选完进对应表单', () => {
    render(<GenerationSheetHost controller={controller} />);
    expect(screen.queryByTestId('generation-sheet')).toBeNull();

    act(() => openGenerationSheet({ scope: 'venue' }));
    // 2026-11-18 用户：入口不再是一句加粗问句，直接给三个任务行（读法对齐「空间」）。
    expect(screen.queryByText('你想做什么？')).toBeNull();
    expect(screen.getByRole('complementary', { name: '场地' })).toBeTruthy();
    expect(screen.getByTestId('generation-task-scene-recon')).toBeTruthy();
    expect(screen.getByTestId('generation-task-model')).toBeTruthy();

    fireEvent.click(screen.getByTestId('generation-task-scene-new'));
    expect(screen.getByLabelText('场景名称')).toBeTruthy();
    expect(screen.getByText(/Beta/)).toBeTruthy();
    expect(screen.getByTestId('generation-primary').textContent).toBe('生成');

    // 场景这条还是骨架：勾了额度才能点（按钮本身就不亮），点了只说明还没接提交。
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    fireEvent.click(screen.getByTestId('generation-primary'));
    expect(screen.getByRole('status').textContent).toContain('还没接提交');

    // 收起与拍摄卡同一枚钮（sc-left-close），卡内也能关。
    fireEvent.click(screen.getByRole('button', { name: '关闭生成面板' }));
    expect(screen.queryByTestId('generation-sheet')).toBeNull();
  });

  it('属性卡入口：标题「生成模型」，先过额度确认才真提交', async () => {
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
    expect(screen.getByTestId('generation-target').textContent).toContain('保存到模型库');

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

  it('没登录云项目时主按钮禁用，原因只在 title 里', () => {
    render(<GenerationSheetHost />);
    act(() => openGenerationSheet({ task: 'model', scope: 'material' }));
    fireEvent.change(screen.getByPlaceholderText('一句话描述物件，如：一把户外折叠椅'), { target: { value: '折叠椅' } });
    fireEvent.click(screen.getByLabelText(/消耗额度/));
    const primary = screen.getByTestId('generation-primary') as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(primary.title).toContain('登录云项目');
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
    expect((screen.getByTestId('generation-primary') as HTMLButtonElement).disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem('scendance:generation-submissions')!)[0]).toMatchObject({
      state: 'failed', projectId: 'project', facilityId: 'f-1',
    });
  });
});
