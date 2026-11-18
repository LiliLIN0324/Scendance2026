/**
 * 岗位点位的预设短台词（W3）：只做「走到岗位旁按 E 看到一句话」。
 *
 * 明确不做：对话树、状态机、大模型、任务系统。文案按岗位名映射，没映射到就用
 * 中性一句，不编剧情。改文案只改这张表，不要在场景层写散字符串。
 */

/** 岗位关键词 → 台词。先匹配到的优先，所以把更具体的词放前面。 */
const ROLE_LINES: readonly { readonly keys: readonly string[]; readonly line: string }[] = [
  { keys: ['保安', '安保', 'security'], line: '这边通道要留着，进出请顺着人流走。' },
  { keys: ['警察', 'police'], line: '有情况找现场民警，我们就在这个路口。' },
  { keys: ['志愿者', 'volunteer'], line: '需要帮忙的话随时叫我，指引图和饮水点都在前面。' },
  { keys: ['主管', 'manager'], line: '现场由我统筹，物料和人员调度可以先找我确认。' },
  { keys: ['管理', 'admin'], line: '场地这边我负责，有问题可以直接跟我说。' },
  { keys: ['签到', '登记', 'reception'], line: '签到在这里，报名字或扫一下就可以进场。' },
  { keys: ['医护', '急救', 'medical'], line: '医疗点在旁边通道，需要时喊一声就来。' },
  { keys: ['演员', '主持', 'performer'], line: '节目马上开始，麻烦大家往这边靠一靠。' },
];

/** 没映射到岗位时的一句中性台词：不编造剧情，也不装作认识人。 */
export const GENERIC_WORKER_LINE = '你好，这里是现场岗位，需要帮助直接说。';

/**
 * 岗位名 → 一句预设台词。空名字走中性句；匹配不区分大小写。
 */
export function workerPresetLine(role: string | undefined | null): string {
  const text = (role ?? '').trim();
  if (!text) return GENERIC_WORKER_LINE;
  const haystack = text.toLowerCase();
  for (const entry of ROLE_LINES) {
    if (entry.keys.some((key) => haystack.includes(key.toLowerCase()))) return entry.line;
  }
  return GENERIC_WORKER_LINE;
}
