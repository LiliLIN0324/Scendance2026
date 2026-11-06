/**
 * 布置对话的核心状态机（独立模块）：跨句子记忆 + 槽填充 + 防复读闸。
 *
 * 2026-10-27 死循环复盘：此前 send() 里的解析是「当句正则、失配即归零」——
 * 一句没接住就退回开场白「这场大概多少人、室内还是户外」，已确认的人数/尺寸装不知道，
 * 用户重复输入、Agent 重复提问。本模块把会话策略收进纯函数：
 *
 * 1. 记忆槽位：人数/类型/室内外/长宽/布置形态跨句累积，失配不再归零；
 * 2. 槽填充：刚问完「多少人」，答「80」「80 个」这类裸数字也能落进人数槽；
 * 3. 防复读：同一句开场白绝不连说两遍——没接住就如实说「没接住」，并把已记下的复述出来；
 * 4. 课桌椅形态：「课桌配椅子」「一人一套」「80 套」→ desk-chair，生成器按一人一套铺课室行列。
 *
 * 模型化路径：turn 函数是唯一接缝，后续接 Vercel AI SDK（选型见 docs/plans/agent-reference-study.md）
 * 时把 parseBriefTurn 换成 LLM resolver 即可，面板与生成器不动。
 */
import { formatArea, HEADCOUNT_MAX, parseBriefSentence, type BriefExtraction, type VenueIO } from './workbench-agent';
import { generateZonePrompts } from '@/lib/suggestions';

/** 布置形态：dining = 餐桌组（默认），desk-chair = 一人一套课桌椅。 */
export type LayoutMode = 'dining' | 'desk-chair';

/** 跨句子累积的简报记忆：出方案的条件都从这里读，不靠当句正则。 */
export interface BriefMemory {
  event: string | null;
  headcount: number | null;
  venueIO: VenueIO | null;
  lengthM: number | null;
  widthM: number | null;
  areaM2: number | null;
  layoutMode: LayoutMode;
  /** 已经追问过一次场地尺寸：再没听到就换一种说法，不重复同一句。 */
  askedScale: boolean;
}

export function initialBriefMemory(): BriefMemory {
  return { event: null, headcount: null, venueIO: null, lengthM: null, widthM: null, areaM2: null, layoutMode: 'dining', askedScale: false };
}

/** 面板侧的画布事实（模块不碰画布，由调用方如实传入）。 */
export interface BriefTurnContext {
  /** 画布上已经立起场地（壳体/模板/云端场景）：米数算已确认。 */
  venueUp: boolean;
  /** 尺寸读数里有说过/填过的合法长宽。 */
  scaleTyped: boolean;
  /** 拖过图纸：图纸只当参照，可以说「按图纸估」。 */
  hasBase: boolean;
  /** 换一版/出方案这类命令由面板先解析好传进来，决策收在同一个地方。 */
  command: 'again' | 'first' | null;
}

export interface BriefTurn {
  kind: 'generate' | 'ask' | 'ack' | 'none';
  memory: BriefMemory;
  extraction: BriefExtraction;
  /** generate 轮：这句是在补答上一轮追问的尺寸——回话改说「记下了」，且跳过「只改尺寸」分支。 */
  filledScaleAsk: boolean;
  /** ask/ack/none 的回话；generate 轮由面板按自己的语气组句，这里是空串。 */
  text: string;
}

const clampHeadcount = (value: number): number => Math.max(1, Math.min(HEADCOUNT_MAX, value));

const EDUCATION_PATTERN = /(小学|中学|大学|学校|课堂|上课|讲课|教学|课室|班级|学生|小朋友)/;
/** 「课桌」「桌椅」「一张桌子配一个椅子」「一人一套」——认定按一人一套摆。 */
const DESK_CHAIR_PATTERN = /(课桌|课椅|桌椅|一人一套|每人一套|一套课桌|桌(子)?[^]{0,6}配[^]{0,6}椅)/;
const BARE_NUMBER_PATTERN = /^(\d{1,5})(个|人)?$/;

/** 记忆里已有的要素复述给人听：人数 · 室内外 · 尺度 · 形态 · 类型。 */
export function summarizeMemory(memory: BriefMemory): string {
  const parts: string[] = [];
  if (memory.headcount !== null) parts.push(`${memory.headcount} 人`);
  if (memory.venueIO !== null) parts.push(memory.venueIO === 'indoor' ? '室内' : '户外');
  // 说过的尺度也要复述：只报「80 人 · 室内」而把刚给的「12×9」吞掉，等于对人确认过的事实装失忆。
  if (memory.lengthM !== null && memory.widthM !== null) parts.push(`${formatArea(memory.lengthM)} × ${formatArea(memory.widthM)} m`);
  else if (memory.areaM2 !== null) parts.push(`${formatArea(memory.areaM2)} ㎡`);
  if (memory.layoutMode === 'desk-chair') parts.push('一人一套课桌椅');
  if (memory.event !== null) parts.push(memory.event);
  return parts.join(' · ');
}

/** 记忆折回 BriefExtraction：scaleFrom / describeExtraction / syncStudioBrief 吃的还是老形状。 */
export function memoryExtraction(memory: BriefMemory): BriefExtraction {
  return { event: memory.event, headcount: memory.headcount, venueIO: memory.venueIO, lengthM: memory.lengthM, widthM: memory.widthM, areaM2: memory.areaM2, timeOfDay: null };
}

const hasDims = (memory: BriefMemory): boolean => memory.lengthM !== null && memory.widthM !== null;

/**
 * 一句话 + 记忆 → 这一轮怎么回。纯函数：memory 原样传入、新记忆原样带回，
 * 面板只按 kind 分发（generate 走生成，ask/ack/none 直接把 text 说出去）。
 * preExtraction：真模型（scene-api /brief/extract）解析出的槽位，注入后跳过本地正则——
 * 这是 LLM 接管「听懂」的唯一入口，记忆合并与防复读决策仍在这里；layoutMode 可随槽位一并注入。
 */
export function parseBriefTurn(raw: string, previous: BriefMemory, context: BriefTurnContext, preExtraction?: BriefExtraction & { layoutMode?: LayoutMode | null }): BriefTurn {
  const memory: BriefMemory = { ...previous };
  const compact = raw.replace(/\s+/g, '');
  const extraction = preExtraction ?? parseBriefSentence(raw);

  // 口语扩展：教学场景与课桌椅形态不在通用解析里，这里补齐。
  if (extraction.event === null && EDUCATION_PATTERN.test(compact)) extraction.event = '教学';
  if (DESK_CHAIR_PATTERN.test(compact)) memory.layoutMode = 'desk-chair';
  // 模型路径：layoutMode 由 /brief/extract 直接给出，规则没接住时兜进来。
  if (preExtraction?.layoutMode) memory.layoutMode = preExtraction.layoutMode;
  // 「80 套」= 80 人各一套（课桌椅语境下套数即人数）；裸数字「80」「80 个」填进人数槽。
  if (extraction.headcount === null && memory.layoutMode === 'desk-chair' && /(\d{1,5})套/.test(compact)) {
    extraction.headcount = clampHeadcount(Number(compact.match(/(\d{1,5})套/)![1]));
  }
  if (extraction.headcount === null && BARE_NUMBER_PATTERN.test(compact)) {
    extraction.headcount = clampHeadcount(Number(compact.match(BARE_NUMBER_PATTERN)![1]));
  }

  if (extraction.event !== null) memory.event = extraction.event;
  if (extraction.headcount !== null) memory.headcount = extraction.headcount;
  if (extraction.venueIO !== null) memory.venueIO = extraction.venueIO;
  if (extraction.lengthM !== null && extraction.widthM !== null) { memory.lengthM = extraction.lengthM; memory.widthM = extraction.widthM; }
  if (extraction.areaM2 !== null) memory.areaM2 = extraction.areaM2;

  const scaleKnown = context.venueUp || context.scaleTyped || hasDims(memory) || memory.areaM2 !== null;
  const filledScaleAsk = memory.askedScale && ((extraction.lengthM !== null && extraction.widthM !== null) || extraction.areaM2 !== null);
  const saidSomething = extraction.event !== null || extraction.headcount !== null || extraction.venueIO !== null
    || extraction.areaM2 !== null || (extraction.lengthM !== null && extraction.widthM !== null) || memory.layoutMode !== previous.layoutMode;

  if ((context.command || saidSomething) && scaleKnown) {
    memory.askedScale = false;
    return { kind: 'generate', memory, extraction, filledScaleAsk, text: '' };
  }
  // 还没拿到场地尺寸就继续问：这句补了新要素就先复述再催尺寸；啥也没补（command 空跑或答非所问）
  // 就换一种说法催，不重复同一句开场白。
  const wantsScale = context.command || saidSomething || (previous.askedScale && !scaleKnown);
  if (wantsScale) {
    const known = summarizeMemory(memory);
    // 已记下人数就别再用「40 人」当示例误导：示例只催缺的槽。
    const example = memory.headcount === null ? '「40 人，室内 12×9」或「108 平米」' : '「室内 12×9」或「108 平米」';
    const missing = [memory.headcount === null ? '人数' : null, '场地多大'].filter(Boolean).join('和');
    const tail = context.hasBase ? '，或者说「按图纸估」' : '';
    memory.askedScale = true;
    const escalate = previous.askedScale && !saidSomething;
    const text = escalate
      ? `还差${missing}：直接报长宽（「39×20」）或面积（「300 平米」）${context.hasBase ? '，有图纸就说「按图纸估」' : ''}，我就能先出一版。`
      : `${known ? `记下了：${known}。` : ''}还差${missing}：说一句 ${example}${tail}。`;
    return { kind: 'ask', memory, extraction, filledScaleAsk: false, text };
  }
  if (memory.headcount === null && memory.event === null && memory.venueIO === null && !hasDims(memory) && memory.areaM2 === null) {
    return { kind: 'none', memory, extraction, filledScaleAsk: false, text: '这句我没接住。跟我说一句「80 人，室内 12×9」这样的需求，我就能先出一版预览。' };
  }
  // 4.0.0 UX 改进：用户在已有规模基础上「补人话」（如「我们是个老年人活动」），
  // 不要再回「我没接住」。识别受众关键词 → 主动给 2-3 条硬建议 + 提出帮他圈区。
  // 推理层：模型通道（preExtraction.proactiveReply）给了文案就优先用模型版，
  // 没给/超时/不可用（resolver 自己 try/catch 回退正则版）才走本地 buildAudiencePrompt。
  const known = summarizeMemory(memory);
  const modelReply =
    typeof preExtraction?.proactiveReply === 'string' && preExtraction.proactiveReply.trim().length > 0
      ? preExtraction.proactiveReply.trim()
      : '';
  // 模型若给了 mobilityAssistance 判定就优先用；没给时正则兜底从 raw 自己识别。
  const mobilityHint = preExtraction?.mobilityAssistance ?? null;
  const audiencePrompt = modelReply || buildAudiencePrompt(raw, mobilityHint);
  if (audiencePrompt) {
    return {
      kind: 'ack',
      memory,
      extraction,
      filledScaleAsk: false,
      text: `${known ? `记下了：${known}。` : ''}${audiencePrompt}`,
    };
  }
  return { kind: 'ack', memory, extraction, filledScaleAsk: false, text: `这句我没接住。已记下：${known}${scaleKnown ? '' : '；还差场地多大，说一句「12×9」就行'}。要调布置直接说，比如「加两把椅子」或「换个摆法」。` };
}

/**
 * 识别用户这一句里的受众关键词，命中就给一段「人话硬建议」。
 * 不命中返回空串，让上层回默认话术。
 *
 * 2026-11-06 三档语义（用户反馈「是老年人就必须有轮椅吗？这智能吗？」后重构）：
 *  档位 1 mobilityAssistance=true（raw 命中「轮椅/腿脚不便/助行器/残疾人/拐杖/行动不便」
 *       或模型显式判定）→ 给 1.5m 轮椅通道硬建议，直接断言。
 *  档位 2 只说老年/长辈/银发/中老年但没提行动能力 → 禁止出现「轮椅」二字，
 *       给确认式问句（「长辈里有需要轮椅/助行器的吗？有的话按 1.5m，没有按 1.2m 也够」），
 *       把判断权交回用户。
 *  档位 3 family/business 等其他受众且没 mobility → 常规硬建议，文案禁止出现「轮椅」二字。
 *
 * mobilityAssistanceHint：模型通道显式判定的布尔值；null 表示模型没给，由本函数从 raw 正则识别。
 */
const MOBILITY_PATTERN = /(轮椅|腿脚不便|助行器|残疾人|轮椅通道|拐杖|行动不便|起身困难)/;
const ELDERLY_PATTERN = /(老年|中老年|老人|长辈|银发|退休|高龄)/;
const FAMILY_PATTERN = /(亲子|小孩|儿童|孩子|小朋友|宝宝)/;
const BUSINESS_PATTERN = /(商务|企业|客户|答谢|晚宴|年会|公司)/;

function buildAudiencePrompt(raw: string, mobilityAssistanceHint: boolean | null = null): string {
  const hasMobility = mobilityAssistanceHint === true || (mobilityAssistanceHint === null && MOBILITY_PATTERN.test(raw));
  const isElderly = ELDERLY_PATTERN.test(raw);
  const isFamily = FAMILY_PATTERN.test(raw);
  const isBusiness = BUSINESS_PATTERN.test(raw);
  // 没有任何受众信号、也没有明确行动能力信号：不说话，走默认话术。
  if (!isElderly && !isFamily && !isBusiness && !hasMobility) return '';

  // 借用 generateZonePrompts 取「建议圈哪些区」，但当前没画过任何 zone（新会话），所以默认全推。
  const zonePrompts = generateZonePrompts({
    audience: raw,
    zoneTypes: [],
  });
  const zoneAsk = zonePrompts.length > 0
    ? `要不要我直接在 2D 上帮你把${zonePrompts.map((p) => ({ checkin: '签到区', rest: '休息区', roundtable: '圆桌区', photo: '打卡区', desk: '课桌区' })[p.zoneType]).join('和')}先圈出来？回「好」就落。`
    : '要不要我直接在 2D 上帮你把签到区和休息区圈出来？';

  // 档位 1：明确行动不便/轮椅 → 硬建议，1.5m 通道。
  if (hasMobility) {
    return `主通道按 1.5m 留轮椅宽度，签到台前先空 2m 排队缓冲，休息区别塞门口、放到场地深处。${zoneAsk}`;
  }

  // 档位 2：只说老年没提行动能力 → 禁止「轮椅」二字出现在硬建议里，改确认式问句把判断权交回用户。
  if (isElderly) {
    return `长辈里有需要助行器/行动不便的吗？有的话我按 1.5m 通道留，没有按普通 1.2m 也够。${zoneAsk}`;
  }

  // 档位 3：family/business → 常规硬建议，文案禁止出现「轮椅」二字。
  const bullets: string[] = [];
  if (isFamily) {
    bullets.push('休息区长椅别靠墙，孩子跑过来有缓冲；尖角/玻璃位置贴防撞条');
  }
  if (isBusiness) {
    bullets.push('圆桌默认 8 人一桌，桌距至少 1.8m 好走通道；签到区放到进门侧，别把客户往深处塞');
  }
  return `${bullets.join('；')}。${zoneAsk}`;
}
