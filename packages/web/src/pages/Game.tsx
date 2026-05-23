import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ActionInput } from '../components/ActionInput.js';
import { DiceAnimation } from '../components/DiceAnimation.js';
import { NarrativeDisplay } from '../components/NarrativeDisplay.js';
import { PlayerStatus } from '../components/PlayerStatus.js';
import { TurnChanges } from '../components/TurnChanges.js';
import { useTurn } from '../hooks/useTurn.js';
import { getAdventure, getSessionByCode } from '../lib/api-client.js';
import { useSessionStore } from '../stores/sessionStore.js';

export function Game() {
  const { code } = useParams<{ code: string }>();
  const sessionCode = code ?? '';
  const session = useSessionStore((s) => s.session);
  const adventure = useSessionStore((s) => s.adventure);
  const setSession = useSessionStore((s) => s.setSession);
  const setAdventure = useSessionStore((s) => s.setAdventure);
  const activePlayer = useSessionStore((s) => s.activePlayer());

  const [loadError, setLoadError] = useState<string | null>(null);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const turn = useTurn(sessionCode, voiceOutputEnabled);

  // Load session + adventure on mount or session-code change.
  useEffect(() => {
    if (!sessionCode) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getSessionByCode(sessionCode);
        if (cancelled) return;
        setSession(s);
        const adv = await getAdventure(s.adventureId);
        if (cancelled) return;
        setAdventure(adv);
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionCode, setSession, setAdventure]);

  if (loadError) {
    return (
      <div className="container narrow">
        <div className="card error">{loadError}</div>
      </div>
    );
  }
  if (!session || !adventure || !activePlayer) {
    return (
      <div className="container narrow">
        <div className="muted">Loading session…</div>
      </div>
    );
  }

  const currentLocation = adventure.locations[activePlayer.currentLocationId];

  return (
    <div className="game-layout">
      <section>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>{currentLocation?.name ?? activePlayer.currentLocationId}</h2>
            <div className="muted" style={{ fontFamily: 'var(--font-mono)' }}>
              {sessionCode}
            </div>
          </div>
          {session.status === 'COMPLETED' && (
            <div className="dice" style={{ marginTop: 0 }}>
              Adventure complete
            </div>
          )}
        </div>

        <NarrativeDisplay
          text={turn.narrative}
          streaming={turn.streaming}
          error={!turn.streaming ? turn.validationError : null}
        />

        <DiceAnimation roll={turn.lastRoll} />
        <TurnChanges changes={turn.changes} adventure={adventure} />

        <ActionInput
          onSubmit={(input) => turn.submit(activePlayer.id, input)}
          disabled={turn.streaming || session.status === 'COMPLETED'}
          voiceOutputEnabled={voiceOutputEnabled}
          onToggleVoiceOutput={() => setVoiceOutputEnabled((v) => !v)}
        />
      </section>

      <PlayerStatus player={activePlayer} session={session} adventure={adventure} />
    </div>
  );
}
