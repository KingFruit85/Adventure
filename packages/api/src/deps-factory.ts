import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  AnthropicProvider,
  type EngineDependencies,
  FileSystemAdventureLoader,
  KeywordIntentClassifier,
  LLMIntentClassifier,
  loadEnv,
} from '@loreforge/engine';
import { FilesystemBlobStore } from '@loreforge/engine/blob/filesystem';
import { SQLiteSessionStore } from '@loreforge/engine/session-store/sqlite';

export interface DepsFactoryConfig {
  adventuresDir?: string;
  databasePath?: string;
  blobDir?: string;
  useLLMIntentClassifier?: boolean;
}

/**
 * Walks up from `startDir` looking for a directory named `marker`. Used to
 * locate the repo root from a package subdirectory — `pnpm --filter` runs
 * scripts with cwd inside the package, so resolving `./adventures` would
 * fail. Returns the absolute path to the marker directory or `null` if not
 * found within `maxDepth` levels.
 */
function findUpward(startDir: string, marker: string, maxDepth = 6): string | null {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i++) {
    const candidate = join(dir, marker);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Wires up production EngineDependencies from environment variables, with
 * sensible defaults that work whether the API is started from the repo
 * root or from inside `packages/api/` (as `pnpm --filter` does).
 *
 * Env vars (all optional):
 *   ADVENTURES_DIR              path to the adventures/ directory
 *   DATABASE_PATH               path to the SQLite file (default: <repo>/loreforge.db)
 *   BLOB_DIR                    path to the per-session blob log directory
 *   USE_LLM_INTENT_CLASSIFIER   "true" (default) to use haiku; "false" for keyword
 *   ANTHROPIC_API_KEY           required for the AnthropicProvider
 */
export function buildEngineDependencies(config: DepsFactoryConfig = {}): EngineDependencies {
  loadEnv();

  const adventuresDir =
    config.adventuresDir ??
    process.env.ADVENTURES_DIR ??
    findUpward(process.cwd(), 'adventures') ??
    resolve(process.cwd(), 'adventures');

  // Anchor the SQLite + blob defaults to the same root as adventures so the
  // game data lives together regardless of where the process was started.
  const dataRoot = dirname(adventuresDir);
  const databasePath =
    config.databasePath ?? process.env.DATABASE_PATH ?? join(dataRoot, 'loreforge.db');
  const blobDir = config.blobDir ?? process.env.BLOB_DIR ?? join(dataRoot, 'sessions');

  const useLLMIntentClassifier =
    config.useLLMIntentClassifier ?? process.env.USE_LLM_INTENT_CLASSIFIER !== 'false';

  const llmProvider = new AnthropicProvider();
  return {
    sessionStore: new SQLiteSessionStore(databasePath),
    adventureLoader: new FileSystemAdventureLoader(adventuresDir),
    blobStore: new FilesystemBlobStore(blobDir),
    llmProvider,
    intentClassifier: useLLMIntentClassifier
      ? new LLMIntentClassifier(llmProvider)
      : new KeywordIntentClassifier(),
  };
}
