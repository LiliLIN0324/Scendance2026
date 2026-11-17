// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireWebGLSurface } from './webgl-context';

type GetContext = typeof HTMLCanvasElement.prototype.getContext;
const original = HTMLCanvasElement.prototype.getContext;

function stubContext(impl: (type: string) => unknown): { mock: { calls: unknown[][] } } {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((type: string) => impl(type)) as unknown as GetContext,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  HTMLCanvasElement.prototype.getContext = original;
});

describe('acquireWebGLSurface', () => {
  it('拿不到上下文时安静地返回 null，不抛错', () => {
    const spy = stubContext(() => null);
    expect(acquireWebGLSurface()).toBeNull();
    // WebGL2 优先，再退 WebGL1。
    expect(spy.mock.calls.map(call => call[0])).toEqual(['webgl2', 'webgl']);
  });

  it('优先复用 WebGL2 上下文，并把同一块 canvas 交出去', () => {
    const context = { name: 'webgl2' };
    stubContext(type => (type === 'webgl2' ? context : null));
    const surface = acquireWebGLSurface({ antialias: true });
    expect(surface?.context).toBe(context);
    expect(surface?.canvas).toBeInstanceOf(HTMLCanvasElement);
  });

  it('WebGL2 不可用时退到 WebGL1', () => {
    const context = { name: 'webgl1' };
    stubContext(type => (type === 'webgl' ? context : null));
    expect(acquireWebGLSurface()?.context).toBe(context);
  });

  it('getContext 直接抛错（被策略禁掉的 iframe）也当成没有', () => {
    stubContext(() => { throw new Error('blocked'); });
    expect(acquireWebGLSurface()).toBeNull();
  });
});
