import { fileURLToPath } from 'node:url';

import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: {
      '@enterprise-memory/auth': fileURLToPath(new URL('../auth/src/index.ts', import.meta.url)),
      '@enterprise-memory/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@enterprise-memory/google-memory': fileURLToPath(
        new URL('../google-memory/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: '@enterprise-memory/gateway',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
