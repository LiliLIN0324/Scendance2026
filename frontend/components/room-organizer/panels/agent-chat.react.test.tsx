// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { AgentChat } from './agent-chat';
import { clearAgentSteerNotes, getAgentRun, resetAgentRun, startAgentRun } from './agent-chat-store';

function editor(): RoomEditorContextValue {
  return {
    layout: INITIAL_LAYOUT,
    activeFloor: INITIAL_LAYOUT.floors[0]!,
    activeFloorIndex: 0,
    actions: {},
    history: { commitNow: vi.fn() },
    playCue: vi.fn(),
    pushColor: vi.fn(),
  } as unknown as RoomEditorContextValue;
}

function renderChat(agent: 'space' | 'material'): void {
  render(<RoomEditorProvider value={editor()}><AgentChat agent={agent} /></RoomEditorProvider>);
}

beforeEach(() => { act(() => resetAgentRun()); });
afterEach(() => { cleanup(); act(() => resetAgentRun()); });

/**
 * 2026-11-16 用户指令：空间/物料底部的「一句话描述场地/物件」输入框属于旧内联生成界面，
 * 已并进统一生成面板。这里只剩正在跑的那一轮的备注框。
 */
describe('空间/物料栏不再有生成输入框', () => {
  it.each(['space', 'material'] as const)('%s 栏空闲时没有任何输入框', agent => {
    renderChat(agent);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByPlaceholderText('为下一步加备注…')).toBeNull();
    // 旧的描述框占位、生成星、发送键都不该再出现。
    expect(screen.queryByText(/一句话描述/)).toBeNull();
    expect(screen.queryByRole('button', { name: '生成物料' })).toBeNull();
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
  });

  it('agent 在跑时只留备注框，回车进下一轮上下文', () => {
    act(() => startAgentRun('material'));
    renderChat('material');
    const input = screen.getByPlaceholderText('为下一步加备注…') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '椅子换成藤编' } });
    fireEvent.submit(input.form!);
    expect(getAgentRun().steerNotes).toEqual(['椅子换成藤编']);
    expect(input.value).toBe('');
    act(() => clearAgentSteerNotes());
  });

  it('活动/门这两栏不在这里渲染', () => {
    const { container } = render(<RoomEditorProvider value={editor()}><AgentChat agent="door" /></RoomEditorProvider>);
    expect(container.querySelector('.ap-chat')).toBeNull();
  });
});
