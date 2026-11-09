// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeoBasemapInput } from './geo-basemap-input';
import { createPresetResearchArea, XIHU_LOCAL_NAME } from '../lib/research-area';
import type { RoomLayout } from '../lib/types';

const AREA: NonNullable<RoomLayout['researchArea']> = {
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

const PRESET = createPresetResearchArea() as NonNullable<RoomLayout['researchArea']>;

describe('GeoBasemapInput（地图入口只做平湖秋月）', () => {
  afterEach(cleanup);

  it('没有底图时只露一枚「西湖 · 平湖秋月」入口，点一下直接铺预设底图', () => {
    const onApply = vi.fn();
    render(<GeoBasemapInput area={undefined} onApply={onApply} view2D={false} />);
    const trigger = screen.getByTestId('geo-basemap-open');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(trigger.textContent).toContain(XIHU_LOCAL_NAME);

    fireEvent.click(trigger);

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as NonNullable<RoomLayout['researchArea']>;
    expect(applied.presetId).toBe('xihu-scenic');
    expect(applied.imageUrl).toBe('/basemap/xihu-scenic-z15.jpg');
    // 简化后不再有搜索地名、半径、样式这些选项。
    expect(screen.queryByTestId('geo-basemap-query')).toBeNull();
    expect(screen.queryByRole('combobox', { name: '底图半径' })).toBeNull();
    expect(screen.queryByText('卫星图')).toBeNull();
  });

  it('有平湖秋月底图时展开只有回到局部/清除，3D 加载与失败都如实说明', () => {
    const onApply = vi.fn();
    const onFrameLocal = vi.fn();
    const onRetryIso = vi.fn();
    const { rerender } = render(<GeoBasemapInput area={PRESET} onApply={onApply} onFrameLocal={onFrameLocal} view2D={false} isoStatus="loading" />);

    fireEvent.click(screen.getByTestId('geo-basemap-open'));
    expect(screen.getByRole('region', { name: '地图设置' })).toBeTruthy();
    expect(screen.getByTestId('geo-basemap-attribution').textContent).toContain('© OpenStreetMap 贡献者');
    expect(screen.getByRole('status').textContent).toContain('正在加载西湖 3D');

    rerender(<GeoBasemapInput area={PRESET} onApply={onApply} onFrameLocal={onFrameLocal} onRetryIso={onRetryIso} view2D={false} isoStatus="fallback" />);
    expect(screen.getByRole('status').textContent).toContain('已退回卫星图');

    fireEvent.click(screen.getByRole('button', { name: '重试 3D' }));
    expect(onRetryIso).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('geo-basemap-frame'));
    expect(onFrameLocal).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('旧的非预设底图可以一步换成平湖秋月，也能清除', () => {
    const onApply = vi.fn();
    render(<GeoBasemapInput area={AREA} onApply={onApply} view2D={false} />);
    fireEvent.click(screen.getByTestId('geo-basemap-open'));
    expect(screen.getByText(AREA.name)).toBeTruthy();
    fireEvent.click(screen.getByTestId('geo-basemap-preset'));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].presetId).toBe('xihu-scenic');

    fireEvent.click(screen.getByTestId('geo-basemap-open'));
    fireEvent.click(screen.getByTestId('geo-basemap-clear'));
    expect(onApply).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('region', { name: '地图设置' })).toBeNull();
  });

  it('2D 平面视图不渲染（底图入口只在 3D 场景）', () => {
    const { container } = render(<GeoBasemapInput area={PRESET} onApply={vi.fn()} view2D />);
    expect(container.querySelector('.sc-geo-basemap')).toBeNull();
  });

  it('Escape 收起设置并还焦点给入口', () => {
    render(<GeoBasemapInput area={PRESET} onApply={vi.fn()} view2D={false} />);
    const trigger = screen.getByTestId('geo-basemap-open');
    fireEvent.click(trigger);
    expect(screen.queryByTestId('geo-basemap-attribution')).toBeTruthy();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByTestId('geo-basemap-attribution')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});