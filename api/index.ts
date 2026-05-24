// Vercel function entrypoint.
//
// Hono's app already mounts everything under /api (see buildApp's
// basePath), and vercel.json rewrites /api/* to this handler so the URLs
// match end-to-end. Imports use subpaths so the Vercel build only includes
// Neon + Vercel Blob — never better-sqlite3.
//
// We use the named `fetch` export (Vercel Functions API / Web Standards
// signature). A default export gets routed to the legacy Node
// `(req, res) => void` signature where returning a Response is ignored
// and the request hangs forever.
import { buildApp } from '@loreforge/api/app';
import { buildVercelEngineDependencies } from '@loreforge/api/deps-factory-vercel';
import { handle } from 'hono/vercel';

// Node runtime needed for the Anthropic SDK + Neon driver + @vercel/blob.
// Long-running SSE streams need maxDuration raised in vercel.json.
export const runtime = 'nodejs';

const app = buildApp(buildVercelEngineDependencies());

export const fetch = handle(app);
