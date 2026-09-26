import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Unit tests only. E2E stays under Playwright (`npm run test:e2e`) because
    // it drives a real browser against a real deployment and must never be
    // swept up by a `vitest` invocation.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    globals: false,
    // `npm test` must be a gate, not a flaky roulette: a hang is a failure.
    testTimeout: 10_000,
    hookTimeout: 10_000,
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      // Scoped to the helpers this suite actually exercises. Including all of
      // src/lib would drag in the Supabase clients, the cache layer and the
      // admin helpers, which are wiring rather than logic — a % over files
      // nobody intends to unit-test is a meaningless number that only teaches
      // everyone to ignore it.
      include: ['src/lib/utils.ts', 'src/lib/site-url.ts', 'src/lib/ip.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        // Modest on purpose: this is a FIRST suite, not a coverage stunt. It
        // exists to catch a regression in the pure helpers, and it must never
        // be the reason a legitimate fix can't merge.
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
