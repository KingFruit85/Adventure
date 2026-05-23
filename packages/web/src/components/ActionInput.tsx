import { type FormEvent, useEffect, useState } from 'react';
import { useVoiceInput } from '../hooks/useVoiceInput.js';

interface Props {
  onSubmit: (input: string) => void;
  disabled?: boolean;
  voiceOutputEnabled: boolean;
  onToggleVoiceOutput: () => void;
}

/**
 * Player action input. Combines a text field with two voice controls:
 *   🎤  toggle voice INPUT  (SpeechRecognition → fills the text field)
 *   🔊  toggle voice OUTPUT (TTS on incoming narrative)
 *
 * When voice input recognises a final phrase, the text field is populated
 * but not auto-submitted — the player still presses Enter (or the send
 * button) to commit. This matches the typed-input flow and avoids
 * surprising the player when the recogniser segments wrong.
 */
export function ActionInput({
  onSubmit,
  disabled,
  voiceOutputEnabled,
  onToggleVoiceOutput,
}: Props) {
  const [value, setValue] = useState('');
  const voice = useVoiceInput();

  useEffect(() => {
    if (voice.transcript) setValue(voice.transcript);
  }, [voice.transcript]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value.trim());
    setValue('');
  };

  return (
    <form className="action-input" onSubmit={submit}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={voice.listening ? 'Listening…' : 'What do you do?'}
        disabled={disabled}
        // biome-ignore lint/a11y/noAutofocus: this is the primary action of the page; focusing on mount is the intended interaction
        autoFocus
      />
      {voice.supported && (
        <button
          type="button"
          className={`voice-button${voice.listening ? ' active' : ''}`}
          onClick={() => (voice.listening ? voice.stop() : voice.start())}
          title="Voice input"
          aria-label="Voice input"
        >
          🎤
        </button>
      )}
      <button
        type="button"
        className={`voice-button${voiceOutputEnabled ? ' active' : ''}`}
        onClick={onToggleVoiceOutput}
        title="Voice output (narration)"
        aria-label="Voice output"
      >
        🔊
      </button>
      <button type="submit" className="primary" disabled={disabled || !value.trim()}>
        Send
      </button>
    </form>
  );
}
