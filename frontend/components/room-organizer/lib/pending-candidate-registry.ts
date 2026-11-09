/**
 * Synchronous, in-memory ownership tracking for uncommitted candidates.
 * Tokens are opaque identities; they must not contain or expose user data.
 * The owning workspace calls setScope synchronously whenever the activity,
 * actor, conversation or other relevant authority changes. Operations use the
 * returned handle, never the caller's scope key.
 */
export type PendingCandidateKind = 'local' | 'cloud';

export interface PendingCandidateCapture {
  readonly hasPending: boolean;
  readonly local: boolean;
  readonly cloud: boolean;
  isCurrent(): boolean;
}

export interface PendingCandidateAccess {
  register(kind:PendingCandidateKind,owner:object):boolean;
  clear(kind:PendingCandidateKind,owner:object):boolean;
  invalidate():boolean;
  capture():PendingCandidateCapture|null;
}

export function createPendingCandidateRegistry() {
  let scopeKey: object | null = null;
  let scopeHandle: object | null = null;
  let epoch = 0;
  const owners: Record<PendingCandidateKind, object | null> = {local:null,cloud:null};
  const validToken = (value: unknown): value is object => typeof value === 'object' && value !== null;
  const validKind = (value: unknown): value is PendingCandidateKind => value === 'local' || value === 'cloud';

  function setScope(next: object | null): object | null {
    if (next !== null && !validToken(next)) throw new TypeError('Invalid scope token');
    if (scopeKey === next) return scopeHandle;
    scopeKey = next;
    scopeHandle = next === null ? null : {};
    owners.local = null;
    owners.cloud = null;
    epoch++;
    return scopeHandle;
  }

  /** Register each candidate creation/replacement synchronously, not in an effect. */
  function register(candidateScope: object, kind: PendingCandidateKind, owner: object): boolean {
    if (!validToken(candidateScope) || !validToken(owner) || !validKind(kind) || scopeHandle !== candidateScope) return false;
    owners[kind] = owner;
    // Advance even if an owner token is accidentally reused: replacement must
    // invalidate an earlier export capture, including an A -> B -> A cycle.
    epoch++;
    return true;
  }

  /** A stale owner's cleanup must not clear its replacement or another source. */
  function clear(candidateScope: object, kind: PendingCandidateKind, owner: object): boolean {
    if (!validToken(candidateScope) || !validToken(owner) || !validKind(kind) || scopeHandle !== candidateScope || owners[kind] !== owner) return false;
    owners[kind] = null;
    epoch++;
    return true;
  }

  /** Hiding an overlay does not discard a retained proposal. */
  function retain(candidateScope: object, kind: PendingCandidateKind, owner: object): boolean {
    return validToken(candidateScope) && validToken(owner) && validKind(kind) && scopeHandle === candidateScope && owners[kind] === owner;
  }

  /** Invalidate captures after a synchronous authority change without discarding either preview. */
  function invalidate(candidateScope: object): boolean {
    if (!validToken(candidateScope) || scopeHandle !== candidateScope) return false;
    epoch++;
    return true;
  }

  function capture(candidateScope: object): PendingCandidateCapture | null {
    if (!validToken(candidateScope) || scopeHandle !== candidateScope) return null;
    const capturedEpoch = epoch;
    const local = owners.local !== null, cloud = owners.cloud !== null;
    return {local,cloud,hasPending:local || cloud,isCurrent:()=>scopeHandle === candidateScope && epoch === capturedEpoch};
  }

  return {setScope,register,clear,retain,invalidate,capture};
}

/** Bind registry operations to a live activity token; stale closures cannot restore an old scope. */
export function bindPendingCandidateRegistry(
 registry:ReturnType<typeof createPendingCandidateRegistry>,scopeToken:object|null,stillCurrent:()=>boolean,
):PendingCandidateAccess {
 const active=()=>{try{return !!scopeToken&&stillCurrent();}catch{return false;}};
 const scope=()=>active()?registry.setScope(scopeToken):null;
 return {
  register:(kind,owner)=>{const handle=scope();return !!handle&&registry.register(handle,kind,owner);},
  clear:(kind,owner)=>{const handle=scope();return !!handle&&registry.clear(handle,kind,owner);},
  invalidate:()=>{const handle=scope();return !!handle&&registry.invalidate(handle);},
  capture:()=>{const handle=scope();if(!handle)return null;const current=registry.capture(handle);return current?{...current,isCurrent:()=>active()&&current.isCurrent()}:null;},
 };
}
