import { useCallback, useEffect, useRef } from 'react';

const SENTENCE_BOUNDARY = /([.!?])(\s|$)/;

/**
 * Progressive TTS. Buffers incoming text deltas; whenever a sentence boundary
 * (`. ! ?` followed by whitespace or end of stream) is detected, the
 * completed sentence is queued to `speechSynthesis` and the buffer continues
 * from the remainder. Result: first sentence plays within ~500ms of stream
 * start instead of waiting for the full response.
 *
 * Browser/platform quirks handled:
 *  - Chrome on Linux loads voices asynchronously (`voiceschanged` event).
 *    Until that fires, getVoices() may return an empty list and speak()
 *    becomes a no-op. We listen once and don't gate on it — speak still
 *    works with the default voice once it arrives — but we do log to the
 *    console so it's visible during debugging.
 *  - Chrome has a long-standing bug where speechSynthesis silently stalls
 *    after ~15 seconds of continuous use. Calling cancel() before each
 *    speak() resets the queue and dodges the freeze.
 *  - Each utterance gets onerror wired up so silent failures surface in
 *    the console rather than just producing no audio.
 *
 * Call `pushDelta` for each text_delta event, and `flush` at end-of-turn to
 * speak whatever's left in the buffer.
 */
export function useVoiceOutput(enabled: boolean) {
  const bufferRef = useRef('');
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const voicesReadyRef = useRef(false);

  // One-time voice availability check + load listener.
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const checkVoices = () => {
      const voices = synth.getVoices();
      voicesReadyRef.current = voices.length > 0;
      if (voices.length === 0) {
        console.warn(
          '[loreforge] speechSynthesis.getVoices() is empty. On Linux + Chrome you need speech-dispatcher running: `systemctl --user enable --now speech-dispatcher.service`',
        );
      }
    };
    checkVoices();
    synth.addEventListener('voiceschanged', checkVoices);
    return () => synth.removeEventListener('voiceschanged', checkVoices);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      const synth = window.speechSynthesis;
      // Workaround for the Chrome SpeechSynthesis stall bug — cancel resets
      // the internal queue so subsequent utterances don't get swallowed.
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onerror = (event) => {
        console.warn('[loreforge] speech utterance error:', event.error ?? event);
      };
      synth.speak(utterance);
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
