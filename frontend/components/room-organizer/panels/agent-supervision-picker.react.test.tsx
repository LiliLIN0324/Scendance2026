// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { AgentSupervisionPicker } from './agent-supervision-picker';
import { AGENT_SUPERVISION_KEY, getAgentSupervision, setAgentSupervision } from '../lib/agent-supervision-store';

let mem: MemoryStorage;
beforeEach(()=>{mem=new MemoryStorage();vi.stubGlobal('Storage',MemoryStorage);vi.stubGlobal('localStorage',mem);window.localStorage=mem;localStorage.clear();setAgentSupervision('key-points');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();mem?.clear();});

it('多个入口共用一份生效设置，选择后立即写入并同步执行器读数',()=>{
  render(<><AgentSupervisionPicker/><AgentSupervisionPicker/></>);
  const groups=screen.getAllByRole('group',{name:'监督档位'});
  fireEvent.click(within(groups[0]).getByRole('button',{name:'严格'}));
  expect(getAgentSupervision()).toBe('strict');
  expect(within(groups[1]).getByRole('button',{name:'严格'}).getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem(AGENT_SUPERVISION_KEY)).toBe('strict');
  expect(screen.getAllByText(/Agent 生成的方案写入前/)).toHaveLength(2);
});

it('跨窗口设置变化与清除会同步，非法值回落关键节点',()=>{
  render(<AgentSupervisionPicker/>);
  act(()=>{localStorage.setItem(AGENT_SUPERVISION_KEY,'auto');window.dispatchEvent(new StorageEvent('storage',{key:AGENT_SUPERVISION_KEY}));});
  expect(screen.getByRole('button',{name:'自动'}).getAttribute('aria-pressed')).toBe('true');
  act(()=>{localStorage.setItem(AGENT_SUPERVISION_KEY,'model-says-unlimited');window.dispatchEvent(new StorageEvent('storage',{key:AGENT_SUPERVISION_KEY}));});
  expect(getAgentSupervision()).toBe('key-points');
  expect(screen.getByRole('button',{name:'关键节点'}).getAttribute('aria-pressed')).toBe('true');
});

it('偏好存储不可用时仍能在本次会话选择，不假装已经持久保存',()=>{
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
  render(<AgentSupervisionPicker/>);
  fireEvent.click(screen.getByRole('button',{name:'自动'}));
  expect(getAgentSupervision()).toBe('auto');
});
