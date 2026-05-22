import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type EngineDependencies,
  FileSystemAdventureLoader,
  FilesystemBlobStore,
  KeywordIntentClassifier,
  MockLLMProvider,
  SQLiteSessionStore,
} from '@loreforge/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADVENTURES_DIR = resolve(__dirname, '../../../adventures');

interface Harness {
  app: ReturnType<typeof buildApp>;
  deps: EngineDependencies;
  store: SQLiteSessionStore;
  tmpDir: string;
}

function makeHarness(
  narrative: {
    text?: string;
    toolCalls?: { name: string; input: Record<string, unknown> }[];
  }[] = [],
): Harness {
  const tmpDir = mkdtempSync(`${tmpdir()}/loreforge-api-`);
  const store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
  const deps: EngineDependencies = {
    sessionStore: store,
    adventureLoader: new FileSystemAdventureLoader(ADVENTURES_DIR),
    llmProvider: new MockLLMProvider({ narratives: narrative }),
    blobStore: new FilesystemBlobStore(`${tmpDir}/blobs`),
    intentClassifier: new KeywordIntentClassifier(),
  };
  return { app: buildApp(deps), deps, store, tmpDir };
}

describe('LoreForge API', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness([{ text: 'You take in the smoky tavern air.' }]);
  });

  afterEach(async () => {
    // Give SSE background work (fire-and-forget blob append) a tick to settle
    // before we yank the tmpdir out from under it. In production the dir
    // doesn't disappear so this race doesn't exist.
    await new Promise((r) => setTimeout(r, 50));
    harness.store.close();
    rmSync(harness.tmpDir, { recursive: true, force: true });
  });

  it('serves a health check', async () => {
    const res = await harness.app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('lists available adventures', async () => {
    const res = await harness.app.request('/adventures');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((a) => a.id === 'whispers-of-eldenmoor')).toBe(true);
  });

  it('returns 404 for unknown adventure', async () => {
    const res = await harness.app.request('/adventures/no-such-adventure');
    expect(res.status).toBe(404);
  });

  it('creates a session and lets it be loaded by code', async () => {
    const create = await harness.app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-fingerprint': 'fp-1' },
      body: JSON.stringify({
        adventureId: 'whispers-of-eldenmoor',
        players: [{ name: 'Hero', classId: 'warrior' }],
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      sessionCode: string;
      session: { id: string; players: { id: string; name: string }[] };
    };
    expect(created.sessionCode).toMatch(/^[A-Z]+-\d{2}-[A-Z]+$/);

    const reload = await harness.app.request(`/sessions/${created.sessionCode}`);
    expect(reload.status).toBe(200);
    const loaded = (await reload.json()) as { session: { id: string } };
    expect(loaded.session.id).toBe(created.session.id);

    const list = await harness.app.request('/device-sessions', {
      headers: { 'x-device-fingerprint': 'fp-1' },
    });
    expect(list.status).toBe(200);
    const sessions = (await list.json()) as Array<{ sessionCode: string }>;
    expect(sessions.some((s) => s.sessionCode === created.sessionCode)).toBe(true);
  });

  it('rejects malformed session-create payload', async () => {
    const res = await harness.app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adventureId: 'whispers-of-eldenmoor' }), // missing players
    });
    expect(res.status).toBe(400);
  });

  it('streams a turn over SSE with text_delta + turn_complete events', async () => {
    const create = await harness.app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        adventureId: 'whispers-of-eldenmoor',
        players: [{ name: 'Hero', classId: 'warrior' }],
      }),
    });
    const { sessionCode, session } = (await create.json()) as {
      sessionCode: string;
      session: { players: { id: string }[] };
    };
    const playerId = session.players[0]!.id;

    const turn = await harness.app.request(`/sessions/${sessionCode}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, input: 'look' }),
    });
    expect(turn.status).toBe(200);
    expect(turn.headers.get('content-type')).toContain('text/event-stream');

    const events = await collectSSE(turn.body!);
    const types = events.map((e) => e.event);
    expect(types).toContain('text_delta');
    expect(types[types.length - 1]).toBe('turn_complete');
  });

  it('emits validation_error on a disallowed move', async () => {
    const create = await harness.app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        adventureId: 'whispers-of-eldenmoor',
        players: [{ name: 'Hero', classId: 'warrior' }],
      }),
    });
    const { sessionCode, session } = (await create.json()) as {
      sessionCode: string;
      session: { players: { id: string }[] };
    };
    const playerId = session.players[0]!.id;

    const turn = await harness.app.request(`/sessions/${sessionCode}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, input: 'north' }),
    });
    expect(turn.status).toBe(200);
    const events = await collectSSE(turn.body!);
    expect(events.map((e) => e.event)).toContain('validation_error');
  });
});

interface SSEEvent {
  event: string;
  data: string;
}

async function collectSSE(stream: ReadableStream<Uint8Array>): Promise<SSEEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events: SSEEvent[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop() ?? '';
    for (const block of blocks) {
      const lines = block.split('\n');
      const evLine = lines.find((l) => l.startsWith('event:'));
      const dataLine = lines.find((l) => l.startsWith('data:'));
      if (!evLine || !dataLine) continue;
      events.push({
        event: evLine.slice('event:'.length).trim(),
        data: dataLine.slice('data:'.length).trim(),
      });
    }
  }
  return events;
}
