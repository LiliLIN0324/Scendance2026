// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import * as placeSearch from '../lib/place-search';
import * as placeSearchOptions from '../lib/place-search-options';
import PlanPlaceSearch from './plan-place-search';
import type { SearchCandidatePin } from '../lib/outdoor-plan-canvas';
import type { PlaceSuggestion } from '../lib/place-search';

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
});
afterEach(() => {
  cleanup();
  mem?.clear();
  vi.unstubAllGlobals();
});

const westLake: PlaceSuggestion = {
  id: 'west-lake',
  name: '西湖',
  address: '浙江省杭州市西湖区',
  lng: 120.146,
  lat: 30.252,
};
const dock: PlaceSuggestion = { id: 'dock', name: '水上森林码头', address: '青山湖景区', lng: 120.21, lat: 30.31 };

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

// 2026-11-28 用户反馈：点搜索框右侧的 × 之后，灵动岛没收回（词清了，岛还撑着展开态）。
// 按位置断言：× 就是「退出搜索」，鼠标还停在岛上、input 的 blur 因点击目标在岛内被跳过时也要收。
describe('PlanPlaceSearch clear button', () => {
  it('collapses the island when × clears the query, even while the pointer and input are still on it', async () => {
    const onClear = vi.fn();
    render(<PlanPlaceSearch onPick={vi.fn()} onClear={onClear} sync={{ query: '西湖', hits: [westLake] }} />);
    const host = screen.getByTestId('plan-place-search');
    const input = screen.getByTestId('plan-place-search-input') as HTMLInputElement;
    await screen.findByRole('listbox');
    fireEvent.mouseEnter(host);
    fireEvent.focus(input);
    expect(host.getAttribute('data-expanded')).toBe('true');

    fireEvent.click(screen.getByTitle('清除'));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
    expect(host.getAttribute('data-expanded')).toBe('false');
    expect(host.className).not.toContain('is-expanded');
    expect(host.className).not.toContain('has-value');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

// 2026-11-28 用户指令：历史条目要挂历史图标，不能带 1/2/3 编号——
// 编号是「本次检索的候选」的身份，与画布编号钉一一对应；历史行也带号时两套逻辑打架。
// 按位置断言：只要那一行来自历史，该位置就没有编号、只有历史图标。
describe('PlanPlaceSearch history rows', () => {
  const waterForest: PlaceSuggestion = {
    id: 'water-forest',
    name: '青山湖水上森林',
    address: '锦北街道科技大道青山湖风景区内',
    lng: 119.72,
    lat: 30.24,
  };

  it('展开只有历史时：每行都是历史图标，没有 1/2 编号', async () => {
    placeSearch.rememberPlace(waterForest);
    placeSearch.rememberPlace(westLake);
    render(<PlanPlaceSearch onPick={vi.fn()} />);
    fireEvent.focus(screen.getByTestId('plan-place-search-input'));

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    const rows = screen.getAllByRole('option');
    for (const row of rows) {
      expect(row.querySelector('.sc-plan-place-search-option-history')).toBeTruthy();
      expect(row.querySelector('.sc-plan-place-search-option-no')).toBeNull();
    }
    // 历史里也不能出现「1」「2」这种序号文本。
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('西湖'),
      expect.stringContaining('青山湖水上森林'),
    ]);
  });

  it('历史行带删除 ×：点击只摘这一条，另一条保留（2026-11-28 用户指令）', async () => {
    placeSearch.rememberPlace(waterForest);
    placeSearch.rememberPlace(westLake);
    const onPick = vi.fn();
    render(<PlanPlaceSearch onPick={onPick} />);
    fireEvent.focus(screen.getByTestId('plan-place-search-input'));

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    // 第一行（西湖，最新）带删除 ×；点击它不触发选中。
    const forget = screen.getByRole('button', { name: '删除最近搜过的「西湖」' });
    fireEvent.click(forget);
    expect(onPick).not.toHaveBeenCalled();

    // 西湖消失、青山湖保留；存储也同步摘除。
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getAllByRole('option')[0]?.textContent).toContain('青山湖水上森林');
    expect(placeSearch.recentPlaces().map(place => place.id)).toEqual(['water-forest']);
  });

  it('有检索词时：历史行占位不占号，结果从 1 开始编，编号钉跟着同一个号', async () => {
    const searchSpy = vi.spyOn(placeSearch, 'searchPlaces').mockResolvedValue([dock]);
    const hintsSpy = vi.spyOn(placeSearchOptions, 'fetchPlaceShapeHints').mockResolvedValue([]);
    const batches: Array<ReadonlyArray<SearchCandidatePin> | null> = [];
    try {
      placeSearch.rememberPlace(waterForest);
      render(
        <PlanPlaceSearch
          onPick={vi.fn()}
          onCandidatesChange={pins => batches.push(pins)}
        />,
      );
      fireEvent.change(screen.getByTestId('plan-place-search-input'), { target: { value: '青山湖' } });

      await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2), { timeout: 3000 });
      const [historyRow, resultRow] = screen.getAllByRole('option');
      // 历史行：有图标、无号。
      expect(historyRow?.querySelector('.sc-plan-place-search-option-history')).toBeTruthy();
      expect(historyRow?.querySelector('.sc-plan-place-search-option-no')).toBeNull();
      // 结果行：第 1 个就是 1，不被历史挤到 2。
      expect(resultRow?.querySelector('.sc-plan-place-search-option-no')?.textContent).toBe('1');
      expect(resultRow?.querySelector('.sc-plan-place-search-option-history')).toBeNull();

      // 画布编号钉与下拉同号（index 0 → 画布上的 1），历史不铺钉。
      await waitFor(() => expect(batches.at(-1)).toEqual([
        { index: 0, lng: dock.lng, lat: dock.lat, name: dock.name, place: dock },
      ]));
    } finally {
      searchSpy.mockRestore();
      hintsSpy.mockRestore();
    }
  });
});
// 2026-11-27 用户指令（对齐百度地图）：下拉候选要按序号上报给画布落编号钉。
// 序号必须与下拉渲染的 1/N 一致（「第 2 个」在地图上就是标 2 的钉）。
describe('PlanPlaceSearch candidate pins', () => {
  it('does not let a pending input blur hide the list opened by a map selection', () => {
    vi.useFakeTimers();
    try {
      const props = { onPick: vi.fn(), sync: { query: '西湖', hits: [westLake, dock] } };
      const view = render(<PlanPlaceSearch {...props} />);
      fireEvent.blur(screen.getByRole('combobox'));
      view.rerender(<PlanPlaceSearch {...props} selectedPlace={dock} />);
      act(() => vi.advanceTimersByTime(150));
      expect(screen.getByRole('listbox')).toBeTruthy();
      expect(screen.getByTestId('plan-place-search-option-1').getAttribute('aria-selected')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an empty result only after a query and removes it when retry finds a place', async () => {
    const searchSpy = vi.spyOn(placeSearch, 'searchPlaces').mockResolvedValue([]);
    const hintsSpy = vi.spyOn(placeSearchOptions, 'fetchPlaceShapeHints').mockResolvedValue([]);
    try {
      render(<PlanPlaceSearch onPick={vi.fn()} />);
      expect(screen.queryByRole('status')).toBeNull();
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '西湖' } });
      fireEvent.click(screen.getByRole('button', { name: '搜索地点' }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe('未找到地点'));
      searchSpy.mockResolvedValue([westLake]);
      fireEvent.click(screen.getByRole('button', { name: '搜索地点' }));
      await screen.findByRole('option');
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      searchSpy.mockRestore();
      hintsSpy.mockRestore();
    }
  });

  it('searches again on the search button and Enter, including an unchanged chat query', async () => {
    const searchSpy = vi.spyOn(placeSearch, 'searchPlaces').mockResolvedValue([dock]);
    const hintsSpy = vi.spyOn(placeSearchOptions, 'fetchPlaceShapeHints').mockResolvedValue([]);
    const onPick = vi.fn();
    try {
      render(<PlanPlaceSearch onPick={onPick} sync={{ query: '西湖', hits: [westLake] }} />);
      await screen.findByTestId('plan-place-search-option-0');
      const submit = screen.getByRole('button', { name: '搜索地点' });
      fireEvent.click(submit);
      await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByTestId('plan-place-search-option-0').textContent).toContain(dock.name));
      fireEvent.click(submit);
      await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2));
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(3));
      expect(onPick).not.toHaveBeenCalled();
    } finally {
      searchSpy.mockRestore();
      hintsSpy.mockRestore();
    }
  });

  it('opens and selects the matching list row after a map marker is picked without picking it again', async () => {
    const onPick = vi.fn();
    const sync = { query: '西湖', hits: [westLake, dock] };
    const view = render(<PlanPlaceSearch onPick={onPick} sync={sync} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    view.rerender(<PlanPlaceSearch onPick={onPick} sync={sync} selectedPlace={dock} />);
    await waitFor(() => expect(screen.getByTestId('plan-place-search-option-1').getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByTestId('plan-place-search').getAttribute('data-expanded')).toBe('true');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('pins a new chat search after a previous dropdown selection', async () => {
    const batches: Array<ReadonlyArray<SearchCandidatePin> | null> = [];
    const props = { onPick: vi.fn(), onCandidatesChange: (pins: ReadonlyArray<SearchCandidatePin> | null) => batches.push(pins) };
    const view = render(<PlanPlaceSearch {...props} sync={{ query: '西湖', hits: [westLake] }} />);
    await waitFor(() => expect(batches.at(-1)?.length).toBe(1));
    fireEvent.click(screen.getByTestId('plan-place-search-option-0'));
    await waitFor(() => expect(batches.at(-1)?.length).toBe(1));

    view.rerender(<PlanPlaceSearch {...props} sync={{ query: '水上森林', hits: [dock] }} />);
    await waitFor(() => expect(batches.at(-1)).toEqual([
      { index: 0, lng: dock.lng, lat: dock.lat, name: dock.name, place: dock },
    ]));
  });

  it('keeps all dropdown numbers after selecting a result and reopening the list', async () => {
    const batches: Array<ReadonlyArray<SearchCandidatePin> | null> = [];
    const onCandidatesChange = (pins: ReadonlyArray<SearchCandidatePin> | null) => batches.push(pins);
    render(
      <PlanPlaceSearch
        onPick={vi.fn()}
        sync={{ query: '西湖', hits: [westLake, dock] }}
        onCandidatesChange={onCandidatesChange}
      />,
    );

    // 同步候选进来：两条带坐标的地点按合成序号上报。
    await waitFor(() => {
      const latest = batches.at(-1);
      expect(latest).toEqual([
        { index: 0, lng: 120.146, lat: 30.252, name: '西湖', place: westLake },
        { index: 1, lng: 120.21, lat: 30.31, name: '水上森林码头', place: dock },
      ]);
    });

    const original = batches.at(-1);
    // 点选第 2 条也不清结果、不换检索词、不把最近选中的结果排到第 1 条。
    fireEvent.click(screen.getByTestId('plan-place-search-option-1'));
    fireEvent.focus(screen.getByTestId('plan-place-search-input'));
    await waitFor(() => expect(screen.getByTestId('plan-place-search-option-1').textContent).toContain(dock.name));
    expect((screen.getByTestId('plan-place-search-input') as HTMLInputElement).value).toBe('西湖');
    expect(batches.at(-1)).toEqual(original);
  });

  it('clears the batch on unmount so pins do not outlive the search island', async () => {
    const batches: Array<ReadonlyArray<SearchCandidatePin> | null> = [];
    const onCandidatesChange = (pins: ReadonlyArray<SearchCandidatePin> | null) => batches.push(pins);
    const view = render(
      <PlanPlaceSearch
        onPick={vi.fn()}
        sync={{ query: '西湖', hits: [westLake] }}
        onCandidatesChange={onCandidatesChange}
      />,
    );
    await waitFor(() => expect(batches.at(-1)?.length).toBe(1));
    view.unmount();
    expect(batches.at(-1)).toBeNull();
  });

  it('keeps pins when chat selection releases sync, but does not restore a revoked batch', async () => {
    const searchSpy = vi.spyOn(placeSearch, 'searchPlaces').mockResolvedValue([westLake, dock]);
    const hintsSpy = vi.spyOn(placeSearchOptions, 'fetchPlaceShapeHints').mockResolvedValue([]);
    const batches: Array<ReadonlyArray<SearchCandidatePin> | null> = [];
    const props = { onPick: vi.fn(), onCandidatesChange: (pins: ReadonlyArray<SearchCandidatePin> | null) => batches.push(pins) };
    const sync = { query: '西湖', hits: [westLake, dock] };
    try {
      const view = render(<PlanPlaceSearch {...props} sync={sync} />);
      await waitFor(() => expect(batches.at(-1)?.length).toBe(2));
      view.rerender(<PlanPlaceSearch {...props} sync={null} />);
      await waitFor(() => expect(searchSpy).toHaveBeenCalledOnce(), { timeout: 3000 });
      expect(batches.at(-1)?.length).toBe(2);

      view.rerender(<PlanPlaceSearch {...props} revokeCandidatePins={1} />);
      await waitFor(() => expect(batches.at(-1)).toBeNull());
      view.rerender(<PlanPlaceSearch {...props} revokeCandidatePins={1} near={{ lng: 120, lat: 30 }} />);
      await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2), { timeout: 3000 });
      expect(batches.at(-1)).toBeNull();

      view.rerender(<PlanPlaceSearch {...props} revokeCandidatePins={1} sync={{ ...sync, hits: [...sync.hits] }} />);
      await waitFor(() => expect(batches.at(-1)?.length).toBe(2));
      fireEvent.click(screen.getByTitle('清除'));
      await waitFor(() => expect(batches.at(-1)).toBeNull());
    } finally {
      searchSpy.mockRestore();
      hintsSpy.mockRestore();
    }
  });

  it('does not pin recent-only suggestions before any real query (工作台一加载不满图钉)', async () => {
    const batches: Array<ReadonlyArray<SearchCandidatePin> | null> = [];
    const onCandidatesChange = (pins: ReadonlyArray<SearchCandidatePin> | null) => batches.push(pins);
    render(<PlanPlaceSearch onPick={vi.fn()} onCandidatesChange={onCandidatesChange} />);
    // 挂载 + 展开（最近列表出下拉）都不该铺钉：没有检索词就只有 null 批次。
    fireEvent.focus(screen.getByTestId('plan-place-search-input'));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(batches.every(batch => batch === null)).toBe(true);
  });

  // 换活动后旧编号钉不能残留；下拉刷新同一批结果也不能把旧活动的钉带回来。
  it('keeps a revoked batch gone while the same search refreshes, and pins again for a new search', async () => {
    const searchSpy = vi.spyOn(placeSearch, 'searchPlaces').mockResolvedValue([westLake, dock]);
    const hintsSpy = vi.spyOn(placeSearchOptions, 'fetchPlaceShapeHints').mockResolvedValue([]);
    const batches: Array<ReadonlyArray<SearchCandidatePin> | null> = [];
    const onCandidatesChange = (pins: ReadonlyArray<SearchCandidatePin> | null) => batches.push(pins);
    const props = { onPick: vi.fn(), onCandidatesChange };
    const view = render(<PlanPlaceSearch {...props} />);
    const input = screen.getByTestId('plan-place-search-input');
    try {
      // 在地图左上角手搜（不走对话侧同步）。
      fireEvent.change(input, { target: { value: '青山湖' } });
      await waitFor(() => expect(batches.at(-1)?.length).toBe(2), { timeout: 3000 });

      // 换活动：调用方递增撤钉令牌 → 旧批次收掉。
      view.rerender(<PlanPlaceSearch {...props} revokeCandidatePins={1} />);
      await waitFor(() => expect(batches.at(-1)).toBeNull());

      // 同一次检索的列表刷新（同步撤走后下拉自己重查）：钉不回来。
      searchSpy.mockResolvedValue([dock, westLake]);
      view.rerender(<PlanPlaceSearch {...props} revokeCandidatePins={1} near={{ lng: 120, lat: 30 }} />);
      await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2), { timeout: 3000 });
      await waitFor(() => expect(screen.getAllByTestId(/plan-place-search-option-\d+/)).toHaveLength(2), { timeout: 3000 });
      expect(batches.at(-1)).toBeNull();

      // 同一个词点搜索按钮也算新检索，不能一直被换活动的撤钉令牌压住。
      fireEvent.click(screen.getByRole('button', { name: '搜索地点' }));
      await waitFor(() => expect(batches.at(-1)?.length).toBe(2), { timeout: 3000 });
      // 换词同样照常重新铺钉。
      fireEvent.change(input, { target: { value: '水上森林' } });
      await waitFor(() => expect(batches.at(-1)?.length).toBe(2), { timeout: 3000 });
    } finally {
      searchSpy.mockRestore();
      hintsSpy.mockRestore();
    }
  });
});
