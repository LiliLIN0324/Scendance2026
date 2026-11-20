/** Coalesce expensive preview geometry work. Committed edits always flush immediately. */
export function createPlanPreviewRefresh<T>(render: (value: T) => void, intervalMs = 64) {
  let lastAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let disposed = false;
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const flush = () => {
    clear();
    if (disposed || !pending) return;
    const { value } = pending;
    pending = null;
    lastAt = performance.now();
    render(value);
  };
  return {
    request(value: T, preview: boolean) {
      if (disposed) return;
      pending = { value };
      const delay = intervalMs - (performance.now() - lastAt);
      if (!preview || delay <= 0) flush();
      else if (timer === null) timer = setTimeout(flush, delay);
    },
    dispose() { disposed = true; pending = null; clear(); },
  };
}
