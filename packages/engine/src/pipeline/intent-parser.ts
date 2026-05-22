import {
  type ActionType,
  type AdventureDefinition,
  type GameSession,
  type ParsedAction,
  ParsedActionSchema,
} from '@loreforge/shared';
import type { IntentClassifier, LLMProvider } from '../llm/provider.js';

/**
 * Phase 1 stub: deterministic keyword-based parser. Useful for testing the
 * pipeline end-to-end without an LLM. Phase 2 will replace this with a
 * haiku-backed implementation that handles natural language robustly.
 */
export class KeywordIntentClassifier implements IntentClassifier {
  async classify(
    rawInput: string,
    context: {
      session: GameSession;
      adventure: AdventureDefinition;
      allowedActions: ActionType[];
    },
  ): Promise<ParsedAction> {
    const input = rawInput.trim().toLowerCase();
    const player = context.session.players.find(
      (p) => p.id === context.session.currentTurnPlayerId,
    );
    const location = player ? context.adventure.locations[player.currentLocationId] : undefined;

    if (input === 'look' || input === 'l') {
      return { type: 'LOOK', rawInput, params: { type: 'LOOK' } };
    }
    if (input === 'inventory' || input === 'inv' || input === 'i') {
      return { type: 'INVENTORY', rawInput, params: { type: 'INVENTORY' } };
    }
    if (input === 'status' || input === 'stat') {
      return { type: 'STATUS', rawInput, params: { type: 'STATUS' } };
    }
    if (input === 'recall') {
      return { type: 'RECALL', rawInput, params: { type: 'RECALL' } };
    }

    const moveMatch =
      input.match(/^(?:go|move|head|walk)\s+(.+)$/) ??
      input.match(/^([nsew]|north|south|east|west|up|down)$/);
    if (moveMatch) {
      const direction = (moveMatch[1] ?? input).trim();
      return { type: 'MOVE', rawInput, params: { type: 'MOVE', direction } };
    }

    const takeMatch = input.match(/^(?:take|pick up|grab|get)\s+(.+)$/);
    if (takeMatch && location) {
      const itemId = resolveItemIdInLocation(takeMatch[1] ?? '', location.items, context.adventure);
      if (itemId) {
        return { type: 'TAKE_ITEM', rawInput, params: { type: 'TAKE_ITEM', itemId } };
      }
    }

    const attackMatch = input.match(/^(?:attack|fight|strike|kill)\s+(.+)$/);
    if (attackMatch && location) {
      const npcId = resolveNpcIdInLocation(attackMatch[1] ?? '', location.npcs, context.adventure);
      if (npcId) {
        return { type: 'ATTACK', rawInput, params: { type: 'ATTACK', targetNpcId: npcId } };
      }
    }

    const talkMatch = input.match(/^(?:talk to|speak to|speak with|greet)\s+(.+)$/);
    if (talkMatch && location) {
      const npcId = resolveNpcIdInLocation(talkMatch[1] ?? '', location.npcs, context.adventure);
      if (npcId) {
        return { type: 'TALK_TO_NPC', rawInput, params: { type: 'TALK_TO_NPC', npcId } };
      }
    }

    const examineMatch = input.match(/^(?:examine|inspect|look at|look)\s+(.+)$/);
    if (examineMatch) {
      return {
        type: 'EXAMINE',
        rawInput,
        params: { type: 'EXAMINE', targetId: (examineMatch[1] ?? '').trim() },
      };
    }

    // Fallback: treat unparseable input as a LOOK so the narrator can re-orient
    // the player. The Phase 2 haiku classifier will do better.
    return { type: 'LOOK', rawInput, params: { type: 'LOOK' } };
  }
}

function resolveItemIdInLocation(
  query: string,
  itemGrants: { itemId: string }[],
  adventure: AdventureDefinition,
): string | undefined {
  const q = query.trim().toLowerCase();
  for (const grant of itemGrants) {
    const item = adventure.items[grant.itemId];
    if (!item) continue;
    if (item.id.toLowerCase() === q || item.name.toLowerCase() === q) {
      return item.id;
    }
    if (item.name.toLowerCase().includes(q)) {
      return item.id;
    }
  }
  return undefined;
}

function resolveNpcIdInLocation(
  query: string,
  npcIds: string[],
  adventure: AdventureDefinition,
): string | undefined {
  const q = query.trim().toLowerCase();
  for (const npcId of npcIds) {
    const npc = adventure.npcs[npcId];
    if (!npc) continue;
    if (npc.id.toLowerCase() === q || npc.name.toLowerCase().includes(q)) {
      return npc.id;
    }
  }
  return undefined;
}

/**
 * Phase 2 implementation: haiku-backed intent classifier.
 *
 * Strategy: ask haiku to return a JSON object describing the action, then
 * validate it against ParsedActionSchema. If parsing fails (malformed JSON,
 * action not in the allowed set, target not present in the current location),
 * we fall back to KeywordIntentClassifier — the deterministic parser still
 * gets the obvious cases right and a LOOK fallback is always safe.
 *
 * Why a JSON prompt instead of structured outputs: the ParsedAction shape is
 * a discriminated union, which `output_config.format` schemas can express
 * but constrain in ways that are awkward to keep in sync as the action set
 * grows. A plain JSON instruction + Zod validation is simpler and lets us
 * fall through to keyword parsing cleanly when the model refuses or
 * returns nonsense.
 */
export class LLMIntentClassifier implements IntentClassifier {
  private fallback = new KeywordIntentClassifier();

  constructor(private readonly llm: LLMProvider) {}

  async classify(
    rawInput: string,
    context: {
      session: GameSession;
      adventure: AdventureDefinition;
      allowedActions: ActionType[];
    },
  ): Promise<ParsedAction> {
    const player = context.session.players.find(
      (p) => p.id === context.session.currentTurnPlayerId,
    );
    const location = player ? context.adventure.locations[player.currentLocationId] : undefined;
    if (!player || !location) return this.fallback.classify(rawInput, context);

    const itemsHere = location.items.map((g) => g.itemId).join(', ') || '(none)';
    const npcsHere = location.npcs.join(', ') || '(none)';
    const inventoryIds = player.inventory.map((i) => i.instanceId).join(', ') || '(empty)';
    const exitDirections = location.exits.map((e) => e.direction).join(', ') || '(none)';
    const spells = player.spells.join(', ') || '(none)';

    const systemPrompt = `You are an action classifier for a text adventure game. Given a player's raw input, classify it into one of the allowed action types and extract its parameters.

Return ONLY a single JSON object — no prose, no markdown fences. The shape is:
{ "type": <ACTION_TYPE>, "params": { ... } }

The "params" object must match the action type:
- MOVE:        { "type": "MOVE", "direction": <string from exit directions> }
- TAKE_ITEM:   { "type": "TAKE_ITEM", "itemId": <itemId present in current location> }
- DROP_ITEM:   { "type": "DROP_ITEM", "instanceId": <instanceId from player inventory> }
- USE_ITEM:    { "type": "USE_ITEM", "instanceId": <instanceId from player inventory>, "targetId": <optional> }
- TALK_TO_NPC: { "type": "TALK_TO_NPC", "npcId": <npcId present in current location> }
- ATTACK:      { "type": "ATTACK", "targetNpcId": <npcId present in current location> }
- CAST_SPELL:  { "type": "CAST_SPELL", "spellId": <spellId from player spells>, "targetId": <optional> }
- EXAMINE:     { "type": "EXAMINE", "targetId": <any visible id or noun> }
- LOOK:        { "type": "LOOK" }
- INVENTORY:   { "type": "INVENTORY" }
- STATUS:      { "type": "STATUS" }
- RECALL:      { "type": "RECALL" }

If the input is ambiguous or impossible (e.g. attacking when ATTACK is not allowed for this class), default to LOOK.
Use only IDs that appear in the lists provided — never invent IDs.`;

    const userPrompt = `Allowed action types: ${context.allowedActions.join(', ')}

Available exit directions: ${exitDirections}
Items in this location: ${itemsHere}
NPCs in this location: ${npcsHere}
Player inventory instanceIds: ${inventoryIds}
Player spells: ${spells}

Player input: ${JSON.stringify(rawInput)}

Classify this input. Return only the JSON object.`;

    try {
      const raw = await this.llm.complete({ systemPrompt, userPrompt, maxTokens: 256 });
      const cleaned = stripJsonFence(raw);
      const parsed = JSON.parse(cleaned) as { type: ActionType; params: unknown };
      const action: ParsedAction = {
        type: parsed.type,
        rawInput,
        params: parsed.params as ParsedAction['params'],
      };
      const validated = ParsedActionSchema.parse(action);
      if (validated.type !== validated.params.type) {
        throw new Error('action type and params.type disagree');
      }
      return validated;
    } catch {
      return this.fallback.classify(rawInput, context);
    }
  }
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}
