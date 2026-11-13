import { z } from './zod-lite.mjs';

/**
 * Faithful stub of the real `_shared/chat-provider.ts` (verified against
 * reports/evidence/_shared__chat-provider.ts:13,15). Reproduced here with the same enum
 * values because `contract.real.ts` imports `chatProviderSchema` and calls
 * `.optional()` on it at module-evaluation time. Request-body validation is out of scope
 * for this bench: we never parse a request, only a model response.
 */
export const CHAT_PROVIDER_IDS = ['default', 'bailian', 'minimax', 'custom', 'tokendance', 'deepseek'] as const;

export const chatProviderSchema = z.enum(CHAT_PROVIDER_IDS);
