import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, owner, studio, session, scene } from './fixtures.ts';
import { agentRunRequestSchema } from '../supabase/functions/_shared/agent-contract.ts';
import { canonical, sceneHash, sha256 } from '../supabase/functions/_shared/domain.ts';

const emptyPlan = {
  schemaVersion: 1 as const,
  boundary: [] as never[],
  zones: [] as never[],
  facilities: [] as never[],
  routes: [] as never[],
  nodes: [] as never[],
  workers: [] as never[],
};

const planCandidate = (facilityId: string) => ({
  kind: 'plan' as const,
  title: '户外方案',
  explanation: '示意方案，现场待核验。',
  plan: { ...emptyPlan, facilities: [{ id: facilityId, name: '摊位', zoneId: null, templateId: 'booth-2x2', position: { x: 1, z: 1 }, width: 2, depth: 2, rotation: 0, color: '#ffffff', notes: '待核验' }] },
  anchor: null,
  added: { zoneIds: [], facilityIds: [facilityId], routeIds: [], nodeIds: [], workerIds: [] },
  warnings: [],
  notice: '户外平面草稿为待核验快照；读取不代表已用于排布、容量核定或通过安全检查。',
});

describe('planCandidate 持久化透传', () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { f = await database(); }, 30000);
  afterAll(async () => { await f.db.close(); });

  async function createRun() {
    const base = scene();
    const project = await f.rpc(owner, 'projects.create', { studioId: studio, name: '户外候选持久化', scene: base });
    const lease = await f.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session });
    const input = agentRunRequestSchema.parse({
      requestId: crypto.randomUUID(), sessionId: session,
      generation: lease.generation, expectedRevision: 0, localRevision: 0,
      scene: base, selectedIds: [], instruction: '规划户外摊位', executionMode: 'preview',
    });
    const run = await f.backend.agent!(owner, 'create', {
      projectId: project.id, input, fingerprint: await sha256(canonical(input)),
      baseHash: await sceneHash(base), executionMode: 'preview',
    });
    const started = await f.backend.agent!(owner, 'start', { projectId: project.id, id: run.id });
    return { projectId: project.id, runId: run.id, claim: started.claim as string };
  }

  it('finish 提交的 planCandidate 落库并经 agent_view 透出，候选为零的户外跑也能 complete', async () => {
    const ctx = await createRun();
    const candidate = planCandidate(crypto.randomUUID());
    const finished = await f.backend.agent!(owner, 'finish', {
      projectId: ctx.projectId, id: ctx.runId, claim: ctx.claim, steerTotal: 0,
      candidates: [], planCandidates: [candidate],
    });
    expect(finished.state).toBe('complete');
    expect(finished.candidates).toEqual([]);
    expect(finished.planCandidates).toHaveLength(1);
    expect(finished.planCandidates[0]).toMatchObject({ kind: 'plan', title: '户外方案' });
    expect(finished.planCandidates[0].added.facilityIds).toEqual(candidate.added.facilityIds);

    const reread = await f.backend.agent!(owner, 'by_request', { projectId: ctx.projectId, requestId: finished.requestId });
    expect(reread.planCandidates).toHaveLength(1);
    expect(reread.planCandidates[0].kind).toBe('plan');
  });

  it('checkpoint 暂存 planCandidate 且保持 running；缺省字段不覆盖既有候选', async () => {
    const ctx = await createRun();
    const first = planCandidate(crypto.randomUUID());
    const check = await f.backend.agent!(owner, 'checkpoint', {
      projectId: ctx.projectId, id: ctx.runId, claim: ctx.claim, steerTotal: 0,
      candidates: [], planCandidates: [first],
    });
    expect(check.state).toBe('running');
    expect(check.planCandidates).toHaveLength(1);

    const second = planCandidate(crypto.randomUUID());
    const finished = await f.backend.agent!(owner, 'finish', {
      projectId: ctx.projectId, id: ctx.runId, claim: ctx.claim, steerTotal: 0,
      planCandidates: [second],
    });
    expect(finished.planCandidates).toHaveLength(1);
    expect(finished.planCandidates[0].added.facilityIds).toEqual(second.added.facilityIds);
  });
});
