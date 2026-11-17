// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OUTDOOR_PROJECT_SWITCH_EVENT,
  onOutdoorProjectSwitch,
  requestOutdoorProjectSwitch,
} from './outdoor-project-switch';

// 2026-11-17 用户拍板「切换经典案例不要白屏刷新重置，按不换页改」：
// 面板只发意图，宿主接住就同页换活动；没人接才回退整页跳。
describe('outdoor-project-switch（同页换活动）', () => {
  const offs: Array<() => void> = [];
  afterEach(() => { offs.splice(0).forEach(off => off()); });

  it('没有宿主接住时返回 false（调用方据此回退整页跳）', () => {
    expect(requestOutdoorProjectSwitch('replica-abc')).toBe(false);
  });

  it('宿主接住时把 project id 交出去并返回 true', () => {
    const seen: string[] = [];
    offs.push(onOutdoorProjectSwitch(id => { seen.push(id); return true; }));
    expect(requestOutdoorProjectSwitch('  replica-abc  ')).toBe(true);
    expect(seen).toEqual(['replica-abc']);
  });

  it('宿主明确不接（返 false 或抛错）仍然返回 false', () => {
    offs.push(onOutdoorProjectSwitch(() => false));
    expect(requestOutdoorProjectSwitch('replica-a')).toBe(false);
    offs.push(onOutdoorProjectSwitch(() => { throw new Error('工作台还没起来'); }));
    expect(requestOutdoorProjectSwitch('replica-b')).toBe(false);
  });

  it('空 id 不发事件；退订后不再接', () => {
    const handler = vi.fn(() => true);
    const off = onOutdoorProjectSwitch(handler);
    offs.push(off);
    expect(requestOutdoorProjectSwitch('   ')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(requestOutdoorProjectSwitch('replica-a')).toBe(true);
    off();
    expect(requestOutdoorProjectSwitch('replica-b')).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('事件名稳定（工作台外壳与面板靠它对齐）', () => {
    expect(OUTDOOR_PROJECT_SWITCH_EVENT).toBe('scendance:switch-outdoor-project');
  });
});
