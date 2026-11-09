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
  let current = cleanJournal(seed ? structuredClone(seed) : emptyJournal(owner));
  if (!sameOwner(current.owner, owner)) throw new Error('INVALID_JOURNAL');
  return {
    read: () => structuredClone(current),
    commit(expectedSerial, next) {
      if (current.serial !== expectedSerial) return false;
      let clean: RecoveryJournal;
      try { clean = cleanJournal(structuredClone(next)); } catch { return false; }
      if (!transitionAllowed(current, clean)) return false;
      current = clean;
      return true;
    },
  };
}

export function draftStagedJournal(current: RecoveryJournal, input: {sessionId: string; text: string; eventId: string}): RecoveryJournal {
  const text = cleanText(input.text);
  const sessionId = cleanText(input.sessionId);
  const eventId = cleanText(input.eventId);
  if (!sessionId || !text || !eventId) throw new Error('EMPTY_TURN');
  if (current.turns.some(turn => turn.eventId === eventId)) throw new Error('DUPLICATE_TURN');
  const next = structuredClone(current);
  next.serial += 1;
  next.revision += 1;
  next.turns.push({eventId, sessionId, text, disposition:'recorded'});
  for (const candidate of next.candidates) if (candidate.status === 'open') candidate.status = 'invalidated';
  return next;
}

function isEntry(value: string): value is ProductEntry {
  return (PRODUCT_ENTRIES as readonly string[]).includes(value);
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() === value && value.length > 0 ? value : null;
}

function cleanJournal(value: unknown): RecoveryJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_JOURNAL');
  const raw = value as RecoveryJournal;
  if (raw.format !== FORMAT) throw new Error('INVALID_JOURNAL');
  assertOwner(raw.owner);
  if (!Number.isSafeInteger(raw.serial) || raw.serial < 0 || !Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new Error('INVALID_JOURNAL');
  if (!Array.isArray(raw.turns) || !Array.isArray(raw.candidates) || !Array.isArray(raw.runs)) throw new Error('INVALID_JOURNAL');
  const dispositions = new Set(['recorded', 'pending', 'accepted', 'unresolved', 'withdrawn']);
  const phases = new Set(['prepared', 'submitted', 'outcome_unknown', 'complete', 'local_write_failed']);
  const turns = raw.turns.map(turn => {
    const eventId = cleanText(turn?.eventId);
    const sessionId = cleanText(turn?.sessionId);
    const text = cleanText(turn?.text);
    if (!eventId || !sessionId || !text || !dispositions.has(turn.disposition)) throw new Error('INVALID_JOURNAL');
    return {eventId, sessionId, text, disposition: turn.disposition};
  });
  if (new Set(turns.map(turn => turn.eventId)).size !== turns.length || raw.revision !== turns.length) throw new Error('INVALID_JOURNAL');
  const candidates = raw.candidates.map(candidate => {
    const candidateId = cleanText(candidate?.candidateId);
    const requestId = cleanText(candidate?.requestId);
    const eventId = candidate?.eventId === null ? null : cleanText(candidate?.eventId);
    if (!candidateId || !requestId || eventId === null && candidate?.eventId !== null || !isEntry(candidate.entry)) throw new Error('INVALID_JOURNAL');
    if (!['open', 'invalidated', 'confirmed'].includes(candidate.status)) throw new Error('INVALID_JOURNAL');
    if (!Number.isSafeInteger(candidate.requirementRevision) || candidate.requirementRevision < 0 || candidate.requirementRevision > raw.revision) throw new Error('INVALID_JOURNAL');
    return {candidateId, entry: candidate.entry, eventId, requirementRevision: candidate.requirementRevision, requestId, status: candidate.status};
  });
  if (new Set(candidates.map(candidate => candidate.candidateId)).size !== candidates.length) throw new Error('INVALID_JOURNAL');
  if (candidates.filter(candidate => candidate.status === 'open').length > 1) throw new Error('INVALID_JOURNAL');
  const open = candidates.find(candidate => candidate.status === 'open');
  if (open && open.requirementRevision !== raw.revision) throw new Error('INVALID_JOURNAL');
  const runs = raw.runs.map(run => {
    const requestId = cleanText(run?.requestId);
    const candidateId = cleanText(run?.candidateId);
    const eventId = run?.eventId === null ? null : cleanText(run?.eventId);
    if (!requestId || !candidateId || (eventId === null && run?.eventId !== null) || !isEntry(run.entry) || !phases.has(run.phase)) throw new Error('INVALID_JOURNAL');
    if (!Number.isSafeInteger(run.requirementRevision) || run.requirementRevision < 0 || run.requirementRevision > raw.revision) throw new Error('INVALID_JOURNAL');
    const paidOk = run.phase === 'prepared' ? run.paidSubmissionCount === 0 : run.paidSubmissionCount === 1;
    if (!paidOk) throw new Error('INVALID_JOURNAL');
    return {requestId, candidateId, entry: run.entry, requirementRevision: run.requirementRevision, eventId, phase: run.phase, paidSubmissionCount: run.paidSubmissionCount};
  });
  if (new Set(runs.map(run => run.requestId)).size !== runs.length || runs.length !== candidates.length) throw new Error('INVALID_JOURNAL');
  for (const candidate of candidates) {
    const run = runs.find(item => item.requestId === candidate.requestId);
    if (!run || run.candidateId !== candidate.candidateId || run.entry !== candidate.entry || run.eventId !== candidate.eventId || run.requirementRevision !== candidate.requirementRevision) throw new Error('INVALID_JOURNAL');
  }
  return {
    format: FORMAT,
    owner: {projectId: raw.owner.projectId, activityId: raw.owner.activityId, actorId: raw.owner.actorId, store: raw.owner.store},
    serial: raw.serial,
    revision: raw.revision,
    turns,
    candidates,
    runs,
  };
}

function sameRun(left: JournalRun, right: JournalRun): boolean {
  return left.requestId === right.requestId && left.candidateId === right.candidateId && left.entry === right.entry && left.requirementRevision === right.requirementRevision && left.eventId === right.eventId && left.phase === right.phase && left.paidSubmissionCount === right.paidSubmissionCount;
}

function paidStep(before: JournalRun, after: JournalRun): boolean {
  if (before.requestId !== after.requestId || before.candidateId !== after.candidateId || before.entry !== after.entry || before.requirementRevision !== after.requirementRevision || before.eventId !== after.eventId) return false;
  if (before.phase === 'prepared' && (after.phase === 'submitted' || after.phase === 'local_write_failed')) return before.paidSubmissionCount === 0 && after.paidSubmissionCount === 1;
  if (before.paidSubmissionCount !== after.paidSubmissionCount || before.paidSubmissionCount !== 1) return false;
  if (before.phase === 'submitted' && (after.phase === 'outcome_unknown' || after.phase === 'complete')) return true;
  return (before.phase === 'outcome_unknown' || before.phase === 'local_write_failed') && after.phase === 'complete';
}

function candidateIdentity(left: JournalCandidate, right: JournalCandidate): boolean {
  return left.candidateId === right.candidateId && left.entry === right.entry && left.eventId === right.eventId && left.requirementRevision === right.requirementRevision && left.requestId === right.requestId;
}

/** 只允许六种向前的提交。付费次数不能回头，失效或已确认的候选不能重新打开。 */
function transitionAllowed(current: RecoveryJournal, next: RecoveryJournal): boolean {
  if (next.serial !== current.serial + 1 || next.format !== current.format || !sameOwner(next.owner, current.owner)) return false;
  if (next.revision !== current.revision && next.revision !== current.revision + 1) return false;
  if (next.turns.length !== current.turns.length && next.turns.length !== current.turns.length + 1) return false;
  if (next.candidates.length !== current.candidates.length && next.candidates.length !== current.candidates.length + 1) return false;
  if (next.runs.length !== next.candidates.length) return false;
  const turnMoves: number[] = [];
  for (let index = 0; index < current.turns.length; index += 1) {
    const before = current.turns[index];
    const after = next.turns[index];
    if (!before || !after || before.eventId !== after.eventId || before.sessionId !== after.sessionId || before.text !== after.text) return false;
    if (before.disposition === after.disposition) continue;
    const allowed = before.disposition === 'recorded' ? ['pending', 'accepted', 'unresolved'] : before.disposition === 'pending' ? ['accepted', 'unresolved'] : before.disposition === 'unresolved' ? ['withdrawn'] : [];
    if (!allowed.includes(after.disposition)) return false;
    turnMoves.push(index);
  }
  const appendedTurn = next.turns.length === current.turns.length + 1 ? next.turns.at(-1) : undefined;
  if (next.turns.length !== current.turns.length && (!appendedTurn || appendedTurn.disposition !== 'recorded' || current.turns.some(turn => turn.eventId === appendedTurn.eventId))) return false;
  const candidateSteps: Array<'invalidate' | 'confirm'> = [];
  for (let index = 0; index < current.candidates.length; index += 1) {
    const before = current.candidates[index];
    const after = next.candidates[index];
    if (!before || !after || !candidateIdentity(before, after)) return false;
    if (before.status === after.status) continue;
    if (before.status === 'open' && after.status === 'invalidated') candidateSteps.push('invalidate');
    else if (before.status === 'open' && after.status === 'confirmed') candidateSteps.push('confirm');
    else return false;
  }
  const appendedCandidate = next.candidates.length === current.candidates.length + 1 ? next.candidates.at(-1) : undefined;
  if (appendedCandidate && (appendedCandidate.status !== 'open' || appendedCandidate.requirementRevision !== next.revision)) return false;
  const runChanges: number[] = [];
  for (let index = 0; index < current.runs.length; index += 1) {
    const before = current.runs[index];
    const after = next.runs[index];
    if (!before || !after) return false;
    if (sameRun(before, after)) continue;
    if (!paidStep(before, after)) return false;
    runChanges.push(index);
  }
  const appendedRun = next.runs.length === current.runs.length + 1 ? next.runs.at(-1) : undefined;
  if (appendedRun && (appendedRun.phase !== 'prepared' || appendedRun.paidSubmissionCount !== 0 || !appendedCandidate || appendedRun.requestId !== appendedCandidate.requestId || appendedRun.candidateId !== appendedCandidate.candidateId || appendedRun.entry !== appendedCandidate.entry || appendedRun.eventId !== appendedCandidate.eventId || appendedRun.requirementRevision !== appendedCandidate.requirementRevision)) return false;
  const grewTurn = Boolean(appendedTurn);
  const grewCandidate = Boolean(appendedCandidate);
  if (grewTurn !== (next.revision === current.revision + 1)) return false;
  if (!grewTurn && next.revision !== current.revision) return false;
  if (grewTurn && (turnMoves.length > 0 || grewCandidate || runChanges.length > 0 || candidateSteps.some(step => step !== 'invalidate'))) return false;
  if (grewCandidate && (grewTurn || turnMoves.length > 0 || runChanges.length > 0 || candidateSteps.some(step => step !== 'invalidate'))) return false;
  if (candidateSteps.includes('confirm') && (candidateSteps.length !== 1 || grewTurn || grewCandidate || runChanges.length > 0 || turnMoves.length > 0)) return false;
  if (runChanges.length > 1) return false;
  if (runChanges.length === 1 && (grewTurn || grewCandidate || candidateSteps.length > 0 || turnMoves.length > 0)) return false;
  if (turnMoves.length > 1) return false;
  if (turnMoves.length === 1 && (grewTurn || grewCandidate || candidateSteps.length > 0 || runChanges.length > 0)) return false;
  const onlyInvalidations = candidateSteps.length > 0 && candidateSteps.every(step => step === 'invalidate');
  if (onlyInvalidations && !grewTurn && !grewCandidate) return false;
  return grewTurn || grewCandidate || candidateSteps.includes('confirm') || runChanges.length === 1 || turnMoves.length === 1;
}

export function serializeRecoveryJournal(journal: SharedJournal): string {
  return JSON.stringify(journal.read());
}

export function hydrateRecoveryJournal(raw: string): SharedJournal {
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error('INVALID_JOURNAL'); }
  const parsed = cleanJournal(value);
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
  stageInput(sessionId: string, text: string): {ok: true; received: false; eventId: string; requirementRevision: number; sessionId: string; text: string} | {ok: false; received: false; reason: 'empty' | 'conflict' | 'duplicate' | 'owner_mismatch'; text: string};
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
  confirmPrepared(candidateId: string, requirementRevision: number): {ok: true; candidateId: string; requirementRevision: number; paidSubmissionCount: 0; unresolvedEventIds: string[]} | {ok: false; reason: string; unresolvedEventIds: string[]};
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
      if (!cleanText(sessionId) || !cleanText(text)) return {ok:false, received:false, reason:'empty', text:kept};
      const eventId = nextId();
      let next: RecoveryJournal;
      try { next = draftStagedJournal(current, {sessionId, text, eventId}); }
      catch (error) { return {ok:false, received:false, reason: error instanceof Error && error.message === 'DUPLICATE_TURN' ? 'duplicate' : 'empty', text:kept}; }
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
      const linked = current.candidates.find(candidate => candidate.candidateId === existing.candidateId);
      if (!linked || linked.status !== 'open') return {ok:false, reason:'candidate_not_open', paidSubmissionCount:existing.paidSubmissionCount};
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
      if (!run || run.candidateId !== candidate.candidateId || run.phase !== 'complete' || run.paidSubmissionCount !== 1 || run.requirementRevision !== requirementRevision) return {ok:false, reason:'run_not_ready', unresolvedEventIds};
      const next = structuredClone(current);
      next.candidates.find(item => item.candidateId === candidateId)!.status = 'confirmed';
      next.serial += 1;
      if (!commit(current, next)) return {ok:false, reason:'conflict', unresolvedEventIds};
      return {ok:true, candidateId, requirementRevision, unresolvedEventIds:unresolvedIds(next)};
    },
    confirmPrepared(candidateId, requirementRevision) {
      const current = owned();
      if (!current) return {ok:false, reason:'owner_mismatch', unresolvedEventIds:[]};
      const unresolvedEventIds = unresolvedIds(current);
      const candidate = current.candidates.find(item => item.candidateId === candidateId);
      if (!candidate) return {ok:false, reason:'unknown_candidate', unresolvedEventIds};
      if (candidate.status !== 'open') return {ok:false, reason:'candidate_not_open', unresolvedEventIds};
      if (candidate.requirementRevision !== requirementRevision || requirementRevision !== current.revision) return {ok:false, reason:'revision_mismatch', unresolvedEventIds};
      const run = current.runs.find(item => item.requestId === candidate.requestId);
      if (!run || run.candidateId !== candidate.candidateId || run.phase !== 'prepared' || run.paidSubmissionCount !== 0 || run.requirementRevision !== requirementRevision) return {ok:false, reason:'run_not_ready', unresolvedEventIds};
      const next = structuredClone(current);
      next.candidates.find(item => item.candidateId === candidateId)!.status = 'confirmed';
      next.serial += 1;
      if (!commit(current, next)) return {ok:false, reason:'conflict', unresolvedEventIds};
      return {ok:true, candidateId, requirementRevision, paidSubmissionCount:0, unresolvedEventIds:unresolvedIds(next)};
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
