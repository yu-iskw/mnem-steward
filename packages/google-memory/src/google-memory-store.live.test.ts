import { describe, expect, it } from 'vitest';

import { isGoogleMemoryConfigured } from './config.js';

describe('live Google Memory Bank', () => {
  it.skipIf(!isGoogleMemoryConfigured(process.env))(
    'requires project, location, and reasoning engine env',
    () => {
      expect(isGoogleMemoryConfigured(process.env)).toBe(true);
    },
  );
});
