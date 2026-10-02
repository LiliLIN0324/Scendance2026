import { useEffect, useRef, type MutableRefObject } from 'react';
import { createEventAtmosphere, type EventAtmosphere, type EventAtmosphereOptions } from '../three/event-atmosphere';
import type * as ThreeNS from 'three';

export interface UseEventAtmosphereParams extends EventAtmosphereOptions {
  isReady: boolean;
  threeModuleRef: MutableRefObject<typeof import('three') | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  rendererRef: MutableRefObject<ThreeNS.WebGLRenderer | null>;
  invalidate(): void;
}

/** Call AFTER useSceneEffects so saved scene lighting wins over its legacy sun. */
export function useEventAtmosphere({
  isReady, threeModuleRef, sceneRef, rendererRef, invalidate,
  lighting, width, depth, ceilingHeight,
}: UseEventAtmosphereParams): void {
  const atmosphere = useRef<EventAtmosphere | null>(null);

  useEffect(() => {
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!isReady || !THREE || !scene || !renderer) return undefined;
    const rig = createEventAtmosphere(THREE, scene, renderer);
    atmosphere.current = rig;
    return () => {
      rig.dispose();
      if (atmosphere.current === rig) atmosphere.current = null;
    };
  }, [isReady, threeModuleRef, sceneRef, rendererRef]);

  // Deliberately runs after every committed editor render. A lamp edit or
  // scene reopen can trigger the old time-of-day effect independently of our
  // preset. apply() compares state and reuses resources, invalidating only
  // when the actual presentation changed.
  useEffect(() => {
    if (atmosphere.current?.apply({ lighting, width, depth, ceilingHeight })) invalidate();
  });
}
