'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listOfficialNotices, listOfficialUnread, markOfficialNoticeRead, type OfficialNotice } from '@/lib/workspace-api';
import type { BackendSession } from '@/lib/backend-session';

/** 未读徽标监听：面板记已读后喊一声，左轨红点跟着扣；列表本身读本地状态，不参与自唤醒。 */
const officialListeners = new Set<() => void>();
export function notifyOfficialChanged(): void {
  for (const listener of [...officialListeners]) listener();
}
function subscribeOfficial(listener: () => void): () => void {
  officialListeners.add(listener);
  return () => officialListeners.delete(listener);
}

export interface OfficialNoticesState {
  notices: OfficialNotice[];
  unread: number;
  loading: boolean;
  error: string;
  refresh(): void;
  read(noticeId: string): void;
}

/** 官方通知列表：打开面板拉一次，开着每 20 秒补新；点开一条当场记已读。未登录就不给数据。 */
export function useOfficialNotices(controller: BackendSession, userId: string): OfficialNoticesState {
  const [notices, setNotices] = useState<OfficialNotice[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!userId) { setNotices([]); setUnread(0); setError(''); return undefined; }
    let alive = true;
    setLoading(true);
    const load = async () => {
      try {
        const [list, unreadResult] = await Promise.all([
          listOfficialNotices(controller),
          listOfficialUnread(controller),
        ]);
        if (!alive || request !== requestRef.current) return;
        setNotices(list);
        setUnread(unreadResult.count);
        setError('');
      } catch (caught) {
        if (!alive || request !== requestRef.current) return;
        setError(caught instanceof Error ? caught.message : '通知拉不下来，稍后再试。');
      } finally {
        if (alive && request === requestRef.current) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => { alive = false; clearInterval(timer); };
  }, [controller, userId, revision]);

  const refresh = useCallback(() => setRevision(current => current + 1), []);

  const read = useCallback((noticeId: string) => {
    void markOfficialNoticeRead(controller, noticeId)
      .then(() => {
        setNotices(list => list.map(item => item.id === noticeId
          ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
          : item));
        setUnread(count => Math.max(0, count - 1));
        // 本地列表已更新，只通知未读徽标刷新，不再唤醒自身做全量重拉。
        notifyOfficialChanged();
      })
      .catch(() => undefined);
  }, [controller]);

  return { notices, unread, loading, error, refresh, read };
}

/** 只取未读数：左轨红点用，不拉全量列表；拉不到保留旧值，不报一个假的未读。 */
export function useOfficialUnread(controller: BackendSession, userId: string): number {
  const [unread, setUnread] = useState(0);
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => subscribeOfficial(() => setRevision(current => current + 1)), []);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!userId) { setUnread(0); return undefined; }
    let alive = true;
    const load = async () => {
      try {
        const result = await listOfficialUnread(controller);
        if (alive && request === requestRef.current) setUnread(result.count);
      } catch { /* 拉不到就保留旧未读，不能清零冒充已读。 */ }
    };
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => { alive = false; clearInterval(timer); };
  }, [controller, userId, revision]);

  return unread;
}
