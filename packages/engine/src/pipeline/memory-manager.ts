import type {
  AdventureDefinition,
  GameSession,
  SectionSummary,
  StateChange,
  TurnEntry,
} from '@loreforge/shared';
import type { BlobStore } from '../blob/interface.js';
import type { LLMProvider } from '../llm/provider.js';

const DEFAULT_ACTIVE_WINDOW_SIZE = 10;

export interface MemoryManagerDeps {
  blob: BlobStore;
  llm: LLMProvider;
  /**
   * Called after asynchronous summarisation completes so the resulting
   * SectionSummary can be persisted. Without this callback the summary lives
   * only in memory and is lost when the engine has already returned the
   * "sync" version of the session to the API layer.
   */
  saveUpdatedSession?: (session: GameSession) => Promise<void>;
  activeWindowSize?: number;
}

export interface UpdateMemoryResult {
  session: GameSession;
  /**
   * Resolves once background work (blob append + summarisation + save)
   * completes. Production callers can ignore; tests should await before
   * making assertions that depend on the summary being persisted.
   */
  backgroundWork: Promise<void>;
}

/**
 * Updates session memory after a turn.
 *
 * Sync work (returned in `session`):
 *   - Append the new turn to the active window.
 *   - If the player moved to a new location, reset the active window: it now
 *     contains only the move turn. The turns at the previous location are
 *     handed off to background summarisation.
 *   - Otherwise trim the active window to `activeWindowSize`.
 *
 * Background work (`backgroundWork` promise):
 *   - Append the turn to the blob log.
 *   - If a location change occurred and there are turns to summarise, call
 *     the LLM, attach the resulting SectionSummary to a fresh copy of the
 *     session, and persist via `saveUpdatedSession`.
 */
export async function updateMemory(
  session: GameSession,
  turn: TurnEntry,
  ctx: { adventure: AdventureDefinition; previousLocationId: string | null },
  deps: MemoryManagerDeps,
): Promise<UpdateMemoryResult> {
  const windowSize = deps.activeWindowSize ?? DEFAULT_ACTIVE_WINDOW_SIZE;

  const movedAway = turn.stateChanges.find(
    (c): c is Extract<StateChange, { type: 'PLAYER_MOVED' }> => c.type === 'PLAYER_MOVED',
  );
  const shouldSummarise =
    !!movedAway && !!ctx.previousLocationId && movedAway.toLocationId !== ctx.previousLocationId;

  // Turns at the previous location = everything currently in activeTurns
  // (they happened *before* this move turn).
  const turnsToSummarise = shouldSummarise ? [...session.memoryState.activeTurns] : [];

  const nextActiveTurns: TurnEntry[] = shouldSummarise
    ? [turn]
    : trimWindow([...session.memoryState.activeTurns, turn], windowSize);

  const syncSession: GameSession = {
    ...session,
    memoryState: { ...session.memoryState, activeTurns: nextActiveTurns },
  };

  const backgroundWork = (async () => {
    try {
      await deps.blob.appendTurn(session.id, turn);
      if (!shouldSummarise || !ctx.previousLocationId || turnsToSummarise.length === 0) {
        return;
      }
      const summary = await summariseLocationVisit({
        adventure: ctx.adventure,
        turns: turnsToSummarise,
        locationId: ctx.previousLocationId,
        priorVisits: syncSession.memoryState.sectionSummaries.filter(
          (s) => s.locationId === ctx.previousLocationId,
        ).length,
        llm: deps.llm,
      });
      if (!summary) return;

      const withSummary: GameSession = {
        ...syncSession,
        memoryState: {
          ...syncSession.memoryState,
          sectionSummaries: [...syncSession.memoryState.sectionSummaries, summary],
        },
      };
      if (deps.saveUpdatedSession) {
        await deps.saveUpdatedSession(withSummary);
      }
    } catch (err) {
      console.error('[memory] background work failed:', err);
    }
  })();

  return { session: syncSession, backgroundWork };
}

function trimWindow(turns: TurnEntry[], size: number): TurnEntry[] {
  return turns.length > size ? turns.slice(turns.length - size) : turns;
}

interface SummariseInput {
  adventure: AdventureDefinition;
  turns: TurnEntry[];
  locationId: string;
  priorVisits: number;
  llm: LLMProvider;
}

async function summariseLocationVisit(input: SummariseInput): Promise<SectionSummary | null> {
  if (input.turns.length === 0) return null;
  const turnNumbers = input.turns.map((t) => t.turnNumber);
  const locationName = input.adventure.locations[input.locationId]?.name ?? input.locationId;
  const transcript = input.turns
    .map((t) => `Turn ${t.turnNumber}: PLAYER: ${t.playerInput}\nNARRATIVE: ${t.narrativeResponse}`)
    .join('\n\n');

  const systemPrompt = `You compress chunks of an adventure transcript into terse memory for a narrator LLM. Return a single JSON object — no prose, no markdown fences. Shape:
{
  "summary": "2-3 sentences in past tense capturing what happened and how it ended",
  "keyEvents": ["3-5 short bullet points: notable items found, NPCs spoken to, fights, decisions, mood shifts"]
}
Be specific. Use proper nouns from the transcript. Do not invent events.`;

  const userPrompt = `Location: ${locationName} (${input.locationId})

Transcript:
${transcript}

Return only the JSON object.`;

  try {
    const raw = await input.llm.complete({ systemPrompt, userPrompt, maxTokens: 512 });
    const parsed = parseJsonResponse<{ summary?: unknown; keyEvents?: unknown }>(raw);
    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const keyEvents = Array.isArray(parsed.keyEvents)
      ? parsed.keyEvents.filter((x): x is string => typeof x === 'string')
      : [];
    if (!summary) return null;
    return {
      locationId: input.locationId,
      visitIndex: input.priorVisits + 1,
      turnRange: [Math.min(...turnNumbers), Math.max(...turnNumbers)],
      summary,
      keyEvents,
    };
  } catch (err) {
    console.error('[memory] summarisation failed:', err);
    return null;
  }
}

function parseJsonResponse<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const json = fenceMatch ? fenceMatch[1]!.trim() : trimmed;
  return JSON.parse(json) as T;
}
