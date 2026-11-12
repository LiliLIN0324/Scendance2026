// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OutdoorFacilityGenerate } from './outdoor-facility-generate';
import { submitMaterialGenerate } from '../lib/material-generate';
import { attachFacilityGenerateTask } from '../lib/facility-generated-models';
vi.mock('../lib/material-generate', () => ({ submitMaterialGenerate: vi.fn() }));
vi.mock('../lib/facility-generated-models', () => ({ attachFacilityGenerateTask: vi.fn(), listFacilityGenerateLinks: () => [], findGeneratedFacilityModel: () => null }));
let host: HTMLDivElement; let root: Root;
const target = { facilityId: 'stage-test', facilityName: '舞台', kind: 'text' as const };
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function show() { act(() => root.render(<OutdoorFacilityGenerate target={target} onClose={vi.fn()} />)); }
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
