import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFreshProposal, createSceneClient, type EditorState, type Proposal } from '../client/scene-client.ts';
import { sceneHash } from '../supabase/functions/_shared/domain.ts';

async function fixture(expiresAt = '2026-10-07T01:31:00.000Z') {
  const current: EditorState = {
    projectId: crypto.randomUUID(), sessionId: crypto.randomUUID(), generation: 1,
    expectedRevision: 2, localRevision: 3,
    scene: {
      schemaVersion: 1, venue: { width: 10, depth: 8, height: 3, shape: 'rectangle', entrances: [] },
      objects: [], camera: 'overview', lighting: 'neutral',
    },
  };
  const proposal: Proposal = {
    id: crypto.randomUUID(), project_id: current.projectId, session_id: current.sessionId,
    generation: current.generation, base_revision: current.expectedRevision, local_revision: current.localRevision,
    base_hash: await sceneHash(current.scene), candidate: current.scene, expires_at: expiresAt, applied_at: null,
  };
  return { proposal, current };
}

describe('proposal freshness at the client write boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T01:30:00.000Z'));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each(['', 'not-a-date', '2026-99-99T01:31:00Z'])('rejects unparseable expiry %s', async expiresAt => {
    const { proposal, current } = await fixture(expiresAt);
    await expect(assertFreshProposal(proposal, current)).rejects.toMatchObject({ code: 'STALE_PROPOSAL', status: 409 });
  });

  it.each(['2026-10-07T01:29:59.999Z', '2026-10-07T01:30:00.000Z'])('rejects expired or boundary timestamp %s', async expiresAt => {
    const { proposal, current } = await fixture(expiresAt);
    await expect(assertFreshProposal(proposal, current)).rejects.toThrow('STALE_PROPOSAL');
  });

  it('accepts a fresh proposal with a PostgreSQL-style timezone offset', async () => {
    const { proposal, current } = await fixture('2026-10-07T09:31:00+08:00');
    await expect(assertFreshProposal(proposal, current)).resolves.toBeUndefined();
  });

  it('does not request an access token or send an apply request for a malformed expiry', async () => {
    const { proposal, current } = await fixture('not-a-date');
    const token = vi.fn(async () => 'fake-test-token');
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const client = createSceneClient('https://example.test/scene-api', token);
    await expect(client.applyProposal(proposal, current)).rejects.toThrow('STALE_PROPOSAL');
    expect(token).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
});
