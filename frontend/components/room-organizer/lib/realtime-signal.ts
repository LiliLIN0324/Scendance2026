'use client';

import { useEffect, useState } from 'react';
import { getBackendConfig } from '@/lib/backend-session';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 未读/私信的 Realtime 信号：服务端写完消息后推一条「谁动了哪条」的广播，
 * 前端收到就重拉一次；正文永远走带鉴权的接口，广播里没有消息内容。
 *
 * 频道是公开广播，订阅只要 anon key。整页只保留一个频道（同账号多组件共用），
 * 没连上就不订阅、轮询照旧，连上后轮询退到兜底频率。
 */
export type UserSignalEvent = 'message' | 'message-read';

export interface UserSignal {
  studioId?: string;
  fromUserId?: string;
  toUserId?: string;
  byUserId?: string;
  messageId?: string;
  marked?: number;
  at?: string;
}

export type UserSignalListener = (event: UserSignalEvent, payload: UserSignal) => void;

const SIGNAL_EVENTS: readonly UserSignalEvent[] = ['message', 'message-read'];

/** 频道名只带收件人 userId；服务端 userSignalTopic 必须保持同一格式。 */
export function userSignalTopic(userId: string): string {
  return `scendance:user:${userId}`;
}

interface SignalConnection {
  userId: string;
  client: SupabaseClient;
  channel: ReturnType<SupabaseClient['channel']>;
  live: boolean;
}

const listeners = new Set<UserSignalListener>();
const statusListeners = new Set<() => void>();
let connection: SignalConnection | null = null;

function notifyStatus(): void {
  for (const listener of [...statusListeners]) listener();
}

function connect(userId: string): void {
  const config = getBackendConfig();
  // 没配置 Supabase 时保持轮询，不建一个连不上的频道。
  if (!config.configured) return;
  const client = createSupabaseBrowserClient(config.url, config.anonKey);
  const channel = client.channel(userSignalTopic(userId));
  for (const event of SIGNAL_EVENTS) {
    channel.on('broadcast', { event }, message => {
      const payload = (message.payload ?? {}) as UserSignal;
      for (const listener of [...listeners]) listener(event, payload);
    });
  }
  const attached: SignalConnection = { userId, client, channel, live: false };
  connection = attached;
  channel.subscribe(state => {
    // 频道可能在退出登录后重连失败，只认当前这条连接的状态。
    if (connection !== attached) return;
    const live = state === 'SUBSCRIBED';
    if (attached.live === live) return;
    attached.live = live;
    notifyStatus();
  });
}

function disconnect(): void {
  const current = connection;
  if (!current) return;
  connection = null;
  notifyStatus();
  try { void current.client.removeChannel(current.channel); } catch { /* 套接字已经断了就没什么可回收的。 */ }
}

/** 订阅当前用户的广播：多个组件共用一条连接，最后一个退订时关掉。 */
export function subscribeUserSignals(userId: string, listener: UserSignalListener): () => void {
  if (!userId) return () => undefined;
  listeners.add(listener);
  if (connection?.userId !== userId) {
    disconnect();
    connect(userId);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disconnect();
  };
}

export function signalsLive(userId: string): boolean {
  return connection?.userId === userId && connection.live;
}

/** 连接状态变化（连上/断开）时通知；用来切换轮询回退间隔。 */
export function subscribeSignalStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

/** 广播连上没有：连上后轮询降频，没连上保持原频率。 */
export function useSignalsLive(userId: string): boolean {
  const [live, setLive] = useState(() => signalsLive(userId));
  useEffect(() => {
    setLive(signalsLive(userId));
    return subscribeSignalStatus(() => setLive(signalsLive(userId)));
  }, [userId]);
  return live;
}
