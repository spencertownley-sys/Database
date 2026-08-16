import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '~/tests': path.resolve(__dirname, './tests'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // The perf suite seeds a 100k-item fixture; it runs via `npm run
    // test:perf` (and in CI), not on every `npm test`.
    exclude: process.env.PERF
      ? ['**/node_modules/**']
      : ['**/node_modules/**', 'tests/perf/**'],
    // Integration tests share one Postgres database and mutate global state
    // (RLS roles, seeded workspaces). Running files in parallel against a
    // single database produces flaky cross-test interference.
    fileParallelism: false,
    // Node by default; the few DOM-dependent files opt in with a
    // `// @vitest-environment jsdom` docblock rather than a glob, so moving a
    // test file cannot silently change the environment it runs under.
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/server/**', 'src/components/grid/**'],
    },
  },
});
