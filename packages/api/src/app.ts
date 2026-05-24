import {
  type EngineDependencies,
  createSession,
  generateSessionCode,
  streamTurn,
} from '@loreforge/engine';
import type {
  AdventureDefinition,
  GameSession,
  SessionSummary,
  TurnEvent,
} from '@loreforge/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

const DEVICE_HEADER = 'x-device-fingerprint';

const CreateSessionBody = z.object({
  adventureId: z.string(),
  players: z.array(z.object({ name: z.string().min(1), classId: z.string() })).min(1),
});

const TurnBody = z.object({
  playerId: z.string().uuid(),
  input: z.string().min(1),
});

/**
 * Builds the Hono app over a set of engine dependencies. The app is built
 * stateless except for the injected deps — `buildApp(deps)` can be called
 * from tests with a MockLLMProvider-backed deps bundle to drive the full
 * HTTP surface without burning API credits.
 */
export function buildApp(deps: EngineDependencies) {
  // Everything is mounted under /api. In production on Vercel, vercel.json
  // rewrites /api/* to the function entrypoint so this matches the URL the
  // client sees. In dev, Vite proxies /api/* to localhost:3000 so the same
  // paths work end-to-end.
  const app = new Hono().basePath('/api');
  app.use('*', cors());

  app.get('/health', (c) => c.json({ ok: true }));

  // ---- adventures -------------------------------------------------------

  app.get('/adventures', async (c) => {
    const list = await deps.adventureLoader.list();
    return c.json(list);
  });

  app.get('/adventures/:id', async (c) => {
    try {
      const adventure = await deps.adventureLoader.load(c.req.param('id'));
      return c.json(adventure);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  // ---- sessions ---------------------------------------------------------

  app.post('/sessions', async (c) => {
    const body = await readJson(c);
    const parsed = CreateSessionBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }

    let adventure: AdventureDefinition;
    try {
      adventure = await deps.adventureLoader.load(parsed.data.adventureId);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }

    let session: GameSession;
    try {
      session = createSession({ adventure, players: parsed.data.players });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    // Collision-check the session code. The pool of WORDS-NN-WORDS combos is
    // large enough that collisions are extremely rare, but we still retry
    // rather than 500 on the rare match.
    for (let i = 0; i < 5; i++) {
      const existing = await deps.sessionStore.getByCode(session.sessionCode);
      if (!existing) break;
      session = { ...session, sessionCode: generateSessionCode() };
    }

    await deps.sessionStore.create(session);
    const fingerprint = c.req.header(DEVICE_HEADER);
    if (fingerprint) {
      await deps.sessionStore.associateDevice(session.id, fingerprint);
    }

    return c.json({ sessionCode: session.sessionCode, session }, 201);
  });

  app.get('/sessions/:code', async (c) => {
    const session = await deps.sessionStore.getByCode(c.req.param('code'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    const fingerprint = c.req.header(DEVICE_HEADER);
    if (fingerprint) {
      // Joining via the share link should associate the device for "My
      // Adventures" listings.
      await deps.sessionStore.associateDevice(session.id, fingerprint);
    }
    return c.json({ session });
  });

  app.get('/sessions/:code/state', async (c) => {
    const session = await deps.sessionStore.getByCode(c.req.param('code'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json({ session });
  });

  app.get('/sessions/:code/history', async (c) => {
    const session = await deps.sessionStore.getByCode(c.req.param('code'));
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json({
      sectionSummaries: session.memoryState.sectionSummaries,
      activeTurns: session.memoryState.activeTurns,
    });
  });

  // ---- device sessions --------------------------------------------------

  app.get('/device-sessions', async (c) => {
    const fingerprint = c.req.header(DEVICE_HEADER);
    if (!fingerprint) {
      return c.json({ error: `Missing ${DEVICE_HEADER} header` }, 400);
    }
    const sessions: SessionSummary[] = await deps.sessionStore.listByDevice(fingerprint);
    return c.json(sessions);
  });

  // ---- turn (SSE) -------------------------------------------------------

  app.post('/sessions/:code/turn', async (c) => {
    const session = await deps.sessionStore.getByCode(c.req.param('code'));
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const body = await readJson(c);
    const parsed = TurnBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }

    const handle = streamTurn(
      { sessionId: session.id, playerId: parsed.data.playerId, rawInput: parsed.data.input },
      deps,
    );

    return streamSSE(c, async (sse) => {
      try {
        for await (const event of handle.events) {
          await sse.writeSSE({
            event: event.type,
            data: JSON.stringify(eventPayload(event)),
          });
        }
      } catch (err) {
        await sse.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: (err as Error).message }),
        });
      } finally {
        // Fire-and-forget — log on failure but don't block stream close.
        handle.backgroundWork.catch((err) => {
          console.error('[api] background work failed:', err);
        });
      }
    });
  });

  return app;
}

/**
 * Strips the discriminator from a TurnEvent so the SSE `data` payload matches
 * the event name carried in the SSE `event:` line — clients reading
 * `eventSource.addEventListener('text_delta', ...)` only care about the
 * payload-specific fields.
 */
function eventPayload(event: TurnEvent): Record<string, unknown> {
  switch (event.type) {
    case 'validation_error':
      return { message: event.message };
    case 'roll_result':
      return event.roll;
    case 'text_delta':
      return { delta: event.delta };
    case 'state_change':
      return event.change;
    case 'turn_complete':
      return { stateChanges: event.stateChanges, updatedSession: event.updatedSession };
  }
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
