import type { DiceRoll, StateChange, TurnEvent } from '@loreforge/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamTurn } from '../lib/api-client.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { useVoiceOutput } from './useVoiceOutput.js';

export interface TurnState {
  /** Currently-accumulating narrative for the in-flight turn. */
  narrative: string;
  /** Streaming. True while events are still arriving. */
  streaming: boolean;
  /** Set to a player-facing message if the engine rejected the action. */
  validationError: string | null;
  /** Most recent dice roll for this turn (if any). */
  lastRoll: DiceRoll | null;
  /** Final state changes applied this turn (from turn_complete). */
  changes: StateChange[];
}

const EMPTY_STATE: TurnState = {
  narrative: '',
  streaming: false,
  validationError: null,
  lastRoll: null,
  changes: [],
};

/**
 * Manages a single in-flight turn. Pipes SSE events into local state for the
 * UI and into the progressive-TTS hook if voice output is enabled. Aborts
 * the underlying fetch on unmount or repeated submit.
 */
export function useTurn(sessionCode: string, voiceOutputEnabled: boolean) {
  const [state, setState] = useState<TurnState>(EMPTY_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const setSession = useSessionStore((s) => s.setSession);
  const voice = useVoiceOutput(voiceOutputEnabled);

  const submit = useCallback(
    async (playerId: string, input: string) => {
      // Cancel any in-flight turn — the user has overridden it.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      voice.cancel();

      setState({ ...EMPTY_STATE, streaming: true });

      try {
        for await (const event of streamTurn(sessionCode, { playerId, input }, controller.signal)) {
          applyEvent(event, setState, setSession, voice.pushDelta);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          streaming: false,
          validationError: (err as Error).message,
        }));
      } finally {
        voice.flush();
        setState((prev) => ({ ...prev, streaming: false }));
      }
    },
    [sessionCode, setSession, voice],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  return { ...state, submit };
}

function applyEvent(
  event: TurnEvent,
  setState: (updater: (prev: TurnState) => TurnState) => void,
  setSession: (s: import('@loreforge/shared').GameSession) => void,
  pushDelta: (delta: string) => void,
): void {
  switch (event.type) {
    case 'validation_error':
      setState((prev) => ({ ...prev, validationError: event.message, narrative: event.message }));
      break;
    case 'roll_result':
      setState((prev) => ({ ...prev, lastRoll: event.roll }));
      break;
    case 'text_delta':
      setState((prev) => ({ ...prev, narrative: prev.narrative + event.delta }));
      pushDelta(event.delta);
      break;
    case 'state_change':
      setState((prev) => ({ ...prev, changes: [...prev.changes, event.change] }));
      break;
    case 'turn_complete':
      setSession(event.updatedSession);
      setState((prev) => ({ ...prev, streaming: false, changes: event.stateChanges }));
      break;
  }
}
