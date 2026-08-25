import { fileURLToPath } from 'node:url';

import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: {
      '@mnem-steward/auth': fileURLToPath(new URL('../auth/src/index.ts', import.meta.url)),
      '@mnem-steward/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@mnem-steward/google-memory': fileURLToPath(
        new URL('../google-memory/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: '@mnem-steward/gateway',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
