'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listTeamMessages, listTeamUnread, markTeamMessagesRead, sendTeamMessage, type TeamMessage } from '@/lib/workspace-api';
import { subscribeUserSignals, useSignalsLive } from './realtime-signal';
import { startVisiblePolling } from './visible-polling';
import type { BackendSession } from '@/lib/backend-session';

const UNREAD_POLL_MS = 20_000;
/** 广播连上后未读只做兜底巡检：漏一条也能在一分钟内补上。 */
const UNREAD_FALLBACK_MS = 60_000;
/** 公开频道谁都能推，收到信号也至少隔 2 秒才重拉，避免被灌成无限请求。 */
const SIGNAL_REFRESH_FLOOR_MS = 2_000;

/** 同一份团队未读只允许一个定时器：多个组件各挂一个 hook 时共用这里的缓存与请求。 */
interface UnreadEntry {
  key: string;
  controller: BackendSession;
  studioId: string;
  userId: string;
  counts: Map<string, number>;
  request: number;
  /** 上次因广播重拉的时间，用来给公开频道加一个最小间隔。 */
  lastSignalAt: number;
  listeners: Set<(counts: Map<string, number>) => void>;
}
const unreadEntries = new Map<string, UnreadEntry>();
let stopUnreadPolling: (() => void) | null = null;
let unreadPollMs = 0;

/** 同一份未读只开一个定时器；广播连上后间隔变长，这里按需重排一次。 */
function ensureUnreadPolling(intervalMs: number): void {
  if (unreadEntries.size === 0) return;
  if (stopUnreadPolling && unreadPollMs === intervalMs) return;
  stopUnreadPolling?.();
  unreadPollMs = intervalMs;
  stopUnreadPolling = startVisiblePolling(pollUnread, intervalMs);
}

async function refreshUnread(entry: UnreadEntry): Promise<void> {
  const request = ++entry.request;
  try {
    const unread = await listTeamUnread(entry.controller, entry.studioId);
    if (request !== entry.request) return;
    entry.counts = new Map(unread.map(item => [item.userId, item.count]));
    for (const listener of [...entry.listeners]) listener(entry.counts);
  } catch { /* 拉不到就当没有红点，不能报一个假的未读。 */ }
}

function pollUnread(): void {
  for (const entry of [...unreadEntries.values()]) void refreshUnread(entry);
}

/** 头像上的红数字与聊天窗读的是同一份未读：读完或发完喊一声，共享未读立刻重拉，所有订阅者一起换。 */
export function notifyUnreadChanged(): void {
  pollUnread();
}

function acquireUnread(controller: BackendSession, studioId: string, userId: string): UnreadEntry {
  const key = `${studioId}\u0000${userId}`;
  const existing = unreadEntries.get(key);
  if (existing) return existing;
  const entry: UnreadEntry = { key, controller, studioId, userId, counts: new Map(), request: 0, lastSignalAt: 0, listeners: new Set() };
  unreadEntries.set(key, entry);
  return entry;
}

/** 团队里谁给我留了几条没看：没登录或没团队就没有红数字。 */
export function useTeamUnread(controller: BackendSession, studioId: string, userId: string): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const live = useSignalsLive(userId);

  useEffect(() => {
    if (!userId || !studioId) { setCounts(new Map()); return undefined; }
    const entry = acquireUnread(controller, studioId, userId);
    entry.listeners.add(setCounts);
    setCounts(entry.counts);
    if (entry.listeners.size === 1) void refreshUnread(entry);
    ensureUnreadPolling(UNREAD_POLL_MS);
    const unsubscribe = subscribeUserSignals(userId, (event, payload) => {
      if (event !== 'message') return;
      if (payload.studioId && payload.studioId !== studioId) return;
      // 自己发出去的消息不会改动自己的未读，等别人发来再拉。
      if (payload.toUserId && payload.toUserId !== userId) return;
      const now = Date.now();
      if (now - entry.lastSignalAt < SIGNAL_REFRESH_FLOOR_MS) return;
      entry.lastSignalAt = now;
      void refreshUnread(entry);
    });
    return () => {
      unsubscribe();
      entry.listeners.delete(setCounts);
      if (entry.listeners.size > 0) return;
      unreadEntries.delete(entry.key);
      if (unreadEntries.size > 0) return;
      stopUnreadPolling?.();
      stopUnreadPolling = null;
      unreadPollMs = 0;
    };
  }, [controller, studioId, userId]);

  // 频道连上后把未读轮询降成兜底频率；断开回落正常频率。
  useEffect(() => {
    if (!userId || !studioId) return;
    ensureUnreadPolling(live ? UNREAD_FALLBACK_MS : UNREAD_POLL_MS);
  }, [live, studioId, userId]);

  return counts;
}

export interface TeamThread {
  messages: TeamMessage[];
  loading: boolean;
  sending: boolean;
  error: string;
  /** 发成功返回 true，窗里留着原文；发失败返回 false，草稿不清，好让人改了再发。 */
  send(body: string): Promise<boolean>;
  refresh(): void;
}

/** 和某一个人的私信：打开就拉一次，开着每 5 秒补新的，收到的当场标已读。 */
export function useTeamThread(controller: BackendSession, studioId: string, peerId: string, selfId: string): TeamThread {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!studioId || !peerId || !selfId) { setMessages([]); setError(''); return undefined; }
    let alive = true;
    setLoading(true);
    const load = async () => {
      try {
        const list = await listTeamMessages(controller, studioId, peerId);
        if (!alive || request !== requestRef.current) return;
        setMessages(list);
        setError('');
        if (list.some(message => message.toUserId === selfId && !message.readAt)) {
          await markTeamMessagesRead(controller, studioId, peerId).catch(() => undefined);
          notifyUnreadChanged();
        }
      } catch (caught) {
        if (!alive || request !== requestRef.current) return;
        setError(caught instanceof Error ? caught.message : '消息拉不下来，稍后再试。');
      } finally {
        if (alive && request === requestRef.current) setLoading(false);
      }
    };
    void load();
    const stop = startVisiblePolling(() => void load(), 5_000);
    // 广播只用来提前触发，5 秒轮询仍是降级路径：频道没连上时行为与原来一致。
    const unsubscribe = subscribeUserSignals(selfId, (event, payload) => {
      if (payload.studioId && payload.studioId !== studioId) return;
      if (event === 'message' && (payload.fromUserId === peerId || payload.toUserId === peerId)) void load();
      if (event === 'message-read' && payload.byUserId === peerId) void load();
    });
    return () => { alive = false; stop(); unsubscribe(); };
  }, [controller, studioId, peerId, selfId, revision]);

  const send = useCallback(async (body: string): Promise<boolean> => {
    const text = body.trim();
    if (!text || !studioId || !peerId || !selfId) return false;
    const request = requestRef.current;
    setSending(true);
    try {
      await sendTeamMessage(controller, studioId, { requestId: crypto.randomUUID(), peerId, body: text });
      const list = await listTeamMessages(controller, studioId, peerId);
      if (request === requestRef.current) setMessages(list);
      notifyUnreadChanged();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '这条没发出去，再试一次。');
      return false;
    } finally { setSending(false); }
  }, [controller, studioId, peerId, selfId]);

  const refresh = useCallback(() => setRevision(current => current + 1), []);
  return { messages, loading, sending, error, send, refresh };
}
