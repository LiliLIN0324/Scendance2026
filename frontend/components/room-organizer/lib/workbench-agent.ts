/** v2.4 布置第 1–3 步：右栏 Agent 状态机的纯函数部分（无 schema 变更，全部是页面本地状态）。 */

export type AgentState =
  | 'empty' | 'dragHover' | 'baseNoDims' | 'baseReady' | 'cadRejected'
  | 'fileUnsupported' | 'fileTooLarge' | 'fileReadFailed' | 'dimsInvalid'
  | 'generating' | 'generatePaused' | 'generateFailed' | 'planReady' | 'planEdited';

export type VenueIO = 'indoor' | 'outdoor';

export const DIM_MIN = 1;
export const DIM_MAX = 500;
export const FILE_LIMIT_BYTES = 20 * 1024 * 1024;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
/** PM 2026-10-19：本期底图只收图片；DXF / DWG 统一给这句。 */
export const CAD_MESSAGE = '下一期支持自动识别，现在可以先导出成图片放进来';

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

export type FileVerdict = 'image' | 'cad' | 'unsupported' | 'tooLarge';

export function classifyFile(file: { name: string; size: number }): FileVerdict {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'dxf' || ext === 'dwg') return 'cad';
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
