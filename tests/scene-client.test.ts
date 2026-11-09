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

  it('keeps the HTTP status when an error body is not JSON', async () => {
    const token = vi.fn(async () => 'fake-test-token');
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    const client = createSceneClient('https://example.test/scene-api', token);
    await expect(client.request('/brief/extract', 'POST', { message: '80人' })).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 502, details: null });
    expect(token).toHaveBeenCalledOnce();
    expect(network).toHaveBeenCalledOnce();
  });

  it('keeps a JSON error code and its status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', details: { private: 'do-not-surface' } } }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    const client = createSceneClient('https://example.test/scene-api', async () => 'fake-test-token');
    const error = await client.request('/brief/extract', 'POST', { message: '80人' }).then(() => { throw new Error('expected rejection'); }, caught => caught);
    expect(error).toMatchObject({ code: 'UNAUTHENTICATED', status: 401, details: { private: 'do-not-surface' } });
  });

  it('does not treat a non-object JSON error as a missing status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 500, headers: { 'Content-Type': 'application/json' } }));
    const client = createSceneClient('https://example.test/scene-api', async () => 'fake-test-token');
    await expect(client.request('/brief/extract', 'POST', {})).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 500, details: null });
  });

  it('reports a non-JSON success body with the real status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not-json', { status: 200 }));
    const client = createSceneClient('https://example.test/scene-api', async () => 'fake-test-token');
    await expect(client.request('/brief/extract', 'POST', {})).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200, details: null });
  });

  it('does not invent a status when fetch itself fails', async () => {
    const failure = new TypeError('network down');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(failure);
    const client = createSceneClient('https://example.test/scene-api', async () => 'fake-test-token');
    await expect(client.request('/brief/extract', 'POST', {})).rejects.toBe(failure);
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
