import { fileURLToPath } from 'node:url';

import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: {
      '@enterprise-memory/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: '@enterprise-memory/google-memory',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
