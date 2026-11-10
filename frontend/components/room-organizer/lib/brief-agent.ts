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
 * 4. 课桌椅形态由明确的布置选择确定；家具库存套数不能推断活动人数。
 *
 * 模型化路径：turn 函数是唯一接缝，后续接 Vercel AI SDK（选型见 docs/plans/agent-reference-study.md）
 * 时把 parseBriefTurn 换成 LLM resolver 即可，面板与生成器不动。
 */
import { planHeldEvent } from './event-layout-agent';
import { resolveTableArrangement } from './table-seat-plan';
import { classifyLocalLayout, formatArea, HEADCOUNT_MAX, layoutGenerateCommand, mentionsCircleSeating, parseBriefSentence, type BriefExtraction, type VenueIO } from './workbench-agent';
import type { FurnishingChoice } from './furnishing-select';
import type { LocalSeatingSpecs } from './local-seating-specs';
import type { SeatingAllocation } from './seating-allocation';
import type { OriginalPreservation } from './original-preservation';

/** 布置形态：dining = 餐桌组（默认），desk-chair = 一人一套课桌椅。 */
export type LayoutMode = 'dining' | 'desk-chair';
export type PendingActivityNeed = { kind: 'checkin' | 'rest' | 'stage' | 'all_seated'; value: boolean; evidence: string };
export type ActivityNeedKind = PendingActivityNeed['kind'];
/** Original words only: this is not a matched or verified stock record. */
export type ReportedInventoryMention={evidence:string;status:'reported'|'needs_review'};
export type PendingBasicFact = { key: 'event' | 'headcount' | 'venueIO' | 'lengthM' | 'widthM' | 'areaM2' | 'timeOfDay' | 'layoutMode'; value: string | number; requiresRestatement?: boolean | undefined };

/** 跨句子累积的简报记忆：出方案的条件都从这里读，不靠当句正则。 */
export interface BriefMemory {
  /** Explicit user instruction, anchored to the objects present when it was stated. */
  originalPreservation?:OriginalPreservation | undefined;
  /** User-reported furniture dimensions for local seating drafts, not measured stock. */
  localSeatingSpecs?:LocalSeatingSpecs | undefined;
  /** Explicit user choice; absent is an exploration assumption, not a confirmed fact. */
  localSeatingAllocation?:SeatingAllocation | undefined;
  reportedInventory?:ReportedInventoryMention[] | undefined;
  event: string | null;
  headcount: number | null;
  headcountMode: 'must' | 'prefer' | null;
  /** 仅在用户明确要求人人入座时为 true，人数本身不等于座位数。 */
  allGuestsSeated: boolean | null;
  venueIO: VenueIO | null;
  lengthM: number | null;
  widthM: number | null;
  areaM2: number | null;
  /** 原话支持的行动辅助/轮椅通行需求；不等于现场或规范已通过。 */
  mobilityRequirement?: {decision:'needed'|'not_needed'|'unknown';evidence:string} | undefined;
  mobilityNeedsClarification?: boolean | undefined;
  /** Exact venue snapshot to which the stated scale belongs. */
  venueScaleBasis?: string | undefined;
  venueFactToken?: {generation:string;epoch:number} | undefined;
  venueSourceScope?: string | undefined;
  venueSourceDigest?: string | undefined;
  scaleNeedsReconfirmation?: boolean | undefined;
  previousVenueScale?: { lengthM:number | null; widthM:number | null; areaM2:number | null } | undefined;
  layoutMode: LayoutMode;
  /** ring = 圆桌沿环/扇形摆；grid = 课桌行列。缺省沿用原方格餐桌。 */
  seatingShape?: 'ring' | 'grid' | undefined;
  /** Table size or per-table headcount the user stated. The layout uses the derived seat count. */
  banquetTable?: { shape?: 'round' | 'rect' | undefined; width?: number | undefined; depth?: number | undefined; peoplePerTable?: number | undefined; evidence: string } | undefined;
  /** The user is holding an event. Awaiting means the next missing fact is the headcount. */
  eventIntent?: { occasion: string; awaiting?: 'headcount' | undefined } | undefined;
  /** Table chosen by select_furnishing. Layout places this and does not pick another. */
  furnishing?: FurnishingChoice | undefined;
  /** Hall size the agent assumed. Not a user-stated measurement. */
  agentVenue?: { lengthM: number; widthM: number } | undefined;
  /** 只有用户明确选择或确认后，才能把布局方式用于生成。 */
  layoutModeConfirmed?: boolean | undefined;
  /** 用户否定或尚未决定布置方式时，等待明确指定替代方式。 */
  layoutModeUnresolved?: boolean | undefined;
  pendingBasicFacts?: PendingBasicFact[] | undefined;
  /** In-memory only; a changed/cancelled request must not resume after confirmation. */
  pendingGeneration?: {command:'first'|'again';instruction:string} | undefined;
  /** 已经追问过一次场地尺寸：再没听到就换一种说法，不重复同一句。 */
  askedScale: boolean;
  /** 仅保存用户明确表达的区域需求；未知不当作需要或不需要。 */
  zoneNeeds: { checkin: boolean | null; rest: boolean | null; stage: boolean | null };
  pendingActivityNeeds: PendingActivityNeed[];
  unresolvedActivityNeeds: ActivityNeedKind[];
  /** Explicitly postponed decisions, still unknown until the user resolves them. */
  deferredActivityNeeds?: ActivityNeedKind[] | undefined;
}

export function initialBriefMemory(): BriefMemory {
  return { event: null, headcount: null, headcountMode: null, allGuestsSeated: null, venueIO: null, lengthM: null, widthM: null, areaM2: null, layoutMode: 'dining', layoutModeConfirmed: false, askedScale: false, zoneNeeds: { checkin: null, rest: null, stage: null }, pendingActivityNeeds: [], unresolvedActivityNeeds: [] };
}

export const isActivityNeedsAnswer = (raw: string): boolean => /^(对|是|确认|没错|是的|好的|可以|不对|不是|否)$/.test(raw.trim());
export const isUnresolvedNeedsAnswer = (raw: string): boolean => /^(需要|要|是|是的|对|不需要|不要|不用|否|不是)$/.test(raw.trim());

/** Counts with object units do not establish how many people will attend. */
export const hasNonPersonQuantity=(raw:string):boolean=>/(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千]+)\s*(?:(?:套|把|张|件|只|盏|排|组|台|块)|个\s*(?:椅|桌|凳|座椅|沙发|舞台|灯|柜|屏|物料|设备|家具|展位))/.test(raw);

function needLabel(kind: ActivityNeedKind): string {
  return kind === 'checkin' ? '签到区' : kind === 'rest' ? '休息区' : kind === 'stage' ? '舞台' : '所有人入座';
}

function needDescription(need: PendingActivityNeed): string {
  if (need.kind === 'all_seated') return need.value ? '所有人都需要座位' : '不要求所有人入座';
  const label = need.kind === 'checkin' ? '签到区' : need.kind === 'rest' ? '休息区' : '舞台';
  return `${need.value ? '需要' : '不需要'}${label}`;
}

/** 只处理明确说出的区域需要与否，复杂表达保留未知。 */
export function mergeZoneNeeds(raw: string, previous: BriefMemory['zoneNeeds']): BriefMemory['zoneNeeds'] {
  const next = { ...previous };
  const clauses = raw.split(/[，,；;。！!]/);
  for (const [key, label] of [['checkin', '签到(?:区|台)?'], ['rest', '休息区'], ['stage', '舞台']] as const) {
    const pattern = new RegExp(`(不需要|没有|不用|不要|无需|不设|取消|需要|要|设置|保留|有)\\s*(?:一个|一处|个)?\\s*${label}`, 'g');
    for (const clause of clauses) {
      if (/(可能|也许|或许|是否|要不要|需不需要|不确定|不知道|待定|看情况|并非|不排除|未必|不一定|不是|上次|上一场|上届|去年|往年|以前|此前|之前|历史|[吗么？?])/.test(clause)) continue;
      for (const match of clause.matchAll(pattern)) next[key] = !/^(不需要|没有|不用|不要|无需|不设|取消)$/.test(match[1]!);
    }
  }
  return next;
}

/** 只接受原句中的具体表述；模糊、否定范围或多处冲突均保守追问。 */
export function parseMobilityRequirement(raw:string):{decision:'needed'|'not_needed'|'unknown';evidence:string}|null {
  const subject=/(轮椅(?:通道|通行|出入|使用者)?|助行器|拐杖|行动不便|腿脚不便|行动辅助)/;
  const clauses=raw.split(/[，,；;。！!]|但是|但|然而|不过|同时|并且/).map(value=>value.trim()).filter(value=>subject.test(value));
  if(!clauses.length)return null;
  const decisions=clauses.map(clause=>{
    if(/(不确定|不排除|并非|不是|没有说|没有表示|不要不|未必|不一定|可能|也许|或许|是否|要不要|需不需要|有没有|待定|不知道|看情况|或者|还是|上一场|上次|去年|以前|[吗么?？])/.test(clause))return 'unknown' as const;
    // Absence of a known user is not a decision about access requirements.
    // Test this before the positive patterns: otherwise “没有” contains “有”
    // and “没有人需要” contains “需要”, silently reversing the user's words.
    if(/(?:没有人|没有任何人|没有人员|没有来宾|没有嘉宾|没有参会者|没人|无人|零人|0\s*人|不使用|没有使用|无人使用|不坐|不会使用|未使用)/.test(clause))return 'unknown' as const;
    if(/(?:没有|未有|不会有|并无|不存在|未见|未发现).{0,8}(?:轮椅|助行器|拐杖|行动不便|腿脚不便|行动辅助)|无(?:任何|一位|人使用)?(?:轮椅|助行器|拐杖|行动不便|腿脚不便|行动辅助)/.test(clause))return 'unknown' as const;
    if(/(?:不需要|无需|不用|不要|不设|取消)(?:.{0,8})(?:轮椅|助行器|拐杖|行动不便|腿脚不便|行动辅助)/.test(clause)||/(?:轮椅|助行器|拐杖|行动辅助).{0,6}(?:不需要|不用|不设|无需)/.test(clause))return 'not_needed' as const;
    if(/(?:需要|要|设置|保留|安排|有|使用|坐)(?:.{0,8})(?:轮椅|助行器|拐杖|行动不便|腿脚不便|行动辅助)/.test(clause)||/(?:轮椅|助行器|拐杖|行动不便|腿脚不便|行动辅助).{0,8}(?:需要|使用|通行)/.test(clause))return 'needed' as const;
    return 'unknown' as const;
  });
  const unique=new Set(decisions);return {decision:unique.size===1?decisions[0]!:'unknown',evidence:(clauses.length===1?clauses[0]!:raw).slice(0,2000)};
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
  /** Event preview copy. Names the agent-filled hall and the selected table, and waits for confirm. */
  previewLead?: string | undefined;
  /** Tool calls that produced a preview. Layout is listed only after selection. */
  layoutTools?: ReadonlyArray<{ tool: 'select_furnishing' | 'layout_preview'; summary: string }> | undefined;
}

const EDUCATION_PATTERN = /(小学|中学|大学|学校|课堂|上课|讲课|教学|课室|班级|学生|小朋友)/;
/** These words select a desk-and-chair style, not the number of people per desk. */
const DESK_CHAIR_PATTERN = /(课桌|课椅|桌椅|一人一套|每人一套|一套课桌|桌(子)?[^]{0,6}配[^]{0,6}椅)/;
const BARE_NUMBER_PATTERN = /^(\d{1,5})(个|人)?$/;

/** 记忆里已有的要素复述给人听：人数 · 室内外 · 尺度 · 形态 · 类型。 */
export function summarizeMemory(memory: BriefMemory): string {
  const parts: string[] = [];
  if (memory.headcount !== null) parts.push(`${memory.headcount} 人${memory.headcountMode === 'must' ? '（必须）' : memory.headcountMode === 'prefer' ? '（期望）' : ''}`);
  if (memory.venueIO !== null) parts.push(memory.venueIO === 'indoor' ? '室内' : '户外');
  // 说过的尺度也要复述：只报「80 人 · 室内」而把刚给的「12×9」吞掉，等于对人确认过的事实装失忆。
  if (memory.lengthM !== null && memory.widthM !== null) parts.push(`${formatArea(memory.lengthM)} × ${formatArea(memory.widthM)} m`);
  else if (memory.areaM2 !== null) parts.push(`${formatArea(memory.areaM2)} ㎡`);
  if (memory.layoutMode === 'desk-chair' && memory.layoutModeConfirmed === true) {
    const arrangement=memory.localSeatingAllocation;
    parts.push(arrangement?.status==='one_per_desk'?'一人一套课桌椅':arrangement?.status==='shared_desk'?`课桌椅（每桌 ${arrangement.peoplePerDesk} 人）`:'课桌椅（每桌人数待定）');
  }
  if (memory.event !== null) parts.push(memory.event);
  return parts.join(' · ');
}

/** 记忆折回 BriefExtraction：scaleFrom / describeExtraction / syncStudioBrief 吃的还是老形状。 */
export function memoryExtraction(memory: BriefMemory): BriefExtraction {
  return { event: memory.event, headcount: memory.headcount, venueIO: memory.venueIO, lengthM: memory.lengthM, widthM: memory.widthM, areaM2: memory.areaM2, timeOfDay: null };
}

/** Carry only bounded, non-secret user statements; these are clues, not verified inventory. */
function inventoryClues(memory:BriefMemory): {lines:string[];omitted:number} {
  const sensitive=/(?:https?:\/\/|www\.|\b(?:data|blob|file):|(?:api[_ -]?key|access[_ -]?token|secret|password|密码|密钥)\s*[:=：]\s*\S+|\bbearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|\b1[3-9]\d{9}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;
  const raw:Array<{evidence:unknown;label:string}>=[];
  for(const item of memory.reportedInventory??[]){
    if(!item||typeof item!=='object')continue;
    raw.push({evidence:item.evidence,label:item.status==='reported'?'用户口述，未核验、未选择':'用户口述有更正或冲突，需复核、未选择'});
  }
  for(const target of ['desk','chair'] as const){
    const item=memory.localSeatingSpecs?.unselected?.[target];
    for(const axis of ['width','depth','height'] as const){
      const fact=item?.[axis];if(!fact)continue;
      raw.push({evidence:fact.evidence,label:`${target==='desk'?'桌子':'椅子'}的口述库存规格线索，${fact.status==='reported'?'未核验、未选择':'不明确、需复核、未选择'}`});
    }
  }
  const unique=new Map<string,{evidence:unknown;label:string}>();
  for(const item of raw)unique.set(JSON.stringify([item.label,item.evidence]),item);
  const entries=[...unique.values()],lines:string[]=[];let omitted=0,total=0;
  for(const item of entries.slice(-6)){
    const quote=item.evidence;
    if(typeof quote!=='string'||!quote.trim()||quote.length>200||/[\u0000-\u001f\u007f]/.test(quote)||sensitive.test(quote)){omitted++;continue;}
    const line=`${item.label}：${JSON.stringify(quote)}`;
    if(total+line.length>1000){omitted++;continue;}lines.push(line);total+=line.length;
  }
  return {lines,omitted:omitted+Math.max(0,entries.length-6)};
}

/** 云端每次只收到当前一句，因此显式附上对话中已经识别、仍需核对的需求。 */
export function cloudBriefMessage(raw: string, memory: BriefMemory): string {
  const facts: string[] = [];
  if (memory.event) facts.push(`活动：${memory.event}`);
  if (memory.headcount !== null) {
    const strength = memory.headcountMode === 'must' ? '必须' : memory.headcountMode === 'prefer' ? '期望' : '强度待确认';
    facts.push(`人数：${memory.headcount}（${strength}）`);
  }
  if (memory.venueIO) facts.push(`场地：${memory.venueIO === 'indoor' ? '室内' : '户外'}`);
  if (memory.lengthM !== null && memory.widthM !== null) facts.push(`尺寸：${formatArea(memory.lengthM)} × ${formatArea(memory.widthM)} 米`);
  else if (memory.agentVenue) facts.push(`场地尺寸未给定，暂按 ${formatArea(memory.agentVenue.lengthM)} × ${formatArea(memory.agentVenue.widthM)} 米出预览，待确认`);
  else if (memory.areaM2 !== null) facts.push(`面积：${formatArea(memory.areaM2)} 平方米（长宽未确认）`);
  if (memory.layoutModeConfirmed === true) facts.push(memory.layoutMode === 'desk-chair' ? '布置：课桌配椅' : memory.seatingShape === 'ring' ? '布置：圆桌围坐，沿环形或扇形摆，椅子绕桌，不要排成方格，中间留过道' : '布置：圆桌');
  if (memory.layoutMode !== 'desk-chair' && (memory.seatingShape === 'ring' || memory.banquetTable?.shape)) {
    const people = memory.banquetTable?.peoplePerTable ?? (memory.localSeatingAllocation?.status === 'shared_desk' ? memory.localSeatingAllocation.peoplePerDesk : null);
    const plan = resolveTableArrangement({
      shape: memory.banquetTable?.shape ?? 'round',
      guests: memory.headcount,
      width: memory.banquetTable?.width ?? null,
      depth: memory.banquetTable?.depth ?? null,
      peoplePerTable: people,
    });
    facts.push(plan.explanation);
  }
  if(memory.localSeatingAllocation)facts.push(`桌椅人数关系的用户原话：${JSON.stringify(memory.localSeatingAllocation.evidence)}；${memory.localSeatingAllocation.status==='unknown'?'关系尚未确定，不能擅自改写。':'仅作用户需求，仍需检查方案。'}`);
  const specs=cloudSeatingSpecs(memory);
  if(specs){
    const evidence=new Set<string>();
    for(const item of [specs.desk,specs.chair])for(const fact of Object.values(item??{}))evidence.add(fact.evidence);
    for(const quote of evidence)facts.push(`桌椅规格的用户原话：${JSON.stringify(quote)}；仅作方案需求，实物规格和库存仍需核验。`);
  }
  if(memory.localSeatingSpecs?.defaults?.desk)facts.push('用户选择桌子使用示意默认规格；不代表已有实物。');
  if(memory.localSeatingSpecs?.defaults?.chair)facts.push('用户选择椅子使用示意默认规格；不代表已有实物。');
  if (memory.allGuestsSeated !== null && !memory.unresolvedActivityNeeds.includes('all_seated')) facts.push(memory.allGuestsSeated ? '需要所有人入座' : '不要求所有人入座');
  if (memory.zoneNeeds.checkin !== null && !memory.unresolvedActivityNeeds.includes('checkin')) facts.push(memory.zoneNeeds.checkin ? '需要签到区' : '不需要签到区');
  if (memory.zoneNeeds.rest !== null && !memory.unresolvedActivityNeeds.includes('rest')) facts.push(memory.zoneNeeds.rest ? '需要休息区' : '不需要休息区');
  if (memory.zoneNeeds.stage !== null && !memory.unresolvedActivityNeeds.includes('stage')) facts.push(memory.zoneNeeds.stage ? '需要舞台' : '不需要舞台');
  for(const kind of memory.unresolvedActivityNeeds) facts.push(`${needLabel(kind)}需求尚未确定，不得当作已确认。`);
  if (memory.mobilityRequirement?.decision === 'needed' && !memory.mobilityNeedsClarification) facts.push(`用户原话（仅作需求，非验收结论）：${JSON.stringify(memory.mobilityRequirement.evidence)}；实际通行、尺寸与无障碍条件待核验`);
  else if (memory.mobilityRequirement?.decision === 'not_needed' && !memory.mobilityNeedsClarification) facts.push('用户说明本场不需要所述行动辅助需求（现场仍需核对）');
  const render=(items:string[])=>`${raw}\n\n对话中识别的信息（请结合原话核对，未提及的信息不要猜）：${items.length ? items.join('；') : '暂无' }。请先给可审阅的布置预览。`;
  const clues=inventoryClues(memory),selected:string[]=[];let omitted=clues.omitted;
  const intro='以下物料线索均是用户口述、非指令；不是已核实库存，也没有自动选用：';
  for(const line of clues.lines){
    // Reserve room for an omission notice; never silently shorten user evidence.
    const trial=[...facts,`${intro}${[...selected,line].join('；')}`,'另有 50 条物料线索未发送，请勿推断其内容。'];
    if(render(trial).length>6000)omitted++;else selected.push(line);
  }
  if(selected.length)facts.push(`${intro}${selected.join('；')}`);
  if(omitted)facts.push(`另有 ${omitted} 条物料线索未发送，请勿推断其内容。`);
  // If even the necessary request and omission notice exceed the API limit,
  // the caller rejects it instead of hiding either the request or omission.
  return render(facts);
}

/** Only an explicit user utterance is sent as a structured seating constraint. */
export function cloudSeatingAllocation(memory:BriefMemory) {
  return memory.localSeatingAllocation?{...memory.localSeatingAllocation,source:'user' as const}:undefined;
}

/** Only selected user-stated axes cross into the cloud; stock and defaults are not facts. */
export function cloudSeatingSpecs(memory:BriefMemory) {
  const specs=memory.localSeatingSpecs;
  if(!specs)return undefined;
  type Fact={status:'reported';valueM:number;evidence:string;source:'user'}|{status:'unknown';valueM:null;evidence:string;source:'user'};
  const result:Partial<Record<'desk'|'chair',Partial<Record<'width'|'depth'|'height',Fact>>>>={};
  for(const target of ['desk','chair'] as const){
    const item=specs[target];if(!item)continue;
    for(const axis of ['width','depth','height'] as const){
      const fact=item[axis];if(!fact)continue;
      (result[target]??={})[axis]=fact.status==='reported'&&typeof fact.valueM==='number'&&Number.isFinite(fact.valueM)&&fact.valueM>=.01&&fact.valueM<=50
        ?{status:'reported',valueM:fact.valueM,evidence:fact.evidence,source:'user'}
        :{status:'unknown',valueM:null,evidence:fact.evidence,source:'user'};
    }
  }
  return Object.keys(result).length?result:undefined;
}

const hasDims = (memory: BriefMemory): boolean => memory.lengthM !== null && memory.widthM !== null;

/**
 * 一句话 + 记忆 → 这一轮怎么回。纯函数：memory 原样传入、新记忆原样带回，
 * 面板只按 kind 分发（generate 走生成，ask/ack/none 直接把 text 说出去）。
 * preExtraction：真模型（scene-api /brief/extract）解析出的槽位，注入后跳过本地正则——
 * 这是 LLM 接管「听懂」的唯一入口，记忆合并与防复读决策仍在这里；layoutMode 可随槽位一并注入。
 */
export function parseBriefTurn(raw: string, previous: BriefMemory, context: BriefTurnContext, preExtraction?: BriefExtraction & { layoutMode?: LayoutMode | null; inventoryMentions?:Array<{evidence:string}> | null }): BriefTurn {
  const memory: BriefMemory = { ...previous, zoneNeeds: mergeZoneNeeds(raw, previous.zoneNeeds) };
  const mentions=preExtraction?.inventoryMentions??[];
  const accepted=mentions.flatMap(({evidence})=>{
    if(!evidence||raw.indexOf(evidence)<0||raw.indexOf(evidence)!==raw.lastIndexOf(evidence))return [];
    const clause=raw.split(/[，,；;。！!？?]/).find(part=>part.includes(evidence));
    if(!clause||clause.trim().length>200||/(?:上次|上一场|上届|去年|往年|以前|此前|之前|历史|不确定|不一定|可能|也许|大约|大概|左右|至少|至多|是否|要不要|待定|不知道|没有|并无|并非|不是|无需|不需要|尚未|未有|采购|租赁|需要|计划|预计|[?？])/.test(clause))return [];
    if(!/(?:现有|已有|库存|我们有|场地有|手头有|备有|拥有|有)/.test(clause)
      || !/(?:\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:套|把|张|件|只|盏|组|台|块|个)\s*[\u4e00-\u9fa5a-zA-Z]/.test(evidence))return [];
    // Keep the complete original clause, not a model-cropped fragment that loses context.
    return [{evidence:clause.trim()}];
  });
  if(accepted.length){
    // Corrections are kept as evidence rather than silently replacing or summing stock.
    const prior=previous.reportedInventory??[],correction=/(?:改成|更正|纠正|其实|应该是|不对|不是|记错)/.test(raw);
    const existing=correction?prior.map(item=>({...item,status:'needs_review' as const})):prior;
    const added=accepted.filter(item=>!existing.some(old=>old.evidence===item.evidence)).map(item=>({evidence:item.evidence,status:correction?'needs_review' as const:'reported' as const}));
    // Never silently discard earlier user statements when this bounded store is full.
    memory.reportedInventory=existing.length+added.length<=50?[...existing,...added]:existing;
  }else if(previous.reportedInventory?.length&&/(?:改成|更正|纠正|其实|应该是|不对|记错)/.test(raw)&&hasNonPersonQuantity(raw)){
    memory.reportedInventory=previous.reportedInventory.map(item=>({...item,status:'needs_review' as const}));
  }
  if((previous.mobilityNeedsClarification || previous.mobilityRequirement?.decision==='unknown') && !previous.pendingActivityNeeds.length && !previous.unresolvedActivityNeeds.length && isUnresolvedNeedsAnswer(raw)){
    const value=!/^(不需要|不要|不用|否|不是)$/.test(raw.trim());
    memory.mobilityRequirement={decision:value?'needed':'not_needed',evidence:`${previous.mobilityRequirement?.evidence??''}；用户答复：${raw.trim()}`.slice(0,2000)};memory.mobilityNeedsClarification=false;
    return {kind:'ack',memory,extraction:preExtraction??parseBriefSentence(raw),filledScaleAsk:false,text:value?'已记下行动辅助或轮椅通行需求，实际通行条件仍待核验。':'已记下本场不需要所述行动辅助需求；现场条件仍需核对。'};
  }
  const compact = raw.replace(/\s+/g, '');
  const seatingDecisions=new Set<boolean>();
  for(const clause of compact.split(/[，,；;。！!]/)){
    if (/(可能|也许|或许|是否|是不是|要不要|需不需要|不确定|不知道|待定|看情况|上次|上一场|上届|去年|往年|以前|此前|之前|历史|[吗么？?])/.test(clause)) continue;
    if (/(?:不需要|不要求|不用|无需|不必)(?:每人|人人|所有人|全部人)(?:都有座|都入座|都坐|坐下|入座)/.test(clause)) seatingDecisions.add(false);
    else if (/(?:每人|人人|所有人|全部人)(?:都有座|都入座|都坐|坐下)|(?:必须|一定要|确保).{0,16}(?:人|位).{0,4}(?:都)?(?:坐|入座)/.test(clause)) seatingDecisions.add(true);
  }
  if(seatingDecisions.size===1)memory.allGuestsSeated=[...seatingDecisions][0]!;
  const extraction = preExtraction ?? parseBriefSentence(raw);
  if (previous.pendingActivityNeeds.length && isActivityNeedsAnswer(raw)) {
    const accepted = !/^(不对|不是|否)$/.test(raw.trim());
    if (accepted) {
      for (const need of previous.pendingActivityNeeds) {
        if (need.kind === 'all_seated') memory.allGuestsSeated = need.value;
        else memory.zoneNeeds[need.kind] = need.value;
      }
      const acceptedKinds = new Set(previous.pendingActivityNeeds.map(need => need.kind));
      memory.unresolvedActivityNeeds = previous.unresolvedActivityNeeds.filter(kind => !acceptedKinds.has(kind));
      memory.deferredActivityNeeds = (previous.deferredActivityNeeds ?? []).filter(kind => !acceptedKinds.has(kind));
      if(!memory.deferredActivityNeeds.length) delete memory.deferredActivityNeeds;
    }
    memory.pendingActivityNeeds = [];
    const nextQuestion=memory.unresolvedActivityNeeds.find(kind=>!(memory.deferredActivityNeeds??[]).includes(kind));
    return { kind: 'ack', memory, extraction, filledScaleAsk: false,
      text: accepted ? `记下了：${previous.pendingActivityNeeds.map(needDescription).join('、')}。${nextQuestion ? `${needLabel(nextQuestion)}是否需要？` : memory.mobilityNeedsClarification || memory.mobilityRequirement?.decision==='unknown' ? '行动辅助或轮椅通行需求是否需要？' : '可以继续补充需求，或说「出方案」。'}` : '这部分我先不采用。请直接告诉我哪里需要调整。' };
  }
  if (!previous.pendingActivityNeeds.length && previous.unresolvedActivityNeeds.length && isUnresolvedNeedsAnswer(raw)) {
    const actionable=previous.unresolvedActivityNeeds.filter(kind=>!(previous.deferredActivityNeeds??[]).includes(kind));
    if(!actionable.length && previous.unresolvedActivityNeeds.length>1) return {kind:'ask',memory,extraction,filledScaleAsk:false,text:'请说明你指的是哪项活动需求。'};
    const kind=actionable[0]??previous.unresolvedActivityNeeds[0];
    const remaining=previous.unresolvedActivityNeeds.filter(item=>item!==kind);
    const value = !/^(不需要|不要|不用|否|不是)$/.test(raw.trim());
    if (kind === 'all_seated') memory.allGuestsSeated = value;
    else if (kind) memory.zoneNeeds[kind] = value;
    memory.unresolvedActivityNeeds = remaining;
    memory.deferredActivityNeeds = (previous.deferredActivityNeeds ?? []).filter(item => item !== kind);
    if(!memory.deferredActivityNeeds.length) delete memory.deferredActivityNeeds;
    const remainingToAsk=remaining.filter(item=>!(memory.deferredActivityNeeds??[]).includes(item));
    return { kind: 'ack', memory, extraction, filledScaleAsk: false, text: remainingToAsk.length
      ? `记下了。${needLabel(remainingToAsk[0]!)}是否需要？`
      : '记下了。可以继续补充需求，或说「出方案」。' };
  }

  // 口语扩展：教学场景与课桌椅形态不在通用解析里，这里补齐。
  if (extraction.event === null && EDUCATION_PATTERN.test(compact)) extraction.event = '教学';
  // Existing inventory is not a choice of layout: “有80套课桌椅” can describe
  // available resources even when the organiser has not decided how to use them.
  const clauses = compact.split(/[，,；;。！!]/);
  const inventoryOnly = (clause:string) => /(?:库存|现有|已有|原有|备有|存有|我们有|场地有|手头有|带有|没有|拥有|提供|借到|租到|买了|购入|准备了|\d+套)/.test(clause)
    && !/(?:采用|选择|按.{0,8}摆|摆成|排成|使用|用.{0,8}(?:课桌|桌椅|圆桌|布置)|布置成|希望|想要|需要|要求|要.{0,8}(?:配|摆|排|布置|\d+套)|每人一套|一人一套)/.test(clause);
  const historyText=/(?:上次|上一场|上届|去年|往年|以前|此前|之前|历史)/;
  const hasCurrentLayoutChoice=clauses.some(clause=>!historyText.test(clause)&&!/(?:不需要|不要|不用|不确定|可能|待定|还是|[吗么？?])/.test(clause)
    && /(?:采用|选择|用|摆|排|需要|要|一人一套|每人一套)/.test(clause)
    && (DESK_CHAIR_PATTERN.test(clause)||/(?:圆桌|餐桌)/.test(clause))&&!inventoryOnly(clause));
  const usableLayoutClause=(clause:string)=>!inventoryOnly(clause)&&!(hasCurrentLayoutChoice&&historyText.test(clause));
  const deskClauses = clauses.filter(clause => DESK_CHAIR_PATTERN.test(clause) && usableLayoutClause(clause));
  const deskExplicit = deskClauses.some(clause => !/(不|没|无|取消|可能|也许|或|是否|待定|看情况|上次|上一场|上届|去年|往年|以前|此前|之前|历史|[吗么？?])/.test(clause));
  const deskAmbiguous = deskClauses.some(clause => /(不|没|无|取消|可能|也许|或|是否|待定|看情况|上次|上一场|上届|去年|往年|以前|此前|之前|历史|[吗么？?])/.test(clause));
  const diningClauses = clauses.filter(clause => /(?:圆桌|餐桌)/.test(clause) && usableLayoutClause(clause));
  const diningExplicit = diningClauses.some(clause => !/(不|没|无|取消|可能|也许|或|是否|待定|看情况|上次|上一场|上届|去年|往年|以前|此前|之前|历史|[吗么？?])/.test(clause));
  const diningAmbiguous = diningClauses.some(clause => /(不|没|无|取消|可能|也许|或|是否|待定|看情况|上次|上一场|上届|去年|往年|以前|此前|之前|历史|[吗么？?])/.test(clause));
  if (deskExplicit && !deskAmbiguous && !diningExplicit) { memory.layoutMode = 'desk-chair'; memory.layoutModeUnresolved = false; memory.layoutModeConfirmed = true; memory.seatingShape = 'grid'; }
  else if (diningExplicit && !diningAmbiguous && !deskExplicit) { memory.layoutMode = 'dining'; memory.layoutModeUnresolved = false; memory.layoutModeConfirmed = true; memory.seatingShape = 'ring'; }
  else if (deskAmbiguous || diningAmbiguous || (deskExplicit && diningExplicit)) { memory.layoutModeUnresolved = true; memory.layoutModeConfirmed = false; }
  // 「围着坐 / 大家围着 / 围成一圈 / 不要课桌改沙发」is a circle preview. Literal sofas are not auto-placed; round tables are.
  if ((mentionsCircleSeating(raw) || /(?:不要|别用|不用).{0,8}(?:课桌|课椅|桌椅)/.test(compact) && /沙发|圆桌|围|休闲/.test(compact)) && !deskExplicit && !/(?:不要|不想|别|不围)围/.test(compact)) {
    memory.layoutMode = 'dining';
    memory.layoutModeUnresolved = false;
    memory.layoutModeConfirmed = true;
    memory.seatingShape = 'ring';
  }
  // 模型路径：layoutMode 由 /brief/extract 直接给出，规则没接住时兜进来。
  const mentionedLayoutClauses=clauses.filter(clause=>DESK_CHAIR_PATTERN.test(clause)||/(?:圆桌|餐桌)/.test(clause));
  const onlyInventory=mentionedLayoutClauses.length>0&&mentionedLayoutClauses.every(inventoryOnly);
  if (preExtraction?.layoutMode && !onlyInventory && !deskAmbiguous && !diningAmbiguous && !memory.layoutModeUnresolved) { memory.layoutMode = preExtraction.layoutMode; memory.layoutModeConfirmed = true; }
  // 裸数字在对话中用作人数；物料套数不是人数。
  if (extraction.headcount === null && BARE_NUMBER_PATTERN.test(compact)) {
    extraction.headcount = Number(compact.match(BARE_NUMBER_PATTERN)![1]);
  }

  if (extraction.headcount !== null && (!Number.isInteger(extraction.headcount) || extraction.headcount < 1 || extraction.headcount > HEADCOUNT_MAX)) {
    const count = extraction.headcount;
    return { kind: 'ask', memory: previous, extraction: { ...extraction, headcount: null }, filledScaleAsk: false,
      text: `我理解的人数是 ${count}；当前一次支持 1 至 ${HEADCOUNT_MAX} 人，请核对人数或分场规划。` };
  }

  if (extraction.event !== null) memory.event = extraction.event;
  if (extraction.headcount !== null) {
    const requirements = extraction.requirements?.filter((r) => r.key === 'headcount' && r.value === extraction.headcount) ?? [];
    const modes = new Set(requirements.map(r => r.mode));
    memory.headcountMode = modes.size === 1 ? requirements[0]!.mode : null;
    memory.headcount = extraction.headcount;
  }
  if (extraction.venueIO !== null) memory.venueIO = extraction.venueIO;
  if (extraction.lengthM !== null && extraction.widthM !== null) { memory.lengthM = extraction.lengthM; memory.widthM = extraction.widthM; }
  if (extraction.areaM2 !== null) memory.areaM2 = extraction.areaM2;

  const mobility=parseMobilityRequirement(raw);
  if(mobility){memory.mobilityRequirement=mobility;memory.mobilityNeedsClarification=mobility.decision==='unknown';}
  const historicPattern=/(?:上次|上一场|上届|去年|往年|以前|此前|之前|历史)/;
  const sourceClauses=raw.split(/[，,；;。！!]|但是|然而|不过/).map(clause=>clause.trim()).filter(Boolean);
  const needPattern:Record<ActivityNeedKind,RegExp>={checkin:/签到/,rest:/休息区/,stage:/舞台/,all_seated:/(?:每人|人人|所有人|全部人).{0,8}(?:坐|座|入座)/};
  // A decision explicitly postponed is different from an unanswered ambiguous question.
  const deferral=/(?:还没决定|尚未决定|没决定|未决定|还没想好|没想好|尚未确定|暂未确定|未确定|待定|稍后再定|以后再定)/;
  const bareDeferral=/^(?:还没决定|尚未决定|没决定|未决定|还没想好|没想好|尚未确定|暂未确定|未确定|待定|稍后再定|以后再定)[。！!]*$/.test(raw.trim());
  const bareTarget=previous.unresolvedActivityNeeds.find(kind=>!(previous.deferredActivityNeeds??[]).includes(kind));
  const postponed=(['checkin','rest','stage','all_seated'] as const).filter(kind=>
    (bareDeferral&&kind===bareTarget) || sourceClauses.some(clause=>!historicPattern.test(clause)&&needPattern[kind].test(clause)&&deferral.test(clause)));
  const explicitlyCurrent=(kind:ActivityNeedKind)=>sourceClauses.some(clause=>{
    if(historicPattern.test(clause)||!needPattern[kind].test(clause)||/(?:不确定|不一定|可能|也许|是否|要不要|待定|没定|未定|不知道|看情况|[吗么?？])/.test(clause))return false;
    if(kind==='all_seated')return /(?:每人|人人|所有人|全部人).{0,8}(?:坐|座|入座)/.test(clause);
    return mergeZoneNeeds(clause,{checkin:null,rest:null,stage:null})[kind]!==null;
  });
  const rawNeeds = (extraction.activityNeeds ?? []).filter(n => n.decision !== 'unknown' && raw.includes(n.evidence));
  const uncertainNeeds = (extraction.activityNeeds ?? []).filter(n => n.decision === 'unknown' && raw.includes(n.evidence) && !(historicPattern.test(n.evidence)&&explicitlyCurrent(n.kind)));
  for(const kind of postponed) if(!uncertainNeeds.some(need=>need.kind===kind)) uncertainNeeds.push({kind,decision:'unknown',evidence:raw});
  // Historical statements describe another event. If the current event has
  // no explicit counterpart, keep its prior value but ask before using it.
  for(const kind of ['checkin','rest','stage','all_seated'] as const){
    const historical=sourceClauses.find(clause=>historicPattern.test(clause)&&needPattern[kind].test(clause));
    if(historical&&!explicitlyCurrent(kind)&&!uncertainNeeds.some(need=>need.kind===kind))uncertainNeeds.push({kind,decision:'unknown',evidence:historical});
  }
  if(seatingDecisions.size>1&&!uncertainNeeds.some(need=>need.kind==='all_seated'))uncertainNeeds.push({kind:'all_seated',decision:'unknown',evidence:raw});
  const proposed: PendingActivityNeed[] = [];
  const reasserted: ActivityNeedKind[] = [];
  const conflicts: string[] = [];
  const conflictKinds: ActivityNeedKind[] = [];
  for (const kind of ['checkin', 'rest', 'stage', 'all_seated'] as const) {
    const matching = rawNeeds.filter(n => n.kind === kind);
    if (!matching.length) continue;
    if (matching.some(n => n.decision !== matching[0]!.decision) || uncertainNeeds.some(n => n.kind === kind)) {
      conflicts.push(kind === 'checkin' ? '签到区' : kind === 'rest' ? '休息区' : kind === 'stage' ? '舞台' : '是否人人入座');
      conflictKinds.push(kind);
      if (kind === 'all_seated') memory.allGuestsSeated = previous.allGuestsSeated;
      else memory.zoneNeeds[kind] = previous.zoneNeeds[kind];
      continue;
    }
    const value = matching[0]!.decision === 'needed';
    const oldValue = kind === 'all_seated' ? previous.allGuestsSeated : previous.zoneNeeds[kind];
    if (value === oldValue) { reasserted.push(kind); continue; }
    proposed.push({ kind, value, evidence: matching[0]!.evidence });
    if (kind === 'all_seated') memory.allGuestsSeated = previous.allGuestsSeated;
    else memory.zoneNeeds[kind] = oldValue;
  }
  if (conflicts.length) {
    const unresolvedKinds = [...conflictKinds, ...uncertainNeeds.map(need => need.kind)];
    memory.unresolvedActivityNeeds = [...new Set([...previous.unresolvedActivityNeeds, ...unresolvedKinds])];
    memory.pendingActivityNeeds = previous.pendingActivityNeeds.filter(need => !unresolvedKinds.includes(need.kind));
    memory.deferredActivityNeeds = (previous.deferredActivityNeeds ?? []).filter(kind => !unresolvedKinds.includes(kind));
    if(!memory.deferredActivityNeeds.length) delete memory.deferredActivityNeeds;
    return { kind: 'ask', memory, extraction, filledScaleAsk: false,
      text: `我没能确定${conflicts.join('、')}的要求，请再说明一次。` };
  }
  const unresolved = uncertainNeeds.filter(n => !proposed.some(p => p.kind === n.kind));
  for (const need of unresolved) {
    if (need.kind === 'all_seated') memory.allGuestsSeated = previous.allGuestsSeated;
    else memory.zoneNeeds[need.kind] = previous.zoneNeeds[need.kind];
  }
  if (unresolved.length) {
    const unresolvedKinds = unresolved.map(n => n.kind);
    memory.unresolvedActivityNeeds = [...new Set([...previous.unresolvedActivityNeeds, ...unresolvedKinds])];
    memory.pendingActivityNeeds = previous.pendingActivityNeeds.filter(need => !unresolvedKinds.includes(need.kind));
  }
  else if (previous.unresolvedActivityNeeds.length) {
    memory.unresolvedActivityNeeds = previous.unresolvedActivityNeeds.filter(kind => {
      if (reasserted.includes(kind)) return false;
      if (proposed.some(p => p.kind === kind)) return true;
      return kind === 'all_seated' ? memory.allGuestsSeated === previous.allGuestsSeated : memory.zoneNeeds[kind] === previous.zoneNeeds[kind];
    });
  }
  const newlyUncertain = new Set(uncertainNeeds.map(need=>need.kind));
  memory.deferredActivityNeeds = [...new Set([...(previous.deferredActivityNeeds ?? []).filter(kind=>
    memory.unresolvedActivityNeeds.includes(kind) && (!newlyUncertain.has(kind)||postponed.includes(kind))), ...postponed.filter(kind=>memory.unresolvedActivityNeeds.includes(kind))])];
  if(!memory.deferredActivityNeeds.length) delete memory.deferredActivityNeeds;
  // A newly postponed decision is unknown now, even if an earlier turn held a value.
  for(const kind of memory.deferredActivityNeeds??[]){
    if(kind==='all_seated') memory.allGuestsSeated=null;
    else memory.zoneNeeds[kind]=null;
  }
  if (proposed.length || reasserted.length) memory.pendingActivityNeeds = [
    ...memory.pendingActivityNeeds.filter(p => !proposed.some(n => n.kind === p.kind) && !reasserted.includes(p.kind)),
    ...proposed,
  ];
  else if (memory.pendingActivityNeeds.length) {
    for (const need of memory.pendingActivityNeeds) {
      if (need.kind === 'all_seated') memory.allGuestsSeated = previous.allGuestsSeated;
      else memory.zoneNeeds[need.kind] = previous.zoneNeeds[need.kind];
    }
  }
  if (memory.pendingActivityNeeds.length) {
    const known = summarizeMemory(memory);
    return { kind: 'ack', memory, extraction, filledScaleAsk: false,
      text: `${known ? `已记录（待核对）：${known}。` : ''}关于活动需求，我理解为${memory.pendingActivityNeeds.map(needDescription).join('、')}。这样对吗？回复「确认」或「不对」。` };
  }
  if (memory.unresolvedActivityNeeds.length) {
    // “还没决定” is an answer, not a request to decide immediately. Keep
    // the uncertainty in memory while allowing the conversation to continue.
    const deferred=memory.deferredActivityNeeds ?? [];
    const needsAnswer=memory.unresolvedActivityNeeds.filter(kind=>!deferred.includes(kind));
    if(!needsAnswer.length && postponed.length){
      const known=summarizeMemory(memory),inventory=hasNonPersonQuantity(raw)?'提到的物料数量暂未计入库存。':'';
      return {kind:'ack',memory,extraction,filledScaleAsk:false,text:`${known?`我先记下：${known}。`:''}${deferred.map(needLabel).join('、')}暂时待定，可以之后再决定。${inventory}你可以继续补充场地信息，也可以先用假设探索。`};
    }
    if(needsAnswer.length) return { kind: 'ask', memory, extraction, filledScaleAsk: false, text: `${needLabel(needsAnswer[0]!)}的需求还不确定，请告诉我是否需要。` };
  }
  if (reasserted.length && previous.pendingActivityNeeds.length) return { kind: 'ack', memory, extraction, filledScaleAsk: false, text: '记下了，保留之前的要求。' };

  if (memory.mobilityNeedsClarification || memory.mobilityRequirement?.decision==='unknown') return {kind:'ask',memory,extraction,filledScaleAsk:false,text:'行动辅助或轮椅通行需求尚未确定，这场是否需要？'};
  if (memory.layoutModeUnresolved) return { kind: 'ask', memory, extraction, filledScaleAsk: false, text: '布置方式尚未确定，请告诉我希望采用哪种布置方式。' };
  const requested = context.command ?? layoutGenerateCommand(raw);
  if ((onlyInventory||hasNonPersonQuantity(raw)) && !requested && extraction.headcount===null && extraction.event===null && extraction.venueIO===null && extraction.lengthM===null && extraction.widthM===null && extraction.areaM2===null) {
    const missing=[memory.headcount===null?'本场人数':null,memory.layoutModeConfirmed!==true?'布置方式':null].filter(Boolean);
    return {kind:'ask',memory,extraction,filledScaleAsk:false,text:`这句话提到了物品数量，暂未保存为库存。${missing.length?`请再说明${missing.join('和')}。`:'可以继续补充活动要求。'}`};
  }
  if ((extraction.lengthM !== null && extraction.widthM !== null) || extraction.areaM2 !== null) delete memory.agentVenue;
  const eventTurn = planHeldEvent(raw, memory, extraction);
  if (eventTurn) return eventTurn;

  const scaleKnown = context.venueUp || context.scaleTyped || hasDims(memory) || memory.areaM2 !== null;
  const filledScaleAsk = memory.askedScale && ((extraction.lengthM !== null && extraction.widthM !== null) || extraction.areaM2 !== null);
  const saidSomething = extraction.event !== null || extraction.headcount !== null || extraction.venueIO !== null
    || extraction.areaM2 !== null || (extraction.lengthM !== null && extraction.widthM !== null) || memory.layoutMode !== previous.layoutMode || memory.layoutModeConfirmed !== previous.layoutModeConfirmed;

  if ((requested || saidSomething) && scaleKnown) {
    if (memory.layoutModeConfirmed !== true) return { kind: 'ask', memory, extraction, filledScaleAsk, text: '还没确定布置方式，请选择圆桌或课桌椅；其他方式请说明，可能需要人工调整。' };
    if (memory.headcount === null) return { kind: 'ask', memory, extraction, filledScaleAsk, text: '请先说明本场预计人数，再生成布置方案。' };
    memory.askedScale = false;
    return { kind: 'generate', memory, extraction, filledScaleAsk, text: '' };
  }
  // 还没拿到场地尺寸就继续问：这句补了新要素就先复述再催尺寸；啥也没补（command 空跑或答非所问）
  // 就换一种说法催，不重复同一句开场白。
  const wantsScale = requested || saidSomething || (previous.askedScale && !scaleKnown);
  if (wantsScale && requested) {
    memory.askedScale = true;
    const text = memory.headcount === null
      ? '还差人数和场地尺寸。说一下，我再出预览。'
      : '还差场地尺寸。说一下长宽或面积，我再出预览。';
    return { kind: 'ask', memory, extraction, filledScaleAsk: false, text };
  }
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
  if (memory.zoneNeeds.checkin !== previous.zoneNeeds.checkin || memory.zoneNeeds.rest !== previous.zoneNeeds.rest || memory.zoneNeeds.stage !== previous.zoneNeeds.stage) {
    const requested = [memory.zoneNeeds.checkin === true ? '签到区' : null, memory.zoneNeeds.rest === true ? '休息区' : null].filter(Boolean);
    const excluded = [memory.zoneNeeds.checkin === false ? '不设签到区' : null, memory.zoneNeeds.rest === false ? '不设休息区' : null].filter(Boolean);
    const stage = memory.zoneNeeds.stage !== previous.zoneNeeds.stage ? (memory.zoneNeeds.stage ? '需要舞台' : '不设舞台') : null;
    const text = `${excluded.length || stage ? `记下了：${[...excluded, stage].filter(Boolean).join('、')}。` : ''}${requested.length ? `要不要我在 2D 上帮你把${requested.join('和')}圈出来？` : ''}`;
    return { kind: 'ack', memory, extraction, filledScaleAsk, text };
  }
  if (memory.allGuestsSeated !== previous.allGuestsSeated) {
    return { kind: 'ack', memory, extraction, filledScaleAsk, text: memory.allGuestsSeated ? '记下了：每位参加者都需要座位。' : '记下了：不要求所有参加者都入座。' };
  }
  if(mobility && mobility.decision!=='unknown')return {kind:'ack',memory,extraction,filledScaleAsk:false,text:mobility.decision==='needed'?'已记下行动辅助或轮椅通行需求，实际通行条件仍待核验。':'已记下本场不需要所述行动辅助需求；现场条件仍需核对。'};
  if (classifyLocalLayout(raw) === 'cannot') {
    return { kind: 'ask', memory, extraction, filledScaleAsk: false, text: '消防验收、施工图和办证我做不到。人和场地可以说一下，我先出布置预览。' };
  }
  if (memory.headcount === null && memory.event === null && memory.venueIO === null && !hasDims(memory) && memory.areaM2 === null) {
    return { kind: 'none', memory, extraction, filledScaleAsk: false, text: '这句我没接住。跟我说这场活动怎么坐、大概多少人，我再出一版预览。' };
  }
  // 基础提取没有新信息时，以中性问题澄清需求，避免把模型自由文本变成操作。
  const known = summarizeMemory(memory);
  // 模型若给了 mobilityAssistance 判定就优先用；没给时正则兜底从 raw 自己识别。
  const mobilityHint = null; // 模型布尔没有原文证据，不能覆盖用户陈述。
  // 未验证的模型自由文本不能直接变成圈区指令或安全结论。
  const audiencePrompt = mobility ? (mobility.decision==='needed'?'已记下行动辅助或轮椅通行需求，实际通行条件仍待核验。':'已记下本场不需要所述行动辅助需求；现场条件仍需核对。') : buildAudiencePrompt(raw, mobilityHint);
  if (audiencePrompt) {
    return {
      kind: 'ack',
      memory,
      extraction,
      filledScaleAsk: false,
      text: `${known ? `记下了：${known}。` : ''}${audiencePrompt}`,
    };
  }
  return { kind: 'ack', memory, extraction, filledScaleAsk: false, text: `这句我没接住。已记下：${known}。想改布置，直接说你希望怎么坐、松一点还是紧一点。` };
}

/** 离线兜底只追问本场需求，不从受众标签断言行动能力或固定布局。 */
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

  if (hasMobility) return '参加者是否有行动辅助需求？请说明需要的通行方式和场地条件。';
  if (isElderly) return '参加者是否有需要特别照顾的行动辅助、通行或休息需求？';
  return '这场活动希望如何入场、就座和交流？';
}
