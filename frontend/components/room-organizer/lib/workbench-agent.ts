/** v2.4 布置第 1–3 步：右栏 Agent 状态机的纯函数部分（无 schema 变更，全部是页面本地状态）。 */

export type AgentState =
  | 'empty' | 'dragHover' | 'baseNoDims' | 'baseReady' | 'nonImageRejected'
  | 'fileUnsupported' | 'fileTooLarge' | 'fileReadFailed' | 'dimsInvalid'
  | 'generating' | 'generatePaused' | 'generateFailed' | 'planReady' | 'planEdited';

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

/** 只收数字，最多 1 位小数；返回规范化后的输入框文本（不合法字符直接丢弃）。 */
export function sanitizeDimInput(raw: string): string {
  const text = normalizeDimInput(raw).replace(/[^0-9.\-]/g, '');
  const negative = text.startsWith('-');
  const body = text.replace(/-/g, '');
  const [whole = '', ...rest] = body.split('.');
  const fraction = rest.join('').slice(0, 1);
  return `${negative ? '-' : ''}${whole}${body.includes('.') ? `.${fraction}` : ''}`;
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

/** 主按钮可点 = 两个值都合法，或者没传底图（用默认场地）。 */
export function canGenerate(state: AgentState, hasBase: boolean, length: DimCheck, width: DimCheck): boolean {
  if (state === 'generating') return false;
  if (!hasBase) return true;
  return length.ok && width.ok;
}

/** 「停一下」/「停」等同点 hint 里的停一下。 */
export function isStopCommand(text: string): boolean { return /^\s*停(一下|下)?[。.!！]?\s*$/.test(text); }

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
  const headcount = rest.match(/(\d{1,4})(人|位|名)/);
  if (headcount) {
    const value = Number(headcount[1]);
    if (Number.isFinite(value) && value >= 2 && value <= 10000) found.headcount = value;
  }
  for (const [pattern, label] of EVENT_KEYWORDS) { if (pattern.test(text)) { found.event = label; break; } }
  if (/(户外|室外|露天|草坪|花园|院子|广场|营地|庭院)/.test(text)) found.venueIO = 'outdoor';
  else if (/(室内|场馆|展厅|宴会厅|会议室|大厅|礼堂)/.test(text)) found.venueIO = 'indoor';
  if (/(晚上|夜晚|夜间|夜场|入夜)/.test(text)) found.timeOfDay = 21;
  else if (/(黄昏|傍晚|夕阳|落日)/.test(text)) found.timeOfDay = 18;
  else if (/(上午|白天|正午|中午|早上|清晨)/.test(text)) found.timeOfDay = 12;
  return found;
}

/** 把解析结果说回给用户听；场地长宽缺省时用当前画布的尺寸兜底。 */
export function describeExtraction(extraction: BriefExtraction, fallbackDims: { length: number; width: number }): string {
  const parts: string[] = [];
  if (extraction.headcount !== null) parts.push(`${extraction.headcount} 人`);
  if (extraction.venueIO !== null) parts.push(extraction.venueIO === 'indoor' ? '室内' : '户外');
  const length = extraction.lengthM ?? fallbackDims.length;
  const width = extraction.widthM ?? fallbackDims.width;
  parts.push(`${formatArea(length)} × ${formatArea(width)} m（${formatArea(length * width)} ㎡）`);
  if (extraction.event !== null) parts.push(extraction.event);
  if (extraction.timeOfDay !== null) parts.push(extraction.timeOfDay >= 21 ? '夜间' : extraction.timeOfDay === 18 ? '黄昏' : '白天');
  return parts.join(' · ');
}
