import type { AdventureMetadata, SessionSummary } from '@loreforge/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAdventures, listMySessions } from '../lib/api-client.js';

export function Home() {
  const navigate = useNavigate();
  const [adventures, setAdventures] = useState<AdventureMetadata[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listAdventures(), listMySessions()])
      .then(([adv, ses]) => {
        setAdventures(adv);
        setSessions(ses);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const join = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    navigate(`/play/${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="container">
      <h1>Begin or rejoin an adventure</h1>

      {error && <div className="card error">{error}</div>}

      <section>
        <h2>New adventure</h2>
        {loading ? (
          <div className="muted">Loading…</div>
        ) : adventures.length === 0 ? (
          <div className="muted">No adventures available.</div>
        ) : (
          adventures.map((a) => (
            <button
              key={a.id}
              className="card adventure-card"
              type="button"
              onClick={() => navigate(`/start/${encodeURIComponent(a.id)}`)}
            >
              <h2 style={{ margin: 0 }}>{a.title}</h2>
              <div className="muted">{a.description}</div>
              <div className="muted">
                {a.minPlayers === a.maxPlayers
                  ? `${a.minPlayers} player`
                  : `${a.minPlayers}–${a.maxPlayers} players`}
              </div>
            </button>
          ))
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Join with code</h2>
        <form onSubmit={join} className="row" style={{ maxWidth: 400 }}>
          <input
            type="text"
            placeholder="WOLF-42-STONE"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ flex: 1, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}
          />
          <button type="submit" className="primary" disabled={!code.trim()}>
            Join
          </button>
        </form>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>My adventures</h2>
        {sessions.length === 0 ? (
          <div className="muted">Sessions you start on this device will appear here.</div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.sessionCode}
              className="card adventure-card"
              type="button"
              onClick={() => navigate(`/play/${encodeURIComponent(s.sessionCode)}`)}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <strong style={{ fontFamily: 'var(--font-mono)' }}>{s.sessionCode}</strong>
                <span className="muted">{s.status}</span>
              </div>
              <div className="muted">
                {s.adventureId} · {s.playerNames.join(', ') || 'no players'}
              </div>
            </button>
          ))
        )}
      </section>
    </div>
  );
}
