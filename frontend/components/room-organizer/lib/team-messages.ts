'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listTeamMessages, listTeamUnread, markTeamMessagesRead, sendTeamMessage, type TeamMessage } from '@/lib/workspace-api';
import type { BackendSession } from '@/lib/backend-session';

/** 头像上的红数字与聊天窗读的是同一份未读：读完或发完喊一声，两处一起换。 */
const unreadListeners = new Set<() => void>();
export function notifyUnreadChanged(): void {
  for (const listener of [...unreadListeners]) listener();
}
function subscribeUnread(listener: () => void): () => void {
  unreadListeners.add(listener);
  return () => unreadListeners.delete(listener);
}

/** 团队里谁给我留了几条没看：没登录或没团队就没有红数字。 */
export function useTeamUnread(controller: BackendSession, studioId: string, userId: string): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => subscribeUnread(() => setRevision(current => current + 1)), []);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!userId || !studioId) { setCounts(new Map()); return undefined; }
    const load = async () => {
      try {
        const unread = await listTeamUnread(controller, studioId);
        if (request === requestRef.current) setCounts(new Map(unread.map(item => [item.userId, item.count])));
      } catch { /* 拉不到就当没有红点，不能报一个假的未读。 */ }
    };
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [controller, studioId, userId, revision]);

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
    const timer = setInterval(() => void load(), 5_000);
    return () => { alive = false; clearInterval(timer); };
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
