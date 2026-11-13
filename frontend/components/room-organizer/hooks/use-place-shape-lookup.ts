import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPlaceShape } from '../lib/place-area';

type Shape = NonNullable<Awaited<ReturnType<typeof fetchPlaceShape>>>;
/** One current lookup, including its retry timer and in-flight request, per project. */
export function usePlaceShapeLookup(projectId: string, onShape: (shape: Shape, name: string) => void, boundaryRevision = '') {
  const [loading, setLoading] = useState(false);
  const currentProject = useRef(projectId); currentProject.current = projectId;
  const currentBoundary = useRef(boundaryRevision); currentBoundary.current = boundaryRevision;
  const callback = useRef(onShape); callback.current = onShape;
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => {
    seq.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    request.current?.abort(); request.current = null;
  }, []);
  const cancel = useCallback(() => { invalidate(); setLoading(false); }, [invalidate]);
  useEffect(() => { cancel(); return invalidate; }, [projectId, boundaryRevision, cancel, invalidate]);
  const start = useCallback((name: string, near: { lng: number; lat: number }) => {
    cancel();
    const version = seq.current; const project = currentProject.current; const boundary = currentBoundary.current;
    const controller = new AbortController(); request.current = controller;
    const active = () => seq.current === version && currentProject.current === project && currentBoundary.current === boundary && !controller.signal.aborted;
    setLoading(true);
    const attempt = async (index: number): Promise<void> => {
      if (!active()) return; // No stale network request, even if an old timer was queued.
      timer.current = null;
      let shape: Shape | null = null;
      try { shape = await fetchPlaceShape(name, { near, signal: controller.signal }); } catch { /* transient */ }
      if (!active()) return;
      if (!shape && index < 2) { timer.current = setTimeout(() => { void attempt(index + 1); }, 9000); return; }
      setLoading(false);
      if (shape) callback.current(shape, name);
    };
    void attempt(0);
  }, [cancel]);
  return { loading, start, cancel };
}
