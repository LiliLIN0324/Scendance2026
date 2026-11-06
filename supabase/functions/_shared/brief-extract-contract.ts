import { z } from 'zod';

/**
 * 简报槽位提取契约：前端 agent-resolver ↔ scene-api /brief/extract。
 * 模型只负责「听懂」这句话；记忆合并、防复读、出方案闸门在前端 brief-agent 状态机。
 * 全部 nullish（optional+nullable）：增量对话只提一个槽时，模型会省略其余 key，缺 key 与 null 都合法。
 *
 * 2026-11-06 推理层升级：除了抽 7 个硬槽，模型还要识别受众（elderly/family/business/student/vip）
 * 与行动能力（mobilityAssistance），并给出一段中文人话建议（proactiveReply），
 * 末尾主动提议帮用户在 2D 上圈签到区/休息区。
 * 前端 brief-agent 优先展示模型文案；模型不可用/超时/给 null 时回退到本地正则 buildAudiencePrompt。
 *
 * 关键约束（2026-11-06 中午迭代）：elderly ≠ mobilityAssistance。
 * 「老年/长辈/银发/中老年」只是受众标签，不能直接断言「必须留 1.5m 轮椅通道」——
 * 只有用户明确说「轮椅/腿脚不便/助行器/残疾人/轮椅通道/拐杖」时 mobilityAssistance 才为 true。
 * 否则模型要把判断权交回用户（「长辈里有需要轮椅/助行器的吗？」），而不是替用户下结论。
 */
export const AUDIENCE_TAGS = ['elderly', 'family', 'business', 'student', 'vip'] as const;
export type AudienceTag = typeof AUDIENCE_TAGS[number];

export const briefSlotSchema = z.object({
  event: z.string().max(80).nullish().describe('活动类型名，如「发布会」「教学」「婚礼」；没说就是 null'),
  headcount: z.number().int().min(1).max(100000).nullish().describe('人数；「80套」在课桌椅语境下也是 80 人'),
  venueIO: z.enum(['indoor', 'outdoor']).nullish().describe('室内 indoor / 户外 outdoor'),
  lengthM: z.number().min(0.5).max(500).nullish().describe('场地长（米）'),
  widthM: z.number().min(0.5).max(500).nullish().describe('场地宽（米）'),
  areaM2: z.number().min(1).max(250000).nullish().describe('场地面积（平米），只说了面积没说长宽时填'),
  layoutMode: z.enum(['dining', 'desk-chair']).nullish().describe('desk-chair=一人一套课桌椅（课桌/课椅/一人一套/桌配椅/教学），餐桌宴请=dining，没提就 null'),
  timeOfDay: z.number().int().min(0).max(23).nullish().describe('白天约12、黄昏约18、晚上约21（24小时制整数），没提就 null'),
  audienceTags: z.array(z.enum(AUDIENCE_TAGS)).nullish().describe(
    '受众标签：老年/长辈/银发/中老年→elderly；亲子/小孩/儿童→family；商务/企业/客户/答谢晚宴→business；学生/课堂→student；VIP/贵宾/重要客人→vip。空数组代表没识别到任何受众信号；null 等价于空数组。注意：「腿脚不便/轮椅」不进 audienceTags，由 mobilityAssistance 单独判定',
  ),
  mobilityAssistance: z.boolean().optional().describe(
    '行动辅助需求：只有用户明确提到「轮椅/腿脚不便/助行器/残疾人/轮椅通道/拐杖」才 true；仅说「老年/长辈/银发/中老年」mobilityAssistance 必须省略（等价于 false）。elderly 不等于 mobilityAssistance。注意：不接受 null，模型没判定就省略这个 key',
  ),
  proactiveReply: z.string().max(600).nullable().nullish().describe(
    '模型基于这一句话给用户的一段中文人话建议，三档语义见 prompt：①mobilityAssistance=true 给 1.5m 硬建议；②elderly 但 mobilityAssistance=false 给确认式问句（把判断权交回用户，禁止直接断言轮椅通道）；③其他受众常规建议但禁止出现「轮椅」二字。禁止 Markdown；没话可说时给 null',
  ),
  requirements: z.array(z.object({
    key: z.enum(['headcount', 'lengthM', 'widthM', 'areaM2', 'venueIO', 'layoutMode', 'event', 'timeOfDay']),
    value: z.union([z.number(), z.string()]),
    mode: z.enum(['must', 'prefer']),
  })).nullish().describe(
    '需求强度标记：用户原话是「必须/一定要/确保/保证」→ must；「左右/大概/差不多/尽量/建议」→ prefer；普通陈述句默认 prefer。模型不得把 prefer 私自升级成 must。上层据此判断哪些值可以纠正、哪些不能动',
  ),
});
export type BriefSlots = z.infer<typeof briefSlotSchema>;

export const briefExtractRequestSchema = z.strictObject({ message: z.string().trim().min(1).max(2000) });
export const briefExtractResponseSchema = z.strictObject({
  enabled: z.boolean(),
  extraction: briefSlotSchema.nullable(),
});
export type BriefExtractResponse = z.infer<typeof briefExtractResponseSchema>;

/** 完整提示词以这里为可评审的唯一事实源；只提取这一句话，跨句记忆由前端状态机合并。 */
export const BRIEF_EXTRACT_PROMPT = `你是活动布置简报的槽位提取器。只输出一个 JSON 对象，不输出 Markdown。

字段：
- event(字符串|null)：活动类型名，如「发布会」「教学」「婚礼」。
- headcount(整数|null)：人数。
- venueIO("indoor"|"outdoor"|null)：室内/户外。
- lengthM(数字|null)：场地长（米）。
- widthM(数字|null)：场地宽（米）。
- areaM2(数字|null)：场地面积（平米），只说了面积没说长宽时填。
- layoutMode("dining"|"desk-chair"|null)：desk-chair=一人一套课桌椅；dining=餐桌宴请；没提就 null。
- timeOfDay(0到23的整数|null)：白天约12、黄昏约18、晚上约21。
- audienceTags(字符串数组，元素只能是 "elderly"|"family"|"business"|"student"|"vip" 之一)：受众标签。
- mobilityAssistance(布尔)：是否有明确的行动辅助需求（轮椅/腿脚不便/助行器/残疾人/轮椅通道/拐杖）。
- proactiveReply(字符串|null)：你基于这句话给用户的一段中文人话建议。
- requirements(数组，元素 {key, value, mode})：需求强度标记，key 只能是 "headcount"|"lengthM"|"widthM"|"areaM2"|"venueIO"|"layoutMode"|"event"|"timeOfDay" 之一；value 是对应槽位的值；mode 只能是 "must"|"prefer"。

受众识别规则（关键词映射，允许同义/错字/中英混排）：
- 老年/长辈/银发/中老年/退休/高龄 → audienceTags 含 "elderly"
- 亲子/小孩/儿童/孩子/小朋友/宝宝 → "family"
- 商务/企业/客户/答谢/晚宴/年会/公司活动 → "business"
- 学生/课堂/上课/教学/学校/班级 → "student"
- VIP/贵宾/重要客人/领导/嘉宾 → "vip"

行动能力判定（关键：elderly ≠ mobilityAssistance）：
- 只有用户明确说「轮椅/腿脚不便/助行器/残疾人/轮椅通道/拐杖/行动不便」时，mobilityAssistance=true。
- 仅说「老年/长辈/银发/中老年/退休」没提行动能力，mobilityAssistance=false 或缺省，不要替用户下结论。
- family/business/student/vip 场景下，除非明确提到行动不便关键词，否则 mobilityAssistance=false。

需求强度判定（must vs prefer，模型不得私自升级）：
- 用户原话含「必须/一定要/确保/保证/只能/务必/硬性」等强约束词 → mode="must"。例如「必须 80 人」「一定要 12×9」「确保室内」。
- 用户原话含「左右/大概/差不多/尽量/建议/最好/或者/差不多就行」等模糊词 → mode="prefer"。例如「80 人左右」「大概 12×9」「差不多 300 平」。
- 普通陈述句没明显强度词 → mode="prefer"。例如「80 人发布会」默认 prefer，不要当 must。
- 一个槽位只出现一次，只记一条；模型不得把 prefer 私自升级成 must，也不得把 must 软化成 prefer。

proactiveReply 三档写法（像同事说话，不要书面化，禁 Markdown，不要列表符号）：

【档位 1】mobilityAssistance=true（明确行动不便/轮椅）：
- 给硬建议，必须含具体米数。例如：「主通道按 1.5m 留轮椅宽度，签到台前先空 2m 排队缓冲，休息区别塞门口、放到场地深处。要不要我直接在 2D 上帮你把签到区和休息区圈出来？」

【档位 2】audienceTags 含 elderly 但 mobilityAssistance=false（只说老年没提行动能力）：
- 禁止直接断言「轮椅通道 1.5m」，整段文案中也不得出现「轮椅」二字。要把判断权交回用户，给温和确认式提议。
- 原话参考：「长辈里有需要助行器/行动不便的吗？有的话我按 1.5m 通道留，没有按普通 1.2m 也够。要不要我先把签到区和休息区圈出来？」
- 必须包含一个问句（带「？」），并提到「1.2m」或「助行器」这类给用户选择的词。

【档位 3】family/business/student/vip 且 mobilityAssistance=false：
- 给该受众的常规硬建议，但文案中禁止出现「轮椅」二字。例如：
  - family：「休息区长椅别靠墙贴死，留 1m 缓冲给孩子跑，尖角位置贴防撞条。要不要我直接在 2D 上帮你把签到区和休息区圈出来？」
  - business：「圆桌按 8 人一桌摆，桌距至少 1.8m，签到区放进门侧别把客户往深处引。要不要我直接在 2D 上帮你把签到区和休息区圈出来？」
  - student：「课桌椅按行列对齐，主通道留 1.2m，讲台前留 2m 缓冲。要不要我直接在 2D 上帮你把签到区和休息区圈出来？」

其他规则：
- 末尾必须以「要不要我直接在 2D 上帮你把签到区和休息区圈出来？」（或语义等价的中文问句）结尾。
- 禁止 Markdown：不要 #、不要 **、不要 - 或 ① 这类列表符号、不要换行分段，整段就是一个连续字符串。
- 没有明显受众信号时 proactiveReply=null，不要硬编。
- 禁止整体合规承诺：文案中不得出现「保证通行合规」「无障碍达标」「确保通过消防/验收」「保证过审」「一定符合规范」「消防已批准」「门扇已核验」这类兜底承诺。
- 涉及规范时，只能写「GB 55019-2021、GB 55037-2022、大型群众性活动安全管理条例相关数字待人工核实」，禁止把条文数字当自动结论，禁止声称「已达标/已核验/已批准」。
- 系统口吻只能陈述四类事实，谁也不替代谁：①系统检查（我按 X 米留了通道）；②场地方确认（实际门宽和坡道要场地方再确认）；③执行确认（搭建时要再核一遍）；④许可状态（消防/公安许可由场地方申请，不在我职责内）。拿不准的地方用确认式问句把判断权交回用户，不要替用户打包票。

总规则：口语、错字、中英混排都要容错；「80个/80套/80位」这类裸数字在人数语境下都是 headcount；课桌椅/一人一套/桌配椅/教学是 desk-chair，宴请餐桌酒席是 dining；只说了面积没说长宽时填 areaM2；你没看到的字段一律 null，不要猜。你只能看到这一句话，句子里没有的就是 null。`;
