import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { agentRunRequestSchema, agentRunSchema } from '../supabase/functions/_shared/agent-contract.ts';
import { reviewAgentCandidate } from '../supabase/functions/_shared/agent-candidate-review.ts';
import { chair, database, owner, scene, session, studio } from './fixtures.ts';

// The model is simulated. The API, tool executor, review and database are real code
// running against a disposable in-memory database; no external request is made.
const config: Record<string, string> = {
  AGENT_CHAT_PROFILE: 'minimax', MINIMAX_AGENT_TOOLS_ENABLED: '1',
  AGENT_CHAT_BASE_URL: 'https://api.minimax.cn/v1', AGENT_CHAT_KEY: 'fixture',
  AGENT_CHAT_MODEL: 'MiniMax-M3.1-Flash',
};
const dimensions = { layout: 'two_people_per_desk', count: 30,
  deskSize: { width: 1.2, depth: 0.5, height: 0.75 },
  chairSize: { width: 0.45, depth: 0.5, height: 0.85 },
  deskChairGap: 0.1, chairGap: 0.1, columnGap: 0.2, rowGap: 0.2, edgeClearance: 0.2 };
const call = (name: string, args: unknown) => ({ id: crypto.randomUUID(), type: 'function', index: 0, function: { name, arguments: JSON.stringify(args) } });
const response = (tool: ReturnType<typeof call>) => Response.json({ base_resp: { status_code: 0 }, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [tool] } }] });

describe('shared seating cloud preview against persisted state', () => {
  let f: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { f = await database(); }, 30000);
  afterAll(async () => { await f.db.close(); });

  it.each([5, 6])('preserves %i existing objects and reports the actual object limit', async existingCount => {
    const initial = scene();
    initial.venue.width = 20; initial.venue.depth = 20;
    for (let n = 0; n < existingCount; n++) {
      const object = chair(); object.position = { x: 18, z: 1 + n }; initial.objects.push(object);
    }
    const project = await f.rpc(owner, 'projects.create', { studioId: studio, name: 'Disposable shared seating test', scene: initial });
    const lease = await f.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session });
    const input = agentRunRequestSchema.parse({ requestId: crypto.randomUUID(), sessionId: session,
      generation: lease.generation, expectedRevision: 0, localRevision: 0, scene: initial,
      selectedIds: [], instruction: '请为30人按每2人一桌试排，保留原有物件', executionMode: 'preview' });
    let observation: any;
    const mockModel = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (mockModel.mock.calls.length === 1) return response(call('prepare_shared_seating_candidate', dimensions));
      observation = JSON.parse(body.messages.filter((m: any) => m.role === 'tool').at(-1).content);
      return response(call('submit_candidates', { candidates: [{ preparedId: observation.preparedId }] }));
    });
    const api = createApi(f.backend, key => config[key], mockModel);
    const apiResponse = await api(new Request(`https://api.test/projects/${project.id}/agent-runs`, {
      method: 'POST', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, body: JSON.stringify(input),
    }));
    expect(apiResponse.status).toBe(202);
    const result = agentRunSchema.parse(await apiResponse.json());
    expect(result.state).toBe('complete');
    const proposal = result.candidates[0]!.proposal;
    const objects = proposal.candidate.objects;
    expect(objects).toHaveLength(50);
    expect(objects.slice(0, existingCount)).toEqual(initial.objects);
    expect(objects.filter(o => o.materialId === 'table')).toHaveLength(15);
    expect(objects.filter(o => o.materialId === 'chair')).toHaveLength(existingCount + (existingCount === 5 ? 30 : 29));
    expect(observation).toMatchObject({ requestedPeople: 30, placedPeople: existingCount === 5 ? 30 : 29,
      tables: 15, shortfall: existingCount === 5 ? 0 : 1 });
    if(existingCount===5){expect(observation.nextSteps).toEqual([]);expect(proposal.explanation).not.toContain('可考虑：');}
    else {expect(observation.nextSteps.join('')).toContain('系统场景对象数量上限');expect(observation.nextSteps.join('')).toContain('由用户');expect(proposal.explanation).toContain('可考虑：');expect(proposal.explanation).not.toContain('明确选择两人共桌');}
    expect(proposal.warnings).toContainEqual({ code: 'SAFETY_CHECKS_UNKNOWN', ids: [] });
    if (existingCount === 6) expect(proposal.warnings).toContainEqual({ code: 'SHARED_SEATING_SHORTFALL:30:29:15:object_limit', ids: [] });
    expect(reviewAgentCandidate(initial, proposal.candidate, [], true).status).not.toBe('violated');
    const collided = structuredClone(proposal.candidate);
    const table = collided.objects.find(o => o.materialId === 'table')!;
    const newChair = collided.objects.slice(existingCount).find(o => o.materialId === 'chair')!;
    newChair.position = { ...table.position };
    expect(reviewAgentCandidate(initial, collided, [], true).status).toBe('violated');
    const saved = await f.rpc(owner, 'projects.get', { projectId: project.id });
    expect(saved.revision).toBe(0);
    expect(saved.scene).toEqual(initial);
    expect(mockModel).toHaveBeenCalledTimes(2);
  }, 30000);
});
