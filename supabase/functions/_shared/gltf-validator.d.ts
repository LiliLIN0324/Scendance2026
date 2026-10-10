export function validateBytes(bytes: Uint8Array, options?: { maxIssues?: number }): Promise<{ issues: { numErrors: number; numWarnings: number; messages: unknown[] } }>;
