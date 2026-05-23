import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TurnEvent } from '@loreforge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemAdventureLoader } from '../adventures/loader.js';
import { FilesystemBlobStore } from '../blob/filesystem.js';
import type { EngineDependencies } from '../deps.js';
import { MockLLMProvider } from '../llm/mock-provider.js';
import { SQLiteSessionStore } from '../session-store/sqlite.js';
import { KeywordIntentClassifier } from './intent-parser.js';
import { streamTurn } from './process-turn.js';
import { createSession } from './session-factory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADVENTURES_DIR = resolve(__dirname, '../../../../adventures');

describe('streamTurn', () => {
  let tmpDir: string;
  let store: SQLiteSessionStore;
  let deps: EngineDependencies;

  beforeEach(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/loreforge-stream-`);
    store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
    deps = {
      sessionStore: store,
      adventureLoader: new FileSystemAdventureLoader(ADVENTURES_DIR),
      llmProvider: new MockLLMProvider({
        narratives: [{ text: 'The bar is hushed.' }],
      }),
      blobStore: new FilesystemBlobStore(`${tmpDir}/blobs`),
      intentClassifier: new KeywordIntentClassifier(),
    };
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const collect = async (sessionId: string, playerId: string, rawInput: string) => {
    const handle = streamTurn({ sessionId, playerId, rawInput }, deps);
    const events: TurnEvent[] = [];
    for await (const e of handle.events) events.push(e);
    await handle.backgroundWork;
    return events;
  };

  it('emits validation_error then turn_complete for a rejected action', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);

    const events = await collect(session.id, session.players[0]!.id, 'north');
    const types = events.map((e) => e.type);
    expect(types).toEqual(['validation_error', 'turn_complete']);
  });

  it('emits text_delta and turn_complete on a happy-path turn', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);

    const events = await collect(session.id, session.players[0]!.id, 'look');
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);
    expect(events[events.length - 1]!.type).toBe('turn_complete');
  });
});
