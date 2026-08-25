import { serve } from '@hono/node-server';

import { createApp } from './create-app.js';
import { createGatewayDeps } from './create-deps.js';
import { parseEnv } from './env.js';

const env = parseEnv(process.env);
const deps = createGatewayDeps(env);
const app = createApp(deps);

serve({ fetch: app.fetch, port: env.port });
