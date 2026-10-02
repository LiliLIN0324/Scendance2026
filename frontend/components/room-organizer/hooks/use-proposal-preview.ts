import { useEffect, useRef, type MutableRefObject } from 'react';
import { createProposalPreview, type ProposalPreview } from '../three/proposal-preview';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

export interface UseProposalPreviewParams {
  isReady: boolean;
  threeModuleRef: MutableRefObject<typeof import('three') | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  layout: RoomLayout;
  candidate: RoomLayout | null;
  activeFloorIndex: number;
  invalidate(): void;
  requestShadowUpdate(): void;
}

/** Call after useSceneEffects. Candidate lives outside persistence/history. */
export function useProposalPreview({ isReady, threeModuleRef, sceneRef, layout, candidate, activeFloorIndex, invalidate, requestShadowUpdate }: UseProposalPreviewParams): void {
  const previewRef = useRef<ProposalPreview | null>(null);
  // If the document changes, never render an old candidate against its new
  // base while the Provider is still propagating onPreview(null).
  const baseRef = useRef<{ candidate: RoomLayout; layout: RoomLayout } | null>(null);
  if (candidate !== baseRef.current?.candidate) baseRef.current = candidate ? { candidate, layout } : null;
  const validCandidate = baseRef.current?.layout === layout ? candidate : null;

  useEffect(() => {
    const THREE = threeModuleRef.current, scene = sceneRef.current;
    if (!isReady || !THREE || !scene || !validCandidate) return undefined;
    const preview = createProposalPreview(THREE, scene, layout, validCandidate, activeFloorIndex);
    previewRef.current = preview;
    requestShadowUpdate();
    invalidate();
    return () => {
      preview.dispose();
      if (previewRef.current === preview) previewRef.current = null;
      requestShadowUpdate();
      invalidate();
    };
  }, [isReady, threeModuleRef, sceneRef, layout, validCandidate, activeFloorIndex, requestShadowUpdate, invalidate]);

  useEffect(() => {
    if (previewRef.current?.refreshOriginals()) {
      requestShadowUpdate();
      invalidate();
    }
  });
}
