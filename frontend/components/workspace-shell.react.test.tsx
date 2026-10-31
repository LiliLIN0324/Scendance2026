// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootSkeleton } from './workspace-shell';

describe('BootSkeleton', () => {
  it('shows a short brand bar and parks the account cluster on the rail foot', () => {
    const { container } = render(<BootSkeleton />);
    expect(container.querySelector('.sc-boot-top')).toBeNull();
    const rail = container.querySelector('.sc-boot-rail');
    expect(rail?.firstElementChild?.classList.contains('sc-boot-mark')).toBe(true);
    const foot = container.querySelector('.sc-boot-rail-foot');
    expect(foot?.querySelector('.sc-boot-tile')).toBeTruthy();
    expect(foot?.querySelector('.sc-boot-dot')).toBeTruthy();
    expect(screen.getByText('正在打开幕景工作台')).toBeTruthy();
  });
});
