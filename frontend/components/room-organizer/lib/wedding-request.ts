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
