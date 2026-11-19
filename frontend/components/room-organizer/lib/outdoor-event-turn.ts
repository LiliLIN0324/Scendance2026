/** Small deterministic outdoor continuation guard, ahead of the existing Agent's normal NLP.
 *
 * D2（2026-11-20）：活动词表补齐八类新模板的说法（相亲/社交、发布会变体、婚宴、音乐会/演唱会、
 * 美食、车展、展览、运动会/趣味运动/体育比赛/体育节），否则「45人美食节」这类句子进不了本地
 * 确定性路径（M4 离线白名单与 proposeZonePlan 同用本词表把门），注册了模板也到不了。
 * 注意：否决守卫与词表必须同步扩展——新词进词表而守卫不收，「取消车展」会被当成排布指令；
 * 本卡只给新词补守卫，旧词（婚礼/演出/发布会等）的既有守卫缺口留给 E2 路由收敛统一处理。
 */
export function parseOutdoorEventTurn(text: string, priorEvent: string | null, continueBlockedTask = false): { event: string | null; headcount: number | null } | null {
  if (/(?:不要|不做|别做|取消).{0,6}(?:讲座|会议|论坛|市集|活动|相亲|联谊|交友|社交|新品发布|产品发布|婚宴|音乐会|演唱会|美食|小吃|餐饮|车展|汽车展|新车展示|展览|展会|博览|运动会|趣味运动|体育比赛|体育节)/u.test(text)) return null;
  const events = [...text.matchAll(/讲座|会议|论坛|发布会|市集|集市|展销|相亲|联谊|交友|社交|婚礼|婚宴|演出|音乐会|演唱会|音乐节|美食节|美食|小吃|餐饮|车展|汽车展|新车展示|展览|展会|博览|运动会|趣味运动|体育比赛|体育赛事|体育节|烟花(?:燃放)?|马拉松|露营|庆典/gu)];
  const event = events.at(-1)?.[0] ?? priorEvent;
  const count = text.match(/(\d+(?:\.\d+)?)\s*(?:人|位)/u);
  const headcount = count ? Number(count[1]) : null;
  const siteFollowup = continueBlockedTask && priorEvent && /场地|入口|边界|签到|舞台|朝向|人行|流线|重试|重新|继续/u.test(text)
    && !/什么|为什么|怎么|是否|吗|？|\?|模型|上传|生成|模拟|取消|不要|停止|删除|清空/u.test(text);
  if (!events.length && !(headcount != null && priorEvent) && !siteFollowup) return null;
  return { event, headcount };
}
