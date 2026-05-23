import { useCallback, useEffect, useRef, useState } from 'react';

// SpeechRecognition typings vary across browsers — declare a minimal shape.
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

declare global {
  interface Window {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  }
}

/**
 * Web Speech API wrapper. Returns a controlled hook with a `transcript`
 * field that updates as the user speaks and a `final` boolean that flips to
 * true when the recognition session ends with a finalised result.
 *
 * Browser support: Chrome / Edge / Safari (with `webkitSpeechRecognition`).
 * Firefox has no support — `supported` will be false there.
 */
export function useVoiceInput() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [final, setFinal] = useState(false);
  const supported =
    typeof window !== 'undefined' &&
    (Boolean(window.SpeechRecognition) || Boolean(window.webkitSpeechRecognition));

  const start = useCallback(() => {
    if (!supported || listening) return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      let text = '';
      let isFinal = false;
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]!;
        text += result[0].transcript;
        if (result.isFinal) isFinal = true;
      }
      setTranscript(text);
      setFinal(isFinal);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setFinal(false);
    setTranscript('');
    setListening(true);
    recognition.start();
  }, [supported, listening]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
    },
    [],
  );

  return { transcript, final, listening, start, stop, supported };
}
