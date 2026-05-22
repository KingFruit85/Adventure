import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AnthropicProvider,
  type EngineDependencies,
  FileSystemAdventureLoader,
  FilesystemBlobStore,
  LLMIntentClassifier,
  SQLiteSessionStore,
  loadEnv,
} from '@loreforge/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADVENTURES_DIR = resolve(__dirname, '../../../adventures');
const LIVE = process.env.RUN_LIVE_TESTS === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

describe.runIf(LIVE)('API live integration', () => {
  let app: ReturnType<typeof buildApp>;
  let store: SQLiteSessionStore;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/loreforge-api-live-`);
    store = new SQLiteSessionStore(`${tmpDir}/sessions.db`);
    const llm = new AnthropicProvider();
    const deps: EngineDependencies = {
      sessionStore: store,
      adventureLoader: new FileSystemAdventureLoader(ADVENTURES_DIR),
      llmProvider: llm,
      blobStore: new FilesystemBlobStore(`${tmpDir}/blobs`),
      intentClassifier: new LLMIntentClassifier(llm),
    };
    app = buildApp(deps);
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs the full HTTP loop: create session → turn → SSE narrative', async () => {
    const created = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        adventureId: 'whispers-of-eldenmoor',
        players: [{ name: 'Hero', classId: 'warrior' }],
      }),
    });
    expect(created.status).toBe(201);
    const { sessionCode, session } = (await created.json()) as {
      sessionCode: string;
      session: { players: { id: string }[] };
    };
    const playerId = session.players[0]!.id;

    const turn = await app.request(`/sessions/${sessionCode}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, input: 'look around the tavern' }),
    });
    expect(turn.status).toBe(200);

    const events = await collectSSE(turn.body!);
    const types = events.map((e) => e.event);
    expect(types).toContain('text_delta');
    expect(types[types.length - 1]).toBe('turn_complete');

    // The narrative should be a non-empty string with actual prose.
    const textDeltas = events
      .filter((e) => e.event === 'text_delta')
      .map((e) => (JSON.parse(e.data) as { delta: string }).delta)
      .join('');
    expect(textDeltas.length).toBeGreaterThan(40);
  }, 30_000);
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
