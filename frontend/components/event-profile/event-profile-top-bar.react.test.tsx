// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EventProfileTopBar } from './event-profile-top-bar';
import { emptyEventProfile, updateEventProfile } from '../../lib/event-profile';

afterEach(cleanup);

const now = '2026-11-18T10:00:00.000Z';
const meta = { updatedBy: '阿岚', updatedAt: now };
const bar = () => screen.getByRole('group', { name: '活动概览' }).textContent ?? '';

it('没有档案时先说日期待确认，并把日期列为第一项', () => {
  render(<EventProfileTopBar now={now} />);
  expect(bar()).toContain('日期待确认');
  expect(bar()).toContain('待确认 7 项');
  expect(bar()).toContain('下一步：确认日期');
});

it('日期已确认才显示天数，其余事实继续列为待确认', () => {
  const profile = updateEventProfile(emptyEventProfile(),
    { date: { value: '2026-12-20', status: 'confirmed', source: 'user_statement' } }, 0, meta);
  render(<EventProfileTopBar profile={profile} now={now} />);
  expect(bar()).toContain('距活动 32 天');
  expect(bar()).toContain('待确认 6 项');
  expect(bar()).toContain('下一步：确认时间窗');
});

it('日期已过时照实说已过，不显示负数天数', () => {
  const profile = updateEventProfile(emptyEventProfile(),
    { date: { value: '2026-11-01', status: 'confirmed', source: 'user_statement' } }, 0, meta);
  render(<EventProfileTopBar profile={profile} now={now} />);
  expect(bar()).toContain('活动已过 17 天');
});
