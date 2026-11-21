// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLocalActivity } from '@/lib/local-activities';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { outdoorPlanStorageKey } from '../lib/outdoor-project-store';
import type { RoomLayout } from '../lib/types';
import { ProjectThumb } from './project-thumb';

// 三维单帧（老的室内壳体）已从卡片撤掉；这里只验「画什么」，平面缩略用标记代替真实 2D 渲染。
vi.mock('./plan-thumb', () => ({ PlanThumb: () => <canvas data-testid="plan-thumb"/> }));
vi.mock('@/lib/local-activities', () => ({ readLocalActivity: vi.fn() }));

const readActivity = vi.mocked(readLocalActivity);

/** 用户新增的室内区域 + 门：只在 layout 里，云端 scene 不含这些。 */
const layoutWithZonesAndDoor = {
  id: 'a1', name: '新活动', width: 10, height: 8,
  floors: [{
    id: 'f1', name: '活动场地', height: 3, floorColor: '#f5f6f7',
    zones: [{ id: 'z1', name: '签到区', polygon: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }], color: '#9fb3aa' }],
    items: [{ id: 'd1', type: 'door', name: '主要出入口', width: 2, depth: 0.12, height: 2.2, color: '#d6c7a4', position: { x: 0, z: 0 }, rotation: 0, locked: true, venueEntranceId: 'e1' }],
  }],
} as unknown as RoomLayout;

const emptyLayout = {
  id: 'a2', name: '新活动', width: 10, height: 8,
  floors: [{ id: 'f1', name: '活动场地', height: 3, floorColor: '#f5f6f7', zones: [], items: [] }],
} as unknown as RoomLayout;

function writePlan(projectId: string, plan: unknown): void {
  localStorage.setItem(outdoorPlanStorageKey(projectId), JSON.stringify({
    v: 1, projectId, name: '新活动', createdAt: '2026-11-18T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z', plan,
  }));
}

const planWithBoundary = {
  schemaVersion: 1,
  boundary: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }],
  zones: [], facilities: [], routes: [], nodes: [], workers: [],
};

const fallback = <span data-testid="mark"/>;

describe('ProjectThumb', () => {
  let mem: MemoryStorage;
  beforeEach(() => {
    mem = new MemoryStorage();
    vi.stubGlobal('Storage', MemoryStorage);
    vi.stubGlobal('localStorage', mem);
    window.localStorage = mem;
    localStorage.clear();
    readActivity.mockReset();
    readActivity.mockRejectedValue(new Error('没有本机归档'));
  });
  afterEach(() => { mem?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('先用本机真实定格', async () => {
    readActivity.mockResolvedValue({ layout: layoutWithZonesAndDoor } as never);
    const { container } = render(<ProjectThumb projectId="p1" cover="data:image/jpeg;base64,AAA" fallback={fallback}/>);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAA');
    await waitFor(() => expect(container.querySelector('canvas')).toBeNull());
  });

  it('区域与门在本机 layout 里：画平面缩略，不画三维壳体', async () => {
    readActivity.mockResolvedValue({ layout: layoutWithZonesAndDoor } as never);
    const { container } = render(<ProjectThumb projectId="p2" fallback={fallback}/>);
    await waitFor(() => expect(container.querySelector('[data-testid="plan-thumb"]')).toBeTruthy());
  });

  it('本机活动 id 与云项目 id 不同也能接回平面（升云项目）', async () => {
    readActivity.mockImplementation((async (id: string) => {
      if (id === 'local-1') return { layout: layoutWithZonesAndDoor } as never;
      throw new Error('没有本机归档');
    }) as never);
    const { container } = render(<ProjectThumb projectId="cloud-1" aliasId="local-1" fallback={fallback}/>);
    await waitFor(() => expect(container.querySelector('[data-testid="plan-thumb"]')).toBeTruthy());
  });

  it('没有本机平面时用本机户外规划线稿', async () => {
    writePlan('p3', planWithBoundary);
    const { container } = render(<ProjectThumb projectId="p3" fallback={fallback}/>);
    await waitFor(() => expect(container.querySelector('svg.sc-project-thumb')).toBeTruthy());
    expect(container.querySelector('[data-testid="plan-thumb"]')).toBeNull();
  });

  it('本机平面是空壳时不算预览，也不退回三维壳体', async () => {
    readActivity.mockResolvedValue({ layout: emptyLayout } as never);
    writePlan('p4', { schemaVersion: 1, boundary: [], zones: [], facilities: [], routes: [], nodes: [], workers: [] });
    const { container } = render(<ProjectThumb projectId="p4" fallback={fallback}/>);
    await waitFor(() => expect(container.querySelector('[data-testid="mark"]')).toBeTruthy());
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });
});
