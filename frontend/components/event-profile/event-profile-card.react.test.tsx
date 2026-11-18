// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EventProfileCard } from './event-profile-card';
import { emptyEventProfile, updateEventProfile } from '../../lib/event-profile';
import { proposeEventProfileChange } from '../../lib/event-profile-context';

afterEach(cleanup);

const meta = { updatedBy: '阿岚', updatedAt: '2026-11-18T10:00:00.000Z' };
const attendance = { value: 60, status: 'inferred', source: 'model_inference', note: '按场地容量推断' } as const;

function inferredProfile() {
  return updateEventProfile(emptyEventProfile(), { expectedAttendance: attendance }, 0, meta);
}

it('shows unknown facts as unrecorded instead of guessing', () => {
  render(<EventProfileCard profile={emptyEventProfile()} />);
  expect(screen.getByText('v0')).toBeTruthy();
  expect(screen.queryByText('尚未创建')).toBeNull();
  expect(screen.getAllByText('待确认（未填写，不得推测）').length).toBeGreaterThan(0);
});

it('marks inferred values as needing human confirmation and hides internal fields by default', () => {
  render(<EventProfileCard profile={inferredProfile()} />);
  expect(screen.getByText('60 人（推断，需人工确认）')).toBeTruthy();
  expect(screen.queryByText('预算')).toBeNull();
  expect(screen.queryByText('分工')).toBeNull();
});

it('shows internal fields only when explicitly allowed', () => {
  render(<EventProfileCard profile={inferredProfile()} showInternal />);
  expect(screen.getByText('预算')).toBeTruthy();
  expect(screen.getByText('分工')).toBeTruthy();
});

it('commits only after a reviewer name is entered', () => {
  const profile = inferredProfile();
  const onCommit = vi.fn();
  const proposal = proposeEventProfileChange(profile,
    { goal: { value: '完成一次全员走位', status: 'inferred', source: 'model_inference', note: '简报推断' } }, meta);
  render(<EventProfileCard profile={profile} proposal={proposal} onCommit={onCommit} />);
  const confirm = screen.getByRole('button', { name: '确认写入' });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('确认人'), { target: { value: ' 小乙 ' } });
  fireEvent.click(confirm);
  expect(onCommit).toHaveBeenCalledTimes(1);
  const next = onCommit.mock.calls[0]![0];
  expect(next.revision).toBe(profile.revision + 1);
  expect(next.updatedBy).toBe('小乙');
  expect(next.goal.value).toBe('完成一次全员走位');
  expect(screen.getByRole('status').textContent).toContain(`版本 v${profile.revision + 1}`);
});

it('refuses to overwrite a profile that changed after the proposal', () => {
  const base = inferredProfile();
  const proposal = proposeEventProfileChange(base,
    { goal: { value: '完成一次全员走位', status: 'inferred', source: 'model_inference', note: '简报推断' } }, meta);
  const onCommit = vi.fn();
  render(<EventProfileCard profile={onCommitProfile()} proposal={proposal} onCommit={onCommit} />);
  fireEvent.change(screen.getByLabelText('确认人'), { target: { value: '小乙' } });
  fireEvent.click(screen.getByRole('button', { name: '确认写入' }));
  expect(onCommit).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('版本已变化');
});

/** 另一个人已先改过档案：版本前进一步。 */
function onCommitProfile() {
  return updateEventProfile(inferredProfile(),
    { goal: { value: '别人先改的目标', status: 'inferred', source: 'model_inference', note: '他人提案' } }, 1, meta);
}
