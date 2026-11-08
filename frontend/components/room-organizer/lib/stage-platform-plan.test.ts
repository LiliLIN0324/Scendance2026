import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { proposeStagePlatform, STAGE_PLATFORM_ASSET_ID } from './stage-platform-plan';
import { checkFunctionalRequirements } from './functional-requirements';
import { parseStoredLayout } from './schema';
import { backendSceneToLayout, layoutToBackendScene } from './backend-adapter';

const base = () => makeLayout({ width: 12, height: 10, roof: { style: 'none' }, floors: [makeFloor({ items: [] })] });
const stageCheck = (layout: ReturnType<typeof base>) => checkFunctionalRequirements(layout, 0, { checkin: null, stage: true })[1];

describe('舞台平台候选', () => {
  it('adds a public asset without moving existing furniture and persists its actual dimensions', () => {
    const layout = base();
    layout.floors[0]!.items.push(makeItem({ id: '73edda40-e9e5-4cc0-8768-46d7ff634f16', position: { x: 4, z: 3 }, locked: true }));
    const before = structuredClone(layout);
    const result = proposeStagePlatform(layout, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(layout).toEqual(before);
    expect(result.layout.floors[0]!.items[0]).toEqual(before.floors[0]!.items[0]);
    expect(result.item).toMatchObject({ assetId: STAGE_PLATFORM_ASSET_ID, width: 2, depth: 2.0430251546437157, height: 0.6000183290813681 });
    const saved = parseStoredLayout(JSON.parse(JSON.stringify(result.layout)));
    expect(saved?.floors[0]!.items.find(item => item.id === result.item.id)).toEqual(result.item);
    expect(stageCheck(saved!)?.status).toBe('pass');
    const loaded = backendSceneToLayout(layoutToBackendScene(result.layout));
    expect(loaded.floors[0]!.items.find(item => item.id === result.item.id)?.assetId).toBe(STAGE_PLATFORM_ASSET_ID);
    expect(stageCheck(loaded)?.status).toBe('pass');
  });

  it('does not treat a backdrop or arbitrary asset containing 舞台 in its name as the platform', () => {
    const layout = base();
    layout.floors[0]!.items.push(makeItem({ id: 'backdrop', type: 'backdrop', name: '舞台背景板' }),
      makeItem({ id: 'asset', type: 'glb-asset', materialId: 'asset', assetId: 'other', name: '舞台灯' }));
    expect(stageCheck(layout)?.status).toBe('unknown');
  });

  it('returns an honest search failure without changing the original when the space is too small', () => {
    const layout = { ...base(), width: 1, height: 1 }, before = structuredClone(layout);
    const result = proposeStagePlatform(layout, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('这次搜索');
    expect(layout).toEqual(before);
  });

  it('searches away from existing furniture and known door positions', () => {
    const layout = base();
    layout.floors[0]!.items.push(makeItem({ id: 'door', type: 'door', width: 1, depth: 0.12,
      position: { x: -4.7, z: -3.678487422678142 }, locked: true }));
    const first = proposeStagePlatform(layout, 0);
    expect(first.ok).toBe(true);
    if (!first.ok || !first.item.position) return;
    expect(first.item.position.x).not.toBeCloseTo(-4.7);
    const withObstacle = base();
    withObstacle.floors[0]!.items.push(makeItem({ id: 'obstacle', width: 2, depth: 2.0430251546437157,
      position: first.item.position, locked: true }));
    const next = proposeStagePlatform(withObstacle, 0);
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.item.position).not.toEqual(first.item.position);
    expect(withObstacle.floors[0]!.items).toHaveLength(1);
  });
});
