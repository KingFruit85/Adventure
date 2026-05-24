// Vercel function entrypoint.
//
// Hono's app already mounts everything under /api (see buildApp's
// basePath), and vercel.json rewrites /api/* to this handler, so the URLs
// match end-to-end. Imports use subpaths so the Vercel build only includes
// Neon + Vercel Blob — never better-sqlite3.
import { buildApp } from '@loreforge/api/app';
import { buildVercelEngineDependencies } from '@loreforge/api/deps-factory-vercel';
import { handle } from 'hono/vercel';

// Node runtime needed for the Anthropic SDK + Neon driver + @vercel/blob.
// Long-running SSE streams need maxDuration raised in vercel.json.
export const config = { runtime: 'nodejs' };

const app = buildApp(buildVercelEngineDependencies());

export default handle(app);
