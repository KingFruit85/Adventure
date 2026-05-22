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

describe('processTurn — combat resolution', () => {
  let tmpDir: string;
  let llm: MockLLMProvider;
  let deps: EngineDependencies;
  let store: SQLiteSessionStore;
  const pendingBackground: Promise<void>[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/loreforge-combat-`);
    store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
    llm = new MockLLMProvider({
      narratives: [{ text: 'You strike the chief down. The forest goes quiet.' }],
    });
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

  it('rolls dice and resolves combat; engine emits NPC_DEFEATED on lethal damage', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    // Force the player into the forest with the quest active
    session.players[0]!.currentLocationId = 'forest_clearing';
    session.worldState.activeQuestIds.push('the_goblin_threat');
    await deps.sessionStore.create(session);
    const playerId = session.players[0]!.id;

    // Drive enough attacks that the chief eventually falls.
    // With AC 13 / HP 12 / d6+1 damage, this is probabilistic — loop a
    // bounded number of times. Combat is engine-resolved, so the test
    // doesn't need the LLM to emit anything for the defeat to register.
    let result = await processTurn(
      { sessionId: session.id, playerId, rawInput: 'attack chief' },
      deps,
    );
    if (result.backgroundWork) pendingBackground.push(result.backgroundWork);
    let attempts = 1;
    while (
      attempts < 100 &&
      !result.updatedSession.worldState.defeatedNpcIds.includes('goblin_chief')
    ) {
      result = await processTurn(
        { sessionId: session.id, playerId, rawInput: 'attack chief' },
        deps,
      );
      if (result.backgroundWork) pendingBackground.push(result.backgroundWork);
      attempts++;
    }

    expect(result.updatedSession.worldState.defeatedNpcIds).toContain('goblin_chief');
    expect(result.updatedSession.worldState.completedGoalIds).toContain('defeat_goblin_chief');
    expect(result.updatedSession.status).toBe('COMPLETED');
  });
});
