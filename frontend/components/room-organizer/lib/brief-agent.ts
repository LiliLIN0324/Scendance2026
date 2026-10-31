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
  const known = summarizeMemory(memory);
  return { kind: 'ack', memory, extraction, filledScaleAsk: false, text: `这句我没接住。已记下：${known}${scaleKnown ? '' : '；还差场地多大，说一句「12×9」就行'}。要调布置直接说，比如「加两把椅子」或「换个摆法」。` };
}
