import { useLayoutEffect, useRef } from 'react';

interface Props {
  text: string;
  streaming: boolean;
  error?: string | null;
}

/**
 * Renders the in-flight narrative. Auto-scrolls to the bottom as new text
 * arrives so the cursor stays in view during streaming. Uses a serif face
 * and pre-wrap so paragraph breaks from the LLM render naturally.
 *
 * useLayoutEffect runs after every render, which is what we want here — the
 * scroll position needs to settle synchronously before the browser paints,
 * otherwise the user sees a flash of stale scroll position.
 */
export function NarrativeDisplay({ text, streaming, error }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  });

  if (error) {
    return (
      <div className="narrative">
        <span className="error">{error}</span>
      </div>
    );
  }

  return (
    <div ref={ref} className={`narrative${streaming ? ' streaming' : ''}`}>
      {text || <span className="dim">Speak or type your action. The world is waiting.</span>}
    </div>
  );
}
