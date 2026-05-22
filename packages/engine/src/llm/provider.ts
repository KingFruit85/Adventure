import type { ActionType, AdventureDefinition, GameSession, ParsedAction } from '@loreforge/shared';

export interface NarrativeChunk {
  type: 'text_delta' | 'tool_call';
  textDelta?: string;
  toolCall?: { name: string; input: Record<string, unknown> };
}

export interface NarrativePrompt {
  systemPrompt: string;
  userContext: string;
  toolDefinitions: NarratorToolDefinition[];
}

export interface NarratorToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CompletionPrompt {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface LLMProvider {
  streamNarrative(payload: NarrativePrompt): AsyncIterable<NarrativeChunk>;
  complete(payload: CompletionPrompt): Promise<string>;
}

/**
 * Phase 1 stub: deterministic provider that returns canned narrative.
 * Replace with AnthropicProvider in Phase 2.
 */
export class StubLLMProvider implements LLMProvider {
  async *streamNarrative(_payload: NarrativePrompt): AsyncIterable<NarrativeChunk> {
    yield { type: 'text_delta', textDelta: '[stub narrator] ' };
    yield {
      type: 'text_delta',
      textDelta: 'The world holds its breath as the engine waits for Phase 2.',
    };
  }

  async complete(_payload: CompletionPrompt): Promise<string> {
    return '[stub completion]';
  }
}

/**
 * Shape of an intent classification result returned by the Intent Parser stage.
 * Kept narrow so the Phase 2 haiku implementation has a stable contract.
 */
export interface IntentClassifier {
  classify(
    rawInput: string,
    context: {
      session: GameSession;
      adventure: AdventureDefinition;
      allowedActions: ActionType[];
    },
  ): Promise<ParsedAction>;
}
