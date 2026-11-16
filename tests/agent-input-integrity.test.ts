import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { agentRunRequestSchema } from '../supabase/functions/_shared/agent-contract.ts';
import { agentFingerprint, agentFingerprintInput } from '../supabase/functions/_shared/agent-fingerprint.ts';
import { ApiError, sceneSchema } from '../supabase/functions/_shared/domain.ts';
import { SENSITIVE_INPUT_PATTERN, containsSensitiveInput } from '../supabase/functions/_shared/sensitive-input.ts';
import type { Backend } from '../supabase/functions/_shared/backend.ts';

const owner = '10000000-0000-4000-8000-000000000001';
const projectId = '50000000-0000-4000-8000-000000000001';
const session = '30000000-0000-4000-8000-000000000001';
const renewed = '30000000-0000-4000-8000-000000000002';
const baseScene = (width = 12) => sceneSchema.parse({ schemaVersion: 1, venue: { shape: 'rectangle', width, depth: 10, height: 3, entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral' });
function run(extra: Record<string, unknown> = {}) {
  return agentRunRequestSchema.parse({ requestId: crypto.randomUUID(), sessionId: session, generation: 1, expectedRevision: 0, localRevision: 0,
    scene: baseScene(), selectedIds: [], instruction: '把桌子移到入口右侧', executionMode: 'preview', ...extra });
}

describe('agent run idempotency fingerprint', () => {
  it('reuses one fingerprint when only the lease fields change', async () => {
    const first = run();
    const retried = run({ requestId: first.requestId, sessionId: renewed, generation: 7, expectedRevision: 3, localRevision: 5 });
    expect(await agentFingerprint(first)).toBe(await agentFingerprint(retried));
    const business = agentFingerprintInput(first);
    for (const field of ['requestId', 'sessionId', 'generation', 'expectedRevision', 'localRevision']) expect(business).not.toHaveProperty(field);
    expect(business).toMatchObject({ instruction: '把桌子移到入口右侧', jevEnabled: false, executionMode: 'preview' });
  });

  it('separates every business field that changes the request', async () => {
    const base = run();
    const same = (extra: Record<string, unknown>) => run({ requestId: base.requestId, ...extra });
    const variants = [same({ instruction: '把桌子移到入口左侧' }), same({ context: { brief: '30 人品牌活动' } }),
      same({ scene: baseScene(13) }), same({ jevEnabled: true }), same({ executionMode: 'direct' }),
      same({ provider: 'minimax' }), same({ model: 'deepseek-chat' })];
    const fingerprints = await Promise.all([base, ...variants].map(input => agentFingerprint(input)));
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it('hashes in canonical key order', async () => {
    expect(await agentFingerprint({ b: 2, a: 1 })).toBe(await agentFingerprint({ a: 1, b: 2 }));
  });

  it('keeps the activity-task shape distinct instead of hashing one empty body', async () => {
    const activity = { kind: 'activity_tasks', requestId: crypto.randomUUID(), sessionId: session, generation: 1, expectedRevision: 0,
      localRevision: 0, instruction: '推出任务表', activityContext: { dataKind: 'tasks', briefText: '需求 A' } };
    const leased = { ...activity, sessionId: renewed, generation: 4, expectedRevision: 2, localRevision: 9 };
    const changed = { ...activity, activityContext: { dataKind: 'tasks', briefText: '需求 B' } };
    // A field allowlist that only knew agent-run fields would collapse every activity run onto one key.
    expect(await agentFingerprint(activity)).not.toBe(await agentFingerprint(changed));
    expect(await agentFingerprint(activity)).toBe(await agentFingerprint(leased));
  });
});

describe('credential-shaped input rule', () => {
  it.each(['password: hunter2', 'Password：Hunter2', 'api_key=abc123', 'API-KEY: abc123', 'access token: abcdef',
    'secret = topsecret', 'token:abc123', 'Authorization: Bearer abc123', 'bearer abc123', 'sk-abcdefgh1234'])
  ('refuses credential-shaped text: %s', text => expect(containsSensitiveInput(text)).toBe(true));

  it.each(['把桌子移到入口右侧，留出一米通道。', '参考 https://example.com/floorplan.png 的比例', '看看 http://example.com/a?b=1',
    'token 预算要省着用', '密钥在平台设置里保管', 'password 策略由平台决定'])
  ('allows ordinary text and plain links: %s', text => expect(containsSensitiveInput(text)).toBe(false));

  it('is stateless so repeated checks agree', () => {
    expect(SENSITIVE_INPUT_PATTERN.global).toBe(false);
    expect(containsSensitiveInput('sk-abcdefgh1234')).toBe(true);
    expect(containsSensitiveInput('sk-abcdefgh1234')).toBe(true);
    expect(containsSensitiveInput('普通文本')).toBe(false);
  });
});

describe('agent run create refuses credential-shaped input before storing', () => {
  function api() {
    const create = vi.fn(async () => { throw new Error('must not store a run'); });
    const backend = { user: async () => owner, agent: create,
      scene: async () => { throw new ApiError('PROJECT_NOT_FOUND', 404); } } as unknown as Backend;
    const handler = createApi(backend, () => undefined);
    return { create, post: (body: unknown) => handler(new Request(`https://api.test/projects/${projectId}/agent-runs`, { method: 'POST',
      headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })) };
  }
  const errorOf = async (response: Response) => (await response.json()).error as { code: string };

  it.each([['sk-abcdefgh1234'], ['password: hunter2'], ['Authorization: Bearer abc123']])
  ('rejects a credential in the instruction: %s', async instruction => {
    const { create, post } = api();
    const response = await post(run({ instruction: `${instruction} 然后排桌子` }));
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toMatchObject({ code: 'AI_INPUT_SENSITIVE' });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a credential in recent history', async () => {
    const { create, post } = api();
    const response = await post(run({ context: { brief: '', acceptedDecisions: [], recentMessages: [
      { role: 'user', text: '旧消息' }, { role: 'assistant', text: 'token: abc123456' }] } }));
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toMatchObject({ code: 'AI_INPUT_SENSITIVE' });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['普通文本，参考 https://example.com/floorplan.png 排桌子。', '把入口右侧留空，画布尺寸见 http://example.com/plan?a=1'])
  ('lets ordinary text and plain links through to the rest of the route: %s', async instruction => {
    const { create, post } = api();
    const response = await post(run({ instruction }));
    expect(await errorOf(response)).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(create).not.toHaveBeenCalled();
  });
});
