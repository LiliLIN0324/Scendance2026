/** v2.4 布置第 1–3 步：右栏 Agent 状态机的纯函数部分（无 schema 变更，全部是页面本地状态）。 */
import type { ScaleOrigin } from './venue-shell';

export type AgentState =
  | 'empty' | 'dragHover' | 'baseNoDims' | 'baseReady' | 'nonImageRejected'
  | 'fileUnsupported' | 'fileTooLarge' | 'fileReadFailed' | 'dimsInvalid'
  | 'generating' | 'generatePaused' | 'generateFailed' | 'planProposed' | 'planReady' | 'planEdited';

export type VenueIO = 'indoor' | 'outdoor';

export const DIM_MIN = 1;
export const DIM_MAX = 500;
export const FILE_LIMIT_BYTES = 20 * 1024 * 1024;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
/** 本期底图只收图片；DXF / DWG / PDF 共用 nonImageRejected 这一句（handoff v2.4 更新版）。 */
export const NON_IMAGE_MESSAGE = '下一期支持自动识别，现在可以先导出成图片放进来。';

export const GEN_STEPS = ['读场地', '定舞台位置', '摆桌椅', '放绿植', '检查重叠'] as const;

export const EVENT_TYPES = ['发布会', '展览', '沙龙', '市集'] as const;
export const HEADCOUNTS = [30, 80, 150, 300] as const;
/** 对话解析与左栏表单共用一个上限，避免「右栏认 80、左栏只收 40」。 */
export const HEADCOUNT_MAX = 10000;

/**
 * 演示后端判定：mock key 或本机地址。生产环境两项都不匹配，界面不显示演示标签。
 * NEXT_PUBLIC_* 必须直接读取属性，Next 才能在构建时注入。
 */
export function isDemoBackend(): boolean {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return /^mock/i.test(key) || /^https?:\/\/(localhost|127\.0\.0\.1)(:|[/]|$)/.test(url);
}

export interface AgentAnswers { event: string; headcount: number; }
export const DEFAULT_ANSWERS: AgentAnswers = { event: '发布会', headcount: 80 };

/** 全角数字 / 标点转半角，去空白。 */
export function normalizeDimInput(raw: string): string {
  return raw
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[－—–]/g, '-')
    .replace(/\s+/g, '');
}

export type DimCheck = { ok: true; value: number } | { ok: false; empty: true } | { ok: false; empty: false; message: string };

export function checkDim(raw: string, label: '长度' | '宽度'): DimCheck {
  const text = normalizeDimInput(raw);
  if (!text) return { ok: false, empty: true };
  if (text === '-' ) return { ok: false, empty: false, message: `${label}要大于 0` };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, empty: false, message: `${label}要大于 0` };
  if (value < 0) return { ok: false, empty: false, message: '不能是负数' };
  if (value === 0) return { ok: false, empty: false, message: `${label}要大于 0` };
  if (value < DIM_MIN) return { ok: false, empty: false, message: '至少 1 m' };
  if (value > DIM_MAX) return { ok: false, empty: false, message: '最大 500 m，是不是填成了厘米？' };
  return { ok: true, value: Math.round(value * 10) / 10 };
}

export type FileVerdict = 'image' | 'nonImage' | 'unsupported' | 'tooLarge';

export function classifyFile(file: { name: string; size: number }): FileVerdict {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'dxf' || ext === 'dwg' || ext === 'pdf') return 'nonImage';
  if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'unsupported';
  if (file.size > FILE_LIMIT_BYTES) return 'tooLarge';
  return 'image';
}

export function fileSizeLabel(bytes: number): string { return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`; }

export function formatArea(value: number): string { return Number(value.toFixed(1)).toString(); }

/** 「停一下」/「停」等同点 hint 里的停一下。 */
export function isStopCommand(text: string): boolean { return /^\s*停(一下|下)?[。.!！]?\s*$/.test(text); }

/**
 * 右栏唯一的生成入口是说话：尺寸表单和大绿钮那个第二入口按 2026-10-26 夜截图钉砍掉了。
 * 这句话是在要「一版布置」吗？'again' = 换一版，'first' = 就按现在这些条件出。
 */
export function isGenerateCommand(text: string): 'again' | 'first' | null {
  const compact = normalizeDimInput(text).replace(/\s+/g, '');
  if (/(换一版|再来一版|再出一版|重出一版|重新摆|换个方案|换种摆法)/.test(compact)) return 'again';
  if (/(出方案|出一版|摆一版|生成布置|布置起来|开始摆|先摆|就按这个|按这个出)/.test(compact)) return 'first';
  return null;
}

/** 「按图纸估」：把只当参照的底图比例折成一版长宽，由人改过才当准。 */
export function isEstimateCommand(text: string): boolean {
  return /(按|照|用)图纸(比例)?估|图纸估|按图估/.test(normalizeDimInput(text).replace(/\s+/g, ''));
}

/**
 * 「改一版」：在现有画布上体检冲突和动线，给一条能先预览的改法。
 * 与「换一版」分开——那是重出一版新布置，不是这条卡的范围。
 */
export function isReviewCommand(text: string): boolean {
  const compact = normalizeDimInput(text).replace(/\s+/g, '');
  if (!compact || /换一版|再来一版|再出一版|重出一版|换个方案|换种摆法/.test(compact)) return false;
  return /(哪里有问题|有什么问题|有没有问题|检查一下|检查下|体检|挑毛病|挑挑毛病|优化一下|优化下|改一版|太挤|挤不挤|动线|碰撞|冲突|拉开|留够|走不走得通|顺不顺)/.test(compact);
}

/** 「准备客户评审 / 评审包」：深工具入口仍是一句话，不把六 Tab 表单掀成主舞台。 */
export function isClientReviewCommand(text: string): boolean {
  const compact = normalizeDimInput(text).replace(/\s+/g, '');
  if (!compact || /走一遍|漫游/.test(compact)) return false;
  return /(客户评审|评审包|发给客户|准备评审|给客户看|给甲方看)/.test(compact);
}

/** 「出物料清单」：直接把画布上的物料按名字汇总，不去开第二套表单。 */
export function isMaterialListCommand(text: string): boolean {
  return /清单|物料表|材料表|多少件物料|有哪些物料|用了哪些物料/.test(normalizeDimInput(text).replace(/\s+/g, ''));
}

/** 「写段文案」：右栏直接起草，草稿只在对话里，确认前不写任何资料。 */
export function isCopyDraftCommand(text: string): boolean {
  return /文案|宣传语|推广语|邀请语|朋友圈|写一段|写几句/.test(normalizeDimInput(text).replace(/\s+/g, ''));
}

/**
 * 「导出给搭建方 / 出交接」（T-UI §4-5）：不直接下载，先落一张预览卡，
 * 说清导什么、只在本机生成，点「确认导出」才触发既有导出动作。
 * 「出物料清单」不算——那是在对话里列清单（isMaterialListCommand），不带导字就不出卡。
 */
export function isExportCommand(text: string): boolean {
  const compact = normalizeDimInput(text).replace(/\s+/g, '');
  if (!compact) return false;
  return /(导出|交接|交付|搭建方|打包带走)/.test(compact);
}

/** 「换区」：现在只有分区绘制，没有可点的换区控件；按区域搬物料属于改布置，先如实说清。 */
export function isZoneCommand(text: string): boolean {
  return /换区|换个区|换区域|换到.{0,6}区|搬到.{0,6}区|移到.{0,6}区/.test(normalizeDimInput(text).replace(/\s+/g, ''));
}

const CN_NUMBERS: Readonly<Record<string, number>> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function parseCount(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === '十') return 10;
  if (raw.startsWith('十')) return 10 + (CN_NUMBERS[raw[1]!] ?? 0);
  if (raw.endsWith('十')) return (CN_NUMBERS[raw[0]!] ?? 1) * 10;
  return CN_NUMBERS[raw] ?? 1;
}

/** 物料库里能直接用嘴加的那几种（与 EVENT_CATALOG 的 materialId 对齐）。 */
const MATERIAL_ALIASES: ReadonlyArray<{ pattern: string; materialId: string; name: string }> = [
  { pattern: '椅子|座椅|餐椅|椅', materialId: 'chair', name: '椅子' },
  { pattern: '桌子|餐桌|圆桌|桌', materialId: 'table', name: '桌子' },
  { pattern: '签到台|签到处|接待台', materialId: 'reception', name: '签到台' },
  { pattern: '背景板|背景墙|背景', materialId: 'backdrop', name: '背景板' },
  { pattern: '展架|展板|展示架|展台', materialId: 'display', name: '展架' },
  { pattern: '隔断|屏风', materialId: 'partition', name: '隔断' },
  { pattern: '地毯|地垫', materialId: 'carpet', name: '地毯' },
  { pattern: '装饰道具|装饰|绿植|植物|花艺|盆栽|花', materialId: 'decoration', name: '装饰道具' },
];

export interface MaterialRequest {
  materialId: string;
  name: string;
  count: number;
}

/** 「再加两把椅子」→ 椅子 ×2。没有数量的按 1 件；没说要加东西就返回 null。 */
export function parseMaterialRequest(text: string): MaterialRequest | null {
  const compact = normalizeDimInput(text).replace(/\s+/g, '');
  if (!/(加|添|再放|再来|补|多放|多来)/.test(compact)) return null;
  for (const entry of MATERIAL_ALIASES) {
    const hit = compact.match(new RegExp(`(\\d{1,3}|[一二两三四五六七八九十]{1,2})(?:把|张|个|块|组|盆|件|面|套|排|对)?(?:${entry.pattern})`));
    if (!hit) {
      // 「加把椅子」「加个背景板」：数量被吞进量词里
      if (new RegExp(`(?:把|张|个|块|组|盆|件|面|套|排|对)(?:${entry.pattern})`).test(compact)) return { materialId: entry.materialId, name: entry.name, count: 1 };
      continue;
    }
    const count = Math.max(1, Math.min(50, parseCount(hit[1]!)));
    return { materialId: entry.materialId, name: entry.name, count };
  }
  return null;
}

/** 「加物料」但没点名要哪件：右栏回一份可加清单，不空跑一趟。 */
export function isGenericMaterialRequest(text: string): boolean {
  return /(加|添|再放|补).*(物料|家具|东西|摆设)/.test(normalizeDimInput(text).replace(/\s+/g, ''));
}

export const MATERIAL_REQUEST_HINT = '能直接用嘴加的是：椅子、桌子、签到台、背景板、展架、隔断、地毯、装饰道具。别的类型走左栏「物料工具」建模。';

/* ───────── 一句话开场：客户端解析（无新增后端） ───────── */

/** 从一句话里能读出来的活动要素；读不出的字段保持 null，由默认值兜底。 */
export interface BriefExtraction {
  event: string | null;
  headcount: number | null;
  areaM2: number | null;
  lengthM: number | null;
  widthM: number | null;
  venueIO: VenueIO | null;
  timeOfDay: number | null;
}

const EVENT_KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(发布会|新品发布|launch)/i, '发布会'],
  [/(展览|展陈|展会|策展)/, '展览'],
  [/(沙龙|分享会|讲座|讲堂)/, '沙龙'],
  [/(市集|集市)/, '市集'],
  [/(婚礼|婚宴|订婚)/, '婚礼'],
  [/(派对|晚宴|聚会|生日)/, '派对'],
  // 「宴会厅」是场地，不是活动类型：厅字不进类型槽。
  [/(酒会|宴会)(?!厅)/, '酒会'],
  [/(工作坊|共创|动手)/, '工作坊'],
  [/(黑客松|黑客马拉松|hackathon)/i, '黑客松'],
  [/(年会|年度)/, '年会'],
  [/(路演|竞赛|比赛|决赛)/, '路演'],
  [/(快闪|popup)/i, '快闪'],
];

const clampDim = (value: number): number => Math.min(DIM_MAX, Math.max(DIM_MIN, value));

/** 面积 → 长宽：默认 4:3 的横向场地，步进 0.5 m。 */
export function suggestDimsFromArea(areaM2: number): { length: number; width: number } {
  const area = Math.max(4, Math.min(areaM2, DIM_MAX * DIM_MAX));
  return {
    length: clampDim(Math.round(Math.sqrt(area * (4 / 3)) * 2) / 2),
    width: clampDim(Math.round(Math.sqrt(area * (3 / 4)) * 2) / 2),
  };
}

/** 底图比例 → 长宽：面积不变，长宽比跟图纸走（图纸横版则场地横版）。 */
export function suggestDimsFromImageRatio(pixelWidth: number, pixelHeight: number, areaM2: number): { length: number; width: number } {
  const ratio = Math.max(0.25, Math.min(4, pixelWidth / Math.max(1, pixelHeight)));
  const area = Math.max(4, Math.min(areaM2, DIM_MAX * DIM_MAX));
  return {
    length: clampDim(Math.round(Math.sqrt(area * ratio) * 2) / 2),
    width: clampDim(Math.round(Math.sqrt(area / ratio) * 2) / 2),
  };
}

/** 解析一句话活动描述。全角数字归一，先抠面积/长宽再数人数，避免「300平米」被当成人头。 */
export function parseBriefSentence(raw: string): BriefExtraction {
  const text = normalizeDimInput(raw).replace(/[×X＊✕]/g, 'x').toLowerCase();
  const found: BriefExtraction = { event: null, headcount: null, areaM2: null, lengthM: null, widthM: null, venueIO: null, timeOfDay: null };
  let rest = text;

  const area = rest.match(/(\d+(?:\.\d+)?)(平方米|平米|㎡|m2|m²|平)/);
  if (area) {
    const value = Number(area[1]);
    if (Number.isFinite(value) && value >= 4 && value <= DIM_MAX * DIM_MAX) found.areaM2 = Math.round(value * 10) / 10;
    rest = rest.replace(area[0], '-');
  }
  const dims = rest.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(m|米)?/);
  if (dims) {
    const length = Number(dims[1]), width = Number(dims[2]);
    if (Number.isFinite(length) && Number.isFinite(width) && length >= DIM_MIN && length <= DIM_MAX && width >= DIM_MIN && width <= DIM_MAX) {
      found.lengthM = Math.round(length * 10) / 10;
      found.widthM = Math.round(width * 10) / 10;
    }
    rest = rest.replace(dims[0], '-');
  }
  const headcount = rest.match(/(\d{1,5})(人|位|名)/);
  if (headcount) {
    const value = Number(headcount[1]);
    if (Number.isFinite(value) && value >= 2 && value <= HEADCOUNT_MAX) found.headcount = value;
  }
  for (const [pattern, label] of EVENT_KEYWORDS) { if (pattern.test(text)) { found.event = label; break; } }
  if (/(户外|室外|露天|草坪|花园|院子|广场|营地|庭院)/.test(text)) found.venueIO = 'outdoor';
  else if (/(室内|场馆|展厅|宴会厅|会议室|大厅|礼堂)/.test(text)) found.venueIO = 'indoor';
  if (/(晚上|夜晚|夜间|夜场|入夜)/.test(text)) found.timeOfDay = 21;
  else if (/(黄昏|傍晚|夕阳|落日)/.test(text)) found.timeOfDay = 18;
  else if (/(上午|白天|正午|中午|早上|清晨)/.test(text)) found.timeOfDay = 12;
  return found;
}

/** 把解析结果说回给用户听。 */
export function describeExtraction(
  extraction: BriefExtraction,
  scale: { length: number; width: number; origin: ScaleOrigin },
): string {
  const parts: string[] = [];
  if (extraction.headcount !== null) parts.push(`${extraction.headcount} 人`);
  if (extraction.venueIO !== null) parts.push(extraction.venueIO === 'indoor' ? '室内' : '户外');
  // 硬钉「确认前不报假米数」：人没给尺度时，画布当前那块空地不算场地尺寸，一个字米数都不报；
  // 面积折算和图纸估算是推出来的，必须带着「折算/估算、待你确认」一起说。
  const size = `${formatArea(scale.length)} × ${formatArea(scale.width)} m`;
  if (scale.origin === 'stated' || scale.origin === 'typed') {
    parts.push(`${size}（${formatArea(scale.length * scale.width)} ㎡）`);
  } else if (scale.origin === 'area') {
    parts.push(`${formatArea(scale.length * scale.width)} ㎡ 按 4:3 折算是 ${size}，你改过我才当准`);
  } else if (scale.origin === 'plan') {
    parts.push(`按图纸比例估的 ${size}，等你确认`);
  } else {
    parts.push('场地尺寸还没定');
  }
  if (extraction.event !== null) parts.push(extraction.event);
  if (extraction.timeOfDay !== null) parts.push(extraction.timeOfDay >= 21 ? '夜间' : extraction.timeOfDay === 18 ? '黄昏' : '白天');
  return parts.join(' · ');
}

/** 这句话里有没有能立起场地或定下规模的要素。一个都没有 → 先问一句，不空跑一趟生成。 */
export function hasBriefSignals(extraction: BriefExtraction): boolean {
  return extraction.event !== null || extraction.headcount !== null || extraction.venueIO !== null
    || extraction.areaM2 !== null || (extraction.lengthM !== null && extraction.widthM !== null) || extraction.timeOfDay !== null;
}

/**
 * 「改成 15×10」这类只动场地边界的句子：只立壳/换壳，不是新开一轮布置提案。
 * 带了人数、活动或时段就是在要一版布置；室内外跟着场地走，不算额外意图。
 */
export function isVenueSizeOnly(extraction: BriefExtraction): boolean {
  const hasSize = extraction.areaM2 !== null || (extraction.lengthM !== null && extraction.widthM !== null);
  return hasSize && extraction.headcount === null && extraction.event === null && extraction.timeOfDay === null;
}

/** 尺度是从哪儿来的：只有人说过或填过的才算确认。 */
export function scaleOriginOf(extraction: BriefExtraction, previous: ScaleOrigin): ScaleOrigin {
  if (extraction.lengthM !== null && extraction.widthM !== null) return 'stated';
  if (extraction.areaM2 !== null) return 'area';
  return previous;
}

/** 一版还没确认的提案，右栏要说的那几个数（本地候选与云端提案归一成同一个读数）。 */
export interface PendingPlan {
  added: number;
  removing: number;
  changed: number;
  /** 锁着的物料被这版动了的件数——Agent 本不该动它们，动了就必须报出来。 */
  lockedTouched: number;
  overlapCount: number;
  overlapNames: string[];
}

/**
 * 差异 + 服务端场地检查 → 卡片上那几行话。
 * 只吃「谁变了」和「哪些 id 挤了/出界」，不碰场景对象，所以两种提案来源都能喂进来。
 */
export function pendingPlanOf(
  differences: readonly { kind: 'added' | 'removed' | 'changed'; locked: boolean }[],
  warnings: readonly { code: string; ids: string[] }[],
  nameOf: (id: string) => string,
): PendingPlan {
  const overlaps = new Set<string>();
  for (const warning of warnings) {
    if (warning.code !== 'OVERLAP' && warning.code !== 'OUT_OF_BOUNDS') continue;
    for (const id of warning.ids) overlaps.add(nameOf(id));
  }
  return {
    added: differences.filter(change => change.kind === 'added').length,
    removing: differences.filter(change => change.kind === 'removed').length,
    changed: differences.filter(change => change.kind === 'changed').length,
    lockedTouched: differences.filter(change => change.locked && change.kind !== 'added').length,
    overlapCount: overlaps.size,
    overlapNames: [...overlaps],
  };
}
