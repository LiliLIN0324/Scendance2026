/**
 * 最小可恢复闭环：先把原话写入日志，再允许声称已接收；
 * 需求版本和候选、付费请求编号绑在一起；新输入立即使旧候选失效。
 * 超时或本机写入失败都不自动再付一次费。刷新后按原请求编号读回。
 *
 * 这是内存日志，不是 Supabase 表，也没有接到面板、控制器或 scene-api。
 * 产品仍是一个活动 Agent。五个入口共用同一条确认路径，目前都还没接到运行时。
 */
import {createDialogueTurnTracker} from './dialogue-turn-tracker';

export const PRODUCT_ENTRIES = ['proposal', 'rebuild', 'material', 'review', 'restore'] as const;
export type ProductEntry = (typeof PRODUCT_ENTRIES)[number];
export type TurnDisposition = 'recorded' | 'pending' | 'accepted' | 'unresolved' | 'withdrawn';
export type RunPhase = 'prepared' | 'submitted' | 'outcome_unknown' | 'complete' | 'local_write_failed';

export interface JournalOwner {
  projectId: string;
  activityId: string;
  actorId: string;
  store: string;
}

export interface JournalTurn {
  eventId: string;
  sessionId: string;
  text: string;
  disposition: TurnDisposition;
}

export interface JournalCandidate {
  candidateId: string;
  entry: ProductEntry;
  eventId: string | null;
  requirementRevision: number;
  requestId: string;
  status: 'open' | 'invalidated' | 'confirmed';
}

export interface JournalRun {
  requestId: string;
  candidateId: string;
  entry: ProductEntry;
  requirementRevision: number;
  eventId: string | null;
  phase: RunPhase;
  paidSubmissionCount: number;
}

export interface RecoveryJournal {
  format: 'requirement-recovery-journal-v1';
  owner: JournalOwner;
  serial: number;
  revision: number;
  turns: JournalTurn[];
  candidates: JournalCandidate[];
  runs: JournalRun[];
}

export interface SharedJournal {
  read(): RecoveryJournal;
  commit(expectedSerial: number, next: RecoveryJournal): boolean;
}

const FORMAT = 'requirement-recovery-journal-v1' as const;

function sameOwner(left: JournalOwner, right: JournalOwner): boolean {
  return left.projectId === right.projectId && left.activityId === right.activityId && left.actorId === right.actorId && left.store === right.store;
}

function assertOwner(owner: JournalOwner): void {
  for (const value of [owner.projectId, owner.activityId, owner.actorId, owner.store]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_OWNER');
  }
}

function emptyJournal(owner: JournalOwner): RecoveryJournal {
  assertOwner(owner);
  return {format: FORMAT, owner:{...owner}, serial:0, revision:0, turns:[], candidates:[], runs:[]};
}

export function createSharedJournal(owner: JournalOwner, seed?: RecoveryJournal): SharedJournal {
  let current = seed ? structuredClone(seed) : emptyJournal(owner);
  if (current.format !== FORMAT || !sameOwner(current.owner, owner)) throw new Error('INVALID_JOURNAL');
  return {
    read: () => structuredClone(current),
    commit(expectedSerial, next) {
      if (current.serial !== expectedSerial || next.serial !== expectedSerial + 1) return false;
      if (next.format !== FORMAT || !sameOwner(next.owner, current.owner)) return false;
      current = structuredClone(next);
      return true;
    },
  };
}

export function draftStagedJournal(current: RecoveryJournal, input: {sessionId: string; text: string; eventId: string}): RecoveryJournal {
  const text = input.text.trim();
  if (!input.sessionId || !text || !input.eventId) throw new Error('EMPTY_TURN');
  if (current.turns.some(turn => turn.eventId === input.eventId)) throw new Error('DUPLICATE_TURN');
  const next = structuredClone(current);
  next.serial += 1;
  next.revision += 1;
  next.turns.push({eventId:input.eventId, sessionId:input.sessionId, text, disposition:'recorded'});
  for (const candidate of next.candidates) if (candidate.status === 'open') candidate.status = 'invalidated';
  return next;
}

function isEntry(value: string): value is ProductEntry {
  return (PRODUCT_ENTRIES as readonly string[]).includes(value);
}

function validateJournal(value: unknown): RecoveryJournal {
  if (!value || typeof value !== 'object') throw new Error('INVALID_JOURNAL');
  const journal = value as RecoveryJournal;
  if (journal.format !== FORMAT) throw new Error('INVALID_JOURNAL');
  assertOwner(journal.owner);
  if (!Number.isSafeInteger(journal.serial) || !Number.isSafeInteger(journal.revision)) throw new Error('INVALID_JOURNAL');
  if (!Array.isArray(journal.turns) || !Array.isArray(journal.candidates) || !Array.isArray(journal.runs)) throw new Error('INVALID_JOURNAL');
  const dispositions = new Set(['recorded', 'pending', 'accepted', 'unresolved', 'withdrawn']);
  const phases = new Set(['prepared', 'submitted', 'outcome_unknown', 'complete', 'local_write_failed']);
  for (const turn of journal.turns) {
    if (!turn.eventId || !turn.sessionId || !turn.text || !dispositions.has(turn.disposition)) throw new Error('INVALID_JOURNAL');
  }
  for (const candidate of journal.candidates) {
    if (!candidate.candidateId || !candidate.requestId || !isEntry(candidate.entry)) throw new Error('INVALID_JOURNAL');
    if (!['open', 'invalidated', 'confirmed'].includes(candidate.status)) throw new Error('INVALID_JOURNAL');
  }
  for (const run of journal.runs) {
    if (!run.requestId || !phases.has(run.phase) || !Number.isSafeInteger(run.paidSubmissionCount)) throw new Error('INVALID_JOURNAL');
  }
  return journal;
}

export function serializeRecoveryJournal(journal: SharedJournal): string {
  return JSON.stringify(journal.read());
}

export function hydrateRecoveryJournal(raw: string): SharedJournal {
  const parsed = validateJournal(JSON.parse(raw) as unknown);
  return createSharedJournal(parsed.owner, parsed);
}

export interface RecoveryIdentity {
  projectId: string;
  activityId: string;
  actorId: string;
  store: string;
}

export interface RequirementRecoveryLoop {
  readonly identity: RecoveryIdentity;
  stageInput(sessionId: string, text: string): {ok: true; received: false; eventId: string; requirementRevision: number; sessionId: string; text: string} | {ok: false; received: false; reason: 'empty' | 'conflict' | 'owner_mismatch'; text: string};
  claimReceived(eventId: string): {ok: true; received: true; eventId: string} | {ok: false; received: false; reason: string};
  canCapture(eventId: string): boolean;
  bindCandidate(entry: ProductEntry, eventId: string): {ok: true; candidateId: string; requestId: string; requirementRevision: number; entry: ProductEntry} | {ok: false; reason: string};
  bindCommand(entry: ProductEntry): {ok: true; candidateId: string; requestId: string; requirementRevision: number; entry: ProductEntry} | {ok: false; reason: string};
  submitPrepared(requestId: string, options?: {localWrite?: 'fail'}): {ok: true; requestId: string; phase: RunPhase; paidSubmissionCount: number} | {ok: false; reason: string; paidSubmissionCount: number};
  noteOutcomeUnknown(requestId: string): {ok: true; requestId: string; phase: 'outcome_unknown'; paidSubmissionCount: number} | {ok: false; reason: string};
  observeOriginal(requestId: string, outcome: 'complete' | 'still_unknown'): {ok: true; requestId: string; phase: RunPhase; paidSubmissionCount: number} | {ok: false; reason: string};
  resubmit(requestId: string): {ok: false; reason: 'paid_request_not_replayed' | 'unknown_request' | 'not_submitted'; requestId: string; paidSubmissionCount: number};
  lookup(requestId: string): JournalRun | null;
  readback(requestId: string): JournalRun | null;
  confirm(candidateId: string, requirementRevision: number): {ok: true; candidateId: string; requirementRevision: number; unresolvedEventIds: string[]} | {ok: false; reason: string; unresolvedEventIds: string[]};
  completeTurn(eventId: string, disposition: 'accepted' | 'unresolved'): {ok: boolean; reason?: string};
  abandon(eventId: string): {ok: boolean};
  withdraw(eventId: string): {ok: boolean; unresolvedEventIds: string[]};
  unresolved(sessionId?: string): JournalTurn[];
  read(): RecoveryJournal;
  coverage(): {entries: readonly ProductEntry[]; runtimeWired: false; singleAgent: true};
}

export function createRequirementRecoveryLoop(options: {identity: RecoveryIdentity; journal: SharedJournal; createId?: () => string}): RequirementRecoveryLoop {
  const identity = options.identity;
  assertOwner(identity);
  if (!sameOwner(options.journal.read().owner, identity)) throw new Error('OWNER_MISMATCH');
  const tracker = createDialogueTurnTracker();
  const releases = new Map<string, () => void>();
  let serial = 0;
  const nextId = options.createId ?? (() => `id-${++serial}`);

  function arm(eventId: string): void {
    if (releases.has(eventId)) return;
    releases.set(eventId, tracker.begin(eventId));
  }
  function disarm(eventId: string): void {
    const release = releases.get(eventId);
    if (!release) return;
    releases.delete(eventId);
    release();
  }
  function syncFence(journal: RecoveryJournal): void {
    const inflight = new Set(journal.turns.filter(turn => turn.disposition === 'recorded' || turn.disposition === 'pending').map(turn => turn.eventId));
    for (const eventId of [...releases.keys()]) if (!inflight.has(eventId)) disarm(eventId);
    for (const eventId of inflight) arm(eventId);
  }
  syncFence(options.journal.read());

  function owned(): RecoveryJournal | null {
    const current = options.journal.read();
    return sameOwner(current.owner, identity) ? current : null;
  }
  function commit(current: RecoveryJournal, next: RecoveryJournal): boolean {
    return options.journal.commit(current.serial, next);
  }
  function unresolvedIds(journal: RecoveryJournal, sessionId?: string): string[] {
    return journal.turns.filter(turn => turn.disposition === 'unresolved' && (!sessionId || turn.sessionId === sessionId)).map(turn => turn.eventId);
  }

  const loop: RequirementRecoveryLoop = {
    identity,
    stageInput(sessionId, text) {
      const kept = text;
      const current = owned();
      if (!current) return {ok:false, received:false, reason:'owner_mismatch', text:kept};
      if (!sessionId.trim() || !text.trim()) return {ok:false, received:false, reason:'empty', text:kept};
      const eventId = nextId();
      const next = draftStagedJournal(current, {sessionId, text, eventId});
      if (!commit(current, next)) return {ok:false, received:false, reason:'conflict', text:kept};
      syncFence(next);
      return {ok:true, received:false, eventId, requirementRevision:next.revision, sessionId, text:text.trim()};
    },
    claimReceived(eventId) {
      const current = owned();
      if (!current) return {ok:false, received:false, reason:'owner_mismatch'};
      const next = structuredClone(current);
      const turn = next.turns.find(item => item.eventId === eventId);
      if (!turn || turn.disposition !== 'recorded') return {ok:false, received:false, reason:'not_recorded'};
      turn.disposition = 'pending';
      next.serial += 1;
      if (!commit(current, next)) return {ok:false, received:false, reason:'conflict'};
      return {ok:true, received:true, eventId};
    },
    canCapture(eventId) {
      const current = owned();
      if (!current) return false;
      syncFence(current);
      return tracker.canCapture(eventId);
    },
    bindCandidate(entry, eventId) {
      const current = owned();
      if (!current) return {ok:false, reason:'owner_mismatch'};
      syncFence(current);
      if (!isEntry(entry)) return {ok:false, reason:'unknown_entry'};
      const turn = current.turns.find(item => item.eventId === eventId);
      if (!turn || turn.disposition !== 'pending') return {ok:false, reason:'not_received'};
      if (!tracker.canCapture(eventId)) return {ok:false, reason:'capture_blocked'};
      return bind(current, entry, eventId);
    },
    bindCommand(entry) {
      const current = owned();
      if (!current) return {ok:false, reason:'owner_mismatch'};
      syncFence(current);
      if (!isEntry(entry)) return {ok:false, reason:'unknown_entry'};
      if (tracker.size !== 0) return {ok:false, reason:'turn_in_flight'};
      return bind(current, entry, null);
    },
    submitPrepared(requestId, options) {
      const current = owned();
      const existing = current?.runs.find(run => run.requestId === requestId);
      if (!current || !existing) return {ok:false, reason:'unknown_request', paidSubmissionCount:existing?.paidSubmissionCount ?? 0};
      if (existing.phase !== 'prepared') return {ok:false, reason:'already_submitted', paidSubmissionCount:existing.paidSubmissionCount};
      const next = structuredClone(current);
      const run = next.runs.find(item => item.requestId === requestId)!;
      run.paidSubmissionCount += 1;
      run.phase = options?.localWrite === 'fail' ? 'local_write_failed' : 'submitted';
      next.serial += 1;
      if (!commit(current, next)) return {ok:false, reason:'conflict', paidSubmissionCount:existing.paidSubmissionCount};
      return {ok:true, requestId, phase:run.phase, paidSubmissionCount:run.paidSubmissionCount};
    },
    noteOutcomeUnknown(requestId) {
      const current = owned();
      const existing = current?.runs.find(run => run.requestId === requestId);
      if (!current || !existing || existing.phase !== 'submitted') return {ok:false, reason:'not_submitted'};
      const next = structuredClone(current);
      const run = next.runs.find(item => item.requestId === requestId)!;
      run.phase = 'outcome_unknown';
      next.serial += 1;
      if (!commit(current, next)) return {ok:false, reason:'conflict'};
      return {ok:true, requestId, phase:'outcome_unknown', paidSubmissionCount:run.paidSubmissionCount};
    },
    observeOriginal(requestId, outcome) {
      const current = owned();
      const existing = current?.runs.find(run => run.requestId === requestId);
      if (!current || !existing) return {ok:false, reason:'unknown_request'};
      if (existing.phase === 'prepared') return {ok:false, reason:'not_submitted'};
      if (existing.phase === 'complete' && outcome === 'still_unknown') return {ok:false, reason:'already_complete'};
      const phase: RunPhase = outcome === 'complete' ? 'complete' : existing.phase === 'submitted' ? 'outcome_unknown' : existing.phase;
      if (phase === existing.phase) return {ok:true, requestId, phase, paidSubmissionCount:existing.paidSubmissionCount};
      const next = structuredClone(current);
      const run = next.runs.find(item => item.requestId === requestId)!;
      run.phase = phase;
      next.serial += 1;
      if (!commit(current, next)) return {ok:false, reason:'conflict'};
      return {ok:true, requestId, phase:run.phase, paidSubmissionCount:run.paidSubmissionCount};
    },
    resubmit(requestId) {
      const run = owned()?.runs.find(item => item.requestId === requestId);
      if (!run) return {ok:false, reason:'unknown_request', requestId, paidSubmissionCount:0};
      if (run.phase === 'prepared' || run.paidSubmissionCount === 0) return {ok:false, reason:'not_submitted', requestId, paidSubmissionCount:run.paidSubmissionCount};
      return {ok:false, reason:'paid_request_not_replayed', requestId, paidSubmissionCount:run.paidSubmissionCount};
    },
    lookup(requestId) {
      return owned()?.runs.find(run => run.requestId === requestId) ?? null;
    },
    readback(requestId) {
      const run = loop.lookup(requestId);
      if (!run || run.phase === 'prepared') return null;
      return run;
    },
    confirm(candidateId, requirementRevision) {
      const current = owned();
      if (!current) return {ok:false, reason:'owner_mismatch', unresolvedEventIds:[]};
      const unresolvedEventIds = unresolvedIds(current);
      const candidate = current.candidates.find(item => item.candidateId === candidateId);
      if (!candidate) return {ok:false, reason:'unknown_candidate', unresolvedEventIds};
      if (candidate.status !== 'open') return {ok:false, reason:'candidate_not_open', unresolvedEventIds};
      if (candidate.requirementRevision !== requirementRevision || requirementRevision !== current.revision) return {ok:false, reason:'revision_mismatch', unresolvedEventIds};
      const run = current.runs.find(item => item.requestId === candidate.requestId);
      if (!run || run.phase !== 'complete' || run.requirementRevision !== requirementRevision) return {ok:false, reason:'run_not_ready', unresolvedEventIds};
      const next = structuredClone(current);
      next.candidates.find(item => item.candidateId === candidateId)!.status = 'confirmed';
      next.serial += 1;
      if (!commit(current, next)) return {ok:false, reason:'conflict', unresolvedEventIds};
      return {ok:true, candidateId, requirementRevision, unresolvedEventIds:unresolvedIds(next)};
    },
    completeTurn(eventId, disposition) {
      const current = owned();
      if (!current) return {ok:false, reason:'owner_mismatch'};
      const next = structuredClone(current);
      const turn = next.turns.find(item => item.eventId === eventId);
      if (!turn || (turn.disposition !== 'recorded' && turn.disposition !== 'pending')) return {ok:false, reason:'not_in_flight'};
      turn.disposition = disposition;
      next.serial += 1;
      if (!commit(current, next)) return {ok:false, reason:'conflict'};
      syncFence(next);
      return {ok:true};
    },
    abandon(eventId) {
      const settled = loop.completeTurn(eventId, 'unresolved');
      return {ok:settled.ok};
    },
    withdraw(eventId) {
      const current = owned();
      if (!current) return {ok:false, unresolvedEventIds:[]};
      const next = structuredClone(current);
      const turn = next.turns.find(item => item.eventId === eventId);
      if (!turn || turn.disposition !== 'unresolved') return {ok:false, unresolvedEventIds:unresolvedIds(current)};
      turn.disposition = 'withdrawn';
      next.serial += 1;
      if (!commit(current, next)) return {ok:false, unresolvedEventIds:unresolvedIds(current)};
      return {ok:true, unresolvedEventIds:unresolvedIds(next)};
    },
    unresolved(sessionId) {
      const current = owned();
      if (!current) return [];
      return current.turns.filter(turn => turn.disposition === 'unresolved' && (!sessionId || turn.sessionId === sessionId));
    },
    read() {
      const current = owned();
      if (!current) throw new Error('OWNER_MISMATCH');
      return current;
    },
    coverage() {
      return {entries:PRODUCT_ENTRIES, runtimeWired:false, singleAgent:true};
    },
  };

  function bind(current: RecoveryJournal, entry: ProductEntry, eventId: string | null) {
    const next = structuredClone(current);
    const candidateId = nextId();
    const requestId = nextId();
    for (const candidate of next.candidates) if (candidate.status === 'open') candidate.status = 'invalidated';
    next.candidates.push({candidateId, entry, eventId, requirementRevision:current.revision, requestId, status:'open'});
    next.runs.push({requestId, candidateId, entry, requirementRevision:current.revision, eventId, phase:'prepared', paidSubmissionCount:0});
    next.serial += 1;
    if (!commit(current, next)) return {ok:false as const, reason:'conflict'};
    return {ok:true as const, candidateId, requestId, requirementRevision:current.revision, entry};
  }

  return loop;
}
