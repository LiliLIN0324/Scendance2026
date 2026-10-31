/** 高德 JS API 只在浏览器里加载一次。Key 由调用方从 NEXT_PUBLIC_AMAP_* 或本机存储传入，不在这里粘贴。 */

export const AMAP_KEY_STORAGE = 'scendance:amap-key';
export const AMAP_SECURITY_STORAGE = 'scendance:amap-security';
const SCRIPT_ID = 'scendance-amap-script';

export interface AmapPlaceSearch {
  search(keyword: string, cb: (status: string, result: unknown) => void): void;
}

export interface AmapNamespace {
  PlaceSearch?: new (opts: Record<string, unknown>) => AmapPlaceSearch;
  Map?: new (...args: unknown[]) => unknown;
  MouseTool?: new (...args: unknown[]) => unknown;
  TileLayer?: { Satellite?: new () => { setMap(map: unknown): void; show(): void } };
}

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode: string };
    AMap?: AmapNamespace;
  }
}

let loaderPromise: Promise<void> | null = null;

export function loadAmapScript(key: string, security: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('高德脚本只能在浏览器里加载'));
  if (window.AMap) return Promise.resolve();
  if (loaderPromise) return loaderPromise;
  window._AMapSecurityConfig = { securityJsCode: security };
  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.PlaceSearch,AMap.MouseTool,AMap.ToolBar`;
    script.onload = () => resolve();
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error('高德脚本加载失败，检查网络与 Key 域名白名单（需含 localhost:3000）。'));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}
