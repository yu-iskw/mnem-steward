import type { Principal } from '@enterprise-memory/core';
import type { Hono } from 'hono';

export type AppEnv = {
  Variables: {
    principal: Principal;
  };
};

export type MemoryApp = Hono<AppEnv>;
