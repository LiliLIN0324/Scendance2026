// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { BingoDesk } from './bingo-desk';
import { BingoRailButton, VenueRailButton } from './rail-desk-buttons';
import { VenueDesk } from './venue-desk';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('left rail desks', () => {
  it('gives Bingo and 场地 their own buttons', () => {
    const onBingo = vi.fn();
    const onVenue = vi.fn();
    render(<><BingoRailButton open={false} onOpen={onBingo} /><VenueRailButton open onOpen={onVenue} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Bingo' }));
    fireEvent.click(screen.getByRole('button', { name: '场地' }));
    expect(onBingo).toHaveBeenCalledOnce();
    expect(onVenue).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '场地' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: '晴光' })).toBeNull();
  });

  it('renders a Bingo review desk that is not the agent panel', () => {
    render(<BingoDesk
      planKey="sample:initial"
      layoutName="周末共创工作坊"
      pins={[]}
      items={[]}
      pinFilter="open"
      activePinId={null}
      reviewing={false}
      onEnterReview={vi.fn()}
      onClose={vi.fn()}
      onFilter={vi.fn()}
      onFocus={vi.fn()}
      onResolve={vi.fn()}
      onReturn={vi.fn()}
      onConfirm={vi.fn()}
    />);
    const desk = screen.getByRole('complementary', { name: 'Bingo' });
    expect(desk.getAttribute('data-desk')).toBe('bingo');
    expect(desk.id).not.toBe('agent-panel');
    expect(screen.getByRole('button', { name: '在这块场地上点评' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '待评' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '收藏' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '回执' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: '晴光' })).toBeNull();
  });

  it('renders a venue library with templates, separate from Bingo', () => {
    render(<VenueDesk layout={INITIAL_LAYOUT} onApply={vi.fn()} onClose={vi.fn()} />);
    const desk = screen.getByRole('complementary', { name: '场地库' });
    expect(desk.getAttribute('data-desk')).toBe('venue');
    expect(screen.getByRole('region', { name: '模板场馆' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '收藏的场馆' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /空白场地/ })).toBeTruthy();
    expect(screen.getByText('青序 · 香氛快闪')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Bingo' })).toBeNull();
    expect(document.getElementById('agent-panel')).toBeNull();
  });
});
