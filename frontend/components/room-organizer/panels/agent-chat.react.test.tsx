// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { AgentChat } from './agent-chat';

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

function renderChat(agent: 'space' | 'material', onNewSpace?: (mode?: 'blank' | 'template') => void): void {
  const chat = onNewSpace ? <AgentChat agent={agent} onNewSpace={onNewSpace}/> : <AgentChat agent={agent}/>;
  render(<RoomEditorProvider value={editor()}>
    {chat}
  </RoomEditorProvider>);
}

afterEach(cleanup);

describe('AgentChat composer entry points', () => {
  it('puts 生成物料 in the bottom-left of the material chat', () => {
    renderChat('material');
    const generate = screen.getByRole('button', { name: '生成物料' });
    expect(document.querySelector('.ap-composer-left')?.contains(generate)).toBe(true);
    fireEvent.click(generate);
    const menu = screen.getByRole('menu', { name: '生成物料' });
    expect([...menu.querySelectorAll('button')].map(button => button.textContent)).toEqual(['通过描述生成物料', '拍照/图片生成物料']);
  });

  it('keeps the space chat on its own plus menu without a generate button', () => {
    const onNewSpace = vi.fn();
    renderChat('space', onNewSpace);
    expect(screen.queryByRole('button', { name: '生成物料' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '新建空白空间' }));
    expect(onNewSpace).toHaveBeenCalledWith('blank');
  });
});
