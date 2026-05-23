import { describe, expect, it } from 'vitest';
import { readSSE } from './sse-consumer.js';

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

describe('readSSE', () => {
  it('parses event + data pairs', async () => {
    const stream = makeStream([
      'event: text_delta\ndata: {"delta":"hello"}\n\n',
      'event: turn_complete\ndata: {"stateChanges":[]}\n\n',
    ]);
    const events = [];
    for await (const e of readSSE(stream)) events.push(e);
    expect(events.map((e) => e.event)).toEqual(['text_delta', 'turn_complete']);
    expect(JSON.parse(events[0]!.data)).toEqual({ delta: 'hello' });
  });

  it('handles a chunk split mid-event', async () => {
    const stream = makeStream([
      'event: text_delta\ndata: {"de',
      'lta":"hi"}\n\nevent: turn_complete\ndata: {}\n\n',
    ]);
    const events = [];
    for await (const e of readSSE(stream)) events.push(e);
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]!.data)).toEqual({ delta: 'hi' });
  });

  it('aborts cleanly when signal fires', async () => {
    const stream = makeStream(['event: text_delta\ndata: {"delta":"hi"}\n\n']);
    const ctrl = new AbortController();
    ctrl.abort();
    const events = [];
    for await (const e of readSSE(stream, ctrl.signal)) events.push(e);
    expect(events).toHaveLength(0);
  });
});
