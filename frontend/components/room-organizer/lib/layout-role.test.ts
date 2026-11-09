import { describe, expect, it } from 'vitest';
import { revisePlan } from './agent-proposal';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { layoutRoleFromAssetName, layoutRoleNote } from './layout-role';

describe('Aholo asset roles', () => {
  it('names a generated asset so layout can move it', () => {
    expect(layoutRoleFromAssetName('主舞台装置')).toBe('舞台');
    expect(layoutRoleFromAssetName('一张白色圆桌')).toBe('桌子');
    const generated = makeItem({
      id: 'stage-gen', type: 'glb-asset', name: '装置A', width: 2, depth: 1, height: 0.4,
      materialId: 'asset', assetId: 'asset-1', source: 'generated', notes: layoutRoleNote('舞台'),
      position: { x: 0, z: 0 }, rotation: 0,
    });
    const layout = makeLayout({ width: 24, height: 16, floors: [makeFloor({ items: [generated] })] });
    const plan = revisePlan({ base: layout, floorIndex: 0, ops: [{ kind: 'move', role: '舞台', delta: { x: 1, z: 0 } }], bands: [] });
    expect(plan.applied).toBeGreaterThan(0);
    expect(plan.layouts.at(-1)?.floors[0]?.items.find(entry => entry.id === 'stage-gen')?.position?.x).toBeCloseTo(1);
    expect(plan.conflicts.map(conflict => conflict.message).join('')).not.toContain('没接住');
  });
});
