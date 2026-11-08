// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 高德脚本加载走网络，测试里直接放行；Key 从 localStorage 来。
vi.mock('../lib/amap-script', async (original) => ({
  ...(await original<typeof import('../lib/amap-script')>()),
  loadAmapScript: () => Promise.resolve(),
}));

import { AmapVenuePicker } from './amap-venue-picker';

type Cb = (status: string, result: unknown) => void;

class FakePlaceSearch {
  static calls: { kw: string; cb: Cb }[] = [];
  constructor(public opts: Record<string, unknown>) {}
  search(kw: string, cb: Cb) { FakePlaceSearch.calls.push({ kw, cb }); }
}

class FakeAutoComplete {
  static calls: { kw: string; cb: Cb }[] = [];
  constructor(public opts: Record<string, unknown>) {}
  search(kw: string, cb: Cb) { FakeAutoComplete.calls.push({ kw, cb }); }
}

class FakeMap {
  zoomCalls: { zoom: number; center: [number, number] }[] = [];
  setZoomAndCenter(zoom: number, center: [number, number]) { this.zoomCalls.push({ zoom, center }); }
  on() {}
  setFitView() {}
  resize() {}
}

const AMapStub = {
  PlaceSearch: FakePlaceSearch,
  AutoComplete: FakeAutoComplete,
  Map: FakeMap,
  MouseTool: class { on() {} close() {} polygon() {} polyline() {} },
  TileLayer: { Satellite: class { setMap() {} show() {} } },
};

function poi(id: string, name: string, address: string) {
  return { id, name, address, location: { lng: 120.13, lat: 30.24 } };
}

function searchResult(pois: unknown[]) {
  return { poiList: { pois } };
}

function tip(id: string, name: string, detail: string, withLocation: boolean) {
  return {
    id,
    name,
    district: withLocation ? '' : detail,
    address: withLocation ? detail : '',
    ...(withLocation ? { location: { lng: 120.14, lat: 30.25 } } : {}),
  };
}

async function renderPicker() {
  const onPick = vi.fn();
  const view = render(<AmapVenuePicker onPick={onPick} onClose={() => {}} />);
  const input = await screen.findByLabelText('搜索地点') as HTMLInputElement;
  return { onPick, view, input };
}

describe('AmapVenuePicker（MAP-01 找地点：联想/竞态/取消）', () => {
  afterEach(cleanup);
  beforeEach(() => {
    FakePlaceSearch.calls = [];
    FakeAutoComplete.calls = [];
    localStorage.setItem('scendance:amap-key', 'test-key');
    localStorage.setItem('scendance:amap-security', 'test-security');
    (window as unknown as { AMap?: unknown }).AMap = AMapStub;
  });

  it('连续搜索：慢的旧响应不覆盖新结果', async () => {
    const { input } = await renderPicker();
    fireEvent.change(input, { target: { value: '西湖' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    fireEvent.change(input, { target: { value: '灵隐寺' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(FakePlaceSearch.calls).toHaveLength(2);
    // 后发的「灵隐寺」先回；再让慢的「西湖」晚到
    FakePlaceSearch.calls[1]!.cb('complete', searchResult([poi('l', '灵隐寺', '西湖区法云弄1号')]));
    FakePlaceSearch.calls[0]!.cb('complete', searchResult([poi('x', '西湖', '杭州市')]));
    await waitFor(() => expect(screen.getByText('灵隐寺')).toBeTruthy());
    // 结果列表只剩新搜索这一条（旧「西湖/杭州市」整行被竞态守卫丢弃）
    expect(document.querySelectorAll('.sc-lux-direct-results li')).toHaveLength(1);
    expect(screen.queryByText('杭州市')).toBeNull();
  });

  it('输入联想：防抖后出同名可区分的下拉（区划 + 坐标条目）', async () => {
    const { input } = await renderPicker();
    fireEvent.change(input, { target: { value: '西湖' } });
    await waitFor(() => expect(FakeAutoComplete.calls).toHaveLength(1));
    expect(screen.queryByRole('listbox', { name: '地点联想' })).toBeNull(); // 回包前不渲染
    // 同名地点靠区划/地址区分
    FakeAutoComplete.calls[0]!.cb('complete', { tips: [tip('t1', '西湖', '浙江省杭州市西湖区', true), tip('t2', '西湖区', '杭州市', false)] });
    const listbox = await screen.findByRole('listbox', { name: '地点联想' });
    expect(listbox).toBeTruthy();
    expect(screen.getByText(/浙江省杭州市西湖区/)).toBeTruthy();
  });

  it('键盘导航：↓ 选中第一条，Enter 采用并只做预览（挪图不写入）', async () => {
    const { input } = await renderPicker();
    fireEvent.change(input, { target: { value: '西湖' } });
    await waitFor(() => expect(FakeAutoComplete.calls).toHaveLength(1));
    FakeAutoComplete.calls[0]!.cb('complete', { tips: [tip('t1', '西湖', '浙江省杭州市西湖区', true)] });
    await waitFor(() => expect(screen.getByRole('option', { selected: false })).toBeTruthy());
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('西湖');
    fireEvent.keyDown(input, { key: 'Enter' });
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('已定位预览');
    expect(status.textContent).toContain('生成户外场地'); // 写入路径在圈画生成，不在联想
  });

  it('无坐标的区划 tip：点它转 POI 搜索，不出假坐标', async () => {
    const { input } = await renderPicker();
    fireEvent.change(input, { target: { value: '西湖' } });
    await waitFor(() => expect(FakeAutoComplete.calls).toHaveLength(1));
    FakeAutoComplete.calls[0]!.cb('complete', { tips: [tip('t2', '西湖区', '杭州市', false)] });
    fireEvent.click(await screen.findByText('西湖区'));
    await waitFor(() => expect(FakePlaceSearch.calls).toHaveLength(1));
    expect(FakePlaceSearch.calls[0]!.kw).toBe('西湖区');
  });

  it('清空搜索：结果与联想一并撤掉， Escape 只收联想', async () => {
    const { input } = await renderPicker();
    fireEvent.change(input, { target: { value: '西湖' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    FakePlaceSearch.calls[0]!.cb('complete', searchResult([poi('x', '西湖', '杭州市')]));
    await waitFor(() => expect(screen.getByText('西湖')).toBeTruthy());
    fireEvent.keyDown(input, { key: 'Escape' }); // 不该清掉搜索结果
    expect(screen.getByText('西湖')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清空搜索结果' }));
    expect(screen.queryByText('西湖')).toBeNull();
    expect(screen.queryByRole('button', { name: '清空搜索结果' })).toBeNull();
  });
});
