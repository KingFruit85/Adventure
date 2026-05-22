import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemAdventureLoader } from '../adventures/loader.js';
import { FilesystemBlobStore } from '../blob/filesystem.js';
import type { EngineDependencies } from '../deps.js';
import { StubLLMProvider } from '../llm/provider.js';
import { SQLiteSessionStore } from '../session-store/sqlite.js';
import { KeywordIntentClassifier } from './intent-parser.js';
import { processTurn } from './process-turn.js';
import { createSession } from './session-factory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADVENTURES_DIR = resolve(__dirname, '../../../../adventures');

describe('processTurn (full pipeline, Phase 1 stubs)', () => {
  let tmpDir: string;
  let deps: EngineDependencies;
  let store: SQLiteSessionStore;
  const pendingBackground: Promise<void>[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/loreforge-test-`);
    store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
    deps = {
      sessionStore: store,
      adventureLoader: new FileSystemAdventureLoader(ADVENTURES_DIR),
      llmProvider: new StubLLMProvider(),
      blobStore: new FilesystemBlobStore(`${tmpDir}/blobs`),
      intentClassifier: new KeywordIntentClassifier(),
    };
    pendingBackground.length = 0;
  });

  afterEach(async () => {
    await Promise.allSettled(pendingBackground);
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const run = async (sessionId: string, playerId: string, rawInput: string) => {
    const result = await processTurn({ sessionId, playerId, rawInput }, deps);
    if (result.backgroundWork) pendingBackground.push(result.backgroundWork);
    return result;
  };

  it('rejects an invalid action with a player-friendly reason', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);

    const result = await run(session.id, session.players[0]!.id, 'north');
    expect(result.validationError).toBeDefined();
    expect(result.stateChanges).toHaveLength(0);
  });

  it('picks up an item and records the inventory change', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);

    const result = await run(session.id, session.players[0]!.id, 'take bread');

    expect(result.validationError).toBeUndefined();
    const player = result.updatedSession.players[0]!;
    expect(player.inventory.some((i) => i.itemId === 'bread_loaf')).toBe(true);
  });

  it('persists session updates through the store', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);

    await run(session.id, session.players[0]!.id, 'look');

    const reloaded = await deps.sessionStore.get(session.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.memoryState.activeTurns.length).toBe(1);
  });
});
