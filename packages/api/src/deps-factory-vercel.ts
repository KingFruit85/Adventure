import { join } from 'node:path';
import {
  AnthropicProvider,
  type EngineDependencies,
  FileSystemAdventureLoader,
  KeywordIntentClassifier,
  LLMIntentClassifier,
} from '@loreforge/engine';
import { VercelBlobStore } from '@loreforge/engine/blob/vercel';
import { PostgresSessionStore } from '@loreforge/engine/session-store/postgres';

/**
 * Production-on-Vercel factory. Resolves session storage to Neon Postgres,
 * blob storage to Vercel Blob, and reads the bundled adventures/ directory
 * from the function's working directory (vercel.json's `includeFiles`
 * setting copies it next to the handler at deploy time).
 *
 * Env vars expected at runtime (set in Vercel project settings or
 * auto-injected by the Storage integration):
 *   DATABASE_URL                 Neon Postgres connection string
 *   BLOB_READ_WRITE_TOKEN        Vercel Blob token (auto-set when Blob is linked)
 *   ANTHROPIC_API_KEY            Anthropic SDK key
 *   USE_LLM_INTENT_CLASSIFIER    "true" (default) to use haiku; "false" for keyword
 *
 * This factory deliberately does NOT import SQLite or filesystem-blob
 * code, so the Vercel function bundle stays free of better-sqlite3's
 * native binary. The corresponding local-dev wiring lives in
 * deps-factory.ts.
 */
export function buildVercelEngineDependencies(): EngineDependencies {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set — Neon Postgres is required on Vercel');
  }

  // includeFiles in vercel.json copies adventures/ next to the function, so
  // process.cwd() resolves to the deployment root with adventures/ alongside.
  const adventuresDir = join(process.cwd(), 'adventures');

  const useLLMIntentClassifier = process.env.USE_LLM_INTENT_CLASSIFIER !== 'false';
  const llmProvider = new AnthropicProvider();

  return {
    sessionStore: new PostgresSessionStore(databaseUrl),
    adventureLoader: new FileSystemAdventureLoader(adventuresDir),
    blobStore: new VercelBlobStore(),
    llmProvider,
    intentClassifier: useLLMIntentClassifier
      ? new LLMIntentClassifier(llmProvider)
      : new KeywordIntentClassifier(),
  };
}
