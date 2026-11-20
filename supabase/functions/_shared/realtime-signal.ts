/**
 * 消息/已读的服务端广播。只发「谁动了哪条」的标识，正文仍然由带鉴权接口拉，
 * 所以订阅方拿到的频道消息本身不含隐私内容；广播失败也不影响消息落库。
 *
 * 频道是公开广播（public），订阅只需 publishable/anon key：私信与通知的数据表在
 * scene_private 下且 RLS 全关，直连表既拉不到，也会把鉴权口径搬进数据库，
 * 因此这里只推一个「有变化」的信号。要升级成私有频道，需要给 realtime.messages
 * 加 RLS 策略（数据库迁移，需人工 review），不在本次改动内。
 */
export type SignalEvent = 'message' | 'message-read';

export function userSignalTopic(userId: string): string {
  return `scendance:user:${userId}`;
}

/**
 * 一次性 REST 广播：不建长连接、不在客户端里留频道对象。
 * 2 秒拿不到确认就放弃，前端还有轮询兜底；任何失败只记日志。
 */
export async function publishUserSignal(
  baseUrl: string,
  serviceKey: string,
  userId: string,
  event: SignalEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ topic: userSignalTopic(userId), event, payload: { ...payload, at: new Date().toISOString() } }],
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    // 只记信号类型与收件人，不记消息正文。
    console.warn(JSON.stringify({
      event: 'realtime_signal_failed',
      signal: event,
      userId,
      at: new Date().toISOString(),
      reason: error instanceof Error ? error.message : String(error),
    }));
  }
}
