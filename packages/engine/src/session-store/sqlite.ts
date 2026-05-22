import { type GameSession, GameSessionSchema, type SessionSummary } from '@loreforge/shared';
import Database, { type Database as SqliteDb } from 'better-sqlite3';
import type { SessionStore } from './interface.js';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    session_code TEXT UNIQUE NOT NULL,
    adventure_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(session_code)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at)',
  `CREATE TABLE IF NOT EXISTS device_sessions (
    device_fingerprint TEXT NOT NULL,
    session_id TEXT NOT NULL,
    associated_at TEXT NOT NULL,
    PRIMARY KEY (device_fingerprint, session_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_device_sessions_fp ON device_sessions(device_fingerprint)',
];

export class SQLiteSessionStore implements SessionStore {
  private db: SqliteDb;

  constructor(databasePath: string) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    for (const stmt of SCHEMA_STATEMENTS) {
      this.db.prepare(stmt).run();
    }
  }

  async create(session: GameSession): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO sessions (id, session_code, adventure_id, status, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.sessionCode,
        session.adventureId,
        session.status,
        session.createdAt,
        session.updatedAt,
        JSON.stringify(session),
      );
  }

  async get(sessionId: string): Promise<GameSession | null> {
    const row = this.db
      .prepare<[string], { data: string }>('SELECT data FROM sessions WHERE id = ?')
      .get(sessionId);
    return row ? GameSessionSchema.parse(JSON.parse(row.data)) : null;
  }

  async getByCode(sessionCode: string): Promise<GameSession | null> {
    const row = this.db
      .prepare<[string], { data: string }>('SELECT data FROM sessions WHERE session_code = ?')
      .get(sessionCode);
    return row ? GameSessionSchema.parse(JSON.parse(row.data)) : null;
  }

  async update(session: GameSession): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE sessions
         SET session_code = ?, adventure_id = ?, status = ?, updated_at = ?, data = ?
         WHERE id = ?`,
      )
      .run(
        session.sessionCode,
        session.adventureId,
        session.status,
        session.updatedAt,
        JSON.stringify(session),
        session.id,
      );
    if (result.changes === 0) {
      throw new Error(`Session ${session.id} not found for update`);
    }
  }

  async listByDevice(deviceFingerprint: string): Promise<SessionSummary[]> {
    const rows = this.db
      .prepare<[string], { data: string }>(
        `SELECT s.data FROM sessions s
         JOIN device_sessions d ON d.session_id = s.id
         WHERE d.device_fingerprint = ?
         ORDER BY s.updated_at DESC`,
      )
      .all(deviceFingerprint);
    return rows.map((row) => {
      const session = GameSessionSchema.parse(JSON.parse(row.data));
      return {
        sessionCode: session.sessionCode,
        adventureId: session.adventureId,
        status: session.status,
        updatedAt: session.updatedAt,
        playerNames: session.players.map((p) => p.name),
      };
    });
  }

  async associateDevice(sessionId: string, deviceFingerprint: string): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO device_sessions (device_fingerprint, session_id, associated_at)
         VALUES (?, ?, ?)`,
      )
      .run(deviceFingerprint, sessionId, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
