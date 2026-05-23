import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameSession } from '@loreforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileSystemAdventureLoader } from './adventures/loader.js';
import { FilesystemBlobStore } from './blob/filesystem.js';
import type { EngineDependencies } from './deps.js';
import { AnthropicProvider } from './llm/anthropic-provider.js';
import { loadEnv } from './llm/env.js';
import { LLMIntentClassifier } from './pipeline/intent-parser.js';
import { processTurn } from './pipeline/process-turn.js';
import { createSession } from './pipeline/session-factory.js';
import { SQLiteSessionStore } from './session-store/sqlite.js';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADVENTURES_DIR = resolve(__dirname, '../../../adventures');
const LIVE = process.env.RUN_LIVE_TESTS === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

describe.runIf(LIVE)('PoC Validation — Whispers of Eldenmoor', () => {
  let tmpDir: string;
  let store: SQLiteSessionStore;
  let deps: EngineDependencies;

  beforeAll(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/loreforge-poc-`);
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

  async function runTurn(
    sessionId: string,
    playerId: string,
    rawInput: string,
  ): Promise<{ narrative: string; updatedSession: GameSession }> {
    // Capture the parsed action by intercepting the classifier briefly.
    const realClassify = deps.intentClassifier.classify.bind(deps.intentClassifier);
    let capturedAction = '';
    deps.intentClassifier.classify = async (input, ctx) => {
      const a = await realClassify(input, ctx);
      capturedAction = `${a.type}(${JSON.stringify(a.params)})`;
      return a;
    };
    const result = await processTurn({ sessionId, playerId, rawInput }, deps);
    deps.intentClassifier.classify = realClassify;
    await result.backgroundWork?.catch(() => {});
    if (process.env.LOREFORGE_TRANSCRIPT) {
      const types = result.stateChanges.map((c) => c.type).join(', ') || '(none)';
      const npcHp = JSON.stringify(result.updatedSession.worldState.npcHp);
      const completed = result.updatedSession.worldState.completedGoalIds.join(',') || '-';
      console.log(
        `\n> ${rawInput}\n  action=${capturedAction}\n  [validation: ${result.validationError ?? 'ok'}; changes: ${types}; npcHp: ${npcHp}; completed: ${completed}; status: ${result.updatedSession.status}]`,
      );
    }
    return { narrative: result.narrative, updatedSession: result.updatedSession };
  }

  it('Warrior playthrough: tavern → quest → forest → defeat goblin chief', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Brann', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);
    const playerId = session.players[0]!.id;

    // 1. Talk to Mira — auto-grants the_goblin_threat quest
    let s = (await runTurn(session.id, playerId, 'talk to Mira about the missing villagers'))
      .updatedSession;
    expect(s.worldState.activeQuestIds).toContain('the_goblin_threat');

    // 2. Go north — should now be allowed
    s = (await runTurn(session.id, playerId, 'head north into the Ashwood')).updatedSession;
    expect(s.players[0]!.currentLocationId).toBe('forest_clearing');

    // 3. Attack the chief, looping until defeat (probabilistic combat)
    for (let i = 0; i < 20; i++) {
      s = (await runTurn(session.id, playerId, 'attack the goblin chief')).updatedSession;
      if (s.worldState.defeatedNpcIds.includes('goblin_chief')) break;
      if (s.players[0]!.hp.current <= 0) break;
    }
    expect(s.worldState.defeatedNpcIds).toContain('goblin_chief');
    expect(s.worldState.completedGoalIds).toContain('defeat_goblin_chief');
    expect(s.status).toBe('COMPLETED');
  }, 300_000);

  it('Mage playthrough: same arc, using fire_bolt instead of melee', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Sage', classId: 'mage' }],
    });
    await deps.sessionStore.create(session);
    const playerId = session.players[0]!.id;

    // 1. Talk to Mira
    let s = (await runTurn(session.id, playerId, 'speak with the innkeeper Mira')).updatedSession;
    expect(s.worldState.activeQuestIds).toContain('the_goblin_threat');

    // 2. Move north
    s = (await runTurn(session.id, playerId, 'go north toward the Ashwood clearing'))
      .updatedSession;
    expect(s.players[0]!.currentLocationId).toBe('forest_clearing');

    // 3. Cast fire_bolt repeatedly — keyword intent classifier handles this
    //    sentence shape ("cast fire_bolt at the goblin chief") via the haiku
    //    classifier. The Mage cannot ATTACK so any fallback to ATTACK would
    //    be rejected by the validator.
    for (let i = 0; i < 20; i++) {
      s = (await runTurn(session.id, playerId, 'cast fire_bolt at the goblin chief'))
        .updatedSession;
      if (s.worldState.defeatedNpcIds.includes('goblin_chief')) break;
      if (s.players[0]!.hp.current <= 0) break;
    }
    expect(s.worldState.defeatedNpcIds).toContain('goblin_chief');
    expect(s.status).toBe('COMPLETED');
  }, 300_000);

  it('Session resumes after store close+reopen (browser-close simulation)', async () => {
    const adventure = await deps.adventureLoader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Resumer', classId: 'warrior' }],
    });
    await deps.sessionStore.create(session);
    const playerId = session.players[0]!.id;
    const sessionId = session.id;
    const sessionCode = session.sessionCode;

    // First leg: talk to Mira (grants quest), then move
    await runTurn(sessionId, playerId, 'talk to mira');
    await runTurn(sessionId, playerId, 'go north');

    // "Close the browser" — close the store, reopen from the same DB path.
    store.close();
    store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
    deps.sessionStore = store;

    // Reload session via the public API the frontend uses.
    const restored = await store.getByCode(sessionCode);
    expect(restored).not.toBeNull();
    expect(restored!.players[0]!.currentLocationId).toBe('forest_clearing');
    expect(restored!.worldState.activeQuestIds).toContain('the_goblin_threat');

    // Continue the adventure on the restored session — verifying the
    // pipeline still works against a re-loaded SQLite store.
    const s = (await runTurn(restored!.id, playerId, 'look around the clearing')).updatedSession;
    expect(s.memoryState.activeTurns.length).toBeGreaterThan(0);
  }, 300_000);
});
