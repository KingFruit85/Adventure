import type { TurnEntry } from '@loreforge/shared';

export interface BlobStore {
  appendTurn(sessionId: string, turn: TurnEntry): Promise<void>;
  readAll(sessionId: string): Promise<TurnEntry[]>;
  search(sessionId: string, keyword: string): Promise<TurnEntry[]>;
}
