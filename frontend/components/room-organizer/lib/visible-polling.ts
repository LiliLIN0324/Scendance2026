/**
 * 可见性轮询：页面隐藏时停表，回到前台立刻补跑一次再按间隔继续。
 * 返回停止函数，调用方在卸载或释放时必须执行，避免定时器与监听器残留。
 * 没有 document 的运行环境（服务端渲染、node 测试）退化为常规定时器。
 */
export function startVisiblePolling(run: () => void, intervalMs: number): () => void {
  if (typeof document === 'undefined') {
    const timer = setInterval(run, intervalMs);
    return () => clearInterval(timer);
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (timer !== null) return;
    timer = setInterval(() => { if (!document.hidden) run(); }, intervalMs);
  };
  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };
  const onVisibilityChange = () => {
    if (document.hidden) { stop(); return; }
    if (timer !== null) return;
    start();
    run();
  };
  if (!document.hidden) start();
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
