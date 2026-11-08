// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const startVenuePicker = vi.fn();
const reviewNow = vi.fn();
const setBrief = vi.fn();

vi.mock('./agent-panel', () => ({
  useAgent: () => ({
    state: 'empty',
    proposal: null,
    startVenuePicker,
    reviewNow,
    issueReviewLink: vi.fn(),
    callbacks: { onOpenReview: vi.fn(), onOpenDelivery: vi.fn(), onOpenReference: vi.fn() },
  }),
}));

vi.mock('./creative-studio', () => ({
  useStudioAgent: () => ({
    brief: { event: '品牌快闪', guests: 24, description: '', mustHave: '', allowIdeas: true },
    hasSavedBrief: false,
    busy: false,
    setBrief,
  }),
}));

import { TaskToolShelf } from './task-tool-shelf';

afterEach(() => {
  cleanup();
  startVenuePicker.mockClear();
  reviewNow.mockClear();
  setBrief.mockClear();
});

function shelf(venueReady = false) {
  return render(
    <TaskToolShelf
      venueReady={venueReady}
      itemCount={0}
      groupRequest={null}
      onOpenChecklist={vi.fn()}
      spaceSlot={<p>空间内容</p>}
      materialSlot={<p>物料内容</p>}
    />,
  );
}

describe('task tool shelf', () => {
  it('shows one next step and a real venue button on an empty project', () => {
    shelf(false);
    expect(screen.getByRole('status').textContent).toBe('下一步：点「定场地」。');
    fireEvent.click(screen.getByRole('button', { name: '定场地' }));
    expect(startVenuePicker).toHaveBeenCalledOnce();
    expect(screen.getByText('空间内容')).toBeTruthy();
  });

  it('keeps objects behind the material tab and blocks check until something is placed', () => {
    shelf(true);
    fireEvent.click(screen.getByRole('tab', { name: '物料' }));
    expect(screen.getByText('物料内容')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '检查与交付' }));
    const check = screen.getByRole('button', { name: '检查这一版' }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    expect(screen.getByText('画面上还没有物件。先打开「物料」，点一件放到画面上。')).toBeTruthy();
    fireEvent.click(check);
    expect(reviewNow).not.toHaveBeenCalled();
  });

  it('writes a typed headcount into the existing brief', () => {
    shelf(true);
    fireEvent.change(screen.getByLabelText('这场来多少人'), { target: { value: '80' } });
    expect(setBrief).toHaveBeenCalledOnce();
    const update = setBrief.mock.calls[0][0] as (current: { guests: number }) => { guests: number };
    expect(update({ guests: 24 }).guests).toBe(80);
  });

  it('keeps 24 and 240, and treats a cleared field as unset', () => {
    shelf(true);
    const input = screen.getByLabelText('这场来多少人') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByRole('status').textContent).toBe('下一步：填写这场来多少人。');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: '24' } });
    expect(input.value).toBe('24');
    expect(screen.getByRole('status').textContent).not.toContain('填写这场来多少人');
    fireEvent.change(input, { target: { value: '240' } });
    expect(input.value).toBe('240');
    const wrote240 = setBrief.mock.calls.at(-1)?.[0] as (current: { guests: number }) => { guests: number };
    expect(wrote240({ guests: 24 }).guests).toBe(240);
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(screen.getByRole('status').textContent).toBe('下一步：填写这场来多少人。');
    fireEvent.change(input, { target: { value: '24' } });
    expect(input.value).toBe('24');
  });

  it('follows an external material request onto the material tab', () => {
    const view = shelf(true);
    expect(screen.getByRole('tab', { name: '物料' }).getAttribute('aria-selected')).toBe('false');
    view.rerender(
      <TaskToolShelf
        venueReady
        itemCount={0}
        groupRequest={{ group: 'material', nonce: 1 }}
        onOpenChecklist={vi.fn()}
        spaceSlot={<p>空间内容</p>}
        materialSlot={<p>物料内容</p>}
      />,
    );
    expect(screen.getByRole('tab', { name: '物料' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('物料内容')).toBeTruthy();
  });
});
