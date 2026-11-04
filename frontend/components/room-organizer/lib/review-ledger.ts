'use client';

/**
 * Agent 复核台账：agent 产出 → 人确认/驳回 → 记入历史。
 *
 * 为什么不新造一套审批 UI：Bingo 的「预览 → 确认布置 / 撤回」已经是全产品最接近
 * `In review` 的机制（见 docs/research-2026-11/mirasim-agent-human-review.md）。
 * 这一层只负责给它一个身份与一条记录，不复制按钮、不改既有流程。
 *
 * 决定由既有按钮触发，台账只读状态机的进出：
 * - 提案出现（planProposed）→ 新建一条待复核；
 * - 提案消失 + 落盘（planReady/planEdited）→ 已通过；
 * - 提案消失 + 回话「撤了」→ 已驳回；
 * - 其余消失（被新一版顶掉、失效）→ 已作废。
 */

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

/** 动作门禁：改画布必须人点头；只生成候选/校验不写画布的是 agent 能直接做的。 */
export type ReviewGate = 'human' | 'agent';

/** 画布快照的最小形状：只认 id、名字、位置、朝向，不把整份场景存进台账。 */
export interface LedgerItemLike {
  id: string;
  name: string;
  position?: { x: number; z: number } | undefined;
  rotation?: number | undefined;
}

export interface LedgerLayoutLike {
  floors: readonly { items: readonly LedgerItemLike[] }[];
}

/** 通过/驳回时落下的证据：画布实际差出来的件、itemId、前后位置。 */
export interface ReviewEvidence {
  at: number;
  /** 快照里新出现的 itemId。 */
  added: string[];
  /** 快照里消失的 itemId。 */
  removed: string[];
  /** 同一 itemId 位置或朝向变了的，记前后值。 */
  moved: { id: string; name: string; from: string; to: string }[];
  /** 画布差不出东西时的说明，不冒充「改了 0 件」。 */
  note?: string;
}

export interface ReviewAttempt {
  id: string;
  /** 事项编号：T-1、T-2…，同一句分派刷新后仍是同一条。 */
  itemNo?: string;
  /** 负责人：点名的 agent，没有就等认领。 */
  owner?: string;
  /** 这一版要达成的目标（从请求与产物事实拼出来，不是再猜一遍）。 */
  goal?: string;
  /** 验收点：几何闸、件数一致、锁定件不动。 */
  acceptance?: string[];
  /** agent 已经直接做完的事；写画布不在其中。 */
  autoDone?: string[];
  /** 写画布 = 必须等你点头；只出候选/校验 = agent 可直接做。 */
  gate?: ReviewGate;
  /** 发起这条请求的用户气泡 id；没有对应气泡时是 manual。 */
  requestId: string;
  /** 人当时说的那句（快照，气泡后来被删也不影响记录）。 */
  request: string;
  /** 这句同时点名的 agent。 */
  to: string[];
  /** 产出这一版的 agent。 */
  agent: string;
  /** 产物摘要：新增/撤掉/重叠/不能落盘的原因。 */
  artifact: string;
  at: number;
  status: ReviewStatus;
  decidedAt?: number;
  /** 决定说明：通过是「写进画布」，驳回是「撤回」，作废是原因。 */
  note?: string;
  /** 落在台账里的证据；通过/驳回时写，待复核时没有。 */
  evidence?: ReviewEvidence;
}

export const REVIEW_STORAGE_KEY = 'scendance.review-ledger.v1';
/** 只留最近这些条：台账是回看用的，不是归档系统。 */
export const REVIEW_LIMIT = 30;

export interface ProposalDigest {
  added: number;
  removing: number;
  changed?: number;
  overlapCount: number;
  blocked?: string | null;
  review?: boolean;
  /** 锁定件：提案不许动，验收点里要写清楚。 */
  keptLocked?: number;
}

/** 会写画布件的总数：为 0 说明这一版只是结论，agent 自己能收尾。 */
export function proposalWrites(plan: ProposalDigest): number {
  return plan.added + plan.removing + (plan.changed ?? 0);
}

/** 「我可以直接做」与「必须等你点头」的分界：只有写画布要人点头。 */
export function planGate(plan: ProposalDigest): ReviewGate {
  return proposalWrites(plan) > 0 || plan.blocked ? 'human' : 'agent';
}

/** 事项目标：把一句自然语言落成可核对的终态，不重复需求原话。 */
export function goalOfItem(plan: ProposalDigest, request: string): string {
  const request_ = request.trim();
  const parts = [`新增 ${plan.added} 件`, `撤掉 ${plan.removing} 件`];
  if (plan.changed) parts.push(`挪动 ${plan.changed} 件`);
  const head = request_ ? `按「${request_}」` : '按这一版';
  return `${head}：${parts.join(' · ')}，确认前画布保持原样。`;
}

/** 验收点：都是能从画布与台账核对的事实，不写「体验良好」这种空话。 */
export function acceptanceOfItem(plan: ProposalDigest): string[] {
  const gate = plan.blocked
    ? `几何闸未过：${plan.blocked}`
    : `几何闸通过：${plan.overlapCount > 0 ? `仍有 ${plan.overlapCount} 件重叠/越界（卡上会标出）` : '无重叠、无越界'}`;
  const lines = [
    gate,
    `确认后画布与候选一致：新增 ${plan.added} / 撤掉 ${plan.removing}${plan.changed ? ` / 挪动 ${plan.changed}` : ''}`,
    `锁定件不动${plan.keptLocked ? `（${plan.keptLocked} 件）` : ''}`,
    '驳回 = 画布保持原样，这条记录保留',
  ];
  return lines;
}

/** agent 已经直接做完的事：都是只读或候选态，写画布不在其中。 */
export function autoStepsOfItem(): string[] {
  return ['读懂需求并拆成事项', '生成候选并逐帧预览', '几何闸与锁定件检查'];
}

/** 产物摘要：只报能核对的事实，不把「已生成」说成「已落盘」。 */
export function digestProposal(plan: ProposalDigest): string {
  const parts = plan.review
    ? [`体检改法 · 挪动 ${plan.changed ?? 0} 件`]
    : [`新增 ${plan.added} 件`, `撤掉 ${plan.removing} 件`];
  if (plan.changed && !plan.review) parts.push(`挪动 ${plan.changed} 件`);
  parts.push(plan.overlapCount > 0 ? `重叠/越界 ${plan.overlapCount} 件` : '无重叠');
  if (plan.blocked) parts.push(`不能落盘：${plan.blocked}`);
  return parts.join(' · ');
}

/** 展平画布：只留 id/名字/位置/朝向，存的是证据不是场景。 */
export function snapshotItems(layout: LedgerLayoutLike | null | undefined): LedgerItemLike[] {
  return layout ? layout.floors.flatMap(floor => [...floor.items]) : [];
}

function spotOf(item: LedgerItemLike): string {
  const x = item.position?.x;
  const z = item.position?.z;
  const at = typeof x === 'number' && typeof z === 'number' ? `${x.toFixed(2)},${z.toFixed(2)}` : '—';
  return typeof item.rotation === 'number' ? `${at} r${item.rotation.toFixed(2)}` : at;
}

const sameSpot = (a: LedgerItemLike, b: LedgerItemLike): boolean => spotOf(a) === spotOf(b);

/** 前后快照差分：谁新加、谁撤掉、谁挪了；只认 itemId，不靠名字匹配。 */
export function diffSnapshots(before: readonly LedgerItemLike[], after: readonly LedgerItemLike[], at: number): ReviewEvidence {
  const beforeById = new Map(before.map(item => [item.id, item] as const));
  const afterById = new Map(after.map(item => [item.id, item] as const));
  const added = after.filter(item => !beforeById.has(item.id)).map(item => item.id);
  const removed = before.filter(item => !afterById.has(item.id)).map(item => item.id);
  const moved = after.flatMap(item => {
    const old = beforeById.get(item.id);
    if (!old || sameSpot(old, item)) return [];
    return [{ id: item.id, name: item.name, from: spotOf(old), to: spotOf(item) }];
  });
  return { at, added, removed, moved };
}

function idsLabel(ids: readonly string[]): string {
  const head = ids.slice(0, 2).map(id => id.slice(0, 8)).join('、');
  return ids.length > 2 ? `${head} 等 ${ids.length} 件` : head;
}

/** 台账行上的一行证据；驳回时画布没动就照实说，不冒充「改了 0 件」。 */
export function evidenceLine(evidence: ReviewEvidence): string {
  const pieces = [`画布实际 新增 ${evidence.added.length} · 撤掉 ${evidence.removed.length} · 挪动 ${evidence.moved.length}`];
  if (evidence.added.length) pieces.push(`新增 ${idsLabel(evidence.added)}`);
  if (evidence.removed.length) pieces.push(`撤掉 ${idsLabel(evidence.removed)}`);
  if (evidence.moved.length) {
    const rows = evidence.moved.slice(0, 2).map(row => `${row.name}(${row.id.slice(0, 8)}) ${row.from}→${row.to}`).join('；');
    pieces.push(`挪动 ${rows}${evidence.moved.length > 2 ? ' 等' : ''}`);
  }
  if (evidence.note) pieces.push(evidence.note);
  return pieces.join(' · ');
}

export const REVIEW_SEQ_KEY = 'scendance.review-ledger.seq.v1';
export const REVIEW_OPEN_KEY = 'scendance.review-ledger.open.v1';

/** 事项编号：跨刷新递增；存储不可用时退回 T-1，不阻断复核。 */
export function nextItemNo(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage): string {
  if (!storage) return 'T-1';
  const current = Number.parseInt(storage.getItem(REVIEW_SEQ_KEY) ?? '0', 10);
  const next = Number.isFinite(current) && current > 0 ? current + 1 : 1;
  try { storage.setItem(REVIEW_SEQ_KEY, String(next)); } catch { /* 配额满就退回 T-1 语义：编号不阻塞复核。 */ }
  return `T-${next}`;
}

/** 正在复核的那条：切页签会卸载组件，靠它把身份带过去；刷新后也还在。 */
export function loadOpenAttemptId(storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage): string | null {
  if (!storage) return null;
  try { return storage.getItem(REVIEW_OPEN_KEY); } catch { return null; }
}

export function saveOpenAttemptId(id: string | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = typeof window === 'undefined' ? null : window.localStorage): void {
  if (!storage) return;
  try { id ? storage.setItem(REVIEW_OPEN_KEY, id) : storage.removeItem(REVIEW_OPEN_KEY); } catch { /* 同上。 */ }
}

export interface OpenAttemptInput {
  requestId: string;
  request: string;
  to: readonly string[];
  agent: string;
  artifact: string;
  at?: number;
  id?: string;
  itemNo?: string;
  goal?: string;
  acceptance?: readonly string[];
  autoDone?: readonly string[];
  gate?: ReviewGate;
}

function newId(at: number): string {
  return `r-${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 新一版出现：上一版还在待复核的记作废，不留下永远挂着的 pending。 */
export function openReviewAttempt(list: readonly ReviewAttempt[], input: OpenAttemptInput): ReviewAttempt[] {
  const at = input.at ?? Date.now();
  const settled = list.map(attempt => (attempt.status === 'pending'
    ? { ...attempt, status: 'superseded' as const, decidedAt: at, note: '被新一版顶掉' }
    : attempt));
  const attempt: ReviewAttempt = {
    id: input.id ?? newId(at),
    requestId: input.requestId,
    request: input.request,
    to: [...input.to],
    agent: input.agent,
    artifact: input.artifact,
    at,
    status: 'pending',
    ...(input.itemNo ? { itemNo: input.itemNo } : {}),
    ...(input.gate ? { gate: input.gate } : {}),
    ...(input.goal ? { goal: input.goal } : {}),
    ...(input.acceptance?.length ? { acceptance: [...input.acceptance] } : {}),
    ...(input.autoDone?.length ? { autoDone: [...input.autoDone] } : {}),
  };
  // 没点名的交给「待认领」，不要让记录看起来像有人接了。
  const owner = input.to[0];
  if (owner) attempt.owner = owner; else attempt.owner = '待认领';
  return [...settled, attempt].slice(-REVIEW_LIMIT);
}

/** 同一版被继续加料/改法：摘要跟着更新，身份和状态不变。 */
export function updatePendingArtifact(list: readonly ReviewAttempt[], id: string, artifact: string): ReviewAttempt[] {
  return list.map(attempt => (attempt.id === id && attempt.status === 'pending' ? { ...attempt, artifact } : attempt));
}

/** 人做了决定：只对还在待复核的那条生效，重复点击不会改写历史。 */
export function decideReview(
  list: readonly ReviewAttempt[],
  id: string,
  status: Exclude<ReviewStatus, 'pending'>,
  note: string,
  at: number = Date.now(),
  evidence?: ReviewEvidence,
): ReviewAttempt[] {
  return list.map(attempt => (attempt.id === id && attempt.status === 'pending'
    ? { ...attempt, status, decidedAt: at, note, ...(evidence ? { evidence } : {}) }
    : attempt));
}

export function pendingReview(list: readonly ReviewAttempt[]): ReviewAttempt | null {
  for (let index = list.length - 1; index >= 0; index--) {
    if (list[index]!.status === 'pending') return list[index]!;
  }
  return null;
}

export interface ExitDecision {
  status: Exclude<ReviewStatus, 'pending'>;
  note: string;
}

/**
 * 提案离开预览态时，按落盘结果反推人的决定。
 * `state` 是 AgentState（planReady / planEdited 表示已经写进画布）。
 */
export function decideFromExit(state: string, lastAgentText: string): ExitDecision {
  if (state === 'planReady' || state === 'planEdited') {
    return { status: 'approved', note: '人点「确认布置」写进画布' };
  }
  const text = lastAgentText.trim();
  if (text.startsWith('撤了')) return { status: 'rejected', note: '人点「撤回」驳回这一版' };
  if (text.includes('先作废')) return { status: 'superseded', note: '提案失效：场地或需求变了' };
  return { status: 'superseded', note: '被新一版顶掉' };
}

export function loadReviewAttempts(storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage): ReviewAttempt[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(REVIEW_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is ReviewAttempt => (
      !!row && typeof row === 'object'
      && typeof (row as ReviewAttempt).id === 'string'
      && typeof (row as ReviewAttempt).request === 'string'
      && typeof (row as ReviewAttempt).artifact === 'string'
      && typeof (row as ReviewAttempt).at === 'number'
      && ['pending', 'approved', 'rejected', 'superseded'].includes((row as ReviewAttempt).status)
    )).slice(-REVIEW_LIMIT);
  } catch {
    return [];
  }
}

export function saveReviewAttempts(
  list: readonly ReviewAttempt[],
  storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(list.slice(-REVIEW_LIMIT)));
  } catch {
    /* 无痕模式或配额满：台账留在内存里，不影响复核本身。 */
  }
}

export function statusLabel(status: ReviewStatus): string {
  if (status === 'approved') return '已通过';
  if (status === 'rejected') return '已驳回';
  if (status === 'superseded') return '已作废';
  return '待复核';
}
