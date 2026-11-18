/**
 * 报告段落自检（M7.1，轮次 96）。
 *
 * 报告现在有六段（来源 / 快照 / 卡片 / 走查标记 / 云端声明 / 逐条判断 / 待补清单里的一部分是可选）。
 * 人贴工单前想知道的是：**这一轮到底算了哪几段、缺了哪段**——缺段不代表报告错，
 * 可能只是这一轮没算那块；但绝不能让缺段被读成“没问题”。
 *
 * 本层只做“有没有这个标题”的检查，不判断内容对不对、更不下发布结论。
 */

/** 报告里可能出现的段落标题（顺序与报告正文一致）。 */
export const REPORT_SECTIONS = [
  '[报告来源]',
  '[发布状态快照]',
  '[走查标记]',
  '[云端声明]',
  '[逐条判断]',
  '[待补清单]',
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

export interface SectionCheck {
  section: ReportSection;
  present: boolean;
}

export function checkReportSections(text: string): SectionCheck[] {
  return REPORT_SECTIONS.map((section) => ({ section, present: text.includes(section) }));
}

/** 一行话：齐了几段、缺哪几段。缺段用编号点出来，便于对着报告核对。 */
export function formatSectionCheck(text: string): string {
  const checks = checkReportSections(text);
  const present = checks.filter((row) => row.present);
  const missing = checks.filter((row) => !row.present);
  if (missing.length === 0) {
    return `报告段落：${present.length}/${checks.length} 段齐（内容对不对仍要人看）`;
  }
  return [
    `报告段落：${present.length}/${checks.length} 段（缺 ${missing.length} 段：${missing
      .map((row) => row.section)
      .join(' ')}）`,
    '缺段不代表出错，只代表这一段没算——别把缺段读成“没问题”。',
  ].join(' ');
}
