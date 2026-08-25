import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@mnem-steward/core',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
