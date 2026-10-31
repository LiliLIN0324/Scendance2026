// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, type AmapPoint } from '../lib/amap-venue';
import { ActivityBrief, LayoutAgentProvider, MapRailButton, MapVenueOverlay } from './agent-panel';
import type { RoomLayout } from '../lib/types';
import type { WorkbenchMode } from '../lib/workbench-mode';

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

const state = vi.hoisted(() => ({ layout: null as unknown as RoomLayout, apply: vi.fn() }));

vi.mock('../contexts', () => ({
  useRoomEditor: () => ({
    layout: state.layout,
    activeFloor: state.layout.floors[0],
    activeFloorIndex: 0,
    actions: { applyLayout: state.apply, setFloorPlan: vi.fn() },
    view: { view2D: false },
    setView: vi.fn(),
    collidingIds: new Set<string>(),
  }),
}));
vi.mock('./creative-studio', () => ({
  useStudioAgent: () => ({
    exportActivity: vi.fn(async () => {}), generate: vi.fn(async () => {}), discardPreview: vi.fn(),
    setBrief: vi.fn(), brief: { event: null, guests: null }, hasSavedBrief: false, preview: null,
    stale: false, expired: false, busy: false, recoverable: false, connection: '离线引导',
  }),
}));
// 真实的高德地图在 jsdom 里画不出来，这里只留「圈完一块地」这个动作。
vi.mock('./amap-venue-picker', () => ({
  AmapVenuePicker: ({ onPick }: { onPick(pick: { name: string; location: string; polygon: AmapPoint[] }): void }) =>
    <button type="button" onClick={() => onPick({ name: '盐官潮乐之城', location: '海宁盐官', polygon: rect(12, 8) })}>模拟圈画</button>,
}));

const callbacks = {
  workbenchMode: 'layout' as WorkbenchMode,
  onOpenMaterials: vi.fn(), onSelectMode: vi.fn(), onOpenReview: vi.fn(),
  onOpenDelivery: vi.fn(), onFit: vi.fn(),
};

function harness(opts?: {
  onReconUpload?: (preset: { name: string; hint: string }) => void;
  onHangDemoEnvironment?: () => void;
}) {
  state.layout = makeLayout({ floors: [makeFloor({ items: [] })] });
  return render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={next => { state.layout = next; }}>
    <ActivityBrief tools={[]}/>
    <MapVenueOverlay
      {...(opts?.onReconUpload === undefined ? {} : { onReconUpload: opts.onReconUpload })}
      {...(opts?.onHangDemoEnvironment === undefined ? {} : { onHangDemoEnvironment: opts.onHangDemoEnvironment })}
    />
  </LayoutAgentProvider>);
}

afterEach(() => { cleanup(); });

describe('圈画 → 采集单 → 上传重建', () => {
  it('圈完一块地，采集单留在浮层里，不用重新打开地图', () => {
    harness();
    fireEvent.click(screen.getByRole('button', { name: /地图圈画/ }));
    const overlay = screen.getByRole('dialog', { name: '地图选址' });
    fireEvent.click(within(overlay).getByRole('button', { name: '模拟圈画' }));
    expect(screen.getByRole('dialog', { name: '地图选址' })).toBeTruthy();
    const card = screen.getByRole('region', { name: '现场采集单' });
    expect(within(card).getByText(/现场采集单 · \d+ 张 · 沿流线/)).toBeTruthy();
  });

  it('「去上传现场素材」把这块地的名字和应拍数量交给重建，并收掉浮层', () => {
    const onReconUpload = vi.fn();
    harness({ onReconUpload });
    fireEvent.click(screen.getByRole('button', { name: /地图圈画/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '地图选址' })).getByRole('button', { name: '模拟圈画' }));
    const card = screen.getByRole('region', { name: '现场采集单' });
    fireEvent.click(within(card).getByRole('button', { name: /去上传现场素材/ }));
    expect(onReconUpload).toHaveBeenCalledWith(expect.objectContaining({ name: '盐官潮乐之城' }));
    expect(onReconUpload.mock.calls[0]![0].hint).toMatch(/沿流线 \d+ 个站位 · 共 \d+ 张/);
    expect(screen.queryByRole('dialog', { name: '地图选址' })).toBeNull();
  });

  it('重建入口不在时，浮层里只有采集单这一个出口', () => {
    harness();
    fireEvent.click(screen.getByRole('button', { name: /地图圈画/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '地图选址' })).getByRole('button', { name: '模拟圈画' }));
    expect(screen.queryByRole('button', { name: /去上传现场素材/ })).toBeNull();
  });

  it('D0：立壳成功后挂历史环境并收起浮层；再开地图采集单还在', () => {
    const onHang = vi.fn();
    harness({ onHangDemoEnvironment: onHang });
    fireEvent.click(screen.getByRole('button', { name: /地图圈画/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '地图选址' })).getByRole('button', { name: '模拟圈画' }));
    expect(onHang).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '地图选址' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /地图圈画/ }));
    expect(screen.getByRole('region', { name: '现场采集单' })).toBeTruthy();
  });

  it('左轨那颗地图是同一个开关：点开浮层，再点收回去', () => {
    state.layout = makeLayout({ floors: [makeFloor({ items: [] })] });
    render(<LayoutAgentProvider callbacks={callbacks} onPreview={vi.fn()} onApply={vi.fn()}>
      <MapRailButton/>
      <MapVenueOverlay/>
    </LayoutAgentProvider>);
    const rail = screen.getByRole('button', { name: '地图选址' });
    expect(rail.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(rail);
    expect(screen.getByRole('dialog', { name: '地图选址' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '地图选址' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '地图选址' }));
    expect(screen.queryByRole('dialog', { name: '地图选址' })).toBeNull();
  });
});
