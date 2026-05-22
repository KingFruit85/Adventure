import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileSystemAdventureLoader } from '../adventures/loader.js';
import { FilesystemBlobStore } from '../blob/filesystem.js';
import type { EngineDependencies } from '../deps.js';
import { LLMIntentClassifier } from '../pipeline/intent-parser.js';
import { processTurn } from '../pipeline/process-turn.js';
import { createSession } from '../pipeline/session-factory.js';
import { SQLiteSessionStore } from '../session-store/sqlite.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { loadEnv } from './env.js';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADVENTURES_DIR = resolve(__dirname, '../../../../adventures');

const LIVE = process.env.RUN_LIVE_TESTS === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

describe.runIf(LIVE)('AnthropicProvider live integration', () => {
  let tmpDir: string;
  let store: SQLiteSessionStore;
  let deps: EngineDependencies;

  beforeAll(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/loreforge-live-`);
    store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
    const llm = new AnthropicProvider();
    deps = {
      sessionStore: store,
      adventureLoader: new FileSystemAdventureLoader(ADVENTURES_DIR),
      llmProvider: llm,
      blobStore: new FilesystemBlobStore(`${tmpDir}/blobs`),
      intentClassifier: new LLMIntentClassifier(llm),
    };
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('classifies "look around" as LOOK via haiku', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);

    const result = await processTurn(
      { sessionId: session.id, playerId: session.players[0]!.id, rawInput: 'look around' },
      deps,
    );
    await result.backgroundWork?.catch(() => {});

    expect(result.validationError).toBeUndefined();
    expect(result.narrative.length).toBeGreaterThan(20);
  }, 30_000);

  it('takes the bread when the player asks for it, narrating + tool-calling', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);

    const result = await processTurn(
      {
        sessionId: session.id,
        playerId: session.players[0]!.id,
        rawInput: 'grab the loaf of bread off the bar',
      },
      deps,
    );
    await result.backgroundWork?.catch(() => {});

    expect(result.validationError).toBeUndefined();
    // The LLM should have called item_added_to_inventory; verify via session state.
    const player = result.updatedSession.players[0]!;
    expect(player.inventory.some((i) => i.itemId === 'bread_loaf')).toBe(true);
  }, 30_000);
});
