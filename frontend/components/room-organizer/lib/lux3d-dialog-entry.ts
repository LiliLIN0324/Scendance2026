/**
 * 户外对话主路径 → 现有 Aholo Lux3D 生成面板（2026-11-18）。
 *
 * 为什么需要这一层：生成链本身已经完整（额度确认、提交回执、unknown 锁都在
 * panels/generation-sheet.tsx），但入口只在「已放置物件 → 设施属性卡」里。
 * 对话里说「用 Lux3D 生成一个木质花箱」会先被户外工作流当成「改某件设施」，
 * 找不到设施就回一句「请选中设施」，而不是打开生成。
 *
 * 这一层只做两件事：
 *  1. 确定性识别「这句是在点名生成一件新道具」，并从原话里取出描述；
 *  2. 打开现成的 generation-sheet（带可选设施目标），不提交、不扣额度、不重提。
 *
 * 刻意不做的事：
 *  - 不接管「摆一批折叠椅」这类落位预览（#167 的目录预览）——只有生成/做/造
 *    这类动词才进这里；「摆/放/布置」句原样留给落位预览。
 *  - 不自动放置占位设施、不自动勾额度、不替用户点提交。
 */

import { openGenerationSheet, type GenerationFacilityTarget } from './generation-sheet';

export interface Lux3dDialogIntent {
  /** 带进生成面板描述框的那句话；空串表示让用户在面板里自己写。 */
  prompt: string;
}

/** 生成动作；「摆/放/布置」不在内，那是落位预览的词。 */
const BUILD_VERB = /(?:生成|做|造|建模|创建|建)/u;
/** 不是「一件道具」的生成对象：分区、场地、场景、方案、清单、活动本身等都留给原流程。 */
const NON_PROP_OBJECT = /^(?:分区|区域|场地|场景|空间|方案|预览|清单|报价|报价单|平面图|图纸|图片|视频|贴图|文案|报告|任务|账号|模型库|主通道|通道|流线|动线|入口|出口|人流|市集|活动|展会|发布会|比赛|巡游|演出|婚礼|年会|庆典|聚会|派对|论坛|峰会|仪式)/u;
/** 否定/取消句不打开面板。 */
const NEGATED = /(?:不要|不用|别|取消|先不|暂不|停止|算了)/u;

/**
 * 把原话收敛成一句可提交的描述：
 * 「用 Lux3D 生成一个木质花箱摆到展览区」→「木质花箱」。
 * 摆放位置留给后面的落位/分区，不塞进模型描述里。
 */
export function lux3dPromptFrom(raw: string): string {
  let text = raw.normalize('NFKC').trim();
  text = text
    .replace(/^(?:请|麻烦|帮我|帮忙|我想|我要|我想要|想|要)\s*/u, '')
    .replace(/^(?:用|使用|通过|调用)\s*(?:aholo\s*)?(?:lux\s*3d|群核(?:科技)?)\s*/iu, '')
    .replace(/^(?:帮我|给我|请)?\s*(?:再)?\s*(?:生成|做|造|建模|创建|建)\s*/u, '')
    .replace(/^一(?:个|件|张|座|组|台|把|套|版|份)\s*/u, '');
  text = text
    .replace(/[，,；;]\s*(?:把|并|再)?\s*(?:摆|放|搁|布置|安排|移)(?:到|在|进|入|于)[\s\S]*$/u, '')
    .replace(/(?:把|并|再)?\s*(?:摆|放|搁|布置|安排|移)(?:到|在|进|入|于)[\s\S]*$/u, '')
    .replace(/[。！!？?；;，,]+$/u, '')
    .trim();
  return text.slice(0, 200);
}

/**
 * 这句话是不是「用生成的方式做一件新道具」。
 * 只在有生成动词时返回；返回 null 表示不归这个入口管。
 */
export function parseLux3dDialogIntent(raw: string): Lux3dDialogIntent | null {
  const text = raw.normalize('NFKC').trim();
  if (!text || text.length > 160) return null;
  if (NEGATED.test(text)) return null;
  if (!BUILD_VERB.test(text)) return null;
  // 显式点名 Lux3D / Aholo / 群核时，允许省略量词；否则必须是「生成/做/造 …」，
  // 「摆/放/布置」句仍归 #167 的落位预览，不能被静默改成收费生成。
  const explicitEngine = /(?:lux\s*3d|aholo|群核)/iu.test(text);
  // 没有点名引擎时必须带量词（「做一个签到台」），否则「做户外市集 60 人」
  // 「你在做」这种活动/过程句也会被当成生成道具。
  const measured = /(?:生成|做|造|建模|创建|建)\s*(?:一(?:个|件|张|座|组|台|把|套|版|份)|个|件|张|座|组|把|套)/u.test(text);
  if (!explicitEngine && !measured) return null;
  if (!explicitEngine && /(?:摆|放|布置|铺|排)/u.test(text)) return null;
  // 只说了「用 Lux3D 生成」「生成三维模型」：打开面板让用户自己补描述，但不预填空话。
  const rawPrompt = lux3dPromptFrom(text);
  const prompt = /^(?:三维模型|3d\s*模型|模型|道具|物件)$/iu.test(rawPrompt) ? '' : rawPrompt;
  if (!prompt) return explicitEngine ? { prompt: '' } : null;
  if (NON_PROP_OBJECT.test(prompt)) return null;
  if (!explicitEngine && prompt.length < 2) return null;
  return { prompt };
}

/**
 * 生成结果回填给谁：
 *  - 画布上当前选中的设施优先（「给这个舞台生成」）；
 *  - 否则这句里唯一点名的一件已放置设施（「给签到台生成一个…」）；
 *  - 都没有就返回 null —— 结果进模型库，绝不自动造一个占位设施。
 */
export function lux3dFacilityTarget(
  facilities: readonly { id: string; name: string }[],
  selectedIds: readonly string[] = [],
  message = '',
): GenerationFacilityTarget | null {
  const selected = facilities.find(facility => selectedIds.includes(facility.id));
  if (selected) return { id: selected.id, name: selected.name };
  const named = facilities.filter(facility => Boolean(facility.name) && message.includes(facility.name));
  if (named.length === 1 && named[0]) return { id: named[0].id, name: named[0].name };
  return null;
}

/** 打开现成生成面板：模型任务、描述预填、有设施就回填该设施。 */
export function openLux3dDialogGeneration(init: { facility?: GenerationFacilityTarget | null; prompt?: string } = {}): void {
  const facility = init.facility ?? null;
  const prompt = init.prompt?.trim() ?? '';
  openGenerationSheet({
    task: 'model',
    scope: facility ? 'facility' : 'material',
    source: 'text',
    facility,
    ...(prompt ? { prompt } : {}),
  });
}
