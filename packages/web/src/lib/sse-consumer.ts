/**
 * Parses Server-Sent Events from a ReadableStream and yields one event per
 * `event:` / `data:` block. Yields untyped {event, data} pairs — the caller
 * decides how to interpret each event type's payload.
 *
 * Handles partial chunks across reads by buffering whatever's after the last
 * `\n\n` between iterations.
 */
export interface SSEFrame {
  event: string;
  data: string;
}

export async function* readSSE(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEFrame, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop() ?? '';
      for (const block of blocks) {
        const lines = block.split('\n');
        const evLine = lines.find((l) => l.startsWith('event:'));
        const dataLine = lines.find((l) => l.startsWith('data:'));
        if (!evLine || !dataLine) continue;
        yield {
          event: evLine.slice('event:'.length).trim(),
          data: dataLine.slice('data:'.length).trim(),
        };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
