'use client';

/**
 * 总控里的复核台账：谁提的、分派给谁、产出了什么、人通过还是驳回。
 *
 * 它不新增确认/驳回按钮——那两个动作仍在既有的「确认布置 / 撤回」上，
 * 这里只把状态机的进出记成一条可回看的记录（见 lib/review-ledger.ts）。
 * 因此本组件只读 agent 的提案与状态、只读画布快照，不写画布、不动提案。
 *
 * 第 1 步：提案出现时把它落成一条带编号、负责人、目标与验收点的事项。
 * 第 2 步：决定落下时用前后画布快照差分出证据（itemId、前后位置），挂在同一行上。
 * 第 3 步：写画布的动作标「等你点头」，只生成候选/校验的标「我自己能做」。
 */

import { useEffect, useRef, useState } from 'react';
import {
  acceptanceOfItem,
  autoStepsOfItem,
  decideFromExit,
  decideReview,
  diffSnapshots,
  digestProposal,
  evidenceLine,
  goalOfItem,
  loadOpenAttemptId,
  loadReviewAttempts,
  nextItemNo,
  openReviewAttempt,
  planGate,
  saveOpenAttemptId,
  saveReviewAttempts,
  snapshotItems,
  statusLabel,
  updatePendingArtifact,
  type LedgerItemLike,
  type LedgerLayoutLike,
  type ReviewAttempt,
  type ReviewEvidence,
} from '../lib/review-ledger';

/** 只取需要的几项，避免和面板的完整类型互相引用。 */
interface LedgerBubble {
  id: string;
  role: 'user' | 'agent';
  text: string;
  to?: readonly string[];
}

interface LedgerProposal {
  added: number;
  removing: number;
  changed?: number;
  overlapCount: number;
  blocked?: string | null;
  review?: boolean;
  keptLocked?: number;
}

export interface ReviewLedgerAgent {
  proposal: LedgerProposal | null;
  state: string;
  bubbles: readonly LedgerBubble[];
}

const clock = (at: number): string => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

/**
 * 当前这一版的身份放在模块级：切换左轨（总控 ↔ Bingo）会卸载再挂载本组件，
 * 用 useRef 会丢身份、把同一版记成两条。任一时刻只挂载一个实例，够用。
 * 快照也放在模块级，跨挂载还能拿到「提案出现时画布长什么样」。
 */
let openAttemptId: string | null = null;
let openSnapshot: LedgerItemLike[] | null = null;

function lastUserBubble(bubbles: readonly LedgerBubble[]): LedgerBubble | null {
  for (let index = bubbles.length - 1; index >= 0; index--) {
    const bubble = bubbles[index]!;
    if (bubble.role === 'user' && bubble.text.trim()) return bubble;
  }
  return null;
}

function lastAgentText(bubbles: readonly LedgerBubble[]): string {
  for (let index = bubbles.length - 1; index >= 0; index--) {
    const bubble = bubbles[index]!;
    if (bubble.role === 'agent' && bubble.text.trim()) return bubble.text;
  }
  return '';
}

export function AgentReviewLedger({ agent, nameOf, layout, silent = false }: {
  agent: ReviewLedgerAgent;
  nameOf(id: string): string;
  /** 画布：只做前后快照，不改它。 */
  layout?: LedgerLayoutLike | null;
  silent?: boolean;
}): JSX.Element | null {
  const [attempts, setAttempts] = useState<ReviewAttempt[]>(() => loadReviewAttempts());
  const attemptsRef = useRef(attempts); attemptsRef.current = attempts;
  const layoutRef = useRef(layout); layoutRef.current = layout;
  /** 这次挂载里真的见过提案，才允许「提案消失」反推决定；刷新后不会误判。 */
  const sawProposal = useRef(false);

  const commit = (next: ReviewAttempt[]): void => {
    attemptsRef.current = next;
    saveReviewAttempts(next);
    setAttempts(next);
  };

  // 刷新/切页签后把仍在复核的那条认回来：事项不能因为重挂载就分成两条。
  useEffect(() => {
    if (!openAttemptId) openAttemptId = loadOpenAttemptId();
  }, []);

  useEffect(() => {
    const plan = agent.proposal;
    if (plan) {
      sawProposal.current = true;
      const request = lastUserBubble(agent.bubbles);
      const requestId = request?.id ?? 'manual';
      const artifact = digestProposal(plan);
      const current = openAttemptId ? attemptsRef.current.find(attempt => attempt.id === openAttemptId) : undefined;
      // 同一句请求重新长出来（刷新、切页签）沿用原事项；换了请求或已结算就开新事项。
      const resumable = !!current && current.status === 'pending' && current.requestId === requestId;
      if (!openSnapshot) openSnapshot = snapshotItems(layoutRef.current);
      if (!resumable) {
        const next = openReviewAttempt(attemptsRef.current, {
          requestId,
          request: request?.text ?? '工具生成的一版',
          to: request?.to ?? [],
          agent: 'bingo',
          artifact,
          itemNo: nextItemNo(),
          gate: planGate(plan),
          goal: goalOfItem(plan, request?.text ?? ''),
          acceptance: acceptanceOfItem(plan),
          autoDone: autoStepsOfItem(),
        });
        openAttemptId = next[next.length - 1]!.id;
        openSnapshot = snapshotItems(layoutRef.current);
        saveOpenAttemptId(openAttemptId);
        commit(next);
      } else {
        if (current.artifact !== artifact) commit(updatePendingArtifact(attemptsRef.current, openAttemptId!, artifact));
      }
    } else if (openAttemptId && sawProposal.current) {
      const decision = decideFromExit(agent.state, lastAgentText(agent.bubbles));
      const at = Date.now();
      const evidence = evidenceOfDecision(decision.status, openSnapshot, snapshotItems(layoutRef.current), at);
      commit(decideReview(attemptsRef.current, openAttemptId, decision.status, decision.note, at, evidence));
      openAttemptId = null;
      openSnapshot = null;
      sawProposal.current = false;
      saveOpenAttemptId(null);
    }
  // 提案对象每帧都会重算，真正要跟的是「有没有提案」与状态机的落点。
  }, [agent.proposal, agent.state, agent.bubbles]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = attempts.filter(attempt => attempt.status === 'pending').at(-1) ?? null;
  const settled = attempts.filter(attempt => attempt.status !== 'pending').slice(-3).reverse();
  if (silent || (!pending && settled.length === 0)) return null;

  const ownerName = (owner: string | undefined): string => nameOf(owner ?? '待认领');

  return <div className="ap-card" id="review-ledger" aria-label="复核记录">
    <strong>{pending ? `复核记录 · 待你处理 ${attempts.filter(attempt => attempt.status === 'pending').length}` : '复核记录'}</strong>
    {pending && <div className="ap-outcome" role="status">
      <p className="ap-outcome-label">
        {pending.gate === 'agent' ? '可直接做' : '待你处理'} · {pending.itemNo ?? 'T-?'} · 由 {nameOf(pending.agent)} 产出
      </p>
      <p className="ap-outcome-line">{pending.request}</p>
      <p className="ap-small">负责人 {ownerName(pending.owner)} · {pending.artifact}</p>
      {pending.goal && <p className="ap-small">目标：{pending.goal}</p>}
      {pending.acceptance && pending.acceptance.length > 0 && <p className="ap-small">
        验收：{pending.acceptance.map((line, index) => `${index + 1}) ${line}`).join(' ')}
      </p>}
      {pending.autoDone && pending.autoDone.length > 0 && <p className="ap-small">我已直接做：{pending.autoDone.join('、')}</p>}
      <p className="ap-small">
        {pending.gate === 'agent'
          ? '这条只出结论、不写画布，我自己收尾；提案仍在预览卡上供你核对。'
          : '等你点头：在「这版还在预览」卡上点「确认布置」= 通过，点「撤回」= 驳回（画布不动）。'}
      </p>
    </div>}
    {settled.length > 0 && <>
      <p className="ap-small">最近 {settled.length} 次</p>
      <ol className="ap-dispatch-list">
        {settled.map(attempt => <li key={attempt.id} className="ap-dispatch-row">
          <span className="ap-dispatch-body">
            <strong>{attempt.itemNo ? `${attempt.itemNo} · ` : ''}{attempt.request}</strong>
            <small>
              {statusLabel(attempt.status)} · {attempt.artifact}
              {attempt.decidedAt ? ` · ${clock(attempt.decidedAt)}` : ''}
            </small>
            {attempt.evidence && <small>证据 · {evidenceLine(attempt.evidence)}</small>}
          </span>
        </li>)}
      </ol>
    </>}
  </div>;
}

/** 通过：画布前后差出来什么就报什么；驳回：画布没动就照实说。 */
function evidenceOfDecision(
  status: Exclude<ReviewAttempt['status'], 'pending'>,
  before: readonly LedgerItemLike[] | null,
  after: readonly LedgerItemLike[],
  at: number,
): ReviewEvidence | undefined {
  if (!before) return undefined;
  if (status !== 'approved') {
    return { at, added: [], removed: [], moved: [], note: status === 'rejected' ? '人驳回，画布保持原样' : '作废，候选没落盘' };
  }
  const diff = diffSnapshots(before, after, at);
  const touched = diff.added.length + diff.removed.length + diff.moved.length;
  return touched > 0 ? diff : { at, added: [], removed: [], moved: [], note: '画布差分为空：可能由云端落盘，或快照没覆盖这一层' };
}
