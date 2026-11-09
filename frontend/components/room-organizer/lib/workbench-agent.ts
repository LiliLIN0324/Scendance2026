/** v2.4 布置第 1–3 步：右栏 Agent 状态机的纯函数部分（无 schema 变更，全部是页面本地状态）。 */
import { withoutNonTotalHeadcounts } from './attendance-evidence';
import type { PlanAddOp, PlanMoveOp, PlanRecolorOp, PlanRemoveOp, PlanRevisionOp, PlanRotateOp, PlanScaleOp, SiteBand, SiteSide } from './agent-proposal';
import type { ScaleOrigin } from './venue-shell';
import type { BriefSlots } from '../../../../supabase/functions/_shared/brief-extract-contract';

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
  // A direct answer to the assistant's offer to explore assumptions creates only a preview.
  if (/^(?:先探索|先用假设探索)[。！!]*$/.test(compact)) return 'first';
  const localDraft=/(?:生成|制作|做|出)(?:一版)?(?:本地|本机)草案/.exec(compact);
  if(localDraft){
    const start=Math.max(...['，',',','。','；',';','！','!'].map(mark=>compact.lastIndexOf(mark,localDraft.index-1)))+1;
    const prefix=compact.slice(start,localDraft.index),suffix=compact.slice(localDraft.index+localDraft[0].length).split(/[，,。；;！!]/)[0]??'';
    if(!/(?:不要|不想|暂不|别|如何|怎样|怎么|能否|是否|要不要)/.test(prefix)&&!/[?？吗么]|是什么意思/.test(suffix))return 'first';
  }
  if (/(换一版|再来一版|再出一版|重出一版|重新摆|换个方案|换种摆法)/.test(compact)) return 'again';
  if (/(?:^|[，,。；;！!])(?:请|帮我|直接|现在|先)?生成(?:一版)?方案[。！!]*$/.test(compact)) return 'first';
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

/* ───────── plan.revise：一句话里的增量修改（挪/转/缩放/删/加灯） ───────── */

export interface RevisionRequest {
  ops: PlanRevisionOp[];
  /** 这句话里点到的硬保留带（例如「湖边西侧 3 米别压」）。 */
  bands: SiteBand[];
}

const DIR_VEC: Readonly<Record<string, { x: number; z: number }>> = {
  东: { x: 1, z: 0 }, 西: { x: -1, z: 0 }, 南: { x: 0, z: 1 }, 北: { x: 0, z: -1 },
  左: { x: -1, z: 0 }, 右: { x: 1, z: 0 }, 前: { x: 0, z: 1 }, 后: { x: 0, z: -1 },
};

/** 能按 assetId 直接添的目录外/目录内物件；8 类活动物料仍走 parseMaterialRequest。 */
const REVISE_ASSETS: ReadonlyArray<{ pattern: string; assetId: string; name: string }> = [
  { pattern: '落地灯', assetId: 'floor-lamp', name: '落地灯' },
  { pattern: '吊灯', assetId: 'pendant-light', name: '吊灯' },
  { pattern: '路灯|庭院灯', assetId: 'lamppost', name: '路灯' },
  { pattern: '灯|灯光|照明|射灯', assetId: 'lamp', name: '灯' },
  { pattern: '树|绿树', assetId: 'tree', name: '树' },
];

const SIDE_OF: Readonly<Record<string, SiteSide>> = { 东: 'east', 西: 'west', 南: 'south', 北: 'north' };
const SIDE_LABEL: Readonly<Record<SiteSide, string>> = { east: '东', west: '西', south: '南', north: '北' };

function cleanRole(raw: string): string {
  return raw.replace(/^(帮我|请|麻烦|把|将|给|在|贴着|靠|沿着)/, '').replace(/(的|上面|旁边|两侧|两边|左右)$/, '').trim();
}

/** 「左边第二张桌子」→ { role: 桌子, ordinal: 2, side: left }；普通「舞台」原样。 */
function parseTarget(raw: string): { role: string; ordinal?: number; side?: 'left' | 'right' } {
  let text = raw;
  const ordinal = text.match(/(左边|左面|左侧|右边|右面|右侧)?第(\d+|[一二两三四五六七八九十]{1,2})(?:张|个|件|把|盏|棵|组|台|位)?/);
  const side = ordinal?.[1] ? (/右/.test(ordinal[1]) ? 'right' : 'left') : undefined;
  const index = ordinal?.[2] ? Math.max(1, parseCount(ordinal[2])) : undefined;
  if (ordinal) text = text.replace(ordinal[0], '');
  const sideOnly = text.match(/^(左边|左面|左侧|右边|右面|右侧)/);
  return {
    role: cleanRole(sideOnly ? text.replace(sideOnly[0], '') : text),
    ...(index ? { ordinal: index } : {}),
    ...(side ? { side } : sideOnly ? { side: /右/.test(sideOnly[0]) ? 'right' as const : 'left' as const } : {}),
  };
}

const COLOR_WORDS: Readonly<Record<string, string>> = {
  红: '#d94841', 蓝: '#3b6fd4', 绿: '#3f9d63', 黄: '#e0b23c',
  白: '#f2f4f6', 黑: '#2b2f36', 灰: '#9aa3ad', 橙: '#e0863c', 原木: '#b98a5a',
};

/** An unambiguous color change must consume the complete user instruction. */
export function parseSafeRecolor(raw: string): PlanRecolorOp | null {
  const text=normalizeDimInput(raw).replace(/[。.!！]$/, '');
  if (/(?:不要|不用|别|勿|暂不|暂时|不确定|可能|也许|是否|待定|看情况|[?？])/.test(text)) return null;
  const hit=text.match(/^(?:把|将)?(.+?)(?:换成|改成|变成|换为|改为|涂成|刷成)(红|蓝|绿|黄|白|黑|灰|橙|原木)色?$/);
  if (!hit) return null;
  const color=COLOR_WORDS[hit[2]!];
  return color ? {kind:'recolor',...parseTarget(hit[1]!),color} : null;
}
function parseRecolorOp(clause: string): PlanRecolorOp | null { return parseSafeRecolor(clause); }

function parseSiteBands(text: string): SiteBand[] {
  if (!/(湖|景观带|景观|保留带|保留区|视线带)/.test(text)) return [];
  const hit = text.match(/(湖|景观|保留)[^，。；]{0,6}?(东|西|南|北)(?:侧|边)/)
    ?? text.match(/(东|西|南|北)(?:侧|边)[^，。；]{0,6}?(湖|景观|保留)/);
  const direction = hit ? (SIDE_OF[hit[1]!] ? hit[1]! : hit[2]!) : '西';
  const side = SIDE_OF[direction] ?? 'west';
  const depthHit = text.match(/(?:景观带|保留带|景观|保留区)(?:宽)?(\d+(?:\.\d+)?)米/);
  const depth = depthHit ? Math.max(0.5, Math.min(12, Number(depthHit[1]))) : 3;
  return [{ side, depth, label: `${SIDE_LABEL[side]}侧景观带` }];
}

/** Only a whole, unambiguous directional instruction can supply a movement distance. */
export function parseSafeDirectionalMove(raw: string): PlanMoveOp | null {
  const text = normalizeDimInput(raw).replace(/[。.!！]$/, '');
  if (/(?:不要|不用|别|勿|暂不|暂时|不确定|可能|也许|是否|待定|看情况|[?？]|不超过|最多|至少|大约|左右)/.test(text)) return null;
  const target = '(?:把|将)?(.+?)';
  const direction = '(东|西|南|北|左|右|前|后)';
  const action = '(?:挪|移动|平移|移|搬)';
  const number = '(\\d+(?:\\.\\d+)?|十[一二三四五六七八九]?|[一二两三四五六七八九]十|[一二两三四五六七八九])';
  const unit = '(毫米|厘米|米|mm|cm|m)';
  const first = text.match(new RegExp(`^${target}(?:往|向|朝)${direction}(?:边|侧|方)?${action}(?:动)?${number}${unit}$`, 'i'));
  const second = first ? null : text.match(new RegExp(`^${target}${action}(?:到|至)?${direction}(?:边|侧|方)?${number}${unit}$`, 'i'));
  const match = first ?? second;
  if (!match) return null;
  const amount = /^\d/.test(match[3]!) ? Number(match[3]) : parseCount(match[3]!);
  const unitName = match[4]!.toLowerCase();
  const meters = amount / (unitName === '毫米' || unitName === 'mm' ? 1000 : unitName === '厘米' || unitName === 'cm' ? 100 : 1);
  if (!Number.isFinite(meters) || meters <= 0 || meters > 500) return null;
  const vec = DIR_VEC[match[2]!];
  return vec ? {kind:'move', ...parseTarget(match[1]!), delta:{x:vec.x*meters,z:vec.z*meters}} : null;
}

function parseMoveOp(clause: string): PlanMoveOp | null {
  const safe = parseSafeDirectionalMove(clause);
  if (safe) return safe;
  const to = clause.match(/(?:把|将)?(.+?)(?:挪|移|移动|平移|搬)(?:到|至)(\()?(-?\d+(?:\.\d+)?)[,，](-?\d+(?:\.\d+)?)/);
  if (to) return { kind: 'move', ...parseTarget(to[1]!), to: { x: Number(to[3]), z: Number(to[4]) } };

  return null;
}

/** Rotation must be a complete directional instruction with an explicit angle. */
export function parseSafeRotation(raw: string): PlanRotateOp | null {
  const text=normalizeDimInput(raw).replace(/[。.!！]$/, '');
  if (/(?:不要|不用|别|勿|暂不|暂时|不确定|可能|也许|是否|待定|看情况|[?？]|不超过|最多|至少|大约|左右)/.test(text)) return null;
  const match=text.match(/^(?:把|将)?(.+?)(顺时针|逆时针)(?:旋转|转动|转)(\d+(?:\.\d{1,3})?)(?:度|°|deg)$/i);
  if(!match)return null;
  const degrees=Number(match[3]);
  if(!Number.isFinite(degrees)||degrees<=0||degrees>360)return null;
  return {kind:'rotate',...parseTarget(match[1]!),deltaDeg:match[2]==='逆时针'?-degrees:degrees};
}
function parseRotateOp(clause: string): PlanRotateOp | null { return parseSafeRotation(clause); }

function parseScaleOp(clause: string): PlanScaleOp | null {
  const hit = clause.match(/(?:把|将)?(.+?)(放大|缩小|缩放|变大|变小)(到)?\s*(\d+(?:\.\d+)?)\s*(倍|%)?/);
  if (!hit || !hit[5]) return null;
  const raw = Number(hit[4]);
  const unit = hit[5];
  const absolute = Boolean(hit[3]);
  let factor: number;
  if (unit === '%') {
    if (absolute) factor = raw / 100;
    else if (hit[2] === '缩小' || hit[2] === '变小') factor = 1 - raw / 100;
    else factor = 1 + raw / 100;
  } else {
    factor = raw;
  }
  if (!(factor > 0)) return null;
  return { kind: 'scale', ...parseTarget(hit[1]!), factor };
}

function parseRemoveOp(clause: string): PlanRemoveOp | null {
  const before = clause.match(/(?:把|将)?(.+?)(?:删掉|删除|删去|去掉|移除|撤掉|拿走)/);
  if (before) return { kind: 'remove', ...parseTarget(before[1]!) };
  const after = clause.match(/(?:删掉|删除|移除|去掉|撤掉|拿走)(?:了)?(.+)/);
  return after ? { kind: 'remove', ...parseTarget(after[1]!) } : null;
}

function parseAddOps(clause: string, full: string): PlanAddOp[] {
  if (!/(加|添加|放|摆|补|来)/.test(clause)) return [];
  const asset = REVISE_ASSETS.find(entry => new RegExp(entry.pattern).test(clause));
  if (!asset) return [];
  // Quantity may sit before a classifier and a short colour/size modifier: 「两盏暖色灯光」.
  // Action verbs and digits are excluded from the gap so 「挪 2 米再加一盏灯」 still counts one.
  const countHit = clause.match(new RegExp(`(\\d{1,3}|[一二两三四五六七八九十]{1,2})\\s*(?:盏|个|台|支|座|棵|把|张|件|组)?\\s*[^，。；、0-9加放摆补添来]{0,6}?(?:${asset.pattern})`));
  const count = countHit ? Math.max(1, Math.min(20, parseCount(countHit[1]!))) : 1;
  const anchorHit = clause.match(/(?:在|贴着|靠|沿着)?([^，。]{1,10}?)(两侧|两边|左右|左侧|左边|右侧|右边|旁边)/);
  const anchorRole = anchorHit ? cleanRole(anchorHit[1]!) : null;
  const sides = !anchorHit ? undefined
    : /两侧|两边|左右/.test(anchorHit[2]!) ? 'both'
    : /右侧|右边/.test(anchorHit[2]!) ? 'right' : 'left';
  const position = clause.match(/(?:放在|放到|摆在|摆到|位于)(?:坐标)?(\()?(-?\d+(?:\.\d+)?)[,，](-?\d+(?:\.\d+)?)/);
  const facing = /(?:朝向|面向|朝|向)(观众席|观众|台下|南侧|南面|南)/.test(full) || /朝南|面朝南/.test(full) ? 'south'
    : /(?:朝向|面向|朝|向)(舞台|台上|北侧|北面|北)/.test(full) || /朝北|面朝北/.test(full) ? 'north'
    : /朝东|面朝东|向东/.test(full) ? 'east'
    : /朝西|面朝西|向西/.test(full) ? 'west'
    : undefined;
  return [{
    kind: 'add', assetId: asset.assetId, name: asset.name, count,
    ...(position ? { position: { x: Number(position[2]), z: Number(position[3]) } } : {}),
    ...(anchorRole ? { anchor: { role: anchorRole, ...(sides ? { sides } : {}) } } : {}),
    ...(facing ? { facing } : {}),
  }];
}

function parseRevisionClause(clause: string, full: string): PlanRevisionOp[] {
  const ops: PlanRevisionOp[] = [];
  const move = parseMoveOp(clause);
  if (move) ops.push(move);
  const rotate = parseRotateOp(clause);
  if (rotate) ops.push(rotate);
  const scale = parseScaleOp(clause);
  if (scale) ops.push(scale);
  const recolor = parseRecolorOp(clause);
  if (recolor) ops.push(recolor);
  const remove = parseRemoveOp(clause);
  if (remove) ops.push(remove);
  ops.push(...parseAddOps(clause, full));
  return ops;
}

/**
 * 「把舞台往西挪 1.5 米」「在舞台两侧各加一盏灯，朝向观众席」→ 增量操作。
 * 只认「按对象改」的说法：普通「加两把椅子」仍然走 parseMaterialRequest，不被抢走。
 */
export function parseRevisionRequest(text: string): RevisionRequest | null {
  const clauses = text.split(/[，、。；;！!？?]/).map(part => normalizeDimInput(part)).filter(Boolean);
  const full = normalizeDimInput(text);
  const ops: PlanRevisionOp[] = [];
  for (const clause of clauses) ops.push(...parseRevisionClause(clause, full));
  if (!ops.length) return null;
  return { ops, bands: parseSiteBands(full) };
}

/* ───────── 一句话开场：客户端解析（无新增后端） ───────── */

/**
 * 从一句话里能读出来的活动要素；读不出的字段保持 null，由默认值兜底。
 * audienceTags / proactiveReply 是模型通道独有（本地正则 parseBriefSentence 不填），
 * 仅在 resolver 把模型结果注入时存在；作为可选字段不破坏既有调用方的 shape。
 */
export interface BriefExtraction {
  event: string | null;
  headcount: number | null;
  areaM2: number | null;
  lengthM: number | null;
  widthM: number | null;
  venueIO: VenueIO | null;
  timeOfDay: number | null;
  /** 模型识别的受众标签；本地正则版不填。 */
  audienceTags?: Array<'elderly' | 'family' | 'business' | 'student' | 'vip'>;
  /** 模型判定的行动辅助需求；elderly ≠ mobilityAssistance。本地正则版不填。 */
  mobilityAssistance?: boolean | null;
  /** 模型给的一句中文人话建议；null/缺省时前端回退到 buildAudiencePrompt 正则版。 */
  proactiveReply?: string | null;
  requirements?: Array<{ key: 'headcount' | 'lengthM' | 'widthM' | 'areaM2' | 'venueIO' | 'layoutMode' | 'event' | 'timeOfDay'; value: number | string; mode: 'must' | 'prefer' }> | null;
  activityNeeds?: BriefSlots['activityNeeds'];
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
  const headcount = withoutNonTotalHeadcounts(rest).match(/(\d{1,5})(人|位|名)/);
  if (headcount) {
    const value = Number(headcount[1]);
    if (Number.isFinite(value) && value >= 1 && value <= HEADCOUNT_MAX) found.headcount = value;
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

/**
 * 这一轮用哪块场地：人刚说的长宽/面积优先；没说、但场地已经立起来，就用画布上这块，并标明是现成的。
 * 空地还没立壳时保持 canvas，回话不报米数。
 */
export function workingScale(
  extraction: BriefExtraction,
  canvas: { width: number; height: number; venueUp: boolean },
  previous: ScaleOrigin,
): { length: number; width: number; origin: ScaleOrigin; fromVenue: boolean } {
  const origin = scaleOriginOf(extraction, previous);
  if (origin === 'stated' && extraction.lengthM !== null && extraction.widthM !== null) {
    return { length: extraction.lengthM, width: extraction.widthM, origin, fromVenue: false };
  }
  if (origin === 'area' && extraction.areaM2 !== null) {
    return { ...suggestDimsFromArea(extraction.areaM2), origin, fromVenue: false };
  }
  if (canvas.venueUp && canvas.width > 0 && canvas.height > 0) {
    return { length: canvas.width, width: canvas.height, origin: previous === 'canvas' ? 'typed' : previous, fromVenue: true };
  }
  return { length: canvas.width, width: canvas.height, origin: 'canvas', fromVenue: false };
}

/** 只处理本句明确提到的舞台和签到；未提及时由上层保留待确认状态。 */
export function layoutAnchors(text: string, _event: string | null, _layoutMode: 'dining' | 'desk-chair'): { stage: boolean; checkin: boolean } {
  const compact = text.replace(/\s+/g, '');
  const ambiguous = /(可能|也许|或许|是否|要不要|需不需要|不确定|不知道|待定|看情况|[吗么？?])/.test(compact);
  const noStage = /(不要|不设|不需要|无需|没有|无).{0,4}(舞台|背景板)/.test(compact);
  const noCheckin = /(不要|不设|不需要|无需|没有|无).{0,4}(签到|接待)/.test(compact);
  return {
    stage: !ambiguous && !noStage && /舞台|背景板/.test(compact),
    checkin: !ambiguous && !noCheckin && /签到|接待/.test(compact),
  };
}

/**
 * 文生物件 / 场景：只整理要提交的那句，不提交。
 * 布置句（出方案、加人）返回 null，免得把布置当成扣费生成。
 */
export function prepareAholoAsk(raw: string): { kind: 'text' | 'world' | 'recon'; prompt: string; title: string } | null {
  const text = raw.trim();
  const compact = text.replace(/\s+/g, '');
  if (!compact || /出方案|布置|确认布置|加一把|加一张|加一个/.test(compact)) return null;
  if (/场景生成|文生场景|生成.{0,24}场景|做.{0,12}场景/.test(compact)) {
    return { kind: 'world', prompt: text, title: '场景' };
  }
  if (/文字建模|文生物件|文生3d|文生三维|文生(?!场景)|生成.{0,24}物件|做.{0,12}物件/i.test(compact)) {
    return { kind: 'text', prompt: text, title: '物件' };
  }
  const vendor = /群核|aholo|lux3d/i.test(compact);
  const verb = /生成|文生|图生|重建|做一|建一/.test(compact);
  if (vendor && verb && /重建/.test(compact)) return { kind: 'recon', prompt: text, title: '场地' };
  if (vendor && verb && /场景|场地|空间/.test(compact)) return { kind: 'world', prompt: text, title: '场景' };
  if ((vendor && verb) || /图生|照片生成|图片生成/.test(compact)) {
    return { kind: 'text', prompt: text, title: /图生|照片|图片/.test(compact) ? '图片物件' : '物件' };
  }
  return null;
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
  safetyChecksUnknown?: boolean;
  seatingShortfall?: string;
  seatingAllocationUnverified?: boolean;
  seatingHeadcountUnverified?: boolean;
  seatingSpecsUnverified?: boolean;
}

export const SAFETY_CHECKS_UNKNOWN_TEXT='出口、疏散、门扇、无障碍、消防和核定人数仍需核验。';
export const SEATING_ALLOCATION_UNVERIFIED_TEXT='桌椅配比尚未核验，请核对每桌人数与实际座位。';
export const SEATING_HEADCOUNT_UNVERIFIED_TEXT='人数来源尚未核验，请核对活动人数。';
export const SEATING_SPECS_UNVERIFIED_TEXT='桌椅规格尚未核验，请核对候选模型尺寸及实际物料。';
function zeroPlacementSuggestions(reason:string):string {
  const first=reason==='object_limit'?'可核对当前物件数量和方案规模。'
    :reason==='scan_limit'?'可尝试分区试排并核对桌椅规格。'
    :reason==='preset_unverified'?'请先核对场地预设、图纸和尺寸，再尝试试排。'
    :'可尝试其他区域并核对桌椅规格。';
  return `${first}你也可决定是否调整人数、共桌方式或场地；调整后仍需重新试排。`;
}
/** Only accept the bounded, program-generated seating warning, never model prose. */
export function seatingShortfallText(warning:{code:string;ids:readonly string[]}):string|null {
  const shared=/^SHARED_SEATING_SHORTFALL:(\d{1,3}):(\d{1,3}):(\d{1,2}):(object_limit|no_placement|scan_limit|preset_unverified)$/.exec(warning.code);
  if(shared&&!warning.ids.length){
    const requested=Number(shared[1]),placed=Number(shared[2]),tables=Number(shared[3]);
    if(requested>=1&&requested<=100&&placed>=0&&placed<requested&&tables>=0&&tables<=25&&tables===Math.ceil(placed/2)){
      const reason=shared[4]==='object_limit'?'已触及云场景物件数量上限':shared[4]==='scan_limit'?'本次搜索达到计算上限':shared[4]==='preset_unverified'?'场地预设尚未核验':'本次排布未找到更多可用位置';
      if(placed===0)return `本次新增课桌椅组团可安排 0 / ${requested} 人，新增 0 桌；原场景物件未计入。${reason}，不代表场地最大容量；实际座席和现场条件仍需核验。${zeroPlacementSuggestions(shared[4]!)}`;
      return `本版排了 ${placed} / ${requested} 人，${tables} 桌，尚缺 ${requested-placed} 人。${reason}，不代表场地最大容量。`;
    }
    return null;
  }
  const match=/^SEATING_SHORTFALL:(\d{1,3}):(\d{1,3}):(object_limit|no_placement|scan_limit|preset_unverified)$/.exec(warning.code);
  if(!match||warning.ids.length)return null;
  const requested=Number(match[1]),placed=Number(match[2]);
  if(requested<1||requested>100||placed<0||placed>=requested)return null;
  const reason=match[3]==='object_limit'?'已触及云场景物件数量上限，不代表场地最大容量。'
    :match[3]==='scan_limit'?'本次搜索达到计算上限，不代表场地最大容量。'
    :match[3]==='preset_unverified'?'场地预设尚未核验，不代表场地最大容量。'
    :'本次排布未找到更多可用位置，不代表场地最大容量。';
  if(placed===0)return `本次新增课桌椅组团 0 / ${requested} 套；原场景物件未计入。${reason}实际座席和现场条件仍需核验。${zeroPlacementSuggestions(match[3]!)}`;
  return `本版排了 ${placed} / ${requested} 套，尚缺 ${requested-placed} 套。${reason}`;
}
/** Unrecognized backend codes never appear as internal labels in the UI. */
export function proposalWarningText(warning:{code:string;ids:readonly string[]},nameOf:(id:string)=>string):string {
  if(warning.code==='SAFETY_CHECKS_UNKNOWN')return SAFETY_CHECKS_UNKNOWN_TEXT;
  if(warning.code==='SEATING_ALLOCATION_UNVERIFIED')return SEATING_ALLOCATION_UNVERIFIED_TEXT;
  if(warning.code==='SEATING_HEADCOUNT_UNVERIFIED')return SEATING_HEADCOUNT_UNVERIFIED_TEXT;
  if(warning.code==='SEATING_SPECS_UNVERIFIED')return SEATING_SPECS_UNVERIFIED_TEXT;
  const shortfall=seatingShortfallText(warning);if(shortfall)return shortfall;
  const names=warning.ids.map(nameOf).join('、');
  const label=warning.code==='OVERLAP'?'物件重叠':warning.code==='OUT_OF_BOUNDS'?'超出场地边界':'待检查事项';
  return names?`${label}：${names}`:label;
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
    ...(warnings.some(warning=>warning.code==='SAFETY_CHECKS_UNKNOWN')?{safetyChecksUnknown:true}:{}),
    ...(warnings.some(warning=>warning.code==='SEATING_ALLOCATION_UNVERIFIED')?{seatingAllocationUnverified:true}:{}),
    ...(warnings.some(warning=>warning.code==='SEATING_HEADCOUNT_UNVERIFIED')?{seatingHeadcountUnverified:true}:{}),
    ...(warnings.some(warning=>warning.code==='SEATING_SPECS_UNVERIFIED')?{seatingSpecsUnverified:true}:{}),
    ...(()=>{const warning=warnings.map(seatingShortfallText).find(Boolean);return warning?{seatingShortfall:warning}:{};})(),
  };
}
