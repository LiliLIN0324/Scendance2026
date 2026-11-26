// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { outdoorPlanStorageKey } from '../lib/outdoor-project-store';
import { ProjectThumb } from './project-thumb';

// 旧 layout 平面顺位（区域/门只存在壳体 layout）已随壳退役；云端项目卡只认 plan 正源。

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

const emptyPlan = { schemaVersion: 1, boundary: [], zones: [], facilities: [], routes: [], nodes: [], workers: [] };

const fallback = <span data-testid="mark"/>;

describe('ProjectThumb', () => {
  let mem: MemoryStorage;
  beforeEach(() => {
    mem = new MemoryStorage();
    vi.stubGlobal('Storage', MemoryStorage);
    vi.stubGlobal('localStorage', mem);
    window.localStorage = mem;
    localStorage.clear();
  });
  afterEach(() => { mem?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('先用本机真实定格', () => {
    const { container } = render(<ProjectThumb projectId="p1" cover="data:image/jpeg;base64,AAA" fallback={fallback}/>);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAA');
  });

  it('没有封面时用本机户外规划线稿', async () => {
    writePlan('p3', planWithBoundary);
    const { container } = render(<ProjectThumb projectId="p3" fallback={fallback}/>);
    await waitFor(() => expect(container.querySelector('svg.sc-project-thumb')).toBeTruthy());
  });

  it('空规划时交回描边占位', async () => {
    writePlan('p4', emptyPlan);
    const { container } = render(<ProjectThumb projectId="p4" fallback={fallback}/>);
    await waitFor(() => expect(container.querySelector('[data-testid="mark"]')).toBeTruthy());
    expect(container.querySelector('svg')).toBeNull();
  });
});
