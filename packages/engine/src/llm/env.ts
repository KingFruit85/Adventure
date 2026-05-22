import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

let loaded = false;

/**
 * Walks up from the current working directory looking for the first `.env`
 * file and loads it. Idempotent — safe to call from any entry point.
 *
 * Why walk up: in a pnpm monorepo, scripts may run from a package subdir
 * (e.g. packages/engine/) but the `.env` lives at the repo root.
 */
export function loadEnv(startDir: string = process.cwd()): void {
  if (loaded) return;
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate });
      loaded = true;
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loaded = true;
}
