// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useVenueLibrary } from '../hooks/use-venue-library';
import { VENUE_LIBRARY_STORAGE_KEY, noteVenueThreeIntent } from '../lib/venue-library';
import { VenueLibraryPanel, VenueRailButton } from './venue-library-panel';

const here = dirname(fileURLToPath(import.meta.url));

function LibraryHarness(): JSX.Element {
  const library = useVenueLibrary();
  const [open, setOpen] = useState(false);
  return (
    <>
      <VenueRailButton open={open} lit={library.lit} onToggle={() => setOpen(value => !value)} />
      {open && <VenueLibraryPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function RailHarness(): JSX.Element {
  const library = useVenueLibrary();
  return <VenueRailButton open={false} lit={library.lit} onToggle={() => undefined} />;
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(cleanup);

describe('场地库面板', () => {
  it('opens an empty 我的场地 beside the prepared templates', () => {
    render(<LibraryHarness />);
    const nav = screen.getByRole('button', { name: '场地' });
    expect(nav.className).toContain('is-muted');
    expect(nav.getAttribute('data-venue-lit')).toBe('0');
    fireEvent.click(nav);
    const panel = screen.getByRole('complementary', { name: '场地库' });
    expect(within(panel).getByRole('region', { name: '我的场地' }).textContent).toContain('还没有收藏的经营地点');
    const templates = within(panel).getByRole('region', { name: '可参观模板' });
    expect(within(templates).getByText('夜市酒馆壳')).toBeTruthy();
    expect(within(templates).getByText('白日展厅壳')).toBeTruthy();
    expect(within(templates).getByText('灯会庭院壳')).toBeTruthy();
  });

  it('visits a template in place and keeps a copy in 我的场地', () => {
    render(<LibraryHarness />);
    fireEvent.click(screen.getByRole('button', { name: '场地' }));
    const templates = screen.getByRole('region', { name: '可参观模板' });
    const card = within(templates).getByText('夜市酒馆壳').closest('li');
    if (!card) throw new Error('missing template card');
    fireEvent.click(within(card).getByRole('button', { name: '参观' }));
    expect(screen.getByRole('region', { name: '场地详情' }).textContent).toContain('参观占位');
    fireEvent.click(within(card).getByRole('button', { name: '用作模板' }));
    const mine = screen.getByRole('region', { name: '我的场地' });
    expect(within(mine).getByText('夜市酒馆壳')).toBeTruthy();
    expect(within(mine).queryByText('还没有收藏的经营地点')).toBeNull();
    expect(within(card).getByRole('button', { name: '已收藏' }).getAttribute('aria-pressed')).toBe('true');
    const stored = JSON.parse(window.localStorage.getItem(VENUE_LIBRARY_STORAGE_KEY) ?? '{}') as { venues?: { templateId: string }[] };
    expect(stored.venues?.map(item => item.templateId)).toEqual(['tavern-night']);
  });

  it('drops the muted mark after a 3D intent', () => {
    render(<RailHarness />);
    expect(screen.getByRole('button', { name: '场地' }).classList.contains('is-muted')).toBe(true);
    act(() => { noteVenueThreeIntent(window.localStorage); });
    const rail = screen.getByRole('button', { name: '场地' });
    expect(rail.getAttribute('data-venue-lit')).toBe('1');
    expect(rail.classList.contains('is-muted')).toBe(false);
  });

  it('keeps 场地 on the narrow rail under 草稿, out of the foot and the session column', () => {
    const source = readFileSync(join(here, '../room-organizer.tsx'), 'utf8');
    const rail = source.slice(source.indexOf('className="sc-mode-rail"'), source.indexOf('id="workbench-nav-column"'));
    const brand = rail.indexOf('WorkbenchBrandToggle');
    const qingguang = rail.indexOf('QingguangRailButton');
    const draft = rail.indexOf('sc-rail-bingo');
    const venue = rail.indexOf('VenueRailButton');
    const foot = rail.indexOf('sc-mode-rail-foot');
    expect(brand).toBeGreaterThan(-1);
    expect(brand).toBeLessThan(qingguang);
    expect(qingguang).toBeLessThan(draft);
    expect(draft).toBeLessThan(venue);
    expect(venue).toBeLessThan(foot);
    expect(rail.slice(foot)).not.toContain('VenueRailButton');
    expect(rail.slice(foot)).not.toContain('sc-rail-bingo');
    const column = source.slice(source.indexOf('id="workbench-nav-column"'), source.indexOf('className={`sc-canvas-stage'));
    expect(column).toContain('AssistantSessionDock');
    expect(column).not.toContain('VenueRailButton');
    expect(source).not.toContain('sc-venue-nav');
  });
});
