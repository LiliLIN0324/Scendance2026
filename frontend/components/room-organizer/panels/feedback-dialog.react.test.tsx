// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FeedbackDialog } from './feedback-dialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens a prefilled GitHub issue without account data, and downloads the canvas when asked', async () => {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  const onClose = vi.fn();
  const capture = vi.fn(async () => 'data:image/png;base64,aaaa');
  const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {});
  render(
    <FeedbackDialog
      open
      onClose={onClose}
      plan={{ name: '西湖发布会', place: '户外', boundary: '用地红线已闭合，4 个点', canvas: '户外地图' }}
      onCapturePlan={capture}
    />,
  );

  expect(screen.getByRole('checkbox', { name: /附上当前方案信息/ })).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: /附上当前画布截图/ }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: /附上浏览器信息/ }) as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: '反馈内容' }), { target: { value: '红线保存后丢了' } });
  fireEvent.click(screen.getByRole('button', { name: '提交到 GitHub' }));
  await waitFor(() => expect(open).toHaveBeenCalled());

  expect(capture).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalled();
  const url = String(open.mock.calls[0]?.[0]);
  expect(url.startsWith('https://github.com/LiliLIN0324/Scendance2026/issues/new?')).toBe(true);
  const body = new URL(url).searchParams.get('body') ?? '';
  expect(body).toContain('红线保存后丢了');
  expect(body).toContain('西湖发布会');
  expect(body).toContain('户外');
  expect(body).toContain('用地红线已闭合');
  expect(body).not.toContain('data:image');
  expect(body).not.toMatch(/token|密钥|邮箱/i);
  expect(onClose).toHaveBeenCalled();
});

it('leaves the browser line out unless that box is checked', async () => {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  render(<FeedbackDialog open onClose={() => {}} plan={{ name: '厅', place: '室内', boundary: '无', canvas: '室内平面' }} />);
  fireEvent.change(screen.getByRole('textbox', { name: '反馈内容' }), { target: { value: '标注看不清' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /附上当前方案信息/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /附上当前画布截图/ }));
  fireEvent.click(screen.getByRole('button', { name: '提交到 GitHub' }));
  await waitFor(() => expect(open).toHaveBeenCalled());
  const body = new URL(String(open.mock.calls[0]?.[0])).searchParams.get('body') ?? '';
  expect(body).toContain('标注看不清');
  expect(body).not.toContain('厅');
  expect(body).not.toContain(navigator.userAgent);
});
