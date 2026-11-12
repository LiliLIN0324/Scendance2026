import { afterEach, expect, it, vi } from 'vitest';
import { getBackendConfig } from './backend-session';
afterEach(() => vi.unstubAllEnvs());
it('私网HTTP仅显式开发fixture的精确项目主机可用，生产及其他HTTP仍拒绝', () => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('NEXT_PUBLIC_LOCAL_FIXTURE', '1'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://172.30.0.2:54336');
  const config = (url: string) => getBackendConfig({ url, anonKey: 'public-fixture-only' });
  expect(config('http://172.30.0.2:54336').error).toBeNull();
  expect(config('http://172.30.0.3:54336').error).not.toBeNull();
  expect(config('http://203.0.113.2:54336').error).not.toBeNull();
  vi.stubEnv('NODE_ENV', 'production'); expect(config('http://172.30.0.2:54336').error).not.toBeNull();
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('NEXT_PUBLIC_LOCAL_FIXTURE', '0'); expect(config('http://172.30.0.2:54336').error).not.toBeNull();
});
