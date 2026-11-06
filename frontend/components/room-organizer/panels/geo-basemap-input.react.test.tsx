// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookupPlace = vi.fn();
vi.mock('../lib/research-area', async (original) => ({
  ...(await original<typeof import('../lib/research-area')>()),
  lookupPlace: (keywords: string) => lookupPlace(keywords),
}));

import { GeoBasemapInput } from './geo-basemap-input';
import type { RoomLayout } from '../lib/types';

const AREA = {
  name: '杭州西湖风景名胜区',
  address: '浙江省杭州市西湖区',
  center: { lng: 120.121358, lat: 30.222692 },
  radiusM: 1600,
  bounds: { west: 120.10696, south: 30.20835, east: 120.13576, north: 30.23703 },
  widthM: 3200,
  depthM: 3200,
  imageUrl: 'http://127.0.0.1:3199/amap-static?west=120.1069600&south=30.2083500&east=120.1357600&north=30.2370300&style=6&x-ref=map-basemap',
  style: 6 as const,
};

describe('GeoBasemapInput（docs/19 地理底图输入）', () => {
  afterEach(cleanup);
  beforeEach(() => {
    lookupPlace.mockReset();
    localStorage.clear();
  });

  it('没有底图时只露一枚入口；展开输入地名回车即定位铺图', async () => {
    const onApply = vi.fn();
    lookupPlace.mockResolvedValue({ name: '杭州西湖风景名胜区', address: '西湖街道龙井路1号', lng: 120.121358, lat: 30.222692 });
    const { container } = render(<GeoBasemapInput area={undefined} onApply={onApply} view2D={false} />);
    expect(screen.queryByText(/底图 ·/)).toBeNull();
    fireEvent.click(screen.getByTestId('geo-basemap-open'));
    const input = screen.getByTestId('geo-basemap-query') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '杭州西湖' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const applied = onApply.mock.calls[0][0] as NonNullable<RoomLayout['researchArea']>;
    expect(applied.name).toBe('杭州西湖风景名胜区');
    expect(applied.center).toEqual({ lng: 120.121358, lat: 30.222692 });
    expect(applied.radiusM).toBe(1600);
    expect(container.querySelector('.sc-geo-basemap')).toBeTruthy();
  });

  it('查不到地名时如实提示，不铺图也不编坐标', async () => {
    const onApply = vi.fn();
    lookupPlace.mockResolvedValue(null);
    render(<GeoBasemapInput area={undefined} onApply={onApply} view2D={false} />);
    fireEvent.click(screen.getByTestId('geo-basemap-open'));
    const input = screen.getByTestId('geo-basemap-query') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '不存在的地名xyz' } });
    fireEvent.click(screen.getByTestId('geo-basemap-search'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('没查到'));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('已有底图时显示名称胶囊与范围/样式控制：换半径、切卫星/路网、×清除', () => {
    const onApply = vi.fn();
    render(<GeoBasemapInput area={AREA} onApply={onApply} view2D={false} />);
    expect(screen.getByText(/底图 · 杭州西湖风景名胜区/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '底图半径' }), { target: { value: '800' } });
    expect(onApply.mock.calls[0][0].radiusM).toBe(800);
    expect(onApply.mock.calls[0][0].name).toBe(AREA.name); // 地名不动，只换范围
    fireEvent.click(screen.getByRole('button', { name: '卫星含路网' }));
    expect(onApply.mock.calls[1][0].style).toBe(7);
    fireEvent.click(screen.getByTestId('geo-basemap-clear'));
    expect(onApply).toHaveBeenLastCalledWith(null);
  });

  it('2D 平面视图不渲染（底图输入只在 3D 场景）', () => {
    const { container } = render(<GeoBasemapInput area={AREA} onApply={vi.fn()} view2D />);
    expect(container.querySelector('.sc-geo-basemap')).toBeNull();
  });
});
