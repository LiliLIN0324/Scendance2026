// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BingoReviewPanel } from './bingo-review-panel';

afterEach(cleanup);

describe('BingoReviewPanel', () => {
  it('is developer-only and does not link into the client review page', () => {
    render(<BingoReviewPanel onClose={() => {}} onEnterVenueReview={() => {}} />);
    expect(screen.getByRole('note').textContent).toMatch(/不要在本机打开评审页自评/);
    expect(screen.queryByRole('link', { name: /打开评审页/ })).toBeNull();
    expect(screen.queryByLabelText('称呼')).toBeNull();
    expect(screen.queryByLabelText('意见')).toBeNull();
    expect(document.querySelector('[data-bingo-side="developer"]')).toBeTruthy();
  });

  it('offers copy link instead of navigating as the reviewer', () => {
    render(<BingoReviewPanel onClose={() => {}} onEnterVenueReview={() => {}} />);
    const copy = screen.queryByRole('button', { name: '复制甲方评审链接' });
    if (copy) fireEvent.click(copy);
  });

  it('enters canvas venue review from Bingo without opening the client page', () => {
    let entered = false;
    render(<BingoReviewPanel onClose={() => {}} onEnterVenueReview={() => { entered = true; }} />);
    fireEvent.click(screen.getByRole('button', { name: '在画布场地点钉' }));
    expect(entered).toBe(true);
  });
});
