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

describe('processTurn — turn counter is monotonic', () => {
  let tmpDir: string;
  let store: SQLiteSessionStore;
  let deps: EngineDependencies;
  const pendingBackground: Promise<void>[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/loreforge-turn-counter-`);
    store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
    deps = {
      sessionStore: store,
      adventureLoader: new FileSystemAdventureLoader(ADVENTURES_DIR),
      llmProvider: new MockLLMProvider({
        narratives: Array.from({ length: 25 }, () => ({ text: 'You look around.' })),
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

  it('keeps climbing once the active window starts trimming', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);
    const playerId = session.players[0]!.id;

    let lastSession = session;
    // Default active window is 10. Run 15 LOOK turns and inspect the last
    // turn's turnNumber on the session — it should be 14 (zero-indexed), not
    // stuck at 9 like the pre-fix bug.
    for (let i = 0; i < 15; i++) {
      const result = await processTurn({ sessionId: session.id, playerId, rawInput: 'look' }, deps);
      if (result.backgroundWork) pendingBackground.push(result.backgroundWork);
      lastSession = result.updatedSession;
    }

    const activeTurns = lastSession.memoryState.activeTurns;
    const lastTurnNumber = activeTurns[activeTurns.length - 1]!.turnNumber;
    expect(lastTurnNumber).toBe(14);
    // Active window should be capped at the default 10
    expect(activeTurns).toHaveLength(10);
    // First turn in the window should be turn 5 (turns 0-4 trimmed)
    expect(activeTurns[0]!.turnNumber).toBe(5);
  });
});
