// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, type AmapPoint } from '../lib/amap-venue';
import { capturePlan, capturePlanForVenue, type CapturePlan } from '../lib/site-capture';
import { SiteCaptureCard } from './site-capture-card';

/** 12 × 8 米的一块地，换成高德经纬度。 */
function rect(w: number, d: number): AmapPoint[] {
  const kx = metersPerDegreeLng(30.4);
  return [
    { lng: 120.53, lat: 30.4 },
    { lng: 120.53 + w / kx, lat: 30.4 },
    { lng: 120.53 + w / kx, lat: 30.4 + d / METERS_PER_DEGREE_LAT },
    { lng: 120.53, lat: 30.4 + d / METERS_PER_DEGREE_LAT },
  ];
}

function card(plan: CapturePlan, polygon: AmapPoint[], onUpload?: (() => void) | undefined) {
  return <SiteCaptureCard plan={plan} polygon={polygon} name="盐官潮乐之城" location="海宁盐官" {...(onUpload === undefined ? {} : { onUpload })} />;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('现场采集单', () => {
  it('报出总张数，并逐站给出朝向与坐标', () => {
    const polygon = rect(12, 8);
    render(card(capturePlan(polygon), polygon));
    const region = screen.getByRole('region', { name: '现场采集单' });
    expect(within(region).getByText('现场采集单 · 24 张')).toBeTruthy();
    expect(within(region).getByText(/12.+8 m.+一圈.+40 m.+12.+站位/)).toBeTruthy();
    expect(within(region).getByText('看 12 个站位')).toBeTruthy();
    const stops = within(region).getAllByRole('listitem');
    expect(stops).toHaveLength(12);
    expect(within(stops[0]!).getByText('镜头朝东北（56°）')).toBeTruthy();
    expect(within(stops[0]!).getByText('120.530000, 30.400000')).toBeTruthy();
  });

  it('导出的是这一块地的采集单，不是屏幕上的碎片', async () => {
    const polygon = rect(12, 8);
    const captured: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(value => {
      captured.push(value as Blob);
      return 'blob:capture-sheet';
    });
    render(card(capturePlan(polygon), polygon));
    fireEvent.click(screen.getByRole('button', { name: /导出采集单/ }));
    expect(captured).toHaveLength(1);
    expect(await captured[0]!.text()).toContain('盐官潮乐之城 · 海宁盐官 · 场地采集单');
  });

  it('大地块改推绕场视频，小地块不瞎提示', () => {
    const wide = rect(400, 200);
    const { unmount } = render(card(capturePlan(wide), wide));
    expect(screen.getByText(/建议直接录一段绕场视频/)).toBeTruthy();
    unmount();
    const small = rect(12, 8);
    render(card(capturePlan(small), small));
    expect(screen.queryByText(/建议直接录一段绕场视频/)).toBeNull();
  });

  it('圈不出边界就不摆一张空清单', () => {
    render(card(capturePlan([{ lng: 120.53, lat: 30.4 }]), [{ lng: 120.53, lat: 30.4 }]));
    expect(screen.getByText(/这块地圈得太小/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /导出采集单/ })).toBeNull();
  });

  it('有重建入口时才摆上传按钮，点了把这块地交出去', () => {
    const polygon = rect(12, 8);
    const onUpload = vi.fn();
    render(card(capturePlan(polygon), polygon, onUpload));
    const region = screen.getByRole('region', { name: '现场采集单' });
    fireEvent.click(within(region).getByRole('button', { name: /去上传现场素材/ }));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(within(region).getByText(/按真实米数铺在画布上/)).toBeTruthy();
  });

  it('重建入口不可达时不出现一个点不开的门', () => {
    const polygon = rect(12, 8);
    render(card(capturePlan(polygon), polygon));
    expect(screen.queryByRole('button', { name: /去上传现场素材/ })).toBeNull();
    expect(screen.queryByText(/按真实米数铺在画布上/)).toBeNull();
  });

  it('采集单写明禁止高德/卫星当重建素材', () => {
    const polygon = rect(12, 8);
    render(card(capturePlan(polygon), polygon));
    expect(screen.getByText(/禁止把高德瓦片、卫星截图当重建素材/)).toBeTruthy();
  });

  it('流线模式下标题带沿流线，并提示站位沿主客流线', () => {
    const polygon = rect(12, 8);
    render(card(capturePlanForVenue(polygon), polygon));
    const region = screen.getByRole('region', { name: '现场采集单' });
    expect(within(region).getByText(/现场采集单 · \d+ 张 · 沿流线/)).toBeTruthy();
    expect(within(region).getByText(/站位沿主客流线加密/)).toBeTruthy();
  });
});
