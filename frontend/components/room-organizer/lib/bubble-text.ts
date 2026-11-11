/**
 * 气泡文本排版与追问选项解析：纯函数，不碰状态。
 *
 * - `splitBubbleLines`：把模型回话里的换行、编号条目拆成独立行展示；原文一个字不丢，
 *   拼接后的 textContent 仍与原文本一致。
 * - `parseFollowUpOptions`：从末尾追问句里保守拆出可点选项；解析不出来就回退空数组，
 *   宁可不出选项，也不硬拆出不通顺的话。
 */

/** 编号条目起点：行首或空格/分号/冒号后的 1~2 位数字 + 点号/顿号，后面跟中文或字母。 */
const NUMBERED_SPLIT = /(?<=^|[\s；;：:])(?=\d{1,2}[.、．](?=\s*[一-龥a-zA-Z]))/;

/** 去掉选项头尾的语气词与标点，留下能直接当输入框话术的短句。 */
function cleanOption(raw: string): string {
  return raw
    .replace(/[「」“”]/g, '')
    .replace(/^(您|你)?(希望|想|要|请|帮我|能不能|要不要|可以|觉得)/, '')
    .replace(/^(我)/, '')
    .replace(/[，,。.！!？?；;、\s]+$/g, '')
    .replace(/^[，,。.！!？?；;、\s]+/g, '')
    .trim();
}

/** 列表条目起点：行首编号 + 点号/顿号后接中文或字母，或项目符号。 */
const LIST_ITEM = /^\d{1,2}[.、．]\s*(?=[一-龥a-zA-Z])|^[-•·]\s*/;

export interface BubbleBlock {
  kind: 'text' | 'list';
  /** kind === 'text' 时的整行文案。 */
  text?: string;
  /** kind === 'list' 时的连续条目。 */
  items?: string[];
}

/**
 * 把拆好的行再分块：连续编号/项目符号条目收成一个列表块，其余行按普通段落展示。
 * 原文一个字不丢，拼接后的 textContent 仍与原文本一致。
 */
export function segmentBubbleBlocks(text: string): BubbleBlock[] {
  const blocks: BubbleBlock[] = [];
  let list: string[] = [];
  const flushList = (): void => {
    if (list.length > 0) { blocks.push({ kind: 'list', items: list }); list = []; }
  };
  for (const line of splitBubbleLines(text)) {
    if (LIST_ITEM.test(line)) list.push(line);
    else { flushList(); blocks.push({ kind: 'text', text: line }); }
  }
  flushList();
  return blocks;
}

/** 把一段气泡文本拆成展示行；拆不开就原样返回单行。 */
export function splitBubbleLines(text: string): string[] {
  const lines: string[] = [];
  for (const part of text.split(/\r?\n/)) {
    for (const piece of part.split(NUMBERED_SPLIT)) {
      const trimmed = piece.trim();
      if (trimmed) lines.push(trimmed);
    }
  }
  return lines.length > 0 ? lines : [text];
}

/**
 * 从气泡末尾的追问句里提取可点选项。
 * 目前只认两种稳妥句式：「A」或「B」引号并列；「A，还是 B？」二选一。
 * 返回的每条都是可直接填进输入框的短句；解析失败返回空数组。
 */
export function parseFollowUpOptions(text: string): string[] {
  const sentences = text.split(/(?<=[。！？?])/);
  const last = sentences[sentences.length - 1]?.trim() ?? '';
  if (!/[？?]\s*$/.test(last)) return [];

  const options: string[] = [];

  const quoted = [...last.matchAll(/「([^」]{2,24})」/g)].map(match => match[1]!.trim());
  if (quoted.length >= 2) options.push(...quoted);

  if (last.includes('还是')) {
    const [left, ...rest] = last.split('还是');
    const right = rest.join('还是');
    const a = cleanOption(left ?? '');
    const b = cleanOption(right);
    if (a) options.unshift(a);
    if (b) options.push(b);
  }

  const seen = new Set<string>();
  return options
    .filter(option => {
      if (option.length < 2 || option.length > 24 || seen.has(option)) return false;
      seen.add(option);
      return true;
    })
    .slice(0, 4);
}
