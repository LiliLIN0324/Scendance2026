import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { database, owner, editor, outsider, studio, session, scene, chair } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { agentDispatchRunSchema, agentRunRequestSchema, agentRunSchema } from '../supabase/functions/_shared/agent-contract.ts';
import { activityTaskRunSchema } from '../supabase/functions/_shared/activity-task-contract.ts';
import { ApiError, canonical, sceneHash, sha256 } from '../supabase/functions/_shared/domain.ts';
import type { Rpc } from '../supabase/functions/_shared/backend.ts';
import type { Fetcher } from '../supabase/functions/_shared/http.ts';

const env = (key: string) => ({ DEEPSEEK_API_KEY: 'fixture', DEEPSEEK_AGENT_MODE: 'legacy', HY3_RETIRED: 'true' } as Record<string, string>)[key];
const opaqueId = 'chair/local-entrance';
const uuidId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const taskId = '40000000-0000-4000-8000-000000000001';
const context = (projectId = 'local-activity/fixture') => ({
  projectId, dataKind: 'rehearsal' as const, briefText: '演练：整理已披露的入场物件，提出可由人工确认的任务。',
  tasks: [{ id: taskId, title: '已有入场检查', phase: 'preparation' as const, acceptance: '核对两层物件',
    plannedStartAt: '2026-10-09T09:00:00+08:00', plannedEndAt: null, status: 'needs_review' as const, objectIds: [opaqueId] }],
  objects: [
    { id: opaqueId, name: '入场椅', type: 'chair', floorId: 'floor/local-1', floorName: '一层',
      size: { width: 0.5, depth: 0.5, height: 0.85 }, color: '#aabbcc', position: { x: 2, z: 3 }, rotation: 0, elevation: 0 },
    { id: uuidId, name: '二层待核对物件', type: 'custom', floorId: 'floor/local-2', floorName: '二层',
      size: { width: 0, depth: 0, height: 0 }, color: '#ffffff', position: null, rotation: null, elevation: null },
  ],
});
type ActivityInput = {
  projectId: string; kind: 'activity_tasks'; requestId: string; sessionId: string; generation: number;
  expectedRevision: number; instruction: string; activityContext: ReturnType<typeof context>;
};
const suggestion = (extra: Record<string, unknown> = {}) => ({
  title: '入场前核对所选物件', phase: 'setup', acceptance: '逐项人工核对披露物件，并记录后续需要确认的事项。',
  objectIds: [opaqueId, uuidId.toLowerCase()], ...extra,
});
const result = () => ({ suggestions: [suggestion()] });
const envelope = (value: unknown, finishReason = 'stop') => ({
  choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(value) } }], usage: { total_tokens: 10 },
});
const completion = (value: unknown = result()) => new Response(JSON.stringify(envelope(value)));

describe('bounded read-only activity task runs', () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { f = await database(); }, 30000);
  afterAll(async () => { await f.db.close(); });

  async function input(activityContext = context()): Promise<ActivityInput> {
    const project = await f.rpc(owner, 'projects.create', { studioId: studio, name: 'Activity test', scene: scene() });
    const lease = await f.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session });
    return { projectId: project.id, kind: 'activity_tasks', requestId: crypto.randomUUID(), sessionId: session,
      generation: lease.generation, expectedRevision: 0, instruction: '建议入场核对任务，等待人工选择', activityContext };
  }
  function send(api: ReturnType<typeof createApi>, i: ActivityInput, body?: unknown) {
    const { projectId, ...requestBody } = i;
    return api(new Request(`https://api.test/projects/${projectId}/agent-runs`, { method: 'POST',
      headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? requestBody) }));
  }
  function get(api: ReturnType<typeof createApi>, i: ActivityInput, id?: string, actor = owner, projectId = i.projectId) {
    return api(new Request(`https://api.test/projects/${projectId}/agent-runs/${id ?? `by-request/${i.requestId}`}`,
      { headers: { authorization: `Bearer ${actor}` } }));
  }
  async function read(response: Response) {
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBeLessThan(300);
    return activityTaskRunSchema.parse(body);
  }
  async function create(i: ActivityInput) {
    const { projectId, ...body } = i;
    return f.backend.agent!(owner, 'create', { projectId, input: body, fingerprint: await sha256(canonical(body)),
      baseHash: await sha256(canonical(body.activityContext)), executionMode: 'preview' });
  }
  async function snapshot(projectId: string) {
    const project = await f.rpc(owner, 'projects.get', { projectId });
    const counts = await f.db.query<{ assets: number; proposals: number; links: number }>(`select
      (select count(*)::integer from scene_private.assets) as assets,
      (select count(*)::integer from scene_private.proposals) as proposals,
      (select count(*)::integer from scene_private.agent_proposals) as links`);
    return { scene: project.scene, revision: project.revision, counts: counts.rows[0] };
  }
  async function rejectedOutput(value: unknown, code = 'AGENT_INVALID_ACTIVITY_RESPONSE') {
    const i = await input(), before = await snapshot(i.projectId);
    const fetcher = vi.fn<Fetcher>(async () => completion(value));
    const api = createApi(f.backend, env, fetcher), run = await read(await send(api, i));
    expect(run).toMatchObject({ state: 'failed', callCount: 1, activityResult: null, errorCode: code });
    expect(await snapshot(i.projectId)).toEqual(before);
    expect(await read(await get(api, i))).toEqual(run);
    expect(await read(await send(api, i))).toEqual(run);
    expect(fetcher).toHaveBeenCalledOnce();
  }

  it('creates an activity response without Scene candidate, evaluation or direct-apply fields', async () => {
    const i = await input(), before = await snapshot(i.projectId), stored = await create(i);
    expect(stored).toMatchObject({ kind: 'activity_tasks', projectId: i.projectId, activityId: i.activityContext.projectId,
      contextHash: await sha256(canonical(i.activityContext)), activityResult: null, state: 'queued', callCount: 0 });
    for (const field of ['candidates', 'evaluation', 'executionMode', 'jevEnabled']) expect(stored).not.toHaveProperty(field);
    expect(await snapshot(i.projectId)).toEqual(before);
    await f.backend.agent!(owner, 'cancel', { projectId: i.projectId, id: stored.id });
  });

  it.each(['local-activity/fixture', '50000000-0000-4000-8000-000000000001'])('sends only reviewed summary once and preserves reference spelling for local activity %s', async activityId => {
    const i = await input(context(activityId)), original = structuredClone(i.activityContext), before = await snapshot(i.projectId);
    const requests: { messages: { role: string; content: string }[]; [key: string]: unknown }[] = [];
    const fetcher = vi.fn<Fetcher>(async (url, init) => {
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
      requests.push(JSON.parse(String(init?.body)));
      return completion();
    });
    const api = createApi(f.backend, env, fetcher), response = await send(api, i);
    expect(response.status).toBe(202);
    const raw = await response.json(), run = activityTaskRunSchema.parse(raw);
    expect(agentRunSchema.safeParse(raw).success).toBe(false);
    expect(agentDispatchRunSchema.safeParse(raw).success).toBe(true);
    expect(agentDispatchRunSchema.safeParse({ ...raw, candidates: [], evaluation: null, executionMode: 'direct', jevEnabled: true }).success).toBe(false);
    expect(run).toMatchObject({ kind: 'activity_tasks', state: 'complete', callCount: 1, activityId, projectId: i.projectId,
      contextHash: await sha256(canonical(original)), activityResult: { suggestions: [{ ...suggestion(), objectIds: [opaqueId, uuidId] }] } });
    expect(run.projectId).not.toBe(run.activityId);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ response_format: { type: 'json_object' }, max_tokens: 7000, thinking: { type: 'disabled' } });
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]).not.toHaveProperty('tool_choice');
    expect(requests[0].messages.map((message: { role: string }) => message.role)).toEqual(['system', 'user']);
    expect(JSON.parse(requests[0].messages[1].content)).toEqual({ instruction: i.instruction, activityContext: original });
    const disclosed = JSON.parse(requests[0].messages[1].content);
    for (const field of ['scene', 'catalog', 'resources', 'images', 'fingerprint', 'sessionId', 'generation', 'expectedRevision', 'apiKey']) {
      expect(disclosed).not.toHaveProperty(field);
    }
    for (const field of ['candidates', 'evaluation', 'executionMode', 'jevEnabled']) expect(raw).not.toHaveProperty(field);
    expect(i.activityContext).toEqual(original);
    expect(await snapshot(i.projectId)).toEqual(before);
    expect(await read(await get(api, i, run.id))).toEqual(run);
    expect(await read(await get(api, i))).toEqual(run);
    expect((await send(api, i)).status).toBe(200);
    expect(await read(await send(api, i))).toEqual(run);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects Scene, cached conversation and local bookkeeping fields before creating or calling a model', async () => {
    const i = await input(), { projectId: _remoteProjectId, ...body } = i;
    const fetcher = vi.fn<Fetcher>(async () => completion()), api = createApi(f.backend, env, fetcher);
    const extras = [
      { scene: scene() }, { localRevision: 0 }, { selectedIds: [] }, { jevEnabled: true }, { executionMode: 'direct' },
      { context: { brief: '隐藏缓存' } }, { fingerprint: 'sha256:' + 'a'.repeat(64) }, { DEEPSEEK_API_KEY: 'leaked' },
    ];
    for (const extra of extras) {
      const response = await send(api, i, { ...body, ...extra });
      expect(response.status).toBe(400);
    }
    const nested = await send(api, i, { ...body, activityContext: { ...body.activityContext, evidence: '未经披露的核对记录' } });
    expect(nested.status).toBe(400);
    expect((await get(api, i)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['id', crypto.randomUUID()], ['ownerName', '未经确认的负责人'], ['status', 'accepted'],
    ['plannedStartAt', '2026-10-09T09:00:00+08:00'], ['evidenceNote', '声称已现场核对'], ['amount', 100],
  ])('rejects an entire batch when a suggestion adds forbidden %s', async (field, value) => {
    await rejectedOutput({ suggestions: [suggestion({ title: '有效前项' }), suggestion({ [field]: value })] });
  });

  it.each([
    ['unsupported phase', { phase: 'construction' }], ['blank title', { title: '  ' }], ['blank acceptance', { acceptance: '  ' }],
    ['duplicate opaque references', { objectIds: [opaqueId, opaqueId] }],
    ['duplicate UUID casing aliases', { objectIds: [uuidId, uuidId.toLowerCase()] }],
    ['undisclosed references', { objectIds: ['undisclosed/object'] }],
  ])('rejects an entire batch with %s without a repair call', async (_label, invalid) => {
    await rejectedOutput({ suggestions: [suggestion({ title: '有效前项' }), suggestion(invalid)] });
  });

  it('rejects duplicate suggestion rows after UUID aliases and reference order are normalized', async () => {
    await rejectedOutput({ suggestions: [suggestion(), suggestion({ objectIds: [uuidId, opaqueId] })] });
  });
  it('rejects an output envelope containing fields beyond suggestions', async () => {
    await rejectedOutput({ ...result(), explanation: '模型额外的说明' });
  });
  it('rejects more than 500 suggestions as one batch', async () => {
    await rejectedOutput({ suggestions: Array.from({ length: 501 }, (_, index) => suggestion({ title: `核对 ${index}`, objectIds: [] })) });
  });

  it.each([
    ['malformed choices', { choices: [] }, 'AGENT_INVALID_MODEL_RESPONSE'],
    ['truncated output', envelope(result(), 'length'), 'AGENT_OUTPUT_TRUNCATED'],
    ['unexpected tool calls', { choices: [{ finish_reason: 'tool_calls', message: { content: JSON.stringify(result()), tool_calls: [
      { id: 'model/write-1', type: 'function', function: { name: 'create_parametric_model', arguments: '{"parameters":{"family":"table","width":1,"depth":1,"height":1}}' } },
    ] } }] }, 'AGENT_INVALID_ACTIVITY_RESPONSE'],
    ['missing JSON content', { choices: [{ finish_reason: 'stop', message: { content: null } }] }, 'AGENT_INVALID_ACTIVITY_RESPONSE'],
  ])('fails %s with one provider call and no effects', async (_label, reply, code) => {
    const i = await input(), before = await snapshot(i.projectId);
    const fetcher = vi.fn<Fetcher>(async () => new Response(JSON.stringify(reply)));
    const run = await read(await send(createApi(f.backend, env, fetcher), i));
    expect(run).toMatchObject({ state: 'failed', callCount: 1, activityResult: null, errorCode: code });
    expect(await snapshot(i.projectId)).toEqual(before);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['network failure', 'AGENT_FAILED'], ['HTTP 503', 'PROVIDER_HTTP_ERROR'],
  ])('does not retry %s or buy another call when the original run is recovered', async (failure, code) => {
    const i = await input(), before = await snapshot(i.projectId);
    const fetcher = vi.fn<Fetcher>(async () => {
      if (failure === 'network failure') throw new TypeError('fixture provider connection lost');
      return new Response('{}', { status: 503 });
    });
    const api = createApi(f.backend, env, fetcher), run = await read(await send(api, i));
    expect(run).toMatchObject({ state: 'failed', callCount: 1, errorCode: code, activityResult: null });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await read(await get(api, i, run.id))).toEqual(run);
    expect(await read(await get(api, i))).toEqual(run);
    const replay = await send(api, i);
    expect(replay.status).toBe(200);
    expect(await read(replay)).toEqual(run);
    expect(await snapshot(i.projectId)).toEqual(before);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns a separate queued activity response for background execution and recovers its completed request', async () => {
    const i = await input(), before = await snapshot(i.projectId), tasks: Promise<unknown>[] = [];
    const fetcher = vi.fn<Fetcher>(async () => completion());
    const api = createApi(f.backend, env, fetcher, task => tasks.push(task));
    const response = await send(api, i);
    expect(response.status).toBe(202);
    const raw = await response.json(), queued = activityTaskRunSchema.parse(raw);
    expect(queued).toMatchObject({ kind: 'activity_tasks', state: 'queued', callCount: 0, activityResult: null,
      projectId: i.projectId, activityId: i.activityContext.projectId, requestId: i.requestId });
    for (const field of ['candidates', 'evaluation', 'executionMode', 'jevEnabled']) expect(raw).not.toHaveProperty(field);
    expect(agentRunSchema.safeParse(raw).success).toBe(false);
    expect(agentDispatchRunSchema.safeParse(raw).success).toBe(true);
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    const completed = await read(await get(api, i));
    expect(completed).toMatchObject({ id: queued.id, requestId: queued.requestId, kind: 'activity_tasks', state: 'complete',
      callCount: 1, activityResult: { suggestions: [{ ...suggestion(), objectIds: [opaqueId, uuidId] }] } });
    expect(await read(await get(api, i, queued.id))).toEqual(completed);
    expect(await snapshot(i.projectId)).toEqual(before);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('recovers an unknown POST outcome from its original request after the handler committed', async () => {
    const i = await input(), fetcher = vi.fn<Fetcher>(async () => completion()), api = createApi(f.backend, env, fetcher);
    let committedId: string | undefined;
    const droppedPost = async () => {
      committedId = (await read(await send(api, i))).id;
      throw new Error('fixture outer response lost after handler completed');
    };
    await expect(droppedPost()).rejects.toThrow('fixture outer response lost');
    const recovered = await read(await get(api, i)), replay = await read(await send(api, i));
    expect(recovered).toMatchObject({ id: committedId, requestId: i.requestId, state: 'complete', callCount: 1 });
    expect(replay).toEqual(recovered);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['before-commit', 'after-commit'] as const)('preserves the atomic result when finish response fails %s', async failure => {
    const i = await input(), before = await snapshot(i.projectId);
    let finishCalls = 0;
    const agentRpc = vi.fn<Rpc>(async (actor, action, data) => {
      if (action === 'finish' && ++finishCalls === 1) {
        if (failure === 'after-commit') await f.backend.agent!(actor, action, data);
        throw new ApiError('DATABASE_ERROR', 500);
      }
      return f.backend.agent!(actor, action, data);
    });
    const fetcher = vi.fn<Fetcher>(async () => completion()), api = createApi({ ...f.backend, agent: agentRpc }, env, fetcher);
    const run = await read(await send(api, i));
    expect(run).toMatchObject({ state: failure === 'before-commit' ? 'failed' : 'complete', callCount: 1 });
    if (failure === 'before-commit') expect(run).toMatchObject({ errorCode: 'DATABASE_ERROR', activityResult: null });
    else expect(run.activityResult).toEqual({ suggestions: [{ ...suggestion(), objectIds: [opaqueId, uuidId] }] });
    expect(finishCalls).toBe(1);
    expect(await read(await get(api, i))).toEqual(run);
    expect(await read(await send(api, i))).toEqual(run);
    expect(await snapshot(i.projectId)).toEqual(before);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('cancellation during the fetch prevents result storage and does not run any Scene tool', async () => {
    const i = await input(), before = await snapshot(i.projectId);
    const fetcher = vi.fn<Fetcher>(async () => {
      const stored = await f.backend.agent!(owner, 'by_request', { projectId: i.projectId, requestId: i.requestId });
      await f.backend.agent!(owner, 'cancel', { projectId: i.projectId, id: stored.id });
      return completion();
    });
    const api = createApi(f.backend, env, fetcher), run = await read(await send(api, i));
    expect(run).toMatchObject({ state: 'cancelled', callCount: 1, activityResult: null });
    expect(await read(await send(api, i))).toEqual(run);
    expect(await snapshot(i.projectId)).toEqual(before);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('expiry during the fetch becomes terminal with no retained result or restart', async () => {
    const i = await input(), fetcher = vi.fn<Fetcher>(async () => {
      await f.db.query("update scene_private.agent_runs set deadline=clock_timestamp()-interval '1 second' where owner_id=$1 and project_id=$2 and request_key=$3", [owner, i.projectId, i.requestId]);
      return completion();
    });
    const api = createApi(f.backend, env, fetcher), run = await read(await send(api, i));
    expect(run).toMatchObject({ state: 'failed', errorCode: 'AGENT_DEADLINE', activityResult: null });
    expect(await f.backend.agent!(owner, 'start', { projectId: i.projectId, id: run.id })).toEqual({ claimed: false });
    expect(await read(await send(api, i))).toEqual(run);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['lease', 'revision'] as const)('fences a valid late result after %s changes', async guard => {
    const i = await input(), changed = { ...scene(), objects: [chair()] };
    const fetcher = vi.fn<Fetcher>(async () => {
      if (guard === 'lease') await f.rpc(owner, 'lease.release', i);
      else await f.rpc(owner, 'scene.save', { ...i, scene: changed });
      return completion();
    });
    const api = createApi(f.backend, env, fetcher), run = await read(await send(api, i));
    expect(run).toMatchObject({ state: 'failed', errorCode: guard === 'lease' ? 'LEASE_LOST' : 'REVISION_CONFLICT', activityResult: null });
    expect((await f.rpc(owner, 'projects.get', { projectId: i.projectId })).scene).toEqual(guard === 'lease' ? scene() : changed);
    expect(await read(await send(api, i))).toEqual(run);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('hides the run from another actor and from another remote project', async () => {
    const i = await input(), fetcher = vi.fn<Fetcher>(async () => completion()), api = createApi(f.backend, env, fetcher);
    const run = await read(await send(api, i)), other = await input();
    for (const actor of [editor, outsider]) {
      expect((await get(api, i, run.id, actor)).status).toBe(404);
      expect((await get(api, i, undefined, actor)).status).toBe(404);
    }
    expect((await get(api, i, run.id, owner, other.projectId)).status).toBe(404);
    expect((await get(api, i, undefined, owner, other.projectId)).status).toBe(404);
    expect(await read(await get(api, i))).toEqual(run);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('fences wrong claims, repeated starts and a second model step', async () => {
    const i = await input(), stored = await create(i), start = await f.backend.agent!(owner, 'start', { projectId: i.projectId, id: stored.id });
    const active = { projectId: i.projectId, id: stored.id, claim: start.claim };
    expect(start.claimed).toBe(true);
    expect(await f.backend.agent!(owner, 'start', active)).toEqual({ claimed: false });
    await expect(f.backend.agent!(owner, 'finish', { ...active, claim: crypto.randomUUID(), activityResult: result() })).rejects.toThrow('AGENT_RUN_STOPPED');
    await f.backend.agent!(owner, 'step', { ...active, progress: '固定测试调用' });
    await expect(f.backend.agent!(owner, 'step', active)).rejects.toThrow('AGENT_CALL_LIMIT');
    const run = activityTaskRunSchema.parse(await f.backend.agent!(owner, 'get', active));
    expect(run).toMatchObject({ state: 'running', callCount: 1, activityResult: null });
    await f.backend.agent!(owner, 'cancel', active);
  });
  it('rejects the same request identity with changed activity disclosure', async () => {
    const i = await input(), fetcher = vi.fn<Fetcher>(async () => completion()), api = createApi(f.backend, env, fetcher);
    const run = await read(await send(api, i)), changed = { ...i, activityContext: { ...i.activityContext, briefText: '披露需求已变' } };
    const response = await send(api, changed);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(await read(await get(api, i))).toEqual(run);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects Scene checkpoints and invalid final results, then stores result and complete together', async () => {
    const i = await input(), before = await snapshot(i.projectId), stored = await create(i);
    const start = await f.backend.agent!(owner, 'start', { projectId: i.projectId, id: stored.id });
    const active = { projectId: i.projectId, id: stored.id, claim: start.claim };
    await expect(f.backend.agent!(owner, 'checkpoint', { ...active, candidates: [{ label: 'A', title: '不应写入', scene: scene(), explanation: '不应生成 Scene proposal', warnings: [] }] })).rejects.toThrow();
    await expect(f.backend.agent!(owner, 'finish', { ...active, activityResult: null })).rejects.toThrow('INVALID_ACTIVITY_RESULT');
    expect(await f.backend.agent!(owner, 'get', active)).toMatchObject({ state: 'running', activityResult: null });
    expect(await snapshot(i.projectId)).toEqual(before);
    const valid = { suggestions: [suggestion({ objectIds: [opaqueId, uuidId] })] };
    const finished = activityTaskRunSchema.parse(await f.backend.agent!(owner, 'finish', { ...active, activityResult: valid }));
    expect(finished).toMatchObject({ state: 'complete', activityResult: valid });
    await expect(f.backend.agent!(owner, 'fail', { ...active, errorCode: 'DATABASE_ERROR' })).rejects.toThrow('AGENT_RUN_STOPPED');
    expect(await f.backend.agent!(owner, 'get', active)).toEqual(finished);
    expect(await snapshot(i.projectId)).toEqual(before);
  });
  it('replays an original no-kind Scene run using its original normalized fingerprint and response', async () => {
    const i = await input();
    const oldBody = { requestId: crypto.randomUUID(), sessionId: session, generation: i.generation, expectedRevision: 0,
      localRevision: 0, scene: scene(), selectedIds: [], instruction: '先预览旧 Scene 方案' };
    const normalized = agentRunRequestSchema.parse(oldBody);
    const stored = await f.backend.agent!(owner, 'create', { projectId: i.projectId, input: normalized,
      fingerprint: await sha256(canonical(normalized)), baseHash: await sceneHash(normalized.scene), executionMode: 'preview' });
    const start = await f.backend.agent!(owner, 'start', { projectId: i.projectId, id: stored.id });
    const finished = agentRunSchema.parse(await f.backend.agent!(owner, 'finish', { projectId: i.projectId, id: stored.id,
      claim: start.claim, candidates: [], evaluation: null }));
    const fetcher = vi.fn<Fetcher>(async () => { throw new Error('Scene replay must not call provider'); });
    const response = await send(createApi(f.backend, env, fetcher), i, oldBody);
    expect(response.status).toBe(200);
    const raw = await response.json();
    expect(agentRunSchema.parse(raw)).toEqual(finished);
    expect(raw.id).toBe(stored.id);
    expect(raw).toHaveProperty('candidates');
    expect(raw).toHaveProperty('evaluation');
    expect(raw).not.toHaveProperty('activityResult');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
