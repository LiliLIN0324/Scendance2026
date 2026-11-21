/**
 * 测试用内存 Storage 基座（#45）。
 *
 * 背景：jsdom 在部分 Node 运行时下只注入 sessionStorage，`window.localStorage`
 * 是一个值为 undefined 的实验占位，导致套件里 `localStorage` 不可用。各测试文件
 * 自行造的 Map mock 满足不了生产/测试代码对标准 Storage 的两条依赖：
 * 1. `Object.keys(localStorage)` 枚举已存键（键要落在实例的可枚举自有属性上，
 *    而不是藏在闭包 Map 里）；
 * 2. `vi.spyOn(Storage.prototype, 'getItem' | 'setItem' | 'removeItem')` 能替换
 *    原型方法，且 `original.call(this, …)` 仍操作当前实例的数据。
 *
 * 设计：
 * - 方法定义在类原型上（可 spy）；数据用 WeakMap 按实例隔离，实例自身不留
 *   可枚举的数据字段，避免 `Object.keys` 混入内部状态。
 * - 写盘时把键同步成实例的可枚举自有属性；删除/清空时一并摘掉。
 *
 * 接入方式（在套件内部，不进全局 setup）：
 * ```ts
 * import { MemoryStorage } from '../lib/test-support-memory-storage';
 * const mem = new MemoryStorage();
 * vi.stubGlobal('Storage', MemoryStorage);
 * vi.stubGlobal('localStorage', mem);
 * ```
 */

const instanceData = new WeakMap<MemoryStorage, Map<string, string>>();

export class MemoryStorage implements Storage {
  constructor() {
    instanceData.set(this, new Map<string, string>());
  }

  private data(): Map<string, string> {
    const store = instanceData.get(this);
    if (!store) throw new Error('MemoryStorage instance state missing');
    return store;
  }

  get length(): number {
    return this.data().size;
  }

  clear(): void {
    const store = this.data();
    for (const key of [...store.keys()]) {
      delete (this as Record<string, unknown>)[key];
    }
    store.clear();
  }

  getItem(key: string): string | null {
    const store = this.data();
    const value = store.get(String(key));
    return value === undefined ? null : value;
  }

  key(index: number): string | null {
    const keys = [...this.data().keys()];
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    const store = this.data();
    const rawKey = String(key);
    store.delete(rawKey);
    delete (this as Record<string, unknown>)[rawKey];
  }

  setItem(key: string, value: string): void {
    const rawKey = String(key);
    const rawValue = String(value);
    this.data().set(rawKey, rawValue);
    Object.defineProperty(this, rawKey, {
      value: rawValue,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}
