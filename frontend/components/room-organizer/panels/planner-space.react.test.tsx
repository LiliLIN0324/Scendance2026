// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const startVenuePicker = vi.fn();
const onOpenReference = vi.fn();

vi.mock('../contexts', () => ({
  useRoomEditor: () => ({
    actions: { setWidth: vi.fn(), setHeight: vi.fn() },
    history: { commitNow: vi.fn() },
  }),
}));

vi.mock('./agent-panel', () => ({
  useAgent: () => ({ startVenuePicker, callbacks: { onOpenReference } }),
}));

import type { RoomLayout } from '../lib/types';
import { PlannerSpace } from './planner-space';

const layout = {
  name: '空地',
  width: 12,
  height: 8,
  floors: [{ id: 'ground', name: '场地', height: 3, items: [] }],
} as unknown as RoomLayout;

afterEach(() => {
  cleanup();
  startVenuePicker.mockClear();
  onOpenReference.mockClear();
});

describe('planner space', () => {
  it('starts from the current room instead of a generation mode', () => {
    render(<PlannerSpace layout={layout} onApply={vi.fn()} />);
    expect(screen.getByText(/现在这块地可以直接摆/)).toBeTruthy();
    expect(screen.queryByText('传统空间')).toBeNull();
    expect(screen.queryByText('空间生成')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '换已保存的场地' }));
    expect(startVenuePicker).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '用图纸改这块地' }));
    expect(onOpenReference).toHaveBeenCalledOnce();
  });
});
