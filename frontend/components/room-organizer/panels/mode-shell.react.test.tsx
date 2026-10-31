// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryChecklistShell, LayoutVenueCard, ReviewIssuesCard, dossierStatus } from './mode-shell';
import type { ReviewPin } from '../lib/review-pins';

afterEach(cleanup);

describe('layout venue card', () => {
  it('shows the activity facts and not the review or delivery lists', () => {
    render(<LayoutVenueCard event="发布会" guests="80 人" dims="室内 · 12 × 9 m" />);
    const card = screen.getByRole('region', { name: '布置' });
    expect(card.textContent).toContain('场地');
    expect(card.textContent).toContain('发布会');
    expect(card.textContent).toContain('80 人');
    expect(card.textContent).not.toContain('待确认');
    expect(card.textContent).not.toContain('到场清单');
    expect(card.textContent).not.toContain('这块场地从哪来');
  });
});

const pin = (id: string, text: string, status: ReviewPin['status'] = 'open'): ReviewPin => ({
  id, text, itemId: id === 'ground' ? null : 'desk', status,
  x: 0, y: 0, z: 0, offset: null,
  camera: { position: [1, 2, 3], target: [0, 0, 0] },
});

describe('review issues card', () => {
  it('lists unresolved pins, flies to one, and has no pass or reject wall', () => {
    const onFocus = vi.fn();
    const onResolve = vi.fn();
    const onReturn = vi.fn();
    const onConfirm = vi.fn();
    const onFilter = vi.fn();
    render(<ReviewIssuesCard
      pins={[pin('a', '桌子挡了通道'), pin('ground', '这里空')]}
      items={[{ id: 'desk', name: '签到桌' }]}
      filter="open"
      activeId={null}
      onFilter={onFilter}
      onFocus={onFocus}
      onResolve={onResolve}
      onReturn={onReturn}
      onConfirm={onConfirm}
    />);
    const shell = screen.getByRole('region', { name: '议题' });
    expect(shell.textContent).toContain('议题');
    expect(shell.textContent).toContain('桌子挡了通道');
    expect(shell.textContent).toContain('签到桌');
    expect(shell.textContent).toContain('地面');
    expect(shell.textContent).not.toMatch(/通过|驳回|待确认/);
    expect(screen.queryByRole('button', { name: '通过' })).toBeNull();
    expect(screen.queryByRole('button', { name: '驳回' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /桌子挡了通道/ }));
    expect(onFocus).toHaveBeenCalledWith('a');
    const row = screen.getByRole('button', { name: /桌子挡了通道/ }).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '标记已解决' }));
    expect(onResolve).toHaveBeenCalledWith('a');
    fireEvent.click(within(row).getByRole('button', { name: '退回布置' }));
    expect(onReturn).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: '确认可进执行' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '已解决' }));
    expect(onFilter).toHaveBeenCalledWith('resolved');
  });
});

describe('delivery checklist shell', () => {
  it('shows the arrival list, an export entry, and complete-or-missing status without the layout brief', () => {
    const onExport = vi.fn();
    const { rerender } = render(<DeliveryChecklistShell items={[{ name: '签到桌' }, { name: '签到桌' }]} onExport={onExport} />);
    const shell = screen.getByRole('region', { name: '执行清单' });
    expect(shell.textContent).toContain('到场清单');
    expect(shell.textContent).toContain('签到桌');
    expect(shell.textContent).toContain('2 件');
    expect(shell.textContent).toContain('资料状态 · 齐');
    expect(shell.textContent).not.toContain('这块场地从哪来');
    expect(shell.textContent).not.toContain('场地简报');
    expect(shell.textContent).not.toContain('活动还没说');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(onExport).toHaveBeenCalledOnce();

    rerender(<DeliveryChecklistShell items={[]} onExport={onExport} />);
    expect(screen.getByRole('region', { name: '执行清单' }).textContent).toContain('资料状态 · 缺');
    expect(dossierStatus(0)).toBe('缺');
    expect(dossierStatus(2)).toBe('齐');
  });
});
