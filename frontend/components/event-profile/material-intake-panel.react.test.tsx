// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { eventOperationsSchema } from '../../../supabase/functions/_shared/event-operations-contract';
import { MaterialIntakePanel } from './material-intake-panel';

afterEach(cleanup);

const operations = eventOperationsSchema.parse({ dataKind: 'real', tasks: [] });

it('粘贴材料后逐行出草案，带原文引用与负责人', () => {
  render(<MaterialIntakePanel operations={operations} projectId="intake-panel" onAccept={vi.fn()}
    now="2026-11-18T10:00:00.000Z" />);
  fireEvent.change(screen.getByLabelText('材料原文'), { target: { value: '10:00-11:00 签到，负责人：小乙\n布置签到台' } });
  fireEvent.click(screen.getByRole('button', { name: '解析材料' }));
  expect(screen.getByText('签到')).toBeTruthy();
  expect(screen.getByText('布置签到台')).toBeTruthy();
  expect(screen.getByText(/负责人 小乙/)).toBeTruthy();
  expect(screen.getByText(/原文时刻 10:00–11:00（不生成排期）/)).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});

it('只写入勾选行，保留原有任务，重复写入被拒', () => {
  const onAccept = vi.fn();
  render(<MaterialIntakePanel operations={operations} projectId="intake-panel" onAccept={onAccept}
    now="2026-11-18T10:00:00.000Z" />);
  fireEvent.change(screen.getByLabelText('材料原文'), { target: { value: '签到\n布置' } });
  fireEvent.click(screen.getByRole('button', { name: '解析材料' }));
  fireEvent.click(screen.getAllByRole('checkbox')[1]!);
  fireEvent.click(screen.getByRole('button', { name: '写入流程单' }));
  const next = onAccept.mock.calls[0]![0];
  expect(next.tasks.map((task: { title: string }) => task.title)).toEqual(['签到']);
  expect(screen.getByRole('status').textContent).toContain('已写入 1 项');
});

it('空白材料不产生草案', () => {
  render(<MaterialIntakePanel operations={operations} projectId="intake-panel" onAccept={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('材料原文'), { target: { value: '# 只有标题' } });
  fireEvent.click(screen.getByRole('button', { name: '解析材料' }));
  expect(screen.getByRole('alert').textContent).toContain('没有解析到可写入的行');
});
