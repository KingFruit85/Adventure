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

    const castMatch = input.match(/^(?:cast|invoke|hurl)\s+(.+)$/);
    if (castMatch) {
      const remainder = (castMatch[1] ?? '').trim();
      // "fire_bolt at the goblin chief" → spellId="fire_bolt", target=remainder after "at"
      const atIdx = remainder.search(/\s(?:at|on|toward|towards)\s/);
      let spellPart = remainder;
      let targetPart: string | undefined;
      if (atIdx >= 0) {
        spellPart = remainder.slice(0, atIdx).trim();
        targetPart = remainder
          .slice(atIdx)
          .replace(/^\s(?:at|on|toward|towards)\s/, '')
          .trim();
      }
      const spellId = resolveSpellId(spellPart, context.session, context.adventure);
      if (spellId) {
        const targetId =
          targetPart && location
            ? resolveNpcIdInLocation(targetPart, location.npcs, context.adventure)
            : undefined;
        return {
          type: 'CAST_SPELL',
          rawInput,
          params: { type: 'CAST_SPELL', spellId, ...(targetId ? { targetId } : {}) },
        };
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

function resolveSpellId(
  query: string,
  session: GameSession,
  _adventure: AdventureDefinition,
): string | undefined {
  const q = query.trim().toLowerCase();
  const player = session.players.find((p) => p.id === session.currentTurnPlayerId);
  if (!player) return undefined;
  for (const spellId of player.spells) {
    if (spellId.toLowerCase() === q) return spellId;
    if (spellId.toLowerCase().replace(/_/g, ' ') === q) return spellId;
    if (q.startsWith(spellId.toLowerCase())) return spellId;
    if (q.startsWith(spellId.toLowerCase().replace(/_/g, ' '))) return spellId;
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
    if (!player || !location) {
      const fb = await this.fallback.classify(rawInput, context);
      return canonicalizeAction(fb, context.adventure);
    }

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
- CAST_SPELL:  { "type": "CAST_SPELL", "spellId": <spellId from player spells>, "targetId": <optional npcId> }
- EXAMINE:     { "type": "EXAMINE", "targetId": <any visible id or noun> }
- LOOK:        { "type": "LOOK" }
- INVENTORY:   { "type": "INVENTORY" }
- STATUS:      { "type": "STATUS" }
- RECALL:      { "type": "RECALL" }

CRITICAL RULES:
1. All IDs in the catalogues below are LOWERCASE SLUGS (e.g. "mira", "goblin_chief", "rusty_dagger"). Copy them EXACTLY — never re-capitalize, never use display names like "Mira" or "Goblin Chief".
2. If the player mentions an entity by name, find the matching ID in the catalogue and return that slug.
3. If the input is ambiguous or impossible, default to LOOK.
4. Use only IDs that appear in the catalogues provided — never invent IDs.`;

    const userPrompt = `Allowed action types: ${context.allowedActions.join(', ')}

Available exit directions: ${exitDirections}
Items in this location: ${itemsHere}
NPCs in this location: ${npcsHere}
Player inventory instanceIds: ${inventoryIds}
Player spells: ${spells}

Player input: ${JSON.stringify(rawInput)}

Classify this input. Return only the JSON object.`;

    // Run the keyword classifier in parallel — its strict-prefix regexes
    // catch command-style inputs ("cast fire_bolt at X", "attack X") that
    // haiku occasionally drops to LOOK when it can't decide. We prefer
    // haiku's natural-language result, but rescue with keyword when haiku
    // returns the LOOK fallback on input that wasn't a LOOK request.
    const keywordPromise = this.fallback.classify(rawInput, context);

    let llmAction: ParsedAction | null = null;
    try {
      const raw = await this.llm.complete({ systemPrompt, userPrompt, maxTokens: 256 });
      const cleaned = stripJsonFence(raw);
      const parsed = JSON.parse(cleaned) as { type: ActionType; params: unknown };
      const candidate: ParsedAction = {
        type: parsed.type,
        rawInput,
        params: parsed.params as ParsedAction['params'],
      };
      const validated = ParsedActionSchema.parse(candidate);
      if (validated.type === validated.params.type) {
        llmAction = canonicalizeAction(validated, context.adventure);
      }
    } catch {
      // fall through to the keyword result
    }

    const keywordAction = canonicalizeAction(await keywordPromise, context.adventure);
    if (!llmAction) return keywordAction;
    if (llmAction.type === 'LOOK' && keywordAction.type !== 'LOOK' && !looksLikeLook(rawInput)) {
      return keywordAction;
    }
    return llmAction;
  }
}

function looksLikeLook(input: string): boolean {
  const t = input.trim().toLowerCase();
  return t === 'look' || t === 'l' || /^(?:look(?:\s+at|\s+around)?|examine|inspect)/.test(t);
}

/**
 * Maps display-cased or near-match IDs in an action's params back to the
 * canonical slug from the adventure definition. Idempotent on already-
 * canonical input.
 */
function canonicalizeAction(action: ParsedAction, adventure: AdventureDefinition): ParsedAction {
  const lookupNpc = (id: string): string => {
    if (adventure.npcs[id]) return id;
    const lower = id.toLowerCase();
    for (const npc of Object.values(adventure.npcs)) {
      if (npc.id.toLowerCase() === lower) return npc.id;
      if (npc.name.toLowerCase() === lower) return npc.id;
    }
    return id;
  };
  const lookupItem = (id: string): string => {
    if (adventure.items[id]) return id;
    const lower = id.toLowerCase();
    for (const item of Object.values(adventure.items)) {
      if (item.id.toLowerCase() === lower) return item.id;
      if (item.name.toLowerCase() === lower) return item.id;
    }
    return id;
  };

  switch (action.params.type) {
    case 'MOVE': {
      // The player's current location is implied by session state, but we
      // don't have it here. Walk all locations' exits and find the first
      // direction the LLM-provided string starts with — accommodates inputs
      // like "north into the ashwood" → "north".
      const canonical = canonicalizeDirection(action.params.direction, adventure);
      return { ...action, params: { ...action.params, direction: canonical } };
    }
    case 'TALK_TO_NPC':
      return {
        ...action,
        params: { ...action.params, npcId: lookupNpc(action.params.npcId) },
      };
    case 'ATTACK':
      return {
        ...action,
        params: { ...action.params, targetNpcId: lookupNpc(action.params.targetNpcId) },
      };
    case 'CAST_SPELL':
      if (!action.params.targetId) return action;
      return {
        ...action,
        params: { ...action.params, targetId: lookupNpc(action.params.targetId) },
      };
    case 'TAKE_ITEM':
      return {
        ...action,
        params: { ...action.params, itemId: lookupItem(action.params.itemId) },
      };
    default:
      return action;
  }
}

/**
 * Normalises a movement phrase like "north into the ashwood" or
 * "through the door to the cellar" down to the bare direction token
 * defined on some exit ("north", "through the door"). Returns the original
 * input if no candidate matches — the validator will reject it with a
 * helpful "no exit X from Y" message.
 *
 * Collects exit directions from *all* locations because intent classification
 * doesn't know the active player's current location.
 */
function canonicalizeDirection(input: string, adventure: AdventureDefinition): string {
  const lower = input.trim().toLowerCase();
  const candidates = new Set<string>();
  for (const loc of Object.values(adventure.locations)) {
    for (const exit of loc.exits) {
      candidates.add(exit.direction.toLowerCase());
    }
  }
  // Exact match first.
  for (const c of candidates) if (c === lower) return c;
  // Prefix match next ("north into the ashwood" starts with "north").
  // Sort by length descending so multi-word directions ("through the door")
  // beat single-word prefixes.
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    if (lower.startsWith(`${c} `) || lower === c) return c;
  }
  // Contains match as a last resort.
  for (const c of sorted) {
    if (lower.includes(c)) return c;
  }
  return input;
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}
