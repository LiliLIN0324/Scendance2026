// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryChecklistShell, dossierStatus } from './mode-shell';

afterEach(cleanup);

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
