import { describe, it, expect } from 'vitest';
import {
  CHAT_PROVIDER_IDS,
  chatProviderConfigured,
  chatProviderAgentTools,
  chatProviderView,
  resolveActiveProvider,
  chatCapabilities,
} from '../supabase/functions/_shared/chat-provider.ts';
import { chatModelName } from '../supabase/functions/_shared/providers.ts';
import { briefExtractRequestSchema, briefConversationRequestSchema } from '../supabase/functions/_shared/brief-extract-contract.ts';
import { assistantChatRequestSchema } from '../supabase/functions/_shared/assistant-chat-contract.ts';
import type { Env } from '../supabase/functions/_shared/http.ts';

const makeEnv = (config: Record<string, string | undefined>): Env => (key) => config[key];

const tokendance: Record<string, string | undefined> = { TOKENDANCE_API_KEY: 'tk-secret' };
const deepseek: Record<string, string | undefined> = { DEEPSEEK_API_KEY: 'ds-secret' };
const minimax: Record<string, string | undefined> = {
  AGENT_CHAT_PROFILE: 'minimax', AGENT_CHAT_BASE_URL: 'https://m.test/v1', AGENT_CHAT_KEY: 'k', AGENT_CHAT_MODEL: 'MiniMax-M3.1', MINIMAX_AGENT_TOOLS_ENABLED: '1',
};
const custom: Record<string, string | undefined> = {
  AGENT_CHAT_BASE_URL: 'https://c.test/v1', AGENT_CHAT_KEY: 'k', AGENT_CHAT_MODEL: 'custom-model',
};
const bailian: Record<string, string | undefined> = {
  BAILIAN_PRODUCT_ENABLED: '1', BAILIAN_PRODUCT_BASE_URL: 'https://b.test/v1', BAILIAN_PRODUCT_KEY: 'k', BAILIAN_PRODUCT_MODEL: 'qwen-example',
};
const openaiNext: Record<string, string | undefined> = {
  OPENAI_NEXT_API_KEY: 'onk-secret', OPENAI_NEXT_BASE_URL: 'https://api.openai-next.com/v1', OPENAI_NEXT_MODEL: 'deepseek-v4.1-flash',
};

describe('provider configuration detection', () => {
  it('marks default always available and never exposes a secret', () => {
    expect(chatProviderConfigured(makeEnv({}), 'default')).toBe(true);
  });

  it.each([
    ['openai-next', openaiNext],
    ['bailian', bailian],
    ['minimax', minimax],
    ['custom', custom],
    ['tokendance', tokendance],
    ['deepseek', deepseek],
  ] as const)('detects %s when its slot is complete', (id, config) => {
    expect(chatProviderConfigured(makeEnv(config), id)).toBe(true);
  });

  it('reports incomplete slots as unconfigured', () => {
    expect(chatProviderConfigured(makeEnv({}), 'tokendance')).toBe(false);
    expect(chatProviderConfigured(makeEnv({}), 'deepseek')).toBe(false);
    expect(chatProviderConfigured(makeEnv({ AGENT_CHAT_BASE_URL: 'https://c.test', AGENT_CHAT_KEY: 'k' }), 'custom')).toBe(false);
    expect(chatProviderConfigured(makeEnv(minimax), 'custom')).toBe(false);
    expect(chatProviderConfigured(makeEnv({ ...minimax, AGENT_CHAT_PROFILE: '' }), 'minimax')).toBe(false);
    expect(chatProviderConfigured(makeEnv({ OPENAI_NEXT_MODEL: 'deepseek-v4.1-flash' }), 'openai-next')).toBe(false);
  });

  it('gatekeeps MiniMax agent tools behind the explicit switch', () => {
    expect(chatProviderAgentTools(makeEnv(minimax), 'minimax')).toBe(true);
    expect(chatProviderAgentTools(makeEnv({ ...minimax, MINIMAX_AGENT_TOOLS_ENABLED: '0' }), 'minimax')).toBe(false);
    expect(chatProviderAgentTools(makeEnv(bailian), 'bailian')).toBe(false);
    expect(chatProviderAgentTools(makeEnv(deepseek), 'deepseek')).toBe(true);
    expect(chatProviderAgentTools(makeEnv(openaiNext), 'openai-next')).toBe(true);
  });
});

describe('provider view overrides', () => {
  it('returns the original env unchanged for the default choice', () => {
    const env = makeEnv(tokendance);
    expect(chatProviderView(env, 'default')).toBe(env);
  });

  it('frees the custom slot and keeps the Tokendance key for the tokendance view', () => {
    const env = makeEnv({ ...minimax, TOKENDANCE_API_KEY: 'tk-secret' });
    const view = chatProviderView(env, 'tokendance');
    expect(view('AGENT_CHAT_BASE_URL')).toBe('');
    expect(view('AGENT_CHAT_KEY')).toBe('');
    expect(view('AGENT_CHAT_MODEL')).toBe('');
    expect(view('AGENT_CHAT_PROFILE')).toBe('');
    expect(view('TOKENDANCE_API_KEY')).toBe('tk-secret');
  });

  it('clears the gateway key for the deepseek view', () => {
    const env = makeEnv({ ...tokendance, DEEPSEEK_API_KEY: 'ds-secret' });
    const view = chatProviderView(env, 'deepseek');
    expect(view('TOKENDANCE_API_KEY')).toBe('');
    expect(view('AGENT_CHAT_BASE_URL')).toBe('');
    expect(view('DEEPSEEK_API_KEY')).toBe('ds-secret');
  });

  it('forces the minimax profile and frees bailian for the minimax view', () => {
    const view = chatProviderView(makeEnv({ ...minimax, BAILIAN_PRODUCT_ENABLED: '1' }), 'minimax');
    expect(view('AGENT_CHAT_PROFILE')).toBe('minimax');
    expect(view('BAILIAN_PRODUCT_ENABLED')).toBe('');
    expect(view('AGENT_CHAT_BASE_URL')).toBe('https://m.test/v1');
  });

  it('isolates OpenAI Next from MiniMax secrets and the reverse', () => {
    const env = makeEnv({ ...openaiNext, ...minimax });
    const nextView = chatProviderView(env, 'openai-next');
    expect(nextView('OPENAI_NEXT_API_KEY')).toBe('onk-secret');
    expect(nextView('AGENT_CHAT_KEY')).toBe('');
    expect(nextView('AGENT_CHAT_PROFILE')).toBe('');
    const miniView = chatProviderView(env, 'minimax');
    expect(miniView('AGENT_CHAT_PROFILE')).toBe('minimax');
    expect(miniView('AGENT_CHAT_KEY')).toBe('k');
    expect(miniView('OPENAI_NEXT_API_KEY')).toBe('');
  });
});

describe('active provider resolution', () => {
  it('resolves the default chain in priority order', () => {
    expect(resolveActiveProvider(makeEnv(tokendance), 'agent')).toBe('tokendance');
    expect(resolveActiveProvider(makeEnv(deepseek), 'agent')).toBe('deepseek');
    expect(resolveActiveProvider(makeEnv(minimax), 'agent')).toBe('minimax');
    expect(resolveActiveProvider(makeEnv(custom), 'agent')).toBe('custom');
    expect(resolveActiveProvider(makeEnv({}), 'agent')).toBeNull();
  });

  it('prefers OpenAI Next for brief, but keeps MiniMax as the agent default when both are configured', () => {
    const both = makeEnv({ ...openaiNext, ...minimax, ...bailian });
    expect(resolveActiveProvider(both, 'brief')).toBe('openai-next');
    expect(resolveActiveProvider(both, 'agent')).toBe('minimax');
    expect(resolveActiveProvider(makeEnv({ OPENAI_NEXT_API_KEY: 'onk-secret' }), 'agent')).toBe('openai-next');
  });

  it('prefers bailian for brief when opted in and configured', () => {
    expect(resolveActiveProvider(makeEnv({ ...bailian, ...tokendance }), 'brief')).toBe('bailian');
    expect(resolveActiveProvider(makeEnv({ ...bailian, ...tokendance }), 'agent')).toBe('tokendance');
  });

  it('lists every slot with configured flag and model name, without leaking keys', () => {
    const caps = chatCapabilities(makeEnv({ ...minimax, ...tokendance, ...openaiNext }), (view, purpose) => chatModelName(view, { purpose }));
    expect(caps.providers).toHaveLength(CHAT_PROVIDER_IDS.length);
    const byId = Object.fromEntries(caps.providers.map((p) => [p.id, p]));
    expect(byId['openai-next'].configured).toBe(true);
    expect(byId['openai-next'].model).toBe('deepseek-v4.1-flash');
    expect(caps.active.brief).toBe('openai-next');
    expect(caps.active.agent).toBe('minimax');
    expect(byId.minimax.configured).toBe(true);
    expect(byId.tokendance.configured).toBe(true);
    expect(byId.deepseek.configured).toBe(false);
    expect(byId.deepseek.model).toBe('未配置');
    expect(JSON.stringify(caps)).not.toContain('tk-secret');
    expect(JSON.stringify(caps)).not.toContain('onk-secret');
    expect(JSON.stringify(caps)).not.toContain('AGENT_CHAT_KEY');
  });
});

describe('request contract compatibility', () => {
  it('accepts legacy clients that omit provider', () => {
    expect(briefExtractRequestSchema.safeParse({ message: '需要 30 人签到区' }).success).toBe(true);
    expect(assistantChatRequestSchema.safeParse({ message: '有休息区吗', history: [] }).success).toBe(true);
    expect(briefConversationRequestSchema.safeParse({ message: '舞台放哪', responseMode: 'conversation_v1', history: [] }).success).toBe(true);
  });

  it('accepts a configured provider id and rejects unknown enums', () => {
    expect(briefExtractRequestSchema.safeParse({ message: '布置一下', provider: 'tokendance' }).success).toBe(true);
    expect(briefExtractRequestSchema.safeParse({ message: '布置一下', provider: 'openai-next' }).success).toBe(true);
    const rejected = briefExtractRequestSchema.safeParse({ message: '布置一下', provider: 'openai' });
    expect(rejected.success).toBe(false);
  });
});
