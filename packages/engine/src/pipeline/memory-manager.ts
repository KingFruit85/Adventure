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
  activeWindowSize?: number;
}

/**
 * Updates session memory after a turn. Runs in two phases:
 *  1. (sync) Append the turn to the active window. If the active window grows
 *     past its limit, trim the oldest turn(s) out — they'll be re-summarised
 *     on the next location change.
 *  2. (async, fire-and-forget) Append the full turn to the blob log. If the
 *     turn included a PLAYER_MOVED change, kick off section summarisation for
 *     the location being left.
 *
 * Returns the synchronously-updated session so callers can persist it
 * immediately, while background work continues.
 */
export async function updateMemory(
  session: GameSession,
  turn: TurnEntry,
  ctx: { adventure: AdventureDefinition; previousLocationId: string | null },
  deps: MemoryManagerDeps,
): Promise<{ session: GameSession; backgroundWork: Promise<void> }> {
  const windowSize = deps.activeWindowSize ?? DEFAULT_ACTIVE_WINDOW_SIZE;
  const nextActive = [...session.memoryState.activeTurns, turn];
  const trimmed =
    nextActive.length > windowSize ? nextActive.slice(nextActive.length - windowSize) : nextActive;

  const nextSession: GameSession = {
    ...session,
    memoryState: { ...session.memoryState, activeTurns: trimmed },
  };

  const movedAway = turn.stateChanges.find(
    (c): c is Extract<StateChange, { type: 'PLAYER_MOVED' }> => c.type === 'PLAYER_MOVED',
  );
  const shouldSummarise =
    movedAway && ctx.previousLocationId && movedAway.toLocationId !== ctx.previousLocationId;

  const backgroundWork = (async () => {
    try {
      await deps.blob.appendTurn(session.id, turn);
      if (shouldSummarise && ctx.previousLocationId) {
        const summary = await summariseLocationVisit({
          session: nextSession,
          locationId: ctx.previousLocationId,
          llm: deps.llm,
          blob: deps.blob,
        });
        if (summary) {
          nextSession.memoryState.sectionSummaries.push(summary);
        }
      }
    } catch (err) {
      // Fire-and-forget: log but do not surface to the player.
      // Phase 2 wires a real logger.
      console.error('[memory] background work failed:', err);
    }
  })();

  return { session: nextSession, backgroundWork };
}

/**
 * Phase 1: returns a deterministic placeholder summary so the rest of the
 * pipeline can verify that summaries get persisted. Phase 2 swaps this for a
 * real haiku-backed prompt.
 */
async function summariseLocationVisit(input: {
  session: GameSession;
  locationId: string;
  llm: LLMProvider;
  blob: BlobStore;
}): Promise<SectionSummary | null> {
  const turnsHere = input.session.memoryState.activeTurns.filter(
    (t) =>
      t.stateChanges.some(
        (c) => c.type === 'PLAYER_MOVED' && c.toLocationId !== input.locationId,
      ) || t.narrativeResponse.includes(input.locationId),
  );
  if (turnsHere.length === 0) return null;
  const turnNumbers = turnsHere.map((t) => t.turnNumber);
  const summary = await input.llm.complete({
    systemPrompt: 'Summarise a sequence of adventure turns in 2-3 sentences.',
    userPrompt: turnsHere
      .map((t) => `Turn ${t.turnNumber}: ${t.playerInput} -> ${t.narrativeResponse}`)
      .join('\n'),
  });
  const priorVisits = input.session.memoryState.sectionSummaries.filter(
    (s) => s.locationId === input.locationId,
  ).length;
  return {
    locationId: input.locationId,
    visitIndex: priorVisits + 1,
    turnRange: [Math.min(...turnNumbers), Math.max(...turnNumbers)],
    summary,
    keyEvents: [],
  };
}
