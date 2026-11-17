import { beforeEach, vi } from 'vitest';
import { clearSupabaseBrowserCookies } from './lib/supabase/client';

/**
 * Node 26 暴露了实验性 localStorage（未带 --localstorage-file 时为 undefined），
 * jsdom 30 因此不再安装自己的 Storage，导致大量 React 套件在 beforeEach 就挂。
 * 只在缺失时补一个内存实现；真实浏览器/已注入环境不覆盖。
 */
type MemoryStorageHost = { __memory?: Map<string, string> };

function ensureMemoryStorage(name: 'localStorage' | 'sessionStorage'): void {
  try {
    if (typeof (globalThis as Record<string, unknown>)[name] !== 'undefined') return;
  } catch {
    // Node 的实验性 getter 可能直接抛错，继续走下面的兜底。
  }
  // 有 Storage 构造器时挂到原型上：测试里的 vi.spyOn(Storage.prototype, 'getItem')
  // 仍能注入读失败，和真浏览器/jsdom 的行为一致。
  if (typeof Storage !== 'undefined' && typeof document !== 'undefined') {
    try {
      Object.defineProperties(Storage.prototype, {
        getItem: { configurable: true, writable: true, value(this: MemoryStorageHost, key: string) { return this.__memory?.get(String(key)) ?? null; } },
        setItem: { configurable: true, writable: true, value(this: MemoryStorageHost, key: string, value: string) { this.__memory?.set(String(key), String(value)); } },
        removeItem: { configurable: true, writable: true, value(this: MemoryStorageHost, key: string) { this.__memory?.delete(String(key)); } },
        clear: { configurable: true, writable: true, value(this: MemoryStorageHost) { this.__memory?.clear(); } },
        key: { configurable: true, writable: true, value(this: MemoryStorageHost, index: number) { return Array.from(this.__memory?.keys() ?? [])[index] ?? null; } },
        length: { configurable: true, get(this: MemoryStorageHost) { return this.__memory?.size ?? 0; } },
      });
      const storage = Object.create(Storage.prototype) as MemoryStorageHost;
      storage.__memory = new Map();
      Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
      return;
    } catch {
      // 某些运行时的 Storage.prototype 不可改：退回下面的普通对象。
    }
  }
  const map = new Map<string, string>();
  const storage = {
    get length() { return map.size; },
    clear: () => { map.clear(); },
    getItem: (key: string) => map.get(String(key)) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => { map.delete(String(key)); },
    setItem: (key: string, value: string) => { map.set(String(key), String(value)); },
  };
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
}

ensureMemoryStorage('localStorage');
ensureMemoryStorage('sessionStorage');

// layout.tsx 用 next/font/local 接 Inter 与 Playfair；jsdom 里没有字体管线，mock 成空壳。
vi.mock('next/font/local', () => ({
  default: (options?: { variable?: string }) => {
    const variable = options?.variable ?? '--font-local';
    return { variable, style: { fontFamily: 'var(' + variable + ')' } };
  },
}));

beforeEach(() => {
  clearSupabaseBrowserCookies();
  if (typeof document !== 'undefined') {
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0]?.trim();
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});