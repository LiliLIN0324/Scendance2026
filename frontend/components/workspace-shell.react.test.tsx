// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootSkeleton } from './workspace-shell';

describe('BootSkeleton', () => {
  it('shows a short brand bar and parks the account cluster on the rail foot', () => {
    const { container } = render(<BootSkeleton />);
    const top = container.querySelector('.sc-boot-top');
    expect(top?.querySelector('.sc-boot-mark')).toBeTruthy();
    expect(top?.querySelectorAll('.sc-boot-line')).toHaveLength(1);
    expect(top?.querySelector('.sc-boot-dot')).toBeNull();
    const foot = container.querySelector('.sc-boot-rail-foot');
    expect(foot?.querySelector('.sc-boot-tile')).toBeTruthy();
    expect(foot?.querySelector('.sc-boot-dot')).toBeTruthy();
    expect(screen.getByText('正在打开幕景工作台')).toBeTruthy();
  });
});
