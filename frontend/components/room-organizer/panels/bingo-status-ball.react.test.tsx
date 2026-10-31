/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BINGO_MARK_KEY, BINGO_RETURN_KEY } from '../lib/bingo-status';
import { BingoStatusBall } from './bingo-status-ball';

const SHARE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function mark(shareId: string, title: string) {
  return {
    saved: true,
    status: 'needs-review',
    projectKey: 'local-draft',
    title,
    shareId,
    markedAt: '2026-10-31T00:00:00.000Z',
  };
}

afterEach(() => cleanup());

async function ball(name: string) {
  return screen.findByRole('button', { name });
}

describe('BingoStatusBall', () => {
  it('stays a collapsed 待发 ball until clicked, and is not a mode label', async () => {
    render(<BingoStatusBall />);
    const button = await ball('评审收藏，待发');
    expect(button.getAttribute('data-status')).toBe('to-send');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.className).not.toContain('is-returned');
    expect(screen.queryByRole('dialog', { name: '评审收藏' })).toBeNull();
    expect(screen.queryByRole('button', { name: '布置' })).toBeNull();
    expect(screen.queryByRole('button', { name: '评审' })).toBeNull();
    expect(screen.queryByRole('button', { name: '执行' })).toBeNull();

    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: '评审收藏' }).textContent).toContain('还没有待评审的方案');
    expect(screen.getByRole('link', { name: '打开评审页' }).getAttribute('href')).toBe('/review/');
    expect(screen.queryByRole('button', { name: '清回执' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByRole('dialog', { name: '评审收藏' })).toBeNull();
  });

  it('opens the waiting plans and links each one to its review page', async () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([
      mark(SHARE, '春季沙龙'),
      mark(OTHER, '夜场'),
    ]));
    render(<BingoStatusBall />);
    const button = await ball('评审收藏，待评审，2 份方案');
    expect(button.getAttribute('data-status')).toBe('awaiting');
    expect(button.getAttribute('data-count')).toBe('2');
    expect(button.getAttribute('aria-label')).toBe('评审收藏，待评审，2 份方案');

    fireEvent.click(button);
    expect(screen.getByText('春季沙龙')).toBeTruthy();
    expect(screen.getByText('夜场')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: '打开评审页' });
    expect(links.map(link => link.getAttribute('href'))).toEqual([`/review/${SHARE}`, `/review/${OTHER}`]);
    expect(screen.queryByRole('button', { name: '清回执' })).toBeNull();
  });

  it('draws the returned ring and clears only the receipt', async () => {
    localStorage.setItem(BINGO_MARK_KEY, JSON.stringify([mark(SHARE, '春季沙龙')]));
    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1,
      planKey: 'sample:initial',
      at: '2026-10-31T08:00:00.000Z',
    }));
    render(<BingoStatusBall />);
    const button = await ball('评审收藏，已回执');
    expect(button.getAttribute('data-status')).toBe('returned');
    expect(button.classList.contains('is-returned')).toBe(true);

    fireEvent.click(button);
    expect(screen.getByText('春季沙龙')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '评审收藏' }).textContent).toContain('sample:initial');
    fireEvent.click(screen.getByRole('button', { name: '清回执' }));

    expect((await ball('评审收藏，待评审，1 份方案')).getAttribute('data-status')).toBe('awaiting');
    expect(localStorage.getItem(BINGO_RETURN_KEY)).toBeNull();
    expect(localStorage.getItem(BINGO_MARK_KEY)).toContain('春季沙龙');
    expect(screen.queryByRole('button', { name: '清回执' })).toBeNull();
  });

  it('picks up a receipt written in another tab and closes on Escape', async () => {
    render(<BingoStatusBall />);
    fireEvent.click(await ball('评审收藏，待发'));
    expect(screen.getByRole('dialog', { name: '评审收藏' })).toBeTruthy();

    localStorage.setItem(BINGO_RETURN_KEY, JSON.stringify({
      version: 1,
      planKey: 'sample:initial',
      at: '2026-10-31T08:00:00.000Z',
    }));
    fireEvent(window, new StorageEvent('storage', { key: BINGO_RETURN_KEY }));
    await waitFor(() => expect(screen.getByRole('button', { name: '评审收藏，已回执' }).getAttribute('data-status')).toBe('returned'));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '评审收藏' })).toBeNull();
  });
});
