import { outdoorTurnSchema, type OutdoorTurn } from './outdoor-agent-contract';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** Explicit whole-wedding drafting is a local capability, not another model clarification. */
export function weddingDesignRequest(message: string, event: string | undefined, plan: SitePlanData): OutdoorTurn | null {
  if (/^(?:请)?(?:不要|停止|取消)(?:重新|继续|自动|自主)?(?:规划|布置|重排)|^(?:怎么|如何|为什么|能否|是不是|有没有)|[？?]\s*$/u.test(message)) return null;
  const wedding = /婚礼|婚宴|结婚/u.test(`${event??''} ${message} ${plan.zones.map(z=>z.event??'').join(' ')}`);
  const explicit = /(?:重新|优化|重排|自主|自动|完整|一整版|整场|继续执行|先出一版|出一版|起个?稿)[\s\S]*(?:规划|布局|布置|仪式区|方案|婚礼|婚宴)|(?:规划|布局|布置)[\s\S]*(?:婚礼|婚宴)|(?:婚礼|婚宴)[\s\S]*(?:规划|布局|布置|先出一版|出一版|起个?稿)/u.test(message);
  if (!wedding || !explicit) return null;
  // Detailed location, dimension, selection or item instructions need the existing
  // structured understanding path; never silently replace them with this default.
  if(message.length>120||/尺寸|朝向|入口|出口|东侧|西侧|南侧|北侧|西南|东南|东北|西北|删除|去掉|保留|只(?:改|调整|排)|\d\s*(?:米|[mM])/u.test(message))return null;
  const guests=message.match(/(\d+)\s*(?:位宾客|名宾客|人|位来宾)/u);
  const items=[...message.matchAll(/(\d+)\s*(?:张|桌|把|个|套)?\s*(圆桌|餐桌|长桌|观礼椅|宴席座椅|椅子|签到桌|指示牌)/gu)]
    .map(match=>({zone:'',query:match[2],count:Number(match[1]),evidence:match[0]}));
  return outdoorTurnSchema.parse({ action:'design-event',reply:'采用明确标注的默认参数生成婚礼布局候选，缺失场地依据保留为待核对。',references:[],
    facts:{...(items.length?{items}:{}),...(guests?{guests:{value:Number(guests[1]),evidence:guests[0]}}:{}),
      ...(/婚礼|婚宴|结婚/u.test(message)?{event:{value:'户外婚礼',evidence:message.match(/婚礼|婚宴|结婚/u)![0]}}:{})} });
}

export const requestsWeddingOptimization = (message:string):boolean => /重新|重排|优化|挤|调整.*(?:分区|位置|形状)|允许.*(?:评估|调整)/u.test(message);

/**
 * design-event 只产婚礼联合布置，所以入口先问一句：这轮到底是不是婚礼。
 *
 * 2026-11-22 用户实测（幕景Agent Test S4/S5）：瑜伽疗愈的活动被婚礼路径顶掉，
 * 分区用途卡刚出现就被一张「这条联合布置工具当前用于婚礼」的反问卡取代。
 * 口径：**有明确事件名时只看事件名**，历史消息里出现过「婚礼」不算数；
 * 事件名还没定（空）时才回退到原话里找，避免把「按婚礼布置」这类句子误判成非婚礼。
 */
export function isWeddingEvent(event: string | null | undefined, message = ''): boolean {
  const name = (event ?? '').trim();
  return /婚礼|婚宴|结婚/u.test(name || message);
}

/**
 * 「继续执行 / 无需等待 / 自主规划」+ 当前活动名是婚礼 = 授权我自主起一版婚礼。
 *
 * 2026-11-22 用户拍板：这里**只看活动名**，不再看用户这句话。
 * 修前是 `婚礼|婚宴|结婚` 命中「句子 + 活动名」就触发：用户聊瑜伽时提一句「之前看过一个婚礼案例」
 * 也会被当成婚礼授权，多绕一道。现在句子里的「婚礼」不参与这个判断；
 * 真正的婚礼请求仍由 weddingDesignRequest（在理解模型之前跑）认领，不会丢能力。
 */
export function authorizesAutonomousWedding(event: string | null | undefined, message: string): boolean {
  const name = (event ?? '').trim();
  if (!/婚礼|婚宴|结婚/u.test(name)) return false;
  return /继续执行|不需要等待|无需等待|自主.{0,8}规划/u.test(message);
}
