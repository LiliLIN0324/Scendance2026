/**
 * V-1a（2026-11-13）：从一句话里认出「目标场地」意图。
 *
 * 「在潮乐之城去做设计」→ 场地名「潮乐之城」。此前理解管线（parseBriefSentence）
 * 只有 event/headcount/areaM2 等槽位，地点名会掉进 brief 被当活动描述吞掉；
 * 这里的动词壳正则先把「场地」抽出来，交给回显确认气泡（V-1b）走检索与锚定。
 *
 * 口径对齐 `research-area.ts` 的 matchResearchCommand：只认窄动词壳，宁可漏配
 * 交给 brief 管线，也不把「在室内做布置」这类普通句子误抓成场地。
 */

/**
 * 占位指代词：用户在说场地但没说清是哪儿——回 'ask' 让 agent 反问一句。
 */
const VENUE_PLACEHOLDERS = new Set([
  '这里', '那里', '这儿', '那儿', '哪儿', '哪里', '此地', '那边', '这边', '当地', '原地',
]);

/**
 * 类别/时间词：不是「一个具体地点」——回 null 落回 brief 管线
 * （室内/室外是合法布置场景，不能劫持成场地反问）。
 */
const VENUE_NON_NAMES = new Set([
  '室内', '室外', '现场', '线上', '线下', '家里', '公司', '学校', '网上',
  '周末', '今天', '明天', '后天', '上午', '下午', '晚上', '白天', '梦里', '心里', '手里',
  // 画布/图面操作（「在舞台上加两把椅子」是编辑指令，不是选场地）
  '舞台', '画布', '图上', '图里', '纸上', '场上', '平面', '中间', '左边', '右边',
  '上面', '下面', '前方', '后方', '左上角', '右上角', '左下角', '右下角',
]);

/** 动作动词壳：场地名后面必须跟着「做这件事」的动词才算场地意图。 */
const VENUE_ACTION = '(?:做|搞|出|排|设计|布置|规划|办|生成|落实|落地|安排)';
/** 地名段：汉字/字母/数字 + 连字符与间隔号（「盐官古城-潮乐之城」）。 */
// A preposition must start a clause or follow an explicit request/subject, not the suffix of 签到/收到/知道.
const VENUE_INTRO = '(?:^|[\\s，,。；;！？!?]|(?:请|帮我|我们|我|想|打算|准备|计划|活动))(?:在|去|到)';
const VENUE_NAME_PART = '[\\u4e00-\\u9fa5A-Za-z0-9\\-·]';

/**
 * 「在潮乐之城去做设计」→「潮乐之城」；「去西湖办一场发布会」→「西湖」。
 * 地名位置是占位指代词时回 'ask'（agent 反问）；没有动词壳回 null（归 brief 管线）。
 */
export function matchVenueCommand(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 4 || trimmed.length > 120) return null;
  if (!new RegExp(VENUE_ACTION).test(trimmed)) return null;
  // 在/去/到 + 地名（非贪婪，可含 -·）+ 可选方位尾巴 + 可选连接词（去/来/再）+ 动作动词
  // 「在潮乐之城去做设计」地名与动作之间隔了「去」，必须放宽。
  const pattern = new RegExp(
    `${VENUE_INTRO}\\s*(${VENUE_NAME_PART}{2,24}?)\\s*(?:里|内|那边|那|这)?\\s*(?:去|来|再)?(?=${VENUE_ACTION})`,
    'u',
  );
  const match = trimmed.match(pattern);
  if (!match?.[1]) {
    // 只有方位没有地名：可能在说场地但没说清——由调用方决定要不要反问。
    if (new RegExp(`${VENUE_INTRO}(?:哪里|哪儿|哪)`, 'u').test(trimmed)) return 'ask';
    return null;
  }
  // 疑问/占位指代先判：抓到的是「哪个地方」这类词就直接回 ask，不进地名清洗。
  if (VENUE_PLACEHOLDERS.has(match[1]) || /哪|什么|啥/u.test(match[1])) return 'ask';
  const name = sanitizeVenueName(match[1]);
  if (name) return name;
  return null;
}

/** 剥掉地名两头的客套/量词尾巴，剔除方向/时间词；空了回 null。 */
function sanitizeVenueName(raw: string): string | null {
  let name = raw
    .replace(/^(?:个|家|座|间|块|处|这|那|我们|咱们)+/u, '')
    .replace(/(?:附近|周边|旁边|一带|那里|那儿|这里|这儿|那边)$/u, '')
    .replace(/^[\-·]+|[\-·]+$/u, '')
    .trim();
  // 「12月做设计」「3号布置」是时间不是场地
  if (/^\d{1,2}(?:月|日|号|点)/u.test(name)) return null;
  if (!name || VENUE_NON_NAMES.has(name) || VENUE_PLACEHOLDERS.has(name)) return null;
  if (name.length < 2 || name.length > 24) return null;
  return name;
}
