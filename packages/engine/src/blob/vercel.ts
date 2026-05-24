import { list, put } from '@vercel/blob';
import { type TurnEntry, TurnEntrySchema } from '@loreforge/shared';
import type { BlobStore } from './interface.js';

/**
 * Vercel Blob-backed turn log. Mirrors FilesystemBlobStore's contract.
 *
 * Vercel Blob has no append primitive, so each turn is stored as its own
 * blob under `sessions/<sessionId>/`. The pathname carries a zero-padded
 * turnNumber so lexicographic listing returns turns in order. `playerId`
 * is appended to the pathname to keep multi-player turns unique within a
 * single turn number — same convention as JSONL line ordering in the FS
 * implementation.
 *
 * Auth: the Vercel runtime injects `BLOB_READ_WRITE_TOKEN` automatically
 * when a Blob store is connected to the project. No constructor arg
 * needed.
 */
export class VercelBlobStore implements BlobStore {
  async appendTurn(sessionId: string, turn: TurnEntry): Promise<void> {
    const path = `sessions/${sessionId}/${pad(turn.turnNumber)}-${turn.playerId}.json`;
    await put(path, JSON.stringify(turn), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
  }

  async readAll(sessionId: string): Promise<TurnEntry[]> {
    const { blobs } = await list({ prefix: `sessions/${sessionId}/` });
    blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));
    const bodies = await Promise.all(blobs.map((b) => fetch(b.url).then((r) => r.text())));
    return bodies.map((body) => TurnEntrySchema.parse(JSON.parse(body)));
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
}

function pad(n: number): string {
  return n.toString().padStart(6, '0');
}
