// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlanPlaceSearch from './plan-place-search';
import type { PlaceSuggestion } from '../lib/place-search';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const westLake: PlaceSuggestion = {
  id: 'west-lake',
  name: '西湖',
  address: '浙江省杭州市西湖区',
  lng: 120.146,
  lat: 30.252,
};

function renderSearch() {
  render(
    <PlanPlaceSearch
      onPick={vi.fn()}
      sync={{ query: '西湖', hits: [westLake] }}
    />,
  );
  return {
    host: screen.getByTestId('plan-place-search'),
    input: screen.getByTestId('plan-place-search-input') as HTMLInputElement,
  };
}

describe('PlanPlaceSearch Escape', () => {
  it('collapses the island on Escape even while the pointer is still hovering it', async () => {
    const { host, input } = renderSearch();
    fireEvent.mouseEnter(host);
    fireEvent.focus(input);
    await waitFor(() => expect(host.getAttribute('data-expanded')).toBe('true'));

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(host.getAttribute('data-expanded')).toBe('false');
    expect(input.value).toBe('西湖');
  });

  it('still closes when focus has left the search input', async () => {
    const { host, input } = renderSearch();
    fireEvent.mouseEnter(host);
    await waitFor(() => expect(host.getAttribute('data-expanded')).toBe('true'));
    input.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(host.getAttribute('data-expanded')).toBe('false');
    expect(input.value).toBe('西湖');
  });
});
