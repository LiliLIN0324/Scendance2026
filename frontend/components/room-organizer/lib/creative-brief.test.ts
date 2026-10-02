import { describe, expect, it } from 'vitest';
import { backendSceneToLayout, layoutToBackendScene } from './backend-adapter';
import { briefInstruction, INITIAL_BRIEF, mergeProposalPresentation } from './creative-brief';
import type { Scene } from '@/lib/backend-session';

const scene: Scene = { schemaVersion: 1, venue: { width: 12, depth: 10, height: 3, shape: 'rectangle', entrances: [] }, camera: 'overview', lighting: 'neutral', objects: [{ id: '10000000-0000-4000-8000-000000000001', materialId: 'chair', position: { x: 2, z: 2 }, rotation: 0, size: { width: .5, depth: .5, height: .9 }, color: '#ffffff', locked: false, notes: '' }] };

describe('creative brief boundaries', () => {
  it('rejects attendance beyond the current backend limit and invalid input before generation', () => {
    const brief = { ...INITIAL_BRIEF, description: '交流活动' };
    for (const guests of [0, 1.5, 41, 100, NaN]) expect(() => briefInstruction({ ...brief, guests }, 12, 10)).toThrow('1–40');
    expect(() => briefInstruction(INITIAL_BRIEF, 12, 10)).toThrow('描述');
    expect(briefInstruction({ ...brief, guests: 40 }, 12, 10)).toContain('40人');
  });

  it('does not imply image understanding or silently adopt optional ideas', () => {
    const instruction = briefInstruction({ ...INITIAL_BRIEF, description: '要帐篷和签到区' }, 12, 10);
    expect(instruction).toContain('未经客户确认不得自动加入');
    expect(instruction).toContain('参考图片尚未提交给模型');
    expect(instruction).toContain('不得用桌椅冒充');
    expect(briefInstruction({ ...INITIAL_BRIEF, description: '交流会', allowIdeas: false }, 12, 10)).toContain('不自行扩展');
  });

  it('persists the default warm atmosphere of a local draft', () => {
    const local = backendSceneToLayout(scene);
    delete local.backendLighting;
    expect(layoutToBackendScene(local).lighting).toBe('warm');
  });

  it('keeps local presentation while applying only server-authorized scene changes', () => {
    const base = backendSceneToLayout(scene);
    base.floors[0]!.floorColor = '#ff0000';
    base.floors[0]!.items[0]!.name = '客户选定的座椅';
    base.floors[0]!.items[0]!.groupId = 'local-group';
    const changed = structuredClone(scene);
    changed.objects[0]!.position.x = 6;
    changed.lighting = 'cool';
    const next = mergeProposalPresentation(base, backendSceneToLayout(changed));
    expect(next.floors[0]!.floorColor).toBe('#ff0000');
    expect(next.floors[0]!.items[0]).toMatchObject({ name: '客户选定的座椅', groupId: 'local-group' });
    expect(layoutToBackendScene(next)).toEqual(changed);
    expect(layoutToBackendScene(base)).toEqual(scene);
  });
});
