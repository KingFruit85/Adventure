import type { AdventureDefinition, CharacterClass } from '@loreforge/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createSession, getAdventure } from '../lib/api-client.js';

export function CharacterSelect() {
  const { adventureId } = useParams<{ adventureId: string }>();
  const navigate = useNavigate();
  const [adventure, setAdventure] = useState<AdventureDefinition | null>(null);
  const [name, setName] = useState('');
  const [classId, setClassId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!adventureId) return;
    getAdventure(adventureId)
      .then((adv) => {
        setAdventure(adv);
        setClassId(adv.availableClasses[0]?.id ?? '');
      })
      .catch((err) => setError((err as Error).message));
  }, [adventureId]);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!adventure || !name.trim() || !classId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createSession({
        adventureId: adventure.id,
        players: [{ name: name.trim(), classId }],
      });
      navigate(`/play/${encodeURIComponent(result.sessionCode)}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  if (!adventure) {
    return (
      <div className="container narrow">
        {error ? <div className="card error">{error}</div> : <div className="muted">Loading…</div>}
      </div>
    );
  }

  const selected = adventure.availableClasses.find((c) => c.id === classId);

  return (
    <div className="container narrow">
      <h1>{adventure.title}</h1>
      <p className="dim">{adventure.description}</p>

      <form onSubmit={start} className="col" style={{ gap: 16, marginTop: 24 }}>
        <label className="col">
          <span className="muted">Your name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Hero"
            // biome-ignore lint/a11y/noAutofocus: first interactive control on the page; focusing on mount is intended
            autoFocus
            maxLength={40}
          />
        </label>

        <div className="col">
          <span className="muted">Choose a class</span>
          <div className="col" style={{ gap: 8 }}>
            {adventure.availableClasses.map((c: CharacterClass) => (
              <label
                key={c.id}
                className={`card${classId === c.id ? '' : ''}`}
                style={{
                  cursor: 'pointer',
                  borderColor: classId === c.id ? 'var(--color-accent)' : undefined,
                  marginBottom: 0,
                  padding: 16,
                }}
              >
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="radio"
                    name="class"
                    checked={classId === c.id}
                    onChange={() => setClassId(c.id)}
                    style={{ marginTop: 4 }}
                  />
                  <div style={{ flex: 1 }}>
                    <strong>{c.name}</strong>
                    <div className="muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                      {c.description}
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>
          {selected && (
            <div className="muted" style={{ marginTop: 8 }}>
              Hit die: d{selected.hitDie}
              {selected.spells?.length ? ` · Spells: ${selected.spells.join(', ')}` : ''}
            </div>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => navigate('/')}>
            Back
          </button>
          <button
            type="submit"
            className="primary"
            disabled={submitting || !name.trim() || !classId}
          >
            {submitting ? 'Starting…' : 'Begin adventure'}
          </button>
        </div>
      </form>
    </div>
  );
}
