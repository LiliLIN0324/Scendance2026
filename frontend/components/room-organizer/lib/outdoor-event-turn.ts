/** Small deterministic outdoor continuation guard, ahead of the existing Agent's normal NLP. */
export function parseOutdoorEventTurn(text: string, priorEvent: string | null, continueBlockedTask = false): { event: string | null; headcount: number | null } | null {
  if (/(?:不要|不做|别做|取消).{0,6}(?:讲座|会议|论坛|市集|活动)/u.test(text)) return null;
  const events = [...text.matchAll(/讲座|会议|论坛|发布会|市集|集市|展销|婚礼|演出|音乐节|烟花(?:燃放)?|体育赛事|马拉松|露营|庆典/gu)];
  const event = events.at(-1)?.[0] ?? priorEvent;
  const count = text.match(/(\d+(?:\.\d+)?)\s*(?:人|位)/u);
  const headcount = count ? Number(count[1]) : null;
  const siteFollowup = continueBlockedTask && priorEvent && /场地|入口|边界|签到|舞台|朝向|人行|流线|重试|重新|继续/u.test(text)
    && !/什么|为什么|怎么|是否|吗|？|\?|模型|上传|生成|模拟|取消|不要|停止|删除|清空/u.test(text);
  if (!events.length && !(headcount != null && priorEvent) && !siteFollowup) return null;
  return { event, headcount };
}
