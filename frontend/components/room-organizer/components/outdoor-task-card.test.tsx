// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { OutdoorTaskCard, type OutdoorTaskProgress } from './outdoor-task-card';
let root: Root | undefined; let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
it('只有真实工作态有停止，最近3步折叠，下一步回填而非擅自执行', () => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const stop = vi.fn(); const prefill = vi.fn(); const inspect = vi.fn();
  let task: OutdoorTaskProgress = { intent: '45人讲座', state: 'working', action: '读取路网', steps: ['1','2','3','4'] };
  const draw = () => act(() => root!.render(<OutdoorTaskCard task={task} canStop onStop={stop} onPrefill={prefill} onInspectFacility={inspect}/>));
  draw(); expect(host.querySelectorAll('li')).toHaveLength(3);
  const stopButton = host.querySelector('button')!; act(() => stopButton.click()); expect(stop).toHaveBeenCalledTimes(1);
  task = { ...task, state: 'done', prompts: ['80人市集'], focusFacilityId: 'stage' }; draw();
  expect(host.textContent).not.toContain('停止查找'); expect(host.textContent).not.toMatch(/\d+秒/);
  const buttons = [...host.querySelectorAll('button')];
  act(() => buttons.find(b => b.textContent === '80人市集')!.click()); expect(prefill).toHaveBeenCalledWith('80人市集');
  act(() => buttons.find(b => b.textContent?.includes('模型候选'))!.click()); expect(inspect).toHaveBeenCalledWith('stage');
});
