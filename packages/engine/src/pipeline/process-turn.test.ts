import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemAdventureLoader } from '../adventures/loader.js';
import { FilesystemBlobStore } from '../blob/filesystem.js';
import type { EngineDependencies } from '../deps.js';
import { MockLLMProvider } from '../llm/mock-provider.js';
import { SQLiteSessionStore } from '../session-store/sqlite.js';
import { KeywordIntentClassifier } from './intent-parser.js';
import { processTurn } from './process-turn.js';
import { createSession } from './session-factory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADVENTURES_DIR = resolve(__dirname, '../../../../adventures');

describe('processTurn (full pipeline, mocked LLM)', () => {
  let tmpDir: string;
  let llm: MockLLMProvider;
  let deps: EngineDependencies;
  let store: SQLiteSessionStore;
  const pendingBackground: Promise<void>[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/loreforge-test-`);
    store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
    llm = new MockLLMProvider();
    deps = {
      sessionStore: store,
      adventureLoader: new FileSystemAdventureLoader(ADVENTURES_DIR),
      llmProvider: llm,
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

  it('applies an LLM-emitted item_added_to_inventory tool call', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);
    const playerId = session.players[0]!.id;

    llm = new MockLLMProvider({
      narratives: [
        {
          text: 'You take the bread loaf and stuff it in your pack.',
          toolCalls: [
            {
              name: 'item_added_to_inventory',
              input: { playerId, itemId: 'bread_loaf', quantity: 1 },
            },
          ],
        },
      ],
    });
    deps.llmProvider = llm;

    const result = await run(session.id, playerId, 'take bread');
    expect(result.validationError).toBeUndefined();
    const updatedPlayer = result.updatedSession.players[0]!;
    expect(updatedPlayer.inventory.some((i) => i.itemId === 'bread_loaf')).toBe(true);
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

  it('caches the system prompt prefix on the narrative call', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);
    const playerId = session.players[0]!.id;

    await run(session.id, playerId, 'look');

    expect(llm.lastNarrativePrompt).toBeDefined();
    expect(llm.lastNarrativePrompt!.systemPrompt).toContain('WORLD CONTEXT');
    expect(llm.lastNarrativePrompt!.systemPrompt).toContain('ID REFERENCE');
    // Volatile data must NOT be in the system prompt
    expect(llm.lastNarrativePrompt!.systemPrompt).not.toContain('HP:');
    expect(llm.lastNarrativePrompt!.userContext).toContain('HP:');
  });
});
