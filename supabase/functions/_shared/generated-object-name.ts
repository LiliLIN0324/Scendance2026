/**
 * 生成物件的短显示名（前后端共用）。
 *
 * 生成入口允许写整段规格（例如「户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背……」）。
 * 这段文字是提示词，不是物件名；直接入库会把画布标签、模型候选条和物料卡撑成一条长句，
 * Agent 摆场再拼数量就会变成「户外折叠椅 1：…… 1」。
 *
 * 这里只做确定性的文本收口，不猜品类、不改写用户数据：
 * 1. 去列表序号/项目符号；
 * 2. 去「生成 / 来一个」这类动词与首个量词；
 * 3. 冒号前是主体；没有冒号时取第一个句读前；
 * 4. 去掉尾部数量编号；
 * 5. 最多 12 个字，超出加省略号。
 *
 * 完整提示词不丢：生成任务记录里保留原话；落位时由 {@link generatedObjectNotes}
 * 附在备注里。前端 `components/room-organizer/lib/generated-object-name.ts` 直接转出
 * 本文件的实现，Worker 归档也用它，避免同一个物件在画布和物料库里叫两个名字。
 */
export const GENERATED_OBJECT_NAME_MAX = 12;

/**
 * 颜色 / 材质 / 工艺类定语：「白色与浅绿配色的」「红色木质的」说的是属性，不是物件名。
 *
 * 只剥掉能被认成定语的连续词；「新娘的手捧花」这类真正的所属关系不动，
 * 「白色圆桌」这种颜色直接参与词名的也不动（没有「的」就不触发）。
 */
const NAMED_QUALIFIER =
  '(?:(?:浅|深|淡|亮|暗|正)?[白黑红黄绿蓝粉紫灰米金银棕橙青裸奶咖](?:色)?' +
  '|(?:原木|实木|木|金属|塑料|钢|铁|竹|藤|布|绒|丝|麻|棉|纸|石|陶瓷|玻璃|亚克力|皮革|蕾丝)(?:质)?)' +
  '(?:配色|色系|渐变|质感|风格|款式)?';
const ATTRIBUTE_PREFIX = new RegExp(
  `^((?:${NAMED_QUALIFIER})(?:(?:与|和|、|及|加|以及|\\s)*(?:${NAMED_QUALIFIER}))*)的\\s*`,
  'u',
);

export function generatedObjectName(prompt: string, fallback = '生成物件'): string {
  let text = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  text = text
    .replace(/^[-*•·]+\s*/u, '')
    .replace(/^\d{1,3}\s*[.、)）]\s*/u, '')
    .replace(/^[①-⑳]\s*/u, '')
    .replace(
      /^(?:请|麻烦)?(?:生成|创建|制作|设计|来|要|做)(?:一个|一张|一把|一件|一套|一组|一只|一台|一座|一处|一批|个|张|把|件|套|组|只|台|座|处|批)?\s*/u,
      '',
    );

  // 主体在第一个冒号前；没有冒号时退到第一个逗号/句号/分号/括号前。
  const colon = text.search(/[：:]/u);
  if (colon >= 0) {
    text = text.slice(0, colon);
  } else {
    const stop = text.search(/[，,。；;（(]/u);
    if (stop > 0) text = text.slice(0, stop);
  }

  text = text
    .replace(
      /^(?:一|两|二|三|四|五|六|七|八|九|十|\d{1,3})\s*(?:个|张|把|件|套|组|只|台|座|处|批|条|根|块|面|盏|顶)\s*/u,
      '',
    )
    // 只收「椅子 1」「椅子（1）」这种编号；不碰「180×80」这类尺寸。
    .replace(/[\s　]+(?:\d{1,2}|[（(]\s*\d{1,2}\s*[)）])$/u, '')
    .replace(/[，,。；;：:、\s]+$/u, '')
    .trim();

  // 「白色与浅绿配色的婚礼路引花牌」：定语是属性，物件名在「的」后面。
  const attribute = text.match(ATTRIBUTE_PREFIX);
  if (attribute) {
    const rest = text.slice(attribute[0].length).trim();
    if (rest) text = rest;
  }

  // 「3 米高的主舞台」「180×80 的桌子」：尺寸前缀不是名字，取「的」后的名词。
  if (
    /^(?:约\s*)?[\d一二两三四五六七八九十百]+\s*(?:米|厘米|公分|毫米|m|cm|×|x|\*)/iu.test(text) &&
    text.includes('的')
  ) {
    text = text.slice(text.lastIndexOf('的') + 1).trim();
  }

  if (!text) return fallback;
  const chars = Array.from(text);
  return chars.length > GENERATED_OBJECT_NAME_MAX
    ? `${chars.slice(0, GENERATED_OBJECT_NAME_MAX).join('')}…`
    : text;
}

/**
 * 把整段生成提示词留在设施备注里，同时保持 Agent 匹配用的「复用我的物料库…」前缀不变。
 * 短名与原文相同（例如用户只写了「白色圆桌」）时不重复记一遍。
 */
export function generatedObjectNotes(prompt: string, base: string): string {
  const full = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!full || full === generatedObjectName(full)) return base;
  return `${base}｜生成描述：${full}`.slice(0, 500);
}
