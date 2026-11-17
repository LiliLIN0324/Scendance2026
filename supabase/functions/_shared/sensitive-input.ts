/**
 * Credential-shaped text only. This is the narrow safety floor shared by the
 * edge entry (`api.ts` agent-run create) and the frontend context builder
 * (`frontend/lib/assistant-context.ts`, which imports this module directly).
 * It deliberately does NOT match ordinary http(s) links, because an agent
 * instruction legitimately carries references; the chat history filter
 * (`frontend/components/room-organizer/lib/chat-user-history.ts`) stays
 * stricter and keeps its own URL rule.
 *
 * There must be exactly one definition. If it ever has to move, both sides move
 * together.
 */
export const SENSITIVE_INPUT_PATTERN =
  /(?:\b(?:api[_ -]?key|access[_ -]?token|secret|password|token)\s*[:=：]\s*\S+)|\bbearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}/i;

/** True when the text looks like it carries a credential. Never rewrites the text. */
export function containsSensitiveInput(value: string): boolean {
  return SENSITIVE_INPUT_PATTERN.test(value);
}
