/**
 * A narrow, read-only information question. Returning false does not mean the
 * message is invalid: the normal activity/intention flow must handle it.
 * Never use this classifier to update the scene, facts, or brief.
 */
export function isGeneralActivityQuestion(raw:string):boolean {
 const text=raw.trim();
 if(!text||text.length>300||/[\u0000-\u001f\u007f]/.test(text))return false;
 // Strip conversational introductions, but do not strip actual instructions.
 const body=text.replace(/^(?:请问|我想知道|我想了解|能否解释一下|请解释一下|解释一下|能介绍一下|请介绍一下)\s*/,'');
 // Project-specific information and edits must keep their normal intent route.
 if(/(?:我们|本场|本次|这场|这次|上一场|上次|这间|这个场地|我的|当前|现有|现场已有|我有|我需要|我想办|我计划|预计|参加者|参会者|来宾|嘉宾)/.test(body))return false;
 if(/(?:^|[，,；;])\s*(?:需要|不需要|要|不要|必须|请安排|安排|要求|先|再)(?:[^，,；;]*)(?:[，,；;]|$)/.test(body))return false;
 if(/\d|[零〇一二两三四五六七八九十百千]+\s*(?:人|位|名|把|张|套|米|平米|平方米|个|件|桌)/.test(body))return false;
 if(/(?:帮我|替我|给我|请把|把|将|增加|加上|添加|移除|删除|撤掉|移动|挪|搬走|换成|改成|生成|出方案|开始摆|摆一版|帮忙布置|确认|保存|导出|交付|交接|发给|打开评审)/.test(body))return false;
 if(!/(?:活动|会场|场地|签到|动线|无障碍|轮椅|消防|疏散|通道|座位|座椅|圆桌|课桌|舞台|搭建|撤场|物料|排队|电源|容量|空间|布置|会议|讲座|展览|市集)/.test(body))return false;
 return /(?:什么是|什么叫|什么为|是什么|哪些|有何|有什么|为何|为什么|如何|怎样|怎么|区别|含义|作用)/.test(body);
}

const READ_ONLY_ADVICE_PART = /^(?:请)?(?:先)?给(?:我)?(?:一些|一点)?建议$|^(?:请)?(?:不要|别|不必|无需)(?:改|修改|调整)(?:场景|画布|布局)$/u;
const SCENE_ACTION = /删除|删掉|删去|移除|撤掉|拿走|移动|挪动|平移|发送|(?:往|向|朝)[^。！？!?]{0,6}(?:移|挪)/u;

/** One sentence that only asks for advice or says not to change the scene. */
export function isReadOnlyAdviceSentence(sentence: string): boolean {
  const parts = sentence.split(/[，,；;]/u).map(part => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(part => READ_ONLY_ADVICE_PART.test(part));
}

/**
 * Scene edits that share a message with “请先给建议” or “不要改场景”.
 * They stay visible and unexecuted; an advice sentence must not apply them
 * and must not make them disappear.
 */
export function adviceLeavesSceneActions(raw: string): string[] {
  const sentences = raw.split(/[。！？!?]/u).map(part => part.trim()).filter(Boolean);
  const advice = sentences.some(isReadOnlyAdviceSentence)
    || sentences.some(sentence => /给(?:我)?(?:一些|一点)?建议/u.test(sentence) && SCENE_ACTION.test(sentence));
  if (!advice) return [];
  return sentences.filter(sentence => SCENE_ACTION.test(sentence));
}

/** A greeting must consume the whole message; never discard an attached need. */
export function isPureGreeting(raw:string):boolean {
 return /^(?:你好|您好|嗨|哈喽|hello|hi|早上好|早安|中午好|下午好|晚上好|晚安|谢谢|谢谢你|多谢|感谢|再见|拜拜|bye)(?:呀|啊|啦|哇)?[。.!！?？\s]*$/i.test(raw.trim());
}
