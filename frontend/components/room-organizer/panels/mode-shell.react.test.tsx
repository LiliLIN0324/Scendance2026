// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryChecklistShell, LayoutVenueCard, ReviewAnnotationShell, dossierStatus, reviewStatusLabel } from './mode-shell';

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

describe('review annotation shell', () => {
  it('lists item names and status, and focuses the 3D item without a venue-origin card', () => {
    const onFocus = vi.fn();
    render(<ReviewAnnotationShell items={[{ id: 'desk', name: '签到桌' }, { id: 'chair', name: '活动座椅' }]} onFocus={onFocus} />);
    const shell = screen.getByRole('region', { name: '评审批注' });
    expect(shell.textContent).toContain('签到桌');
    expect(shell.textContent).toContain('待确认');
    expect(shell.textContent).not.toContain('这块场地从哪来');
    expect(screen.queryByLabelText('场地简报')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /签到桌/ }));
    expect(onFocus).toHaveBeenCalledWith('desk');
    expect(reviewStatusLabel(undefined)).toBe('待确认');

    const desk = screen.getByRole('button', { name: /签到桌/ }).closest('li') as HTMLElement;
    fireEvent.click(within(desk).getByRole('button', { name: '通过' }));
    expect(within(desk).getByRole('button', { name: /签到桌/ }).textContent).toContain('通过');
    const chair = screen.getByRole('button', { name: /活动座椅/ }).closest('li') as HTMLElement;
    fireEvent.click(within(chair).getByRole('button', { name: '驳回' }));
    expect(within(chair).getByRole('button', { name: /活动座椅/ }).textContent).toContain('驳回');
    expect(reviewStatusLabel('passed')).toBe('通过');
    expect(reviewStatusLabel('rejected')).toBe('驳回');
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
