import { useCallback, useEffect, useRef } from 'react';

const SENTENCE_BOUNDARY = /([.!?])(\s|$)/;

/**
 * Progressive TTS. Buffers incoming text deltas; whenever a sentence boundary
 * (`. ! ?` followed by whitespace or end of stream) is detected, the
 * completed sentence is queued to `speechSynthesis` and the buffer continues
 * from the remainder. Result: first sentence plays within ~500ms of stream
 * start instead of waiting for the full response.
 *
 * Call `pushDelta` for each text_delta event, and `flush` at end-of-turn to
 * speak whatever's left in the buffer.
 */
export function useVoiceOutput(enabled: boolean) {
  const bufferRef = useRef('');
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  const drainSentences = useCallback(() => {
    let match = bufferRef.current.match(SENTENCE_BOUNDARY);
    while (match && match.index !== undefined) {
      const end = match.index + match[1]!.length;
      const sentence = bufferRef.current.slice(0, end).trim();
      bufferRef.current = bufferRef.current.slice(end + match[2]!.length);
      if (sentence) speak(sentence);
      match = bufferRef.current.match(SENTENCE_BOUNDARY);
    }
  }, [speak]);

  const pushDelta = useCallback(
    (delta: string) => {
      if (!enabled || !supported) return;
      bufferRef.current += delta;
      drainSentences();
    },
    [enabled, supported, drainSentences],
  );

  const flush = useCallback(() => {
    if (!enabled || !supported) return;
    const rest = bufferRef.current.trim();
    bufferRef.current = '';
    if (rest) speak(rest);
  }, [enabled, supported, speak]);

  const cancel = useCallback(() => {
    if (!supported) return;
    bufferRef.current = '';
    window.speechSynthesis.cancel();
  }, [supported]);

  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  return { pushDelta, flush, cancel, supported };
}
