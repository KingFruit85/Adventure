import { serve } from '@hono/node-server';
import { buildApp } from './app.js';
import { buildEngineDependencies } from './deps-factory.js';

const port = Number(process.env.PORT ?? 3000);
const deps = buildEngineDependencies();
const app = buildApp(deps);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[loreforge-api] listening on http://localhost:${info.port}`);
});
