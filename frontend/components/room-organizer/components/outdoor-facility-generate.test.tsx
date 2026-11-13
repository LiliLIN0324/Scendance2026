// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackendSession } from '@/lib/backend-session';
import { OutdoorFacilityGenerate } from './outdoor-facility-generate';
import { submitMaterialGenerate } from '../lib/material-generate';
import { attachFacilityGenerateTask } from '../lib/facility-generated-models';
vi.mock('../lib/material-generate', () => ({ submitMaterialGenerate: vi.fn() }));
vi.mock('../lib/facility-generated-models', () => ({ attachFacilityGenerateTask: vi.fn(), listFacilityGenerateLinks: () => [], findGeneratedFacilityModel: () => null }));
let host: HTMLDivElement; let root: Root;
const target = { facilityId: 'stage-test', facilityName: '舞台', kind: 'text' as const };
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
function show(projectId = 'project-a', controller?: BackendSession) { act(() => root.render(<OutdoorFacilityGenerate key={projectId} target={target} projectId={projectId} controller={controller} onClose={vi.fn()} />)); }
async function submit() {
  act(() => (document.querySelector('[aria-label="确认扣额度后才会提交"]') as HTMLInputElement).click());
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); });
}
it('没有额度确认绝不调用生成；提交成功仅绑定原设施、不切换工作台', async () => {
  vi.mocked(submitMaterialGenerate).mockResolvedValue({ ok: true, taskid: 'mock-task', lane: 'direct', kind: 'text' });
  show(); expect(vi.mocked(submitMaterialGenerate)).not.toHaveBeenCalled();
  expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  await submit(); expect(submitMaterialGenerate).toHaveBeenCalledTimes(1);
  expect(attachFacilityGenerateTask).toHaveBeenCalledWith(expect.objectContaining({ facilityId: 'stage-test', taskid: 'mock-task' }));
  expect(document.querySelector('[data-testid="outdoor-facility-generate"]')).not.toBeNull();
});
it('未知扣费结果关闭重开仍锁住，不靠重新勾选绕过重复提交', async () => {
  vi.mocked(submitMaterialGenerate).mockResolvedValue({ ok: false, stub: false, outcome: 'unknown', message: '结果未知' });
  show(); await submit(); act(() => root.render(null)); show();
  expect(document.body.textContent).toContain('此前提交结果未知');
  expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  expect(submitMaterialGenerate).toHaveBeenCalledTimes(1);
});

function durableReceipt(projectId = 'project-a') {
  return JSON.parse(localStorage.getItem(`scendance:facility-submit:${JSON.stringify([projectId, target.facilityId])}`) ?? 'null');
}
it('请求永不返回也在发出前持久登记；刷新式卸载重挂/伪造submit不再发第二次', async () => {
  vi.mocked(submitMaterialGenerate).mockImplementation(() => {
    expect(durableReceipt()).toMatchObject({ state: 'submitting', projectId: 'project-a', facilityId: target.facilityId });
    return new Promise(() => {});
  });
  show(); await submit(); const original = durableReceipt();
  expect(original.requestId).toMatch(/^[0-9a-f-]{36}$/);
  act(() => root.render(null)); show(); await submit();
  expect(submitMaterialGenerate).toHaveBeenCalledTimes(1);
  expect(durableReceipt().requestId).toBe(original.requestId);
  expect(document.body.textContent).toContain('已锁定重复提交');
});
it('云端调用使用已持久化的同一requestId，重挂不能换randomUUID创建另一单', async () => {
  const createGenerationJob = vi.fn((_prompt, requestId) => {
    expect(requestId).toBe(durableReceipt().requestId);
    return new Promise(() => {});
  });
  const controller = { createGenerationJob, getGenerationJob: vi.fn() } as unknown as BackendSession;
  vi.mocked(submitMaterialGenerate).mockImplementation(async (_input, options) => {
    const job = await options!.cloud!.createJob('舞台', { kind: 'text' });
    return { ok: true, taskid: job.id, lane: 'cloud', kind: 'text' };
  });
  show('project-a', controller); await submit(); act(() => root.render(null)); show('project-a', controller); await submit();
  expect(createGenerationJob).toHaveBeenCalledTimes(1); expect(submitMaterialGenerate).toHaveBeenCalledTimes(1);
});
it('存储不可用时拒绝发请求；只有明确未派发的stub才解锁', async () => {
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  show(); await submit(); expect(submitMaterialGenerate).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('没有发出');
  spy.mockRestore();
  vi.mocked(submitMaterialGenerate).mockResolvedValue({ ok: false, stub: true, message: '没有通道，未发请求' });
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(durableReceipt()).toBeNull(); expect(submitMaterialGenerate).toHaveBeenCalledTimes(1);
});
it('同设施ID跨项目独立锁，晚成功只绑定原项目；已知云任务只GET恢复不POST', async () => {
  let finish!: (result: Awaited<ReturnType<typeof submitMaterialGenerate>>) => void;
  vi.mocked(submitMaterialGenerate).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(() => new Promise(() => {}));
  show(); await submit(); show('project-b'); await submit();
  expect(submitMaterialGenerate).toHaveBeenCalledTimes(2); expect(durableReceipt('project-b').state).toBe('submitting');
  await act(async () => { finish({ ok: true, taskid: 'cloud-original', kind: 'text', lane: 'cloud' }); });
  expect(attachFacilityGenerateTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-a', facilityId: target.facilityId, taskid: 'cloud-original' }));
  const getGenerationJob = vi.fn().mockResolvedValue({ id: 'cloud-original' });
  const controller = { getGenerationJob, createGenerationJob: vi.fn() } as unknown as BackendSession;
  show('project-a', controller); await act(async () => { await Promise.resolve(); });
  expect(getGenerationJob).toHaveBeenCalledWith('cloud-original'); expect(controller.createGenerationJob).not.toHaveBeenCalled();
  expect(submitMaterialGenerate).toHaveBeenCalledTimes(2);
});

it('损坏的提交存档不能被当成没有提交而覆盖重发', async () => {
  localStorage.setItem(`scendance:facility-submit:${JSON.stringify(['project-a', target.facilityId])}`, '{broken');
  show(); await submit(); expect(submitMaterialGenerate).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('已锁定重复提交');
});
