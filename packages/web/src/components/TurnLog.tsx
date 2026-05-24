import type {
  AdventureDefinition,
  DiceRoll,
  GameSession,
  StateChange,
  TurnEntry,
} from '@loreforge/shared';
import { useLayoutEffect, useRef } from 'react';
import { DiceAnimation } from './DiceAnimation.js';
import { TurnChanges } from './TurnChanges.js';

interface Props {
  session: GameSession;
  adventure: AdventureDefinition;
  /** In-flight turn: the player input being processed (empty when idle). */
  currentInput: string;
  /** In-flight narrative as it streams in. */
  narrative: string;
  /** Most recent dice roll for the in-flight turn (or null). */
  lastRoll: DiceRoll | null;
  /** State changes accumulated so far for the in-flight turn. */
  changes: StateChange[];
  /** True while the in-flight turn is still streaming. */
  streaming: boolean;
  /** Engine validation message if the in-flight action was rejected. */
  validationError: string | null;
}

/**
 * Scrollable chat-style log of every turn in the active memory window, plus
 * the in-flight turn at the bottom. Past turns are read from
 * `session.memoryState.activeTurns` — the engine appends to this array on
 * each `turn_complete`, so the log updates automatically.
 *
 * Turns older than the active window (~10) are summarised server-side into
 * `sectionSummaries` to save LLM tokens, so they don't appear verbatim
 * here. If unlimited scrollback becomes important, we'd either widen the
 * active window or surface those summaries as a separate "Earlier…" block.
 */
export function TurnLog({
  session,
  adventure,
  currentInput,
  narrative,
  lastRoll,
  changes,
  streaming,
  validationError,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTurns = session.memoryState.activeTurns;

  // Keep the bottom of the log in view as turns complete or the in-flight
  // narrative streams in. Running on every render is what we want — scroll
  // position needs to settle synchronously before the browser paints.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  });

  const hasInFlight = currentInput.length > 0;

  return (
    <div ref={scrollRef} className="turn-log">
      {activeTurns.length === 0 && !hasInFlight ? (
        <div className="turn-log-empty dim">Speak or type your action. The world is waiting.</div>
      ) : null}

      {activeTurns.map((entry) => (
        <PastTurnEntry key={entry.turnNumber} entry={entry} adventure={adventure} />
      ))}

      {hasInFlight ? (
        <InFlightTurnEntry
          input={currentInput}
          narrative={narrative}
          changes={changes}
          lastRoll={lastRoll}
          streaming={streaming}
          validationError={validationError}
          adventure={adventure}
        />
      ) : null}
    </div>
  );
}

function PastTurnEntry({
  entry,
  adventure,
}: {
  entry: TurnEntry;
  adventure: AdventureDefinition;
}) {
  return (
    <article className="turn-entry">
      <header className="turn-entry-input">
        <span className="turn-entry-prompt">›</span> {entry.playerInput}
      </header>
      <div className="narrative">{entry.narrativeResponse}</div>
      <TurnChanges changes={entry.stateChanges} adventure={adventure} />
    </article>
  );
}

function InFlightTurnEntry({
  input,
  narrative,
  changes,
  lastRoll,
  streaming,
  validationError,
  adventure,
}: {
  input: string;
  narrative: string;
  changes: StateChange[];
  lastRoll: DiceRoll | null;
  streaming: boolean;
  validationError: string | null;
  adventure: AdventureDefinition;
}) {
  return (
    <article className="turn-entry in-flight">
      <header className="turn-entry-input">
        <span className="turn-entry-prompt">›</span> {input}
      </header>
      <DiceAnimation roll={lastRoll} />
      {validationError && !streaming ? (
        <div className="narrative">
          <span className="error">{validationError}</span>
        </div>
      ) : (
        <div className={`narrative${streaming ? ' streaming' : ''}`}>
          {narrative || <span className="dim">…</span>}
        </div>
      )}
      <TurnChanges changes={changes} adventure={adventure} />
    </article>
  );
}
