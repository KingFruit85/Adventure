-- LoreForge initial schema.
-- Mirrors packages/engine/src/session-store/sqlite.ts so the Postgres-backed
-- production deployment behaves identically to local SQLite dev. The full
-- GameSession is stored as JSONB; columns mirror only the fields we filter
-- or sort on.

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY,
  session_code  TEXT UNIQUE NOT NULL,
  adventure_id  TEXT NOT NULL,
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL,
  data          JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_code    ON sessions(session_code);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS device_sessions (
  device_fingerprint TEXT NOT NULL,
  session_id         UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  associated_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (device_fingerprint, session_id)
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_fp ON device_sessions(device_fingerprint);
