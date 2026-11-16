/**
 * 发布前自检：这份会话报告能判哪几条验收用例（M7.1，2026-11-17）。
 *
 * 背景：`docs/plans/2026-11-16-outdoor-evidence-matrix.md` 有 11 条验收用例，
 * 长期状态是「0 条三类全绿」，但“0 条”是人眼读出来的，不是算出来的。这里把
 * 判断依据写成规则：每条用例要求哪些**可观测信号**，报告里有就“有料可判”，
 * 没有就列缺什么，且永远不会把“缺数据”说成“通过”。
 *
 * 硬约束：本模块**不产生通过结论**。它只回答两件事——
 *   1) 这条用例的证据只能来自真实浏览器/云端（`browser-only`），报告再全也判不了；
 *   2) 这条用例可以从报告里找料，当前报告缺哪几个信号。
 */

import type { SessionReport } from './outdoor-session-report';

export type ReportSignal =
  | 'turn' // 至少一轮收口
  | 'map-call' // 真调过地图
  | 'preview' // 出过预览
  | 'confirm' // 有过确认
  | 'apply' // 真落过盘
  | 'failure' // 有失败样本
  | 'cancel' // 有撤回
  | 'place' // 走过“先要地点”这一步
  | 'login'; // 撞过登录门

export type AssessmentVerdict = 'ready' | 'missing' | 'browser-only';

export interface AcceptanceRule {
  id: number;
  title: string;
  /** report = 可先从报告里找料；browser = 只能靠真实浏览器/云端观测。 */
  source: 'report' | 'browser';
  requires: readonly ReportSignal[];
  /** 给执行者的一句话：还缺什么。 */
  hint: string;
}

export const ACCEPTANCE_RULES: readonly AcceptanceRule[] = [
  {
    id: 1,
    title: '空白项目输入组合需求，地图确认地点及范围',
    source: 'report',
    requires: ['turn', 'map-call', 'preview'],
    hint: '需要一轮里同时出现地图调用与预览；只有文字不能算。',
  },
  {
    id: 2,
    title: '两个同名地点，地图选中其中一个',
    source: 'browser',
    requires: [],
    hint: '要把两个同名候选放进一次真实搜索，报告里看不出来。',
  },
  {
    id: 3,
    title: '有范围、已选设施，发明确小改',
    source: 'report',
    requires: ['preview'],
    hint: '需要一次“基于已有范围”的预览；没有预览就无小改可判。',
  },
  {
    id: 4,
    title: '无范围先发设计句，再改预算或人数',
    source: 'report',
    requires: ['place'],
    hint: '要观测到“先要地点”这一步（awaiting_place）；只发一句需求不够。',
  },
  {
    id: 5,
    title: '地图部分、离线或无路网',
    source: 'browser',
    requires: [],
    hint: '要靠断网/离线实跑，报告里区分不出“没路网”和“没调”。',
  },
  {
    id: 6,
    title: '未登录、功能关闭、额度不足、网络超时',
    source: 'report',
    requires: ['failure'],
    hint: '至少要有一条真失败样本；四类阻塞还要分别出现。',
  },
  {
    id: 7,
    title: '待预览时说「等等」或过时的「确认」',
    source: 'browser',
    requires: [],
    hint: '要真点一次过时确认，票号逻辑正确不代表浏览器行为正确。',
  },
  {
    id: 8,
    title: '应用中刷新、双点确认、切项目',
    source: 'browser',
    requires: [],
    hint: '三项都是浏览器行为，报告里只有存储层证据。',
  },
  {
    id: 9,
    title: '确认后撤销，重开旧草稿',
    source: 'browser',
    requires: [],
    hint: '撤销后要回读旧草稿，报告里看不出草稿内容。',
  },
  {
    id: 10,
    title: '一条真实模型失败，一条纯本地成功',
    source: 'report',
    requires: ['failure', 'preview'],
    hint: '失败与成功要在同一份报告里各出现一次。',
  },
  {
    id: 11,
    title: '普通聊天、室内布局、导出与旧云 Agent Run',
    source: 'browser',
    requires: [],
    hint: '要证“户外升级不破坏既有行为”，得把旧路径各跑一遍。',
  },
];

export interface CaseAssessment {
  id: number;
  title: string;
  verdict: AssessmentVerdict;
  /** 缺的信号（ready / browser-only 时为空）。 */
  missing: ReportSignal[];
  hint: string;
}

/** 从报告里读出可观测信号；同一信号只记一次。 */
export function reportSignals(report: SessionReport): Set<ReportSignal> {
  const out = new Set<ReportSignal>();
  const rows = report.traces.rows;
  const totals = report.metrics.totals;

  if (rows.length > 0) out.add('turn');
  if (totals.mapCalls > 0) out.add('map-call');
  if (totals.confirmations > 0) out.add('confirm');
  if (totals.appliedCount > 0) out.add('apply');
  if (totals.previewAvgMs !== null) out.add('preview');
  for (const row of rows) {
    if (row.terminal === 'preview_ready' || row.terminal === 'local_done') out.add('preview');
    if (row.terminal === 'local_done') out.add('apply');
    if (row.terminal === 'awaiting_place') out.add('place');
    if (row.terminal === 'awaiting_login') out.add('login');
    if (row.terminal === 'cancelled') out.add('cancel');
    if (row.terminal === 'failed' || row.errorCode !== null) out.add('failure');
  }
  return out;
}

export function assessAcceptance(
  report: SessionReport,
  rules: readonly AcceptanceRule[] = ACCEPTANCE_RULES,
): CaseAssessment[] {
  const have = reportSignals(report);
  return rules.map((rule) => {
    if (rule.source === 'browser') {
      return { id: rule.id, title: rule.title, verdict: 'browser-only', missing: [], hint: rule.hint };
    }
    const missing = rule.requires.filter((signal) => !have.has(signal));
    return {
      id: rule.id,
      title: rule.title,
      verdict: missing.length === 0 ? 'ready' : 'missing',
      missing,
      hint: rule.hint,
    };
  });
}

export interface AssessmentTotals {
  ready: number;
  missing: number;
  browserOnly: number;
  text: string;
}

export function summarizeAssessment(rows: readonly CaseAssessment[]): AssessmentTotals {
  const ready = rows.filter((row) => row.verdict === 'ready');
  const missing = rows.filter((row) => row.verdict === 'missing');
  const browserOnly = rows.filter((row) => row.verdict === 'browser-only');
  const text = [
    `可判 ${ready.length} 条（${ready.map((row) => `#${row.id}`).join(' ') || '无'}）`,
    `缺料 ${missing.length} 条（${missing.map((row) => `#${row.id} 缺 ${row.missing.join('/')}`).join('；') || '无'}）`,
    `只能浏览器 ${browserOnly.length} 条（${browserOnly.map((row) => `#${row.id}`).join(' ') || '无'}）`,
    '注意：可判 ≠ 通过；通过仍要人按对照表逐项写结论。',
  ].join('\n');
  return { ready: ready.length, missing: missing.length, browserOnly: browserOnly.length, text };
}
