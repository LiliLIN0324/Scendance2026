/**
 * 2026-11-17 正式站卡点（用户原话：「我希望你把我的分区重新做一遍」→ 助手追问（1）压缩成 3-4 个复合区
 * 还是（2）按新清单重排 → 用户答「第一个方案」→ 什么都没发生，任务卡却变成「按用途复用我的物料」）。
 *
 * 根因不是用户说得不清楚：二选一是写在追问气泡里的自然语言，回答「第一个方案」原样丢给理解模型再猜一次
 * 动作，而协议里只有「分区名+数字+物件名→objects」「明确说重新分区→zones」两条规则，对「回答上一轮二选一」
 * 一个字都没有——于是模型把这一轮判成了 objects。
 *
 * 这里做三件确定性的小事（都不调模型）：
 *   ① 从追问文本里认出被列举的选项；
 *   ② 认出用户这句是不是在选第几个；
 *   ③ 认出「原请求」本身要的是哪一步，好让模型再反问时本地也能接着走。
 * 认不出来就一律返回 null，交回原有链路，绝不猜。
 */

export type OutdoorChoice = { index: number; text: string };

/** 中文/阿拉伯数字序号：「（1）」「1.」「1、」「①」。 */
const MARKER = /[（(]\s*([1-9])\s*[）)]|(?:^|[\s，。；;：:、\n])([1-9])\s*[.、)）]/gu;
const CIRCLED = /[①②③④⑤⑥⑦⑧⑨]/gu;

const stripTrailing = (text: string) =>
  text
    .replace(/\s+/gu, " ")
    .replace(/[，,；;：:、\s]+$/u, "")
    .replace(/(?:，|,)?\s*(?:还是|或者|或|抑或)\s*$/u, "")
    .replace(/^(?:还是|或者|或|抑或|是|想|要么)\s*/u, "")
    .trim();

/** 一段选项文字到第一个句末标点为止：后面常接「如果是新清单，请…」这类附加说明，不算选项内容。 */
const cutAtSentenceEnd = (text: string) => {
  const index = text.search(/[。！!？?]/u);
  return (index < 0 ? text : text.slice(0, index)).split(/\n/u)[0] ?? "";
};

/**
 * 从一句追问里取出被列举的选项；不足两项返回空数组（单项列举不是二选一，仍交给模型）。
 * 只做排版层面的切分，不解释选项含义。
 */
export function parseChoiceOptions(question: string): string[] {
  if (!question) return [];
  const markers: Array<{ start: number; end: number }> = [];
  for (const match of question.matchAll(MARKER)) {
    const start = match.index ?? 0;
    markers.push({ start, end: start + match[0].length });
  }
  if (markers.length < 2) {
    for (const match of question.matchAll(CIRCLED)) {
      const start = match.index ?? 0;
      markers.push({ start, end: start + match[0].length });
    }
    markers.sort((a, b) => a.start - b.start);
  }
  if (markers.length < 2) return [];
  const options = markers.map((marker, index) => {
    const next = markers[index + 1];
    const raw = question.slice(marker.end, next ? next.start : question.length);
    return stripTrailing(cutAtSentenceEnd(raw));
  });
  // 序号必须严格递增才有资格当选项（防止正文里的「1.」「2.」被误读成两个选项）；
  // 单项超过 40 字的按「整段说明」处理，宁可认不出也不硬切。
  if (options.some((option) => option.length < 2 || option.length > 40)) return [];
  return options;
}

const CN_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 整句只是在选第几个（「第一个方案」「第2个」「选第二个」「1」「方案一」）；夹带别的要求就交回模型。 */
const ORDERED_PICK =
  /^(?:(?:我|我们|那就|就|选|用|按|要|还是)\s*)?(?:第)?\s*([1-9一二两三四五六七八九])\s*(?:个|项|条|种)?\s*(?:方案|选项|办法|做法)?\s*(?:吧|啊|呀|了|哦)?[。！!]?$/u;
const SUFFIX_PICK = /^方案\s*([1-9一二两三四五六七八九])[。！!]?$/u;

function resolveOrdinal(message: string): number | null {
  const text = message.normalize("NFKC").trim();
  if (!text || text.length > 20) return null;
  const matched = text.match(ORDERED_PICK) ?? text.match(SUFFIX_PICK);
  if (!matched?.[1]) return null;
  const token = matched[1];
  const index = CN_DIGIT[token] ? CN_DIGIT[token]! - 1 : Number(token) - 1;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * 用户在回答上一轮二选一时，返回选中的那一项；否则 null。
 * 只有「上一轮真的列举了 ≥2 项」且「本句整句只是序号」才算，别的一律交回模型。
 */
export function resolveChoiceReply(
  message: string,
  question: string | undefined,
): { options: string[]; chosen: OutdoorChoice } | null {
  if (!question) return null;
  const options = parseChoiceOptions(question);
  if (options.length < 2) return null;
  const index = resolveOrdinal(message);
  const normalize = (text: string) => stripTrailing(text.normalize('NFKC').replace(/^[1-9一二三四五][.、):]\s*/u, '')).replace(/\s+/g, '');
  const matched = index ?? options.findIndex(option => normalize(option) === normalize(message));
  if (matched < 0 || matched >= options.length) return null;
  return { options, chosen: { index: matched, text: options[matched]! } };
}

/**
 * 原请求本身要哪一步；只认「明确的重做/调整」说法，认不出就 null。
 * 用途是兜底：用户已经明确选了第几项、模型却又反问同一件事时，不让同一句追问第二次端回去。
 * 只放两个便宜且只出预览（不写画布）的阶段——通道要拉真实路网、人物要岗位依据，不在这里自动发起。
 */
export function resumeActionForRequest(request: string): "zones" | "objects" | null {
  const text = request.normalize("NFKC").trim();
  if (text.length < 2 || text.length > 120) return null;
  if (
    /(?:重新|重做|重来|再做|再改|改|调整|重排|压缩|合并|精简|减少|增加|拆分|做一遍).{0,6}分区/u.test(text) ||
    /分区.{0,6}(?:重新|重做|重来|再做|再改|改|调整|重排|压缩|合并|精简|减少|增加|拆分|做一遍|重画)/u.test(text)
  )
    return "zones";
  if (
    /(?:重新|重做|重来|再做|再改|改|调整|重排).{0,6}物料/u.test(text) ||
    /物料.{0,6}(?:重新|重做|重来|再做|再改|改|调整|重排)/u.test(text)
  )
    return "objects";
  return null;
}
