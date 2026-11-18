import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPlaceShape } from '../lib/place-area';

type Shape = NonNullable<Awaited<ReturnType<typeof fetchPlaceShape>>>;
/** One bounded lookup per selection; no automatic retry loops. */
export function usePlaceShapeLookup(projectId: string, onShape: (shape: Shape, name: string) => void, boundaryRevision = '') {
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
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
  const cancel = useCallback(() => { invalidate(); setLoading(false); setUnavailable(false); }, [invalidate]);
  useEffect(() => { cancel(); return invalidate; }, [projectId, boundaryRevision, cancel, invalidate]);
  const start = useCallback((name: string, near: { lng: number; lat: number }) => {
    cancel();
    const version = seq.current; const project = currentProject.current; const boundary = currentBoundary.current;
    const controller = new AbortController(); request.current = controller;
    const active = () => seq.current === version && currentProject.current === project && currentBoundary.current === boundary && !controller.signal.aborted;
    setLoading(true);
    // 包含传输与解析的总预算；即使底层请求不响应取消，也不能持续转圈或晚到覆盖手画。
    timer.current = setTimeout(() => {
      if (!active()) return;
      controller.abort(); request.current = null; timer.current = null;
      setLoading(false); setUnavailable(true);
    }, 21000);
    const attempt = async (): Promise<void> => {
      let shape: Shape | null = null;
      try { shape = await fetchPlaceShape(name, { near, signal: controller.signal }); } catch { /* transient */ }
      if (!active()) return;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null; request.current = null;
      controller.abort();
      setLoading(false); setUnavailable(!shape);
      if (shape) callback.current(shape, name);
    };
    void attempt();
  }, [cancel]);
  return { loading, unavailable, start, cancel };
}
