import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror tsconfig's `@/*` path so panel components are importable in tests.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // Supabase shared modules import zod from their directory; resolve via frontend deps.
      zod: fileURLToPath(new URL('./node_modules/zod/index.js', import.meta.url)),
    },
  },
  // Next's tsconfig sets `jsx: preserve` (Next compiles JSX itself); the
  // vitest transform must compile it instead for the React-facing suites.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    setupFiles: ['./test-setup.ts'],
    // Most modules under test are React-free and Three.js-free pure logic, so
    // the fast Node environment is the default. The few React-facing suites
    // (e.g. use-layout-store.react.test.ts) opt into jsdom per-file via a
    // `// @vitest-environment jsdom` comment.
    environment: 'node',
    globals: false,
    include: ['app/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'],
    // 真实 GLB 解码 / GLTF 重载与卫星贴图用例单跑就要 3–8 秒；并行 worker
    // 下 5 秒默认值会产生假超时。放宽上限，不改任何断言。
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Node 20: undici 8 (via jsdom 30) needs worker_threads.markAsUncloneable.
    execArgv: ['--require', './polyfill-mark-as-uncloneable.cjs'],
  },
});
