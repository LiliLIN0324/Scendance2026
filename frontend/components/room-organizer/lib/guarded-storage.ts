import {captureWorkspaceWriteFence} from '@/lib/workspace-write-fence';
/** Synchronous guard at every actual mutation; reads retain the original Storage receiver. */
export function withStorageWriteGuard<T extends object>(storage: T, assertWrite?: () => void): T {
  const fence=captureWorkspaceWriteFence();
  if (!assertWrite && !fence) return storage;
  return new Proxy(storage, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    if (key === 'setItem' || key === 'removeItem' || key === 'clear') return (...args: unknown[]) => {
      fence?.(); assertWrite?.(); return value.apply(target, args);
    };
    return value.bind(target);
  } });
}
