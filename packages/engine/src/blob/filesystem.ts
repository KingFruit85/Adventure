import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type TurnEntry, TurnEntrySchema } from '@loreforge/shared';
import type { BlobStore } from './interface.js';

export class FilesystemBlobStore implements BlobStore {
  constructor(private readonly baseDir: string) {}

  async appendTurn(sessionId: string, turn: TurnEntry): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await appendFile(this.pathFor(sessionId), `${JSON.stringify(turn)}\n`, 'utf-8');
  }

  async readAll(sessionId: string): Promise<TurnEntry[]> {
    const text = await readFile(this.pathFor(sessionId), 'utf-8').catch(() => '');
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => TurnEntrySchema.parse(JSON.parse(line)));
  }

  async search(sessionId: string, keyword: string): Promise<TurnEntry[]> {
    const all = await this.readAll(sessionId);
    const lowered = keyword.toLowerCase();
    return all.filter(
      (entry) =>
        entry.playerInput.toLowerCase().includes(lowered) ||
        entry.narrativeResponse.toLowerCase().includes(lowered),
    );
  }

  private pathFor(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.log.jsonl`);
  }
}
