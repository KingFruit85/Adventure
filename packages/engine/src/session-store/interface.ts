import type { GameSession, SessionSummary } from '@loreforge/shared';

export interface SessionStore {
  create(session: GameSession): Promise<void>;
  get(sessionId: string): Promise<GameSession | null>;
  getByCode(sessionCode: string): Promise<GameSession | null>;
  update(session: GameSession): Promise<void>;
  listByDevice(deviceFingerprint: string): Promise<SessionSummary[]>;
  associateDevice(sessionId: string, deviceFingerprint: string): Promise<void>;
}
