import { fileURLToPath } from 'node:url';

import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: {
      '@mnem-steward/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: '@mnem-steward/auth',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
