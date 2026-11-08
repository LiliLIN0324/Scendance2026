// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SettingsMenu } from './settings-menu';

afterEach(cleanup);

it('keeps the repository link and does not present it as a privacy policy', () => {
  render(<SettingsMenu/>);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe('https://github.com/LiliLIN0324/Scendance2026');
  expect(screen.queryByRole('link', { name: '隐私政策' })).toBeNull();
});
