import type { ActionType, AdventureDefinition, GameSession, ParsedAction } from '@loreforge/shared';
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
 * Phase 2 implementation will go here. Wraps an LLMProvider.complete() call
 * with a structured prompt that asks for JSON output matching ParsedAction.
 */
export class LLMIntentClassifier implements IntentClassifier {
  constructor(private readonly _llm: LLMProvider) {}
  async classify(
    _rawInput: string,
    _context: {
      session: GameSession;
      adventure: AdventureDefinition;
      allowedActions: ActionType[];
    },
  ): Promise<ParsedAction> {
    throw new Error('LLMIntentClassifier not yet implemented — Phase 2');
  }
}
