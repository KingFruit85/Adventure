import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from './env.js';
import type { CompletionPrompt, LLMProvider, NarrativeChunk, NarrativePrompt } from './provider.js';

export interface AnthropicProviderConfig {
  narrativeModel?: string;
  completionModel?: string;
  narrativeMaxTokens?: number;
  completionMaxTokens?: number;
  apiKey?: string;
}

const DEFAULTS = {
  narrativeModel: 'claude-sonnet-4-6',
  completionModel: 'claude-haiku-4-5',
  narrativeMaxTokens: 4096,
  completionMaxTokens: 512,
};

/**
 * Production LLM provider backed by the Anthropic SDK.
 *
 * Two model tiers (per ARCHITECTURE.md §4–5):
 *   - narrativeModel (sonnet): streaming narration with tool use
 *   - completionModel (haiku): non-streaming completions (intent parsing,
 *     summarisation) — fast and cheap
 *
 * Prompt caching is applied to the system prompt (frozen per session) and
 * tool definitions (frozen per adventure). After the first turn, those
 * ~2-4K tokens read at ~10% of base price, which is the single biggest cost
 * lever for a multi-turn adventure loop.
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private narrativeModel: string;
  private completionModel: string;
  private narrativeMaxTokens: number;
  private completionMaxTokens: number;

  constructor(config: AnthropicProviderConfig = {}) {
    loadEnv();
    this.client = new Anthropic({
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
    this.narrativeModel = config.narrativeModel ?? DEFAULTS.narrativeModel;
    this.completionModel = config.completionModel ?? DEFAULTS.completionModel;
    this.narrativeMaxTokens = config.narrativeMaxTokens ?? DEFAULTS.narrativeMaxTokens;
    this.completionMaxTokens = config.completionMaxTokens ?? DEFAULTS.completionMaxTokens;
  }

  async *streamNarrative(payload: NarrativePrompt): AsyncIterable<NarrativeChunk> {
    const tools = payload.toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const stream = this.client.messages.stream({
      model: this.narrativeModel,
      max_tokens: this.narrativeMaxTokens,
      system: [
        {
          type: 'text',
          text: payload.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools,
      messages: [{ role: 'user', content: payload.userContext }],
    });

    // Track tool-use blocks as their JSON inputs stream in piece-by-piece.
    const pendingToolUse = new Map<number, { name: string; jsonBuffer: string }>();

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          pendingToolUse.set(event.index, {
            name: event.content_block.name,
            jsonBuffer: '',
          });
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text_delta', textDelta: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          const pending = pendingToolUse.get(event.index);
          if (pending) pending.jsonBuffer += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        const pending = pendingToolUse.get(event.index);
        if (pending) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = pending.jsonBuffer
              ? (JSON.parse(pending.jsonBuffer) as Record<string, unknown>)
              : {};
          } catch (err) {
            // Malformed tool input — log and skip. Engine will fall back to
            // structural defaults from the action.
            console.error(`[anthropic] failed to parse tool input for ${pending.name}:`, err);
          }
          yield {
            type: 'tool_call',
            toolCall: { name: pending.name, input: parsedInput },
          };
          pendingToolUse.delete(event.index);
        }
      }
    }
  }

  async complete(payload: CompletionPrompt): Promise<string> {
    const response = await this.client.messages.create({
      model: this.completionModel,
      max_tokens: payload.maxTokens ?? this.completionMaxTokens,
      system: payload.systemPrompt,
      messages: [{ role: 'user', content: payload.userPrompt }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return text.trim();
  }
}
