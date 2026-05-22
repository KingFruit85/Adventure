import { resolve } from 'node:path';
import {
  AnthropicProvider,
  type EngineDependencies,
  FileSystemAdventureLoader,
  FilesystemBlobStore,
  KeywordIntentClassifier,
  LLMIntentClassifier,
  SQLiteSessionStore,
  loadEnv,
} from '@loreforge/engine';

export interface DepsFactoryConfig {
  adventuresDir?: string;
  databasePath?: string;
  blobDir?: string;
  useLLMIntentClassifier?: boolean;
}

/**
 * Wires up production EngineDependencies from environment variables.
 *
 * Env vars (all optional):
 *   ADVENTURES_DIR              path to the adventures/ directory
 *   DATABASE_PATH               path to the SQLite file (default ./loreforge.db)
 *   BLOB_DIR                    path to the per-session blob log directory
 *   USE_LLM_INTENT_CLASSIFIER   "true" (default) to use haiku; "false" for keyword
 *   ANTHROPIC_API_KEY           required for the AnthropicProvider
 */
export function buildEngineDependencies(config: DepsFactoryConfig = {}): EngineDependencies {
  loadEnv();
  const adventuresDir =
    config.adventuresDir ?? process.env.ADVENTURES_DIR ?? resolve(process.cwd(), 'adventures');
  const databasePath =
    config.databasePath ?? process.env.DATABASE_PATH ?? resolve(process.cwd(), 'loreforge.db');
  const blobDir = config.blobDir ?? process.env.BLOB_DIR ?? resolve(process.cwd(), 'sessions');
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
