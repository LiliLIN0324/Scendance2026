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
  /** 事件回调：测试用 click() 模拟在地图上点一下。 */
  handlers: Record<string, ((event: unknown) => void)[]> = {};
  constructor(public container?: unknown, public options?: unknown) {}
  setZoomAndCenter(zoom: number, center: [number, number]) { this.zoomCalls.push({ zoom, center }); }
  on(type: string, handler: (event: unknown) => void) {
    (this.handlers[type] ??= []).push(handler);
  }
  /** 模拟用户点地图：lng/lat 走 lnglat，和真高德事件结构一致。 */
  click(lng: number, lat: number) {
    for (const handler of this.handlers['click'] ?? []) handler({ lnglat: { lng, lat } });
  }
  setFitView() {}
  resize() {}
}

/** 最近一次建出来的 FakeMap，测试用它模拟点击。 */
let lastMap: FakeMap | null = null;

/** 高德卫星切片层被 setMap 的次数（应为 0：不再默认叠卫星切片）。 */
let tileLayerCalls = 0;

const AMapStub = {
  PlaceSearch: FakePlaceSearch,
  AutoComplete: FakeAutoComplete,
  Map: class extends FakeMap {
    constructor(container?: unknown, options?: unknown) {
      super(container, options);
      lastMap = this;
    }
  },
  MouseTool: class { on() {} close() {} polygon() {} polyline() {} },
  // 2026-11-11 用户 m00690：选址地图不再默认叠高德卫星切片，这里记录调用次数以便断言。
  TileLayer: { Satellite: class { setMap() { tileLayerCalls += 1; } show() {} } },
  Polygon: class {
    path: unknown[] = [];
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) { this.options = options; this.path = (options.path as unknown[]) ?? []; }
    setPath(path: unknown[]) { this.path = path; }
    setOptions(options: Record<string, unknown>) { this.options = { ...this.options, ...options }; }
    setMap() {}
  },
  Polyline: class {
    path: unknown[] = [];
    constructor(options: Record<string, unknown>) { this.path = (options.path as unknown[]) ?? []; }
    setPath(path: unknown[]) { this.path = path; }
    setMap() {}
  },
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
    tileLayerCalls = 0;
    localStorage.setItem('scendance:amap-key', 'test-key');
    localStorage.setItem('scendance:amap-security', 'test-security');
    (window as unknown as { AMap?: unknown }).AMap = AMapStub;
  });

  it('选址地图不再默认叠高德卫星切片（用户 m00690）', async () => {
    await renderPicker();
    await waitFor(() => expect(lastMap).toBeTruthy());
    expect(tileLayerCalls).toBe(0);
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

  it('提交搜索后丢弃仍在途的联想，选中碑亭后收起候选', async () => {
    const { input } = await renderPicker();
    fireEvent.change(input, { target: { value: '平湖秋月' } });
    await waitFor(() => expect(FakeAutoComplete.calls).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    FakePlaceSearch.calls[0]!.cb('complete', searchResult([poi('p', '平湖秋月碑亭', '孤山路1号')]));
    FakeAutoComplete.calls[0]!.cb('complete', { tips: [tip('old', '平湖秋月', '陕西省咸阳市', true)] });
    const result = await screen.findByRole('button', { name: /平湖秋月碑亭/ });
    expect(screen.queryByRole('listbox', { name: '地点联想' })).toBeNull();
    fireEvent.click(result);
    expect(screen.getByTestId('venue-preview').textContent).toContain('孤山路1号');
    expect(screen.queryByRole('button', { name: /平湖秋月碑亭/ })).toBeNull();
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

/**
 * 圈画主线（P0-1）：闭合动作要看得见，闭合失败要说原因。
 * 旧实现把「画完了」押在地图 SDK 的隐式 draw 事件上，用户闭合后「生成户外场地」一直是灰的、
 * 也没有任何提示。现在改成自己收点 + 显式「完成圈画」。
 */
describe('AmapVenuePicker（圈画：完成 / 撤销 / 无效提示）', () => {
  afterEach(cleanup);
  beforeEach(() => {
    FakePlaceSearch.calls = [];
    FakeAutoComplete.calls = [];
    lastMap = null;
    localStorage.setItem('scendance:amap-key', 'test-key');
    localStorage.setItem('scendance:amap-security', 'test-security');
    (window as unknown as { AMap?: unknown }).AMap = AMapStub;
  });

  /** 平湖秋月那种一小块非矩形地：约 20 m × 10 m 的四点。 */
  const corner = [
    { lng: 120.145, lat: 30.245 },
    { lng: 120.14518, lat: 30.245 },
    { lng: 120.14518, lat: 30.24504 },
    { lng: 120.145, lat: 30.24504 },
  ];

  async function startDrawing() {
    const result = await renderPicker();
    await waitFor(() => expect(lastMap).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '圈画场地' }));
    return result;
  }

  it('「完成圈画」一直可见，点满 3 个才可点；闭合后「生成户外场地」才可点', async () => {
    await startDrawing();
    // 完成入口常驻可见（用户不用去找），但点不够 3 个时禁用，并在进度行说明还差几个。
    expect((screen.getByRole('button', { name: '完成圈画' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('draw-progress').textContent).toContain('至少 3 个');

    for (const point of corner.slice(0, 3)) lastMap!.click(point.lng, point.lat);
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('3'));

    const finish = screen.getByRole('button', { name: '完成圈画' });
    expect((finish as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(finish);

    await waitFor(() => expect(screen.getByRole('button', { name: '生成户外场地' })).toBeTruthy());
    expect((screen.getByRole('button', { name: '生成户外场地' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('闭合后写入真实轮廓并报出尺寸', async () => {
    const { onPick } = await startDrawing();
    for (const point of corner) lastMap!.click(point.lng, point.lat);
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('4'));
    fireEvent.click(screen.getByRole('button', { name: '完成圈画' }));

    await waitFor(() => expect(screen.getByText(/边界已闭合/)).toBeTruthy());
    expect(screen.getByText(/m²/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '生成户外场地' }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    const pick = onPick.mock.calls[0]![0] as { polygon: { lng: number; lat: number }[] };
    expect(pick.polygon).toHaveLength(4);
    // 轮廓是用户点的真点位，不是外接矩形
    expect(pick.polygon[0]!.lng).toBeCloseTo(120.145, 6);
  });

  it('撤销上一点会少一个点，撤销回不足 3 点时完成按钮重新禁用', async () => {
    await startDrawing();
    for (const point of corner.slice(0, 3)) lastMap!.click(point.lng, point.lat);
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('3'));

    fireEvent.click(screen.getByRole('button', { name: '撤销上一点' }));
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('2'));
    expect((screen.getByRole('button', { name: '完成圈画' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('点得太近的点被忽略，不会多出一个顶点', async () => {
    await startDrawing();
    lastMap!.click(120.145, 30.245);
    lastMap!.click(120.145, 30.245); // 双击的第二下
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('1'));
    expect(screen.getByRole('status').textContent).toContain('太近');
  });

  it('点在一条线上的三点围不出面积，给出面积太小的原因', async () => {
    await startDrawing();
    lastMap!.click(120.145, 30.245);
    lastMap!.click(120.1452, 30.245);
    lastMap!.click(120.1454, 30.245);
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('3'));
    fireEvent.click(screen.getByRole('button', { name: '完成圈画' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('面积'));
    // 没闭合成功就不该放行生成
    expect((screen.getByRole('button', { name: '生成户外场地' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('画到一半时「生成户外场地」不可点，避免存下半条边界', async () => {
    await startDrawing();
    for (const point of corner) lastMap!.click(point.lng, point.lat);
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('4'));
    expect((screen.getByRole('button', { name: '生成户外场地' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('放弃圈画后回到可重新圈的状态', async () => {
    await startDrawing();
    lastMap!.click(120.145, 30.245);
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('1'));
    fireEvent.click(screen.getByRole('button', { name: '放弃圈画' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('放弃'));
    // 回到可重新圈的状态：完成入口收起，进度行也没了
    expect(screen.queryByRole('button', { name: '完成圈画' })).toBeNull();
    expect(screen.queryByTestId('draw-progress')).toBeNull();
  });

  it('放弃流线后已闭合的边界仍在，生成按钮回到可点', async () => {
    await startDrawing();
    for (const point of corner) lastMap!.click(point.lng, point.lat);
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('4'));
    fireEvent.click(screen.getByRole('button', { name: '完成圈画' }));
    await waitFor(() => expect(screen.getByText(/边界已闭合/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '画主客流线' }));
    lastMap!.click(120.14505, 30.24501);
    lastMap!.click(120.14512, 30.24502);
    await waitFor(() => expect(screen.getByTestId('flow-progress').textContent).toContain('2'));
    expect((screen.getByRole('button', { name: '生成户外场地' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '放弃圈画' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('放弃这次流线'));
    expect(screen.queryByTestId('flow-progress')).toBeNull();
    expect(screen.getByText(/圈画外接矩形/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '生成户外场地' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('选址预览与保存分开：预览只挪图，未保存前提示尚未写入', async () => {
    await renderPicker();
    fireEvent.change(screen.getByLabelText('搜索地点'), { target: { value: '平湖秋月' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    FakePlaceSearch.calls[0]!.cb('complete', searchResult([poi('p', '平湖秋月', '浙江省杭州市西湖区孤山路1号')]));
    await waitFor(() => expect(screen.getByText('平湖秋月')).toBeTruthy());

    fireEvent.click(screen.getAllByText('平湖秋月')[0]!);
    const preview = await screen.findByTestId('venue-preview');
    expect(preview.textContent).toContain('平湖秋月');
    expect(preview.textContent).toContain('尚未写入场地');
  });

  it('保存后预览行改说「场地已保存」，不再同时挂着「尚未写入」', async () => {
    const { onPick } = await renderPicker();
    fireEvent.change(screen.getByLabelText('搜索地点'), { target: { value: '平湖秋月' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    FakePlaceSearch.calls[0]!.cb('complete', searchResult([poi('p', '平湖秋月', '浙江省杭州市西湖区孤山路1号')]));
    await waitFor(() => expect(screen.getByText('平湖秋月')).toBeTruthy());
    fireEvent.click(screen.getAllByText('平湖秋月')[0]!);
    await screen.findByTestId('venue-preview');

    fireEvent.click(screen.getByRole('button', { name: '圈画场地' }));
    for (const point of corner) lastMap!.click(point.lng, point.lat);
    await waitFor(() => expect(screen.getByTestId('draw-progress').textContent).toContain('4'));
    fireEvent.click(screen.getByRole('button', { name: '完成圈画' }));
    fireEvent.click(screen.getByRole('button', { name: '生成户外场地' }));

    await waitFor(() => expect(onPick).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('venue-preview').textContent).toContain('场地已保存'));
    expect(screen.getByTestId('venue-preview').textContent).not.toContain('尚未写入场地');
  });
});
