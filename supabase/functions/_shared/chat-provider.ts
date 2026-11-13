import { z } from 'zod';
import type { Env } from './http.ts';

/**
 * 请求级 chat provider 选择。
 *
 * 服务端 secret 仍是唯一凭据来源；前端只能在「已配置的槽位」之间选择，
 * 不能提交自定义端点或密钥。`default` 表示不传选择，沿用现有默认链。
 *
 * 槽位与 providers.ts 的 chatRequest() 优先级一一对应：
 * openai-next（默认均衡槽）→ bailian(百炼, 仅摘要/只读) → minimax / custom(AGENT_CHAT_*) → tokendance 网关 → deepseek 官方。
 * OpenAI Next 与 MiniMax 配置可并存；默认走 OpenAI Next，MiniMax 仅在显式选择时使用，不在失败时静默串槽。
 */
export const CHAT_PROVIDER_IDS = ['default', 'openai-next', 'bailian', 'minimax', 'custom', 'tokendance', 'deepseek'] as const;
export type ChatProviderId = typeof CHAT_PROVIDER_IDS[number];
export const chatProviderSchema = z.enum(CHAT_PROVIDER_IDS);

export const CHAT_PROVIDER_LABELS: Record<ChatProviderId, string> = {
  default: '默认（按服务端配置）',
  'openai-next': 'OpenAI Next',
  bailian: '百炼 Qwen',
  minimax: 'MiniMax',
  custom: '自定义兼容端点',
  tokendance: 'Tokendance 网关',
  deepseek: 'DeepSeek 官方',
};

function has(env: Env, key: string): boolean {
  return Boolean(env(key)?.trim());
}

/** 槽位配置是否齐全。只校验字段存在，不证明模型权限或真实可用。 */
export function chatProviderConfigured(env: Env, id: ChatProviderId): boolean {
  switch (id) {
    case 'default':
      return true;
    case 'openai-next':
      return has(env, 'OPENAI_NEXT_API_KEY');
    case 'bailian':
      return env('BAILIAN_PRODUCT_ENABLED') === '1' && has(env, 'BAILIAN_PRODUCT_BASE_URL') && has(env, 'BAILIAN_PRODUCT_KEY') && has(env, 'BAILIAN_PRODUCT_MODEL');
    case 'minimax':
      return env('AGENT_CHAT_PROFILE') === 'minimax' && has(env, 'AGENT_CHAT_BASE_URL') && has(env, 'AGENT_CHAT_KEY') && has(env, 'AGENT_CHAT_MODEL');
    case 'custom': {
      const profile = env('AGENT_CHAT_PROFILE');
      return profile !== 'minimax' && has(env, 'AGENT_CHAT_BASE_URL') && has(env, 'AGENT_CHAT_KEY') && has(env, 'AGENT_CHAT_MODEL');
    }
    case 'tokendance':
      return has(env, 'TOKENDANCE_API_KEY');
    case 'deepseek':
      return has(env, 'DEEPSEEK_API_KEY');
  }
}

/** agent 工具循环能力。百炼只做只读摘要/聊天；MiniMax 需显式开启工具循环开关。 */
export function chatProviderAgentTools(env: Env, id: ChatProviderId): boolean {
  if (id === 'bailian') return false;
  if (id === 'minimax') return env('MINIMAX_AGENT_TOOLS_ENABLED') === '1';
  return true;
}

/**
 * 构造强制选中槽位的 env 覆盖视图。空串用于腾开上级槽位（与 api.ts briefViews 同口径）。
 * `default` 原样返回基础 env，不做任何覆盖。
 */
export function chatProviderView(env: Env, id: ChatProviderId): Env {
  if (id === 'default') return env;
  const overrides: Record<string, string> = {};
  switch (id) {
    case 'openai-next':
      overrides.BAILIAN_PRODUCT_ENABLED = '';
      overrides.AGENT_CHAT_PROFILE = '';
      overrides.AGENT_CHAT_BASE_URL = '';
      overrides.AGENT_CHAT_KEY = '';
      overrides.AGENT_CHAT_MODEL = '';
      overrides.TOKENDANCE_API_KEY = '';
      overrides.DEEPSEEK_API_KEY = '';
      break;
    case 'bailian':
      overrides.BAILIAN_PRODUCT_ENABLED = '1';
      overrides.OPENAI_NEXT_API_KEY = '';
      overrides.OPENAI_NEXT_BASE_URL = '';
      overrides.OPENAI_NEXT_MODEL = '';
      break;
    case 'minimax':
      overrides.BAILIAN_PRODUCT_ENABLED = '';
      overrides.AGENT_CHAT_PROFILE = 'minimax';
      overrides.OPENAI_NEXT_API_KEY = '';
      overrides.OPENAI_NEXT_BASE_URL = '';
      overrides.OPENAI_NEXT_MODEL = '';
      break;
    case 'custom':
      overrides.BAILIAN_PRODUCT_ENABLED = '';
      overrides.AGENT_CHAT_PROFILE = '';
      overrides.OPENAI_NEXT_API_KEY = '';
      overrides.OPENAI_NEXT_BASE_URL = '';
      overrides.OPENAI_NEXT_MODEL = '';
      break;
    case 'tokendance':
      overrides.BAILIAN_PRODUCT_ENABLED = '';
      overrides.AGENT_CHAT_PROFILE = '';
      overrides.AGENT_CHAT_BASE_URL = '';
      overrides.AGENT_CHAT_KEY = '';
      overrides.AGENT_CHAT_MODEL = '';
      overrides.OPENAI_NEXT_API_KEY = '';
      overrides.OPENAI_NEXT_BASE_URL = '';
      overrides.OPENAI_NEXT_MODEL = '';
      break;
    case 'deepseek':
      overrides.BAILIAN_PRODUCT_ENABLED = '';
      overrides.AGENT_CHAT_PROFILE = '';
      overrides.AGENT_CHAT_BASE_URL = '';
      overrides.AGENT_CHAT_KEY = '';
      overrides.AGENT_CHAT_MODEL = '';
      overrides.TOKENDANCE_API_KEY = '';
      overrides.OPENAI_NEXT_API_KEY = '';
      overrides.OPENAI_NEXT_BASE_URL = '';
      overrides.OPENAI_NEXT_MODEL = '';
      break;
  }
  return (key: string) => (Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : env(key));
}

/** 按 chatRequest 默认优先级解析当前服务端实际会落到哪个槽位；未配置返回 null。 */
export function resolveActiveProvider(env: Env, purpose: 'brief' | 'agent'): ChatProviderId | null {
  const openaiNext = chatProviderConfigured(env, 'openai-next');
  const agentChatComplete = has(env, 'AGENT_CHAT_BASE_URL') && has(env, 'AGENT_CHAT_KEY') && has(env, 'AGENT_CHAT_MODEL');
  // Chat Agent brief/assistant defaults to OpenAI Next. The existing MiniMax/custom
  // agent-tool path stays unless that slot is absent (or an isolated openai-next view).
  if (openaiNext && (purpose === 'brief' || !agentChatComplete)) return 'openai-next';
  if (purpose === 'brief' && env('BAILIAN_PRODUCT_ENABLED') === '1' && has(env, 'BAILIAN_PRODUCT_BASE_URL') && has(env, 'BAILIAN_PRODUCT_KEY') && has(env, 'BAILIAN_PRODUCT_MODEL')) return 'bailian';
  if (has(env, 'AGENT_CHAT_BASE_URL') && has(env, 'AGENT_CHAT_KEY') && has(env, 'AGENT_CHAT_MODEL')) {
    return env('AGENT_CHAT_PROFILE') === 'minimax' ? 'minimax' : 'custom';
  }
  if (has(env, 'TOKENDANCE_API_KEY')) return 'tokendance';
  if (has(env, 'DEEPSEEK_API_KEY')) return 'deepseek';
  return null;
}

export interface ChatProviderCapability {
  id: ChatProviderId;
  label: string;
  configured: boolean;
  agentTools: boolean;
  /** 已配置时的实际模型 id；未配置为「未配置」。 */
  model: string;
}

export interface ChatCapabilities {
  active: { agent: ChatProviderId | null; brief: ChatProviderId | null };
  providers: ChatProviderCapability[];
}

/** 能力清单：纯 env 计算，不接触密钥值；供前端渲染可选项。 */
export function chatCapabilities(env: Env, modelName: (view: Env, purpose: 'brief' | 'agent') => string): ChatCapabilities {
  const providers = CHAT_PROVIDER_IDS.map((id) => {
    const configured = chatProviderConfigured(env, id);
    const view = chatProviderView(env, id);
    return {
      id,
      label: CHAT_PROVIDER_LABELS[id],
      configured,
      agentTools: chatProviderAgentTools(env, id),
      model: configured ? modelName(view, 'agent') : '未配置',
    };
  });
  return {
    active: { agent: resolveActiveProvider(env, 'agent'), brief: resolveActiveProvider(env, 'brief') },
    providers,
  };
}
