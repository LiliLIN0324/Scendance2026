// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootSkeleton } from './workspace-shell';

describe('BootSkeleton', () => {
  it('parks the brand mark on the rail and the account cluster on the rail foot', () => {
    const { container } = render(<BootSkeleton />);
    const top = container.querySelector('.sc-boot-top');
    expect(top?.childElementCount).toBe(0);
    const rail = container.querySelector('.sc-boot-rail');
    expect(rail?.querySelector(':scope > .sc-boot-mark')).toBeTruthy();
    const foot = container.querySelector('.sc-boot-rail-foot');
    expect(foot?.querySelector('.sc-boot-tile')).toBeTruthy();
    expect(foot?.querySelector('.sc-boot-dot')).toBeTruthy();
    expect(screen.getByText('正在打开幕景工作台')).toBeTruthy();
  });
});
