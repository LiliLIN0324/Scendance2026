/**
 * 2026-11-17：拿到一块可用的 WebGL 画布，拿不到就返回 null。
 *
 * 为什么不让 three 自己去试：`new THREE.WebGLRenderer()` 在建上下文失败时会**先**
 * `console.error('THREE.WebGLRenderer: A WebGL context could not be created...')`
 * 再抛错。设备没开硬件加速 / 远程桌面 / 嵌入式浏览器里这条 error 会被 Next 开发
 * 面板收成一条 issue，用户看到红屏，其实组件自己的降级 UI 是好的。先在这里用一块
 * 临时 canvas 探一次，并把它直接交给 three（省掉第二次建上下文），调用方就能安静
 * 地走降级分支——控制台不再有任何报错。
 */
export interface WebGLSurface {
  canvas: HTMLCanvasElement;
  context: WebGLRenderingContext;
}

/**
 * 取一个 WebGL2 优先、WebGL1 兜底的上下文。
 *
 * `attributes` 会原样交给 `getContext`：需要 `preserveDrawingBuffer`（导出 PNG）或
 * `powerPreference` 的调用方自己传，别事后改。
 */
export function acquireWebGLSurface(
  attributes: WebGLContextAttributes = {},
): WebGLSurface | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    // WebGL2RenderingContext 在 TS lib 里不是 WebGLRenderingContext 的子类型，
    // 但 three 运行期两者都收（它只看是不是 WebGL 上下文），这里只做类型收口。
    const context = (canvas.getContext('webgl2', attributes)
      ?? canvas.getContext('webgl', attributes)) as unknown as WebGLRenderingContext | null;
    if (!context) return null;
    return { canvas, context };
  } catch {
    // 有的环境 getContext 直接抛（jsdom、被策略禁掉的 iframe），同样是“没有”。
    return null;
  }
}
