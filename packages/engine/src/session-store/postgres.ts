import { type GameSession, GameSessionSchema, type SessionSummary } from '@loreforge/shared';
import { type NeonQueryFunction, neon } from '@neondatabase/serverless';
import type { SessionStore } from './interface.js';

interface SessionRow {
  data: GameSession;
}

/**
 * Neon Postgres-backed session store. Mirrors SQLiteSessionStore's behaviour
 * — same interface, same semantics — but designed for serverless: uses Neon's
 * HTTP driver (no connection-pool lifecycle to manage) and stores the full
 * GameSession as JSONB rather than serialised TEXT.
 *
 * Schema is in migrations/001_init.sql at the repo root; run it once against
 * the Neon database before first deploy.
 */
export class PostgresSessionStore implements SessionStore {
  private sql: NeonQueryFunction<false, false>;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  async create(session: GameSession): Promise<void> {
    await this.sql`
      INSERT INTO sessions (id, session_code, adventure_id, status, created_at, updated_at, data)
      VALUES (
        ${session.id},
        ${session.sessionCode},
        ${session.adventureId},
        ${session.status},
        ${session.createdAt},
        ${session.updatedAt},
        ${JSON.stringify(session)}::jsonb
      )
    `;
  }

  async get(sessionId: string): Promise<GameSession | null> {
    const rows = (await this
      .sql`SELECT data FROM sessions WHERE id = ${sessionId}`) as SessionRow[];
    const row = rows[0];
    return row ? GameSessionSchema.parse(row.data) : null;
  }

  async getByCode(sessionCode: string): Promise<GameSession | null> {
    const rows = (await this
      .sql`SELECT data FROM sessions WHERE session_code = ${sessionCode}`) as SessionRow[];
    const row = rows[0];
    return row ? GameSessionSchema.parse(row.data) : null;
  }

  async update(session: GameSession): Promise<void> {
    // Neon's HTTP driver doesn't expose rowCount on its tagged-template
    // form, so we re-fetch instead. The extra round-trip is cheap because
    // both queries hit the same connection.
    await this.sql`
      UPDATE sessions
      SET session_code = ${session.sessionCode},
          adventure_id = ${session.adventureId},
          status       = ${session.status},
          updated_at   = ${session.updatedAt},
          data         = ${JSON.stringify(session)}::jsonb
      WHERE id = ${session.id}
    `;
    const exists = (await this
      .sql`SELECT 1 FROM sessions WHERE id = ${session.id} LIMIT 1`) as unknown[];
    if (exists.length === 0) {
      throw new Error(`Session ${session.id} not found for update`);
    }
  }

  async listByDevice(deviceFingerprint: string): Promise<SessionSummary[]> {
    const rows = (await this.sql`
      SELECT s.data FROM sessions s
      JOIN device_sessions d ON d.session_id = s.id
      WHERE d.device_fingerprint = ${deviceFingerprint}
      ORDER BY s.updated_at DESC
    `) as SessionRow[];
    return rows.map((row) => {
      const session = GameSessionSchema.parse(row.data);
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
    await this.sql`
      INSERT INTO device_sessions (device_fingerprint, session_id, associated_at)
      VALUES (${deviceFingerprint}, ${sessionId}, ${new Date().toISOString()})
      ON CONFLICT (device_fingerprint, session_id) DO NOTHING
    `;
  }
}
