import { z } from 'zod';

/**
 * 简报槽位提取契约：前端 agent-resolver ↔ scene-api /brief/extract。
 * 模型只负责「听懂」这句话；记忆合并、防复读、出方案闸门在前端 brief-agent 状态机。
 * 全部 nullish（optional+nullable）：增量对话只提一个槽时，模型会省略其余 key，缺 key 与 null 都合法。
 */
export const briefSlotSchema = z.object({
  event: z.string().max(80).nullish().describe('活动类型名，如「发布会」「教学」「婚礼」；没说就是 null'),
  headcount: z.number().int().min(1).max(100000).nullish().describe('人数；「80套」在课桌椅语境下也是 80 人'),
  venueIO: z.enum(['indoor', 'outdoor']).nullish().describe('室内 indoor / 户外 outdoor'),
  lengthM: z.number().min(0.5).max(500).nullish().describe('场地长（米）'),
  widthM: z.number().min(0.5).max(500).nullish().describe('场地宽（米）'),
  areaM2: z.number().min(1).max(250000).nullish().describe('场地面积（平米），只说了面积没说长宽时填'),
  layoutMode: z.enum(['dining', 'desk-chair']).nullish().describe('desk-chair=一人一套课桌椅（课桌/课椅/一人一套/桌配椅/教学），餐桌宴请=dining，没提就 null'),
  timeOfDay: z.number().int().min(0).max(23).nullish().describe('白天约12、黄昏约18、晚上约21（24小时制整数），没提就 null'),
});
export type BriefSlots = z.infer<typeof briefSlotSchema>;

export const briefExtractRequestSchema = z.strictObject({ message: z.string().trim().min(1).max(2000) });
export const briefExtractResponseSchema = z.strictObject({
  enabled: z.boolean(),
  extraction: briefSlotSchema.nullable(),
});
export type BriefExtractResponse = z.infer<typeof briefExtractResponseSchema>;

/** 完整提示词以这里为可评审的唯一事实源；只提取这一句话，跨句记忆由前端状态机合并。 */
export const BRIEF_EXTRACT_PROMPT = `你是活动布置简报的槽位提取器。只输出一个 JSON 对象，不输出 Markdown。字段：event(字符串|null)、headcount(整数|null)、venueIO("indoor"|"outdoor"|null)、lengthM(数字|null)、widthM(数字|null)、areaM2(数字|null)、layoutMode("dining"|"desk-chair"|null)、timeOfDay(0到23的整数小时|null，白天约12黄昏约18晚上约21)。
规则：口语、错字、中英混排都要容错；「80个/80套/80位」这类裸数字在人数语境下都是 headcount；课桌椅/一人一套/桌配椅/教学是 desk-chair，宴请餐桌酒席是 dining；只说了面积没说长宽时填 areaM2；你没看到的字段一律 null，不要猜。你只能看到这一句话，句子里没有的就是 null。`;
