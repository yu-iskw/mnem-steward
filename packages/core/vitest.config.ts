import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@enterprise-memory/core',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
