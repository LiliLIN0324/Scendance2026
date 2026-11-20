import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeChannel {
  topic: string;
  handlers: Map<string, ((message: { payload?: unknown }) => void)[]>;
  emitStatus: ((state: string) => void) | null;
}

function fakeSupabase() {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  const client = {
    channel(topic: string) {
      const handlers = new Map<string, ((message: { payload?: unknown }) => void)[]>();
      const channel: FakeChannel = { topic, handlers, emitStatus: null };
      const api = {
        topic,
        on(_type: string, filter: { event: string }, handler: (message: { payload?: unknown }) => void) {
          handlers.set(filter.event, [...(handlers.get(filter.event) ?? []), handler]);
          return api;
        },
        subscribe(callback: (state: string) => void) {
          channel.emitStatus = callback;
          return api;
        },
      };
      channels.push(channel);
      Object.assign(channel, api);
      return api;
    },
    removeChannel(channel: unknown) {
      removed.push(channel as FakeChannel);
      return Promise.resolve('ok');
    },
  };
  return { client, channels, removed };
}

async function loadModule(client: unknown, configured = true) {
  vi.resetModules();
  vi.doMock('@/lib/backend-session', () => ({
    getBackendConfig: () => ({ configured, url: 'https://demo.supabase.co', anonKey: 'anon-key', apiUrl: 'https://demo.supabase.co/functions/v1/scene-api', error: null }),
  }));
  vi.doMock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: () => client }));
  return import('./realtime-signal');
}

describe('realtime-signal', () => {
  beforeEach(() => { vi.resetModules(); });

  it('多人订阅只开一个频道，广播按事件转发给每个监听者', async () => {
    const { client, channels } = fakeSupabase();
    const signal = await loadModule(client);
    const first = vi.fn(), second = vi.fn();

    const stopFirst = signal.subscribeUserSignals('u-1', first);
    const stopSecond = signal.subscribeUserSignals('u-1', second);
    expect(channels).toHaveLength(1);
    expect(channels[0]!.topic).toBe(signal.userSignalTopic('u-1'));

    channels[0]!.handlers.get('message')!.forEach(handler => handler({ payload: { studioId: 's-1' } }));
    expect(first).toHaveBeenCalledWith('message', { studioId: 's-1' });
    expect(second).toHaveBeenCalledWith('message', { studioId: 's-1' });

    stopFirst();
    stopSecond();
  });

  it('最后一个订阅退掉后回收频道，连上状态跟着订阅回调走', async () => {
    const { client, channels, removed } = fakeSupabase();
    const signal = await loadModule(client);

    expect(signal.signalsLive('u-2')).toBe(false);
    const stop = signal.subscribeUserSignals('u-2', vi.fn());
    expect(signal.signalsLive('u-2')).toBe(false);
    channels[0]!.emitStatus!('SUBSCRIBED');
    expect(signal.signalsLive('u-2')).toBe(true);

    stop();
    expect(signal.signalsLive('u-2')).toBe(false);
    expect(removed).toHaveLength(1);
  });

  it('没配置 Supabase 时不建频道，退订返回空函数', async () => {
    const { client, channels } = fakeSupabase();
    const signal = await loadModule(client, false);
    const listener = vi.fn();

    const stop = signal.subscribeUserSignals('u-3', listener);
    expect(channels).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });
});
