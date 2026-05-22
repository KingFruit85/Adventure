import type { CompletionPrompt, LLMProvider, NarrativeChunk, NarrativePrompt } from './provider.js';

export interface MockNarrativeScript {
  text?: string;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
}

/**
 * Programmable LLMProvider for tests. Each call to `streamNarrative` yields
 * the chunks defined by the next scripted response (or by a default-empty
 * response if the script is exhausted). Use this to drive the engine
 * pipeline with deterministic, asserted behaviour.
 *
 * Example:
 *   const llm = new MockLLMProvider({
 *     narratives: [{
 *       text: 'You take the bread.',
 *       toolCalls: [{ name: 'item_added_to_inventory', input: {...} }],
 *     }],
 *   });
 */
export class MockLLMProvider implements LLMProvider {
  private narratives: MockNarrativeScript[];
  private completions: string[];
  public narrativeCallCount = 0;
  public completionCallCount = 0;
  public lastNarrativePrompt?: NarrativePrompt;
  public lastCompletionPrompt?: CompletionPrompt;

  constructor(
    opts: {
      narratives?: MockNarrativeScript[];
      completions?: string[];
    } = {},
  ) {
    this.narratives = opts.narratives ?? [];
    this.completions = opts.completions ?? [];
  }

  async *streamNarrative(payload: NarrativePrompt): AsyncIterable<NarrativeChunk> {
    this.lastNarrativePrompt = payload;
    const script = this.narratives[this.narrativeCallCount] ?? {};
    this.narrativeCallCount++;
    if (script.text) {
      yield { type: 'text_delta', textDelta: script.text };
    }
    for (const toolCall of script.toolCalls ?? []) {
      yield { type: 'tool_call', toolCall };
    }
  }

  async complete(payload: CompletionPrompt): Promise<string> {
    this.lastCompletionPrompt = payload;
    const next = this.completions[this.completionCallCount] ?? '';
    this.completionCallCount++;
    return next;
  }
}
