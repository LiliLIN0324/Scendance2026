import { canonical, sha256 } from './domain.ts';

/**
 * Fields that a legitimate retry may rewrite — a renewed lease bumps the
 * generation and the expected revision, and the echo fields are bookkeeping.
 * `requestId` stays out too: the RPC already keys reuse on it, so hashing it
 * would make every retry a different run instead of a reused one.
 */
const LEASE_FIELDS = ['requestId', 'sessionId', 'generation', 'expectedRevision', 'localRevision'] as const;

/**
 * Business input only: what the user asked for, with the lease fields removed.
 * Everything else is kept (including `kind` and the activity-task context) so a
 * genuinely different request still hashes differently for both shapes of
 * `agentDispatchRequestSchema`.
 */
export function agentFingerprintInput(input: object): Record<string, unknown> {
  const business: Record<string, unknown> = { ...input };
  for (const field of LEASE_FIELDS) delete business[field];
  return business;
}

/** Stable key-order hash of the business input; the RPC still receives a string. */
export const agentFingerprint = (input: object) => sha256(canonical(agentFingerprintInput(input)));
