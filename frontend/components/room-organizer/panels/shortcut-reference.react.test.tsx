// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShortcutReference } from './shortcut-reference';

describe('ShortcutReference', () => {
  it('renders grouped shortcuts, platform keys and the grid-only caveat', () => {
    render(<ShortcutReference />);
    expect(screen.getByRole('heading', { name: '建造画布 · 编辑' })).toBeTruthy();
    expect(screen.getByText('撤销')).toBeTruthy();
    expect(screen.getByText('Ctrl+Z')).toBeTruthy();
    expect(screen.getByText('⌘Z')).toBeTruthy();
    expect(screen.getByText('只切网格；墙 / 物件吸附是独立开关')).toBeTruthy();
    expect(screen.getByText('一人称漫游：WASD / 方向键归相机，裸单键关闭；撤销、重做、Esc 仍可用。')).toBeTruthy();
  });
});
