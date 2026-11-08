/** Durable, non-secret receipt for a cloud write whose outcome may be unknown. */
export interface OriginalReviewReceipt {
  version: 1;
  projectId: string;
  reviewId: string;
  baseHash: string;
  candidateHash: string;
  baseRevision: number;
}

const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
export function isOriginalReviewReceipt(value: unknown): value is OriginalReviewReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).sort().join(',') === 'baseHash,baseRevision,candidateHash,projectId,reviewId,version'
    && r.version === 1 && typeof r.projectId === 'string' && id.test(r.projectId)
    && typeof r.reviewId === 'string' && id.test(r.reviewId)
    && typeof r.baseHash === 'string' && hash.test(r.baseHash)
    && typeof r.candidateHash === 'string' && hash.test(r.candidateHash)
    && Number.isSafeInteger(r.baseRevision) && (r.baseRevision as number) >= 0;
}

export type OriginalReviewPending = {state:'none'} | {state:'pending';receipt:OriginalReviewReceipt} | {state:'unavailable'};
export function originalReviewReceiptKey(account: string, project: string): string {
  if (!id.test(account) || !id.test(project)) throw new Error('无法核对当前账户或项目。');
  return `scendance:original-review:v1:${account.toLowerCase()}:${project.toLowerCase()}`;
}
export function readOriginalReviewPending(storage: Pick<Storage,'getItem'> | null, key: string): OriginalReviewPending {
  try {
    if (!storage) return {state:'unavailable'};
    const raw = storage.getItem(key);
    if (raw === null) return {state:'none'};
    const parsed: unknown = JSON.parse(raw);
    return isOriginalReviewReceipt(parsed) && key.endsWith(`:${parsed.projectId.toLowerCase()}`)
      ? {state:'pending',receipt:parsed} : {state:'unavailable'};
  } catch { return {state:'unavailable'}; }
}

/**
 * The caller validates the server response. Any thrown error after dispatch is
 * unknown, including local session changes and timeouts. Never automatically retry.
 */
export async function commitOriginalReview<T>(options: {
  storage: Pick<Storage,'getItem'|'setItem'> | null;
  locks: Pick<LockManager,'request'> | null;
  accountId: string;
  receipt: OriginalReviewReceipt;
  isCurrent: () => boolean;
  submit: () => Promise<T>;
}): Promise<{state:'committed';value:T}|{state:'unknown'}|{state:'blocked'}> {
  const {storage,locks,accountId,receipt,isCurrent,submit} = options;
  if (!storage || !locks || !isOriginalReviewReceipt(receipt)) return {state:'blocked'};
  let key:string;try{key=originalReviewReceiptKey(accountId,receipt.projectId);}catch{return {state:'blocked'};}
  try {
    return await locks.request(key, {mode:'exclusive',ifAvailable:true}, async lock => {
      if (!lock || !isCurrent() || readOriginalReviewPending(storage,key).state !== 'none') return {state:'blocked'} as const;
      const encoded = JSON.stringify(receipt);
      try { storage.setItem(key,encoded); if(storage.getItem(key)!==encoded) return {state:'blocked'} as const; }
      catch { return {state:'blocked'} as const; }
      // No await separates the final scope check and dispatch.
      if (!isCurrent()) return {state:'unknown'} as const;
      try {
        const value = await submit();
        if (!isCurrent() || storage.getItem(key)!==encoded) return {state:'unknown'} as const;
        // Deliberately retain the receipt: removeItem may succeed followed by an
        // unreadable store, making an unresolved outcome disappear on restart.
        // A separately verified durable completion ledger is needed to clear it.
        return {state:'committed',value} as const;
      } catch { return {state:'unknown'} as const; }
    });
  } catch { return {state:'blocked'}; }
}
