import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSceneClient, SceneApiError } from '../client/scene-client.ts';
import {
  activityTaskRunRequestSchema, type ActivityTaskContext, type ActivityTaskRun, type ActivityTaskRunRequest,
} from '../supabase/functions/_shared/activity-task-contract.ts';
import { canonical, sha256 } from '../supabase/functions/_shared/domain.ts';

const baseUrl = 'https://example.test/scene-api';
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function context(): ActivityTaskContext {
  return {
    projectId: 'activity/transport-fixture', dataKind: 'rehearsal', briefText: 'Synthetic reviewed disclosure.',
    tasks: [{
      id: '11111111-1111-4111-8111-111111111111', title: 'Existing task', phase: 'preparation',
      acceptance: 'Review the disclosed chair.', plannedStartAt: null, plannedEndAt: null,
      status: 'needs_review', objectIds: ['chair/local-1'],
    }],
    objects: [{
      id: 'chair/local-1', name: 'Synthetic chair', type: 'chair', floorId: 'floor/local-1', floorName: 'Synthetic floor',
      size: { width: 0.5, depth: 0.5, height: 0.8 }, color: '#aabbcc',
      position: { x: 2, z: 3 }, rotation: 0, elevation: 0,
    }],
  };
}
function input(): ActivityTaskRunRequest {
  return {
    kind: 'activity_tasks', requestId, sessionId, generation: 2, expectedRevision: 3,
    instruction: 'Suggest reviewed local tasks.', activityContext: context(),
  };
}
async function queued(request = input()): Promise<ActivityTaskRun> {
  const parsed = activityTaskRunRequestSchema.parse(request);
  return {
    kind: 'activity_tasks', id: runId, projectId, requestId: parsed.requestId, state: 'queued', progress: 'queued',
    callCount: 0, activityId: parsed.activityContext.projectId,
    contextHash: await sha256(canonical(parsed.activityContext)), activityResult: null,
    expiresAt: '2026-10-10T12:00:00.000Z',
  };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
async function invalidResponse(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(SceneApiError);
  await expect(promise).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
}

describe('activity task client transport boundary', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('posts a normalized reviewed summary and accepts a queued 202 without Scene fields', async () => {
    const request = input();
    request.instruction = '  Suggest reviewed local tasks.  ';
    request.activityContext.tasks[0].title = '  Existing task  ';
    request.activityContext.tasks[0].acceptance = '  Review the disclosed chair.  ';
    const original = structuredClone(request), parsed = activityTaskRunRequestSchema.parse(request), run = await queued(request);
    const token = vi.fn(async () => 'fake-test-token');
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(run, 202));
    const client = createSceneClient(`${baseUrl}/`, token);

    await expect(client.startActivityTaskRun(projectId, request)).resolves.toEqual(run);
    expect(network).toHaveBeenCalledOnce();
    expect(token).toHaveBeenCalledOnce();
    const [url, options] = network.mock.calls[0];
    expect(url).toBe(`${baseUrl}/projects/${projectId}/agent-runs`);
    expect(options).toMatchObject({
      method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Bearer fake-test-token', 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(options?.body))).toEqual(parsed);
    expect(request).toEqual(original);
    expect(run.contextHash).toBe(await sha256(canonical(parsed.activityContext)));
    expect(Object.keys(parsed)).toEqual(['kind', 'sessionId', 'generation', 'expectedRevision', 'requestId', 'instruction', 'activityContext']);
    for (const field of ['scene', 'localRevision', 'selectedIds', 'context', 'fingerprint', 'executionMode', 'jevEnabled']) {
      expect(JSON.parse(String(options?.body))).not.toHaveProperty(field);
    }
    for (const field of ['candidates', 'evaluation', 'candidate', 'executionMode', 'jevEnabled']) expect(run).not.toHaveProperty(field);
  });

  it('compares remote project and request UUIDs without case sensitivity on start', async () => {
    const run = await queued();
    const returned = { ...run, projectId: projectId.toUpperCase(), requestId: requestId.toUpperCase() };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(returned, 202));
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    await expect(client.startActivityTaskRun(projectId, input())).resolves.toEqual(returned);
  });

  it('gets the requested run once with authorization, no-store and UUID case aliases', async () => {
    const returned = { ...await queued(), id: runId.toUpperCase(), projectId: projectId.toUpperCase() };
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(returned));
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    await expect(client.getActivityTaskRun(projectId, runId)).resolves.toEqual(returned);
    expect(network).toHaveBeenCalledExactlyOnceWith(`${baseUrl}/projects/${projectId}/agent-runs/${runId}`, {
      method: 'GET', headers: { Authorization: 'Bearer fake-test-token' }, cache: 'no-store',
    });
  });

  it('recovers the requested request UUID using the dedicated GET path', async () => {
    const returned = { ...await queued(), projectId: projectId.toUpperCase(), requestId: requestId.toUpperCase() };
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(returned));
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    await expect(client.getActivityTaskRunByRequest(projectId, requestId)).resolves.toEqual(returned);
    expect(network).toHaveBeenCalledExactlyOnceWith(`${baseUrl}/projects/${projectId}/agent-runs/by-request/${requestId}`, {
      method: 'GET', headers: { Authorization: 'Bearer fake-test-token' }, cache: 'no-store',
    });
  });

  it('cancels only the given run with a bodyless POST and accepts its cancelled response', async () => {
    const returned = { ...await queued(), id: runId.toUpperCase(), projectId: projectId.toUpperCase(), state: 'cancelled' as const };
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(returned));
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    await expect(client.cancelActivityTaskRun(projectId, runId)).resolves.toEqual(returned);
    expect(network).toHaveBeenCalledExactlyOnceWith(`${baseUrl}/projects/${projectId}/agent-runs/${runId}/cancel`, {
      method: 'POST', headers: { Authorization: 'Bearer fake-test-token' }, cache: 'no-store',
    });
    expect(network.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('parses a complete task result with contract normalization and defaults', async () => {
    const run = await queued();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...run, state: 'complete', callCount: 1,
      activityResult: { suggestions: [{ title: '  Review chair  ', phase: 'setup', acceptance: '  Confirm manually.  ' }] },
    }));
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    await expect(client.getActivityTaskRun(projectId, runId)).resolves.toMatchObject({
      state: 'complete', callCount: 1, activityResult: {
        suggestions: [{ title: 'Review chair', phase: 'setup', acceptance: 'Confirm manually.', objectIds: [] }],
      },
    });
  });

  it('rejects old Scene DTOs and hybrid task responses instead of coercing them', async () => {
    const run = await queued();
    const oldSceneRun = {
      id: runId, projectId, requestId, state: 'queued', progress: 'queued', callCount: 0,
      candidates: [], evaluation: null, executionMode: 'preview', jevEnabled: false, expiresAt: run.expiresAt,
    };
    const network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    for (const value of [oldSceneRun, { ...run, candidates: [], evaluation: null, executionMode: 'direct', jevEnabled: true }]) {
      network.mockResolvedValueOnce(response(value));
      await invalidResponse(client.getActivityTaskRun(projectId, runId));
    }
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('rejects damaged envelopes, invalid counts and inconsistent result states as fixed response errors', async () => {
    const run = await queued(), { contextHash: _hash, ...missingHash } = run;
    const result = { suggestions: [{ title: 'Review chair', phase: 'setup', acceptance: 'Confirm manually.', objectIds: [] }] };
    const damaged = [
      missingHash, { ...run, kind: 'scene' }, { ...run, contextHash: 'bad-hash' },
      { ...run, callCount: -1 }, { ...run, callCount: 2 }, { ...run, callCount: 0.5 },
      { ...run, state: 'complete' }, { ...run, state: 'running', activityResult: result },
      { ...run, state: 'complete', activityResult: { suggestions: [] } },
      { ...run, state: 'complete', activityResult: { suggestions: [{ ...result.suggestions[0], ownerName: 'Unexpected owner' }] } },
    ];
    const network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    for (const value of damaged) {
      network.mockResolvedValueOnce(response(value));
      await invalidResponse(client.getActivityTaskRun(projectId, runId));
    }
    expect(network).toHaveBeenCalledTimes(damaged.length);
  });

  it('binds start responses to the project, request, local activity and parsed summary hash', async () => {
    const request = input(), run = await queued(request);
    const wrongScope = [
      { ...run, projectId: otherId }, { ...run, requestId: otherId },
      { ...run, activityId: 'activity/another-fixture' }, { ...run, contextHash: '0'.repeat(64) },
    ];
    const network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    for (const value of wrongScope) {
      network.mockResolvedValueOnce(response(value, 202));
      await invalidResponse(client.startActivityTaskRun(projectId, request));
    }
    expect(network).toHaveBeenCalledTimes(wrongScope.length);
  });

  it('preserves exact local activity identity even when it happens to be UUID-shaped', async () => {
    const request = input();
    request.activityContext.projectId = otherId.toUpperCase();
    const run = await queued(request);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...run, activityId: otherId }, 202));
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    await invalidResponse(client.startActivityTaskRun(projectId, request));
  });

  it('rejects get responses from another project or run', async () => {
    const run = await queued(), network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    for (const value of [{ ...run, projectId: otherId }, { ...run, id: otherId }]) {
      network.mockResolvedValueOnce(response(value));
      await invalidResponse(client.getActivityTaskRun(projectId, runId));
    }
  });

  it('rejects recovery responses from another project or request', async () => {
    const run = await queued(), network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    for (const value of [{ ...run, projectId: otherId }, { ...run, requestId: otherId }]) {
      network.mockResolvedValueOnce(response(value));
      await invalidResponse(client.getActivityTaskRunByRequest(projectId, requestId));
    }
  });

  it('rejects cancellation responses with another scope or a non-cancelled state', async () => {
    const cancelled = { ...await queued(), state: 'cancelled' as const }, network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    for (const value of [{ ...cancelled, projectId: otherId }, { ...cancelled, id: otherId }, { ...cancelled, state: 'queued' }]) {
      network.mockResolvedValueOnce(response(value));
      await invalidResponse(client.cancelActivityTaskRun(projectId, runId));
    }
    expect(network).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid task requests before requesting a token or fetching', async () => {
    const request = input(), token = vi.fn(async () => 'fake-test-token');
    const network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, token);
    const invalid = [
      { ...request, instruction: '   ' }, { ...request, scene: {} },
      { ...request, activityContext: { ...request.activityContext, projectId: 'local' } },
      { ...request, activityContext: { ...request.activityContext, tasks: [{ ...request.activityContext.tasks[0], objectIds: ['undisclosed/object'] }] } },
    ];
    for (const value of invalid) await expect(client.startActivityTaskRun(projectId, value as ActivityTaskRunRequest)).rejects.toThrow();
    expect(token).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('rejects invalid remote project, run and request UUIDs before authorization', async () => {
    const token = vi.fn(async () => 'fake-test-token'), network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, token);
    const invalidCalls = [
      () => client.startActivityTaskRun('not-a-project-uuid', input()),
      () => client.getActivityTaskRun('not-a-project-uuid', runId),
      () => client.getActivityTaskRun(projectId, 'not-a-run-uuid'),
      () => client.getActivityTaskRunByRequest('not-a-project-uuid', requestId),
      () => client.getActivityTaskRunByRequest(projectId, 'not-a-request-uuid'),
      () => client.cancelActivityTaskRun('not-a-project-uuid', runId),
      () => client.cancelActivityTaskRun(projectId, 'not-a-run-uuid'),
    ];
    for (const call of invalidCalls) await expect(call()).rejects.toThrow();
    expect(token).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('preserves 404 and 403 error codes, statuses and details from the existing request path', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    network.mockResolvedValueOnce(response({ error: { code: 'AGENT_RUN_NOT_FOUND', details: { requestId } } }, 404));
    const missing = client.getActivityTaskRunByRequest(projectId, requestId);
    await expect(missing).rejects.toBeInstanceOf(SceneApiError);
    await expect(missing).rejects.toMatchObject({ code: 'AGENT_RUN_NOT_FOUND', status: 404, details: { requestId } });
    network.mockResolvedValueOnce(response({ error: { code: 'FORBIDDEN', details: { reason: 'synthetic permission' } } }, 403));
    const forbidden = client.startActivityTaskRun(projectId, input());
    await expect(forbidden).rejects.toBeInstanceOf(SceneApiError);
    await expect(forbidden).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, details: { reason: 'synthetic permission' } });
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('requires a token for all four activity operations without fetching when absent', async () => {
    const token = vi.fn(async () => null), network = vi.spyOn(globalThis, 'fetch');
    const client = createSceneClient(baseUrl, token);
    const calls = [
      () => client.startActivityTaskRun(projectId, input()), () => client.getActivityTaskRun(projectId, runId),
      () => client.getActivityTaskRunByRequest(projectId, requestId), () => client.cancelActivityTaskRun(projectId, runId),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(token).toHaveBeenCalledTimes(4);
    expect(network).not.toHaveBeenCalled();
  });

  it('leaves an unknown network POST outcome to one explicit recovery GET with the original requestId', async () => {
    const request = input(), run = await queued(request), connectionLost = new TypeError('Synthetic response lost after commit');
    const mintRequestId = vi.spyOn(crypto, 'randomUUID');
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(connectionLost).mockResolvedValueOnce(response(run));
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    await expect(client.startActivityTaskRun(projectId, request)).rejects.toBe(connectionLost);
    expect(network).toHaveBeenCalledOnce();
    expect(request.requestId).toBe(requestId);
    await expect(client.getActivityTaskRunByRequest(projectId, request.requestId)).resolves.toEqual(run);
    expect(network).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).requestId).toBe(requestId);
    expect(network.mock.calls[1][0]).toBe(`${baseUrl}/projects/${projectId}/agent-runs/by-request/${requestId}`);
    expect(network.mock.calls[1][1]?.method).toBe('GET');
    expect(mintRequestId).not.toHaveBeenCalled();
  });

  it('does not repost or mint a new identity after a successful POST contains malformed JSON', async () => {
    const request = input(), run = await queued(request), mintRequestId = vi.spyOn(crypto, 'randomUUID');
    const network = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('not-json', { status: 202 }))
      .mockResolvedValueOnce(response(run));
    const client = createSceneClient(baseUrl, async () => 'fake-test-token');
    await expect(client.startActivityTaskRun(projectId, request)).rejects.toThrow();
    expect(network).toHaveBeenCalledOnce();
    await expect(client.getActivityTaskRunByRequest(projectId, requestId)).resolves.toEqual(run);
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls.map(([, options]) => options?.method)).toEqual(['POST', 'GET']);
    expect(network.mock.calls[1][0]).toBe(`${baseUrl}/projects/${projectId}/agent-runs/by-request/${requestId}`);
    expect(mintRequestId).not.toHaveBeenCalled();
    expect(request.requestId).toBe(requestId);
  });

  it('retains generic response passthrough, private authorization and public share behavior', async () => {
    const genericReply = { synthetic: true, extra: { retained: true } }, shareReply = { shared: 'synthetic' };
    const token = vi.fn(async () => 'fake-test-token');
    const network = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(genericReply)).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response(shareReply));
    const client = createSceneClient(baseUrl, token);
    await expect(client.request('/synthetic-private', 'POST', { retained: true })).resolves.toEqual(genericReply);
    await expect(client.listSources(projectId)).resolves.toEqual([]);
    await expect(client.readShare('fake-test-share-token')).resolves.toEqual(shareReply);
    expect(token).toHaveBeenCalledTimes(2);
    expect(network.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer fake-test-token' }, cache: 'no-store' });
    expect(network.mock.calls[1][0]).toBe(`${baseUrl}/projects/${projectId}/sources`);
    expect(network.mock.calls[2]).toEqual([`${baseUrl}/share/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"fake-test-share-token"}', cache: 'no-store',
    }]);
  });
});
