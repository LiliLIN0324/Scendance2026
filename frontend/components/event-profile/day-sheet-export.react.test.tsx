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
  expect(text).toContain('生成于 2026-11-18 18:00（Asia/Shanghai）');
  expect(text).toContain('签到');
  expect(screen.getByRole('status').textContent).toContain('已生成当天执行包');
});

it('北京时间已过午夜时，文件名用上海的日历日，不取 UTC 日期', () => {
  const save = vi.fn();
  render(<DaySheetExport layout={layout} save={save} now="2026-11-17T23:30:00.000Z" />);
  fireEvent.click(screen.getByRole('button', { name: '下载当天执行包' }));
  const [name, text] = save.mock.calls[0]!;
  expect(name).toBe('冬季-试营业-当天执行包-2026-11-18.html');
  expect(text).toContain('生成于 2026-11-18 07:30（Asia/Shanghai）');
});

it('默认取活动排期的第一天；改日期后文件名和抬头都跟着走', () => {
  const save = vi.fn();
  const dated = makeLayout({ id: 'export-day', name: '两日展',
    eventOperations: eventOperationsSchema.parse({ dataKind: 'real', tasks: [
      { id: crypto.randomUUID(), title: '签到', phase: 'event', plannedStartAt: '2026-12-20T01:00:00+00:00' },
    ] }) });
  render(<DaySheetExport layout={dated} save={save} now="2026-11-18T10:00:00.000Z" />);
  const input = screen.getByLabelText('执行日期') as HTMLInputElement;
  expect(input.value).toBe('2026-12-20');
  fireEvent.change(input, { target: { value: '2026-12-21' } });
  fireEvent.click(screen.getByRole('button', { name: '下载当天执行包' }));
  const [name, text] = save.mock.calls[0]!;
  expect(name).toBe('两日展-当天执行包-2026-12-21.html');
  expect(text).toContain('2026-12-21（周一）');
  expect(text).not.toContain('签到');
  expect(screen.getByRole('status').textContent).toContain('2026-12-21（周一）');
});

it('执行单带上交付版本；没传就只说未定稿', () => {
  const save = vi.fn();
  const { rerender } = render(<DaySheetExport layout={layout} save={save} now="2026-11-18T10:00:00.000Z"
    delivery={{ version: 'v1.0', status: 'confirmed' }} />);
  fireEvent.click(screen.getByRole('button', { name: '下载当天执行包' }));
  expect(save.mock.calls[0]![1]).toContain('定稿 v1.0');
  rerender(<DaySheetExport layout={layout} save={save} now="2026-11-18T10:00:00.000Z" />);
  fireEvent.click(screen.getByRole('button', { name: '下载当天执行包' }));
  expect(save.mock.calls[1]![1]).not.toContain('定稿 v1.0');
});

it('生成失败只提示，不抛到界面之外', () => {
  const save = vi.fn();
  render(<DaySheetExport layout={layout} save={save} now="not-a-time" />);
  fireEvent.click(screen.getByRole('button', { name: '下载当天执行包' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('请记录有效的生成时间');
});
