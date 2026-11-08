import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { database, owner, outsider, scene, session, studio } from './fixtures.ts';

describe('agent steering guard readiness', () => {
  const open: Array<Awaited<ReturnType<typeof database>>> = [];
  afterEach(async () => { await Promise.all(open.splice(0).map(f => f.db.close())); });

  async function setup() {
    const f = await database(); open.push(f);
    const base = scene();
    const project = await f.rpc(owner, 'projects.create', { studioId: studio, name: 'Readiness fixture', scene: base });
    const lease = await f.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session });
    const body = { requestId: crypto.randomUUID(), sessionId: session, generation: lease.generation,
      expectedRevision: lease.revision, localRevision: 0, scene: base, selectedIds: [],
      instruction: '虚构活动，请生成预览', executionMode: 'preview' };
    const request = (token = owner) => new Request(`https://api.test/projects/${project.id}/agent-runs`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const model = vi.fn(async () => { throw new Error('模型不应被调用'); });
    const env = (key: string) => key === 'DEEPSEEK_API_KEY' ? 'fixture-only' : undefined;
    return { f, project, request, model, env };
  }

  it('reads the versioned capability without creating a run and enforces project membership', async () => {
    const { f, project } = await setup();
    expect(await f.backend.agentGuardReady!(owner, 'readiness', { projectId: project.id }))
      .toEqual({ capability: 'agent_steering_guard', version: 1 });
    await expect(f.backend.agentGuardReady!(outsider, 'readiness', { projectId: project.id }))
      .rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    const rows = await f.db.query<{ count: number }>('select count(*)::int as count from scene_private.agent_runs');
    expect(rows.rows[0]!.count).toBe(0);
  });

  it('returns 503 before creating a run or calling a model if the guard RPC is missing', async () => {
    const { f, project, request, model, env } = await setup();
    // This is a private, ephemeral PGlite fixture, not the user's database.
    await f.db.exec('drop function public.agent_steering_guard_rpc(uuid,text,jsonb)');
    const api = createApi(f.backend, env, model);
    const response = await api(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'AGENT_STEERING_GUARD_UNAVAILABLE' } });
    expect(model).not.toHaveBeenCalled();
    const runs = await f.db.query<{ count: number }>('select count(*)::int as count from scene_private.agent_runs where project_id=$1', [project.id]);
    const charges = await f.db.query<{ count: number }>('select count(*)::int as count from scene_private.text_daily_budgets');
    expect(runs.rows[0]!.count).toBe(0); expect(charges.rows[0]!.count).toBe(0);
  });

  it('rejects an older or malformed guard before creating a run', async () => {
    const { f, project, request, model, env } = await setup();
    const api = createApi({ ...f.backend, agentGuardReady: async () => ({ capability: 'agent_steering_guard', version: 0 }) }, env, model);
    const response = await api(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'AGENT_STEERING_GUARD_UNAVAILABLE' } });
    expect(model).not.toHaveBeenCalled();
    const rows = await f.db.query<{ count: number }>('select count(*)::int as count from scene_private.agent_runs where project_id=$1', [project.id]);
    expect(rows.rows[0]!.count).toBe(0);
  });

  it('preserves project authorization and never calls a model for an outsider', async () => {
    const { f, project, request, model, env } = await setup();
    const response = await createApi(f.backend, env, model)(request(outsider));
    expect(response.status).toBe(404);
    expect(model).not.toHaveBeenCalled();
    const rows = await f.db.query<{ count: number }>('select count(*)::int as count from scene_private.agent_runs where project_id=$1', [project.id]);
    expect(rows.rows[0]!.count).toBe(0);
  });
});
