/** 高德 JS API 只在浏览器里加载一次。Key 由调用方从 NEXT_PUBLIC_AMAP_* 或本机存储传入，不在这里粘贴。 */

export const AMAP_KEY_STORAGE = 'scendance:amap-key';
export const AMAP_SECURITY_STORAGE = 'scendance:amap-security';
const SCRIPT_ID = 'scendance-amap-script';

export interface AmapPlaceSearch {
  search(keyword: string, cb: (status: string, result: unknown) => void): void;
}

/** 输入提示（联想）。2.0 版插件名为 AMap.AutoComplete（1.4 时代叫 Autocomplete，勿混用）。 */
export interface AmapAutoComplete {
  search(keyword: string, cb: (status: string, result: unknown) => void): void;
}

export interface AmapNamespace {
  PlaceSearch?: new (opts: Record<string, unknown>) => AmapPlaceSearch;
  AutoComplete?: new (opts: Record<string, unknown>) => AmapAutoComplete;
  Map?: new (...args: unknown[]) => unknown;
  MouseTool?: new (...args: unknown[]) => unknown;
  // 2026-11-11 用户 m00690：选址圈画不再叠 AMap.TileLayer.Satellite 卫星切片，
  // 这里随之去掉 TileLayer 声明（插件列表里本来也没有它）。
}

// 高德 Key 的域名白名单只放行线上域名时，localhost 会被回 10006（INVALID_USER_DOMAIN）并用 JSON 顶掉脚本，
// 浏览器按 ORB 直接拦掉。本机 dev 改走 3199 代理拉脚本 + 代理服务请求，线上仍直连。
const AMAP_DEV_PROXY = 'http://127.0.0.1:3199';
const AMAP_PLUGINS = 'AMap.PlaceSearch,AMap.AutoComplete,AMap.MouseTool,AMap.ToolBar';

/** 当前页面是否要用本机代理；只有 localhost / 127.0.0.1 才启用，线上域名保持直连。 */
export function amapDevProxyOrigin(): string {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' ? AMAP_DEV_PROXY : '';
}

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string };
    AMap?: AmapNamespace;
  }
}

let loaderPromise: Promise<void> | null = null;

const PROXY_DOWN_HINT = '地图降级：本机地图代理未运行（127.0.0.1:3199）。请用 npm run dev 启动，代理会随 dev 自动拉起；若仍失败，检查 3199 端口是否被占用。';

/**
 * 代理的 /health 探活，避免把「代理没起」误报成 Key 被拒。
 * dev 刚启动时代理可能还在回源预热，单次 1.5s 会误判降级，这里给约 4s 的短重试窗口。
 */
async function assertDevProxy(proxy: string): Promise<void> {
  const attempts = 5;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${proxy}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      // 继续重试
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(PROXY_DOWN_HINT);
}

export function loadAmapScript(key: string, security: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('高德脚本只能在浏览器里加载'));
  if (window.AMap) return Promise.resolve();
  if (loaderPromise) return loaderPromise;
  const proxy = amapDevProxyOrigin();
  window._AMapSecurityConfig = proxy
    // 设了 securityJsCode 高德就不会走 serviceHost，所以本机只给 serviceHost，
    // 安全密钥由 3199 代理在回源时补 jscode。
    ? { serviceHost: `${proxy}/_AMapService` }
    : { securityJsCode: security };
  loaderPromise = (async () => {
    if (proxy) await assertDevProxy(proxy);
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      const query = `v=2.0&key=${encodeURIComponent(key)}&plugin=${AMAP_PLUGINS}`;
      script.src = proxy ? `${proxy}/amap-js?${query}` : `https://webapi.amap.com/maps?${query}`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(proxy
        ? '地图降级：本机代理已启动，但脚本回源失败。请检查 Key 是否被高德放行（INVALID_USER_DOMAIN / 10006），或 3199 代理是否返回 200。'
        : '地图降级：Key 没被高德放行，或网络不通。'));
      document.head.appendChild(script);
    });
  })();
  loaderPromise.catch(() => {
    loaderPromise = null;
  });
  return loaderPromise;
}
