// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendSceneToLayout } from '../lib/backend-adapter';
import { PROPOSAL_PREVIEW_TAG } from '../three/proposal-preview';
import { useProposalPreview } from './use-proposal-preview';
import type { RoomLayout } from '../lib/types';

afterEach(cleanup);

describe('proposal preview hook', () => {
  it('removes a stale candidate immediately when its document changes and cleans up on unmount', () => {
    const before = backendSceneToLayout({ schemaVersion: 1, venue: { shape: 'rectangle', width: 12, depth: 10, height: 3, entrances: [] }, objects: [], camera: 'overview', lighting: 'warm' });
    const candidate: RoomLayout = { ...before, floors: [{ ...before.floors[0], items: [{ id: 'chair-test', name: '椅子', type: 'chair', color: '#f0bb88', icon: '', width: 0.5, depth: 0.5, height: 0.9, position: { x: 2, z: 2 } }] }] };
    const scene = new THREE.Scene();
    const params = { isReady: true, threeModuleRef: { current: THREE }, sceneRef: { current: scene }, activeFloorIndex: 0, invalidate: vi.fn(), requestShadowUpdate: vi.fn() };
    function Harness({ layout, preview }: { layout: RoomLayout; preview: RoomLayout | null }) {
      useProposalPreview({ ...params, layout, candidate: preview });
      return null;
    }
    const rendered = render(<Harness layout={before} preview={candidate}/>);
    expect(scene.getObjectByName(PROPOSAL_PREVIEW_TAG)).toBeTruthy();
    const modified = { ...before, width: 14 };
    // A parent onPreview(null) update may arrive one render later. The hook
    // itself must already hide a candidate generated for the earlier draft.
    rendered.rerender(<Harness layout={modified} preview={candidate}/>);
    expect(scene.getObjectByName(PROPOSAL_PREVIEW_TAG)).toBeUndefined();
    rendered.rerender(<Harness layout={modified} preview={{ ...candidate, width: 14 }}/>);
    expect(scene.getObjectByName(PROPOSAL_PREVIEW_TAG)).toBeTruthy();
    rendered.unmount();
    expect(scene.getObjectByName(PROPOSAL_PREVIEW_TAG)).toBeUndefined();
  });
});
