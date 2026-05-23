import type {
  AdventureDefinition,
  AdventureMetadata,
  DiceRoll,
  GameSession,
  SessionSummary,
  StateChange,
  TurnEvent,
} from '@loreforge/shared';
import { getDeviceFingerprint } from './device-fingerprint.js';
import { readSSE } from './sse-consumer.js';

const DEVICE_HEADER = 'x-device-fingerprint';

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    [DEVICE_HEADER]: getDeviceFingerprint(),
    ...extra,
  };
}

async function expectOk(res: Response): Promise<Response> {
  if (!res.ok) {
    let detail: unknown = undefined;
    try {
      detail = await res.json();
    } catch {
      // body might not be JSON; ignore
    }
    const message =
      (detail &&
      typeof detail === 'object' &&
      'error' in detail &&
      typeof (detail as { error: unknown }).error === 'string'
        ? (detail as { error: string }).error
        : null) ?? `Request failed: ${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return res;
}

export async function listAdventures(): Promise<AdventureMetadata[]> {
  const res = await fetch('/adventures', { headers: headers() });
  await expectOk(res);
  return res.json() as Promise<AdventureMetadata[]>;
}

export async function getAdventure(id: string): Promise<AdventureDefinition> {
  const res = await fetch(`/adventures/${encodeURIComponent(id)}`, { headers: headers() });
  await expectOk(res);
  return res.json() as Promise<AdventureDefinition>;
}

export interface CreateSessionParams {
  adventureId: string;
  players: Array<{ name: string; classId: string }>;
}

export interface CreateSessionResult {
  sessionCode: string;
  session: GameSession;
}

export async function createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
  const res = await fetch('/sessions', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(params),
  });
  await expectOk(res);
  return res.json() as Promise<CreateSessionResult>;
}

export async function getSessionByCode(code: string): Promise<GameSession> {
  const res = await fetch(`/sessions/${encodeURIComponent(code)}`, { headers: headers() });
  await expectOk(res);
  const body = (await res.json()) as { session: GameSession };
  return body.session;
}

export async function listMySessions(): Promise<SessionSummary[]> {
  const res = await fetch('/device-sessions', { headers: headers() });
  await expectOk(res);
  return res.json() as Promise<SessionSummary[]>;
}

/**
 * Submits a turn and yields TurnEvent objects as the server streams them.
 * Cancel via `signal.abort()` — the underlying fetch is aborted and the
 * generator returns cleanly.
 */
export async function* streamTurn(
  code: string,
  body: { playerId: string; input: string },
  signal?: AbortSignal,
): AsyncGenerator<TurnEvent, void, void> {
  const res = await fetch(`/sessions/${encodeURIComponent(code)}/turn`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
  await expectOk(res);
  if (!res.body) throw new Error('Turn endpoint returned no body');

  for await (const frame of readSSE(res.body, signal)) {
    const payload = frame.data ? JSON.parse(frame.data) : {};
    yield sseFrameToEvent(frame.event, payload);
  }
}

function sseFrameToEvent(event: string, data: Record<string, unknown>): TurnEvent {
  switch (event) {
    case 'validation_error':
      return { type: 'validation_error', message: String(data.message ?? '') };
    case 'roll_result':
      return { type: 'roll_result', roll: data as unknown as DiceRoll };
    case 'text_delta':
      return { type: 'text_delta', delta: String(data.delta ?? '') };
    case 'state_change':
      return { type: 'state_change', change: data as unknown as StateChange };
    case 'turn_complete':
      return {
        type: 'turn_complete',
        stateChanges: (data.stateChanges as StateChange[]) ?? [],
        updatedSession: data.updatedSession as GameSession,
      };
    default:
      // Unknown event — surface as a synthetic validation_error so consumers
      // don't silently lose data.
      return { type: 'validation_error', message: `Unknown SSE event: ${event}` };
  }
}
