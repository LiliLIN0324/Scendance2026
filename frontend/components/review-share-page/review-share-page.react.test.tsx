// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../room-organizer/lib/constants';
import { INITIAL_LAYOUT } from '../room-organizer/lib/initial-layout';
import { REVIEW_COMMENT_STORAGE_KEY } from './comments';
import { REVIEW_RETURN_STORAGE_KEY } from './review-return';
import { ReviewSharePage } from './review-share-page';
import type { RoomLayout } from '../room-organizer/lib/types';

/** Uncompressed `#layout=` fragment. jsdom has no Blob.stream(), so the test skips deflate. */
function layoutHash(layout: RoomLayout): string {
  const bytes = new TextEncoder().encode(JSON.stringify(layout));
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `#layout=${encoded}`;
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/review/');
});

async function openSample(): Promise<void> {
  window.history.replaceState(null, '', '/review/?demo=1');
  render(<ReviewSharePage />);
  await screen.findByRole('heading', { name: INITIAL_LAYOUT.name });
}

describe('review share page', () => {
  it('shows the sample plan, posts a comment, and keeps a reply after remount', async () => {
    await openSample();
    expect(screen.getByText(/示例场地/)).toBeTruthy();
    expect(screen.getByText(/共创桌/)).toBeTruthy();
    expect(document.querySelector('img[alt*="平面预览"]')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/晴光|模式轨|执行页|到场清单/);
    expect(document.querySelector('.sc-mode-rail, .sc-agent-panel, #agent-panel, .sc-workbench')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '发表评论' }));
    expect(screen.getByRole('alert').textContent).toMatch(/称呼/);

    fireEvent.change(screen.getByLabelText('称呼'), { target: { value: '甲方' } });
    fireEvent.change(screen.getByLabelText('意见'), { target: { value: '主舞台偏左' } });
    fireEvent.click(screen.getByRole('button', { name: '发表评论' }));
    expect(await screen.findByText('主舞台偏左')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '回复 甲方' }));
    fireEvent.change(screen.getByLabelText('意见'), { target: { value: '舞台保持居中' } });
    fireEvent.click(screen.getByRole('button', { name: '发表回复' }));
    expect(await screen.findByText('舞台保持居中')).toBeTruthy();
    expect(localStorage.getItem(REVIEW_COMMENT_STORAGE_KEY)).toContain('主舞台偏左');

    cleanup();
    render(<ReviewSharePage />);
    expect(await screen.findByText('主舞台偏左')).toBeTruthy();
    expect(screen.getByText('舞台保持居中')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '完成评审' }));
    expect(await screen.findByRole('button', { name: '已完成评审' })).toBeTruthy();
    expect(screen.getByText(/红环/)).toBeTruthy();
    expect(localStorage.getItem(REVIEW_RETURN_STORAGE_KEY)).toContain('sample:initial');
  });

  it('opens a shared snapshot and a saved local plan', async () => {
    window.history.replaceState(null, '', `/review/${layoutHash({ ...INITIAL_LAYOUT, name: '发布会主场' })}`);
    render(<ReviewSharePage />);
    expect(await screen.findByRole('heading', { name: '发布会主场' })).toBeTruthy();
    expect(screen.getByText(/分享链接里的方案快照/)).toBeTruthy();
    cleanup();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...INITIAL_LAYOUT, name: '本机共创' }));
    window.history.replaceState(null, '', '/review/');
    render(<ReviewSharePage />);
    expect(await screen.findByRole('heading', { name: '本机共创' })).toBeTruthy();
    expect(screen.getByText(/当前保存的布置/)).toBeTruthy();
  });

  it('switches floors and refuses a broken share hash', async () => {
    const loft = {
      ...INITIAL_LAYOUT.floors[0]!,
      id: 'loft',
      name: '二层看台',
      items: [{ ...INITIAL_LAYOUT.floors[0]!.items[0]!, id: 'a0100000-0000-4000-8000-000000000099', name: '看台桌' }],
    };
    window.history.replaceState(null, '', `/review/${layoutHash({
      ...INITIAL_LAYOUT,
      name: '两层发布会',
      floors: [INITIAL_LAYOUT.floors[0]!, loft],
    })}`);
    render(<ReviewSharePage />);
    await screen.findByRole('heading', { name: '两层发布会' });
    fireEvent.click(screen.getByRole('button', { name: '二层看台' }));
    expect(await screen.findByText('看台桌')).toBeTruthy();
    cleanup();

    window.history.replaceState(null, '', '/review/#layout=!!!');
    render(<ReviewSharePage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/读不出来/);
    expect(screen.queryByLabelText('意见')).toBeNull();
  });
});
