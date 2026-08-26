import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.{test,spec}.ts',
        'packages/*/src/**/*.d.ts',
        'packages/*/dist/**',
        'packages/core/src/index.ts',
        'packages/core/src/types.ts',
        'packages/core/src/ports.ts',
        'packages/google-memory/src/index.ts',
        'packages/gateway/src/main.ts',
        'packages/gateway/src/create-deps.ts',
        'packages/google-memory/src/google-memory-store.ts',
        'packages/google-memory/src/config.ts',
        'packages/gateway/src/mcp/tools.ts',
        'packages/gateway/src/routes/mcp.ts',
        'packages/gateway/src/routes/rest.ts',
        '**/*.config.{js,mjs,cjs,ts}',
      ],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
