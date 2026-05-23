import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceOutput } from './useVoiceOutput.js';

interface SpeechCall {
  text: string;
}

describe('useVoiceOutput', () => {
  let calls: SpeechCall[];

  beforeEach(() => {
    calls = [];
    // Patch speechSynthesis with a minimal capturing mock.
    (globalThis as { speechSynthesis: unknown }).speechSynthesis = {
      speak: (u: { text: string }) => calls.push({ text: u.text }),
      cancel: () => {},
    } as never;
    function FakeUtterance(this: { text: string }, text: string) {
      this.text = text;
    }
    (globalThis as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      FakeUtterance as unknown as typeof SpeechSynthesisUtterance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('speaks complete sentences as they arrive', () => {
    const { result } = renderHook(() => useVoiceOutput(true));

    act(() => {
      result.current.pushDelta('The forest stands ');
      result.current.pushDelta('silent. ');
    });
    expect(calls.map((c) => c.text)).toEqual(['The forest stands silent.']);

    act(() => {
      result.current.pushDelta("Mira's voice cuts through. ");
    });
    expect(calls.map((c) => c.text)).toEqual([
      'The forest stands silent.',
      "Mira's voice cuts through.",
    ]);
  });

  it('does not speak partial sentences', () => {
    const { result } = renderHook(() => useVoiceOutput(true));
    act(() => {
      result.current.pushDelta('You see the tavern');
    });
    expect(calls).toHaveLength(0);
  });

  it('flush() speaks any remaining buffer', () => {
    const { result } = renderHook(() => useVoiceOutput(true));
    act(() => {
      result.current.pushDelta('A fragment with no punctuation');
      result.current.flush();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe('A fragment with no punctuation');
  });

  it('respects the enabled flag', () => {
    const { result } = renderHook(() => useVoiceOutput(false));
    act(() => {
      result.current.pushDelta('You see a thing. ');
    });
    expect(calls).toHaveLength(0);
  });
});
