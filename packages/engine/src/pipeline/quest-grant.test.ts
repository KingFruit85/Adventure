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

describe('processTurn — auto quest grant on TALK_TO_NPC', () => {
  let tmpDir: string;
  let store: SQLiteSessionStore;
  let deps: EngineDependencies;
  const pendingBackground: Promise<void>[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/loreforge-quest-`);
    store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
    deps = {
      sessionStore: store,
      adventureLoader: new FileSystemAdventureLoader(ADVENTURES_DIR),
      llmProvider: new MockLLMProvider({
        narratives: [{ text: 'Mira eyes you, then nods.' }],
      }),
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

  it('grants the_goblin_threat quest when talking to Mira', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);

    const result = await processTurn(
      { sessionId: session.id, playerId: session.players[0]!.id, rawInput: 'talk to mira' },
      deps,
    );
    if (result.backgroundWork) pendingBackground.push(result.backgroundWork);

    expect(result.updatedSession.worldState.activeQuestIds).toContain('the_goblin_threat');
    expect(result.updatedSession.players[0]!.activeQuestIds).toContain('the_goblin_threat');
  });

  it('does not re-grant if quest already active', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    session.worldState.activeQuestIds.push('the_goblin_threat');
    session.players[0]!.activeQuestIds.push('the_goblin_threat');
    await deps.sessionStore.create(session);

    const result = await processTurn(
      { sessionId: session.id, playerId: session.players[0]!.id, rawInput: 'talk to mira' },
      deps,
    );
    if (result.backgroundWork) pendingBackground.push(result.backgroundWork);

    // Still active, but no duplicate QUEST_STARTED change emitted.
    const questStarted = result.stateChanges.filter((c) => c.type === 'QUEST_STARTED');
    expect(questStarted).toHaveLength(0);
  });
});
