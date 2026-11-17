// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { eventOperationsSchema } from '../../../supabase/functions/_shared/event-operations-contract';
import { makeLayout } from '../room-organizer/lib/__testfixtures__/fixtures';
import { DaySheetExport } from './day-sheet-export';

afterEach(cleanup);

const layout = makeLayout({ id: 'export-project', name: '冬季/试营业',
  eventOperations: eventOperationsSchema.parse({ dataKind: 'real', tasks: [
    { id: crypto.randomUUID(), title: '签到', phase: 'event', ownerName: '小乙' },
  ] }) });

it('下载当天执行包：文件名带活动与日期，内容是完整 HTML', () => {
  const save = vi.fn();
  render(<DaySheetExport layout={layout} save={save} now="2026-11-18T10:00:00.000Z" />);
  fireEvent.click(screen.getByRole('button', { name: '下载当天执行包' }));
  expect(save).toHaveBeenCalledTimes(1);
  const [name, text] = save.mock.calls[0]!;
  expect(name).toBe('冬季-试营业-当天执行包-2026-11-18.html');
  expect(text).toContain('<!doctype html>');
  expect(text).toContain('签到');
  expect(screen.getByRole('status').textContent).toContain('已生成当天执行包');
});

it('生成失败只提示，不抛到界面之外', () => {
  const save = vi.fn();
  render(<DaySheetExport layout={layout} save={save} now="not-a-time" />);
  fireEvent.click(screen.getByRole('button', { name: '下载当天执行包' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('请记录有效的生成时间');
});
