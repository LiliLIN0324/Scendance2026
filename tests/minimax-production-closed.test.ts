import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { agentRunRequestSchema, agentRunSchema } from '../supabase/functions/_shared/agent-contract.ts';
import { database, owner, scene, session, studio } from './fixtures.ts';

describe('MiniMax paid tool workflow remains closed before budget integration', () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { fixture = await database(); }, 30_000);
  afterAll(async () => { await fixture?.db.close(); });

  it.each(['tool', 'legacy'])('does not dispatch an outbound provider request through %s agent mode', async mode => {
    const base = scene();
    const project = await fixture.rpc(owner, 'projects.create', { studioId: studio, name: '预算闸测试', scene: base });
    const lease = await fixture.rpc(owner, 'lease.acquire', { projectId: project.id, sessionId: session });
    const input = agentRunRequestSchema.parse({ requestId: crypto.randomUUID(), sessionId: session, generation: lease.generation,
      expectedRevision: 0, localRevision: 0, scene: base, selectedIds: [], instruction: '布置桌子', executionMode: 'preview' });
    const settings: Record<string, string> = { AGENT_CHAT_PROFILE: 'minimax', AGENT_CHAT_BASE_URL: 'https://api.minimax.cn/v1',
      AGENT_CHAT_KEY: 'fixture', AGENT_CHAT_MODEL: 'MiniMax-M3.1-Flash', TOKENDANCE_API_KEY: 'other-fixture',
      ...(mode === 'legacy' ? { DEEPSEEK_AGENT_MODE: 'legacy' } : {}) };
    const fetcher = vi.fn<typeof fetch>();
    const api = createApi(fixture.backend, key => settings[key], fetcher);
    const response = await api(new Request(`https://api.test/projects/${project.id}/agent-runs`, {
      method: 'POST', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, body: JSON.stringify(input),
    }));
    expect(response.status).toBe(202);
    const run = agentRunSchema.parse(await response.json());
    expect(run.state).toBe('failed');
    expect(run.errorCode).toBe('MODEL_PROVIDER_UNSUPPORTED_WORKFLOW');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
