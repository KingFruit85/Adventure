import type {
  AdventureDefinition,
  DiceRoll,
  GameSession,
  ParsedAction,
  StateChange,
} from '@loreforge/shared';
import type { NarrativePrompt, NarratorToolDefinition } from '../llm/provider.js';

export const NARRATOR_TOOL_DEFINITIONS: NarratorToolDefinition[] = [
  {
    name: 'player_moved',
    description: 'Call when the player successfully moves to a new location.',
    input_schema: {
      type: 'object',
      properties: {
        playerId: { type: 'string' },
        locationId: { type: 'string' },
      },
      required: ['playerId', 'locationId'],
    },
  },
  {
    name: 'item_added_to_inventory',
    description: 'Call when a player picks up an item. Engine creates the InventoryItem instance.',
    input_schema: {
      type: 'object',
      properties: {
        playerId: { type: 'string' },
        itemId: { type: 'string' },
        quantity: { type: 'number' },
      },
      required: ['playerId', 'itemId', 'quantity'],
    },
  },
  {
    name: 'item_removed_from_inventory',
    description: "Call when an item is removed from a player's inventory.",
    input_schema: {
      type: 'object',
      properties: {
        playerId: { type: 'string' },
        instanceId: { type: 'string' },
      },
      required: ['playerId', 'instanceId'],
    },
  },
  {
    name: 'item_used',
    description:
      'Call when a consumable or charged item is used. Engine decrements charges/durability.',
    input_schema: {
      type: 'object',
      properties: {
        playerId: { type: 'string' },
        instanceId: { type: 'string' },
      },
      required: ['playerId', 'instanceId'],
    },
  },
  {
    name: 'npc_spoke',
    description: 'Call after every NPC dialogue exchange to record it for NPC memory.',
    input_schema: {
      type: 'object',
      properties: {
        npcId: { type: 'string' },
        playerId: { type: 'string' },
        npcRepliedSummary: { type: 'string' },
        questGranted: { type: 'string' },
        dispositionChange: { type: 'string', enum: ['FRIENDLY', 'NEUTRAL', 'HOSTILE'] },
      },
      required: ['npcId', 'playerId', 'npcRepliedSummary'],
    },
  },
  {
    name: 'npc_defeated',
    description: 'Call when an NPC is defeated in combat.',
    input_schema: {
      type: 'object',
      properties: { npcId: { type: 'string' } },
      required: ['npcId'],
    },
  },
  {
    name: 'puzzle_solved',
    description: 'Call when a puzzle is solved.',
    input_schema: {
      type: 'object',
      properties: { puzzleId: { type: 'string' } },
      required: ['puzzleId'],
    },
  },
  {
    name: 'goal_completed',
    description: 'Call when a goal is completed.',
    input_schema: {
      type: 'object',
      properties: { goalId: { type: 'string' } },
      required: ['goalId'],
    },
  },
  {
    name: 'quest_started',
    description: 'Call when a quest begins for a player.',
    input_schema: {
      type: 'object',
      properties: {
        questId: { type: 'string' },
        playerId: { type: 'string' },
      },
      required: ['questId', 'playerId'],
    },
  },
  {
    name: 'hp_changed',
    description: "Call when a player's HP changes. Engine clamps to max.",
    input_schema: {
      type: 'object',
      properties: {
        playerId: { type: 'string' },
        delta: { type: 'number' },
      },
      required: ['playerId', 'delta'],
    },
  },
  {
    name: 'game_over',
    description: 'Call when the game ends in victory or defeat.',
    input_schema: {
      type: 'object',
      properties: {
        result: { type: 'string', enum: ['VICTORY', 'DEFEAT'] },
        message: { type: 'string' },
      },
      required: ['result', 'message'],
    },
  },
];

const BEHAVIORAL_RULES = `
NARRATIVE RULES:
- You narrate prose. The engine controls facts.
- Never invent state changes that were not pre-resolved by the engine.
- When the player's input was validated and a dice roll was provided, narrate the outcome described by that roll. Do not re-roll or override.
- Use tool calls to signal every state change (movement, item pickup, NPC dialogue, combat result, etc.). Narrative text should never be the canonical record.
- Stay in the adventure's tone. Stay grounded in what the player can perceive.
- Keep responses to 2-4 short paragraphs unless dialogue requires more.
`.trim();

/**
 * The system prompt is *cacheable*. It contains only content that is stable
 * for the lifetime of an adventure run:
 *   - world context
 *   - tone
 *   - behavioural rules
 *   - per-adventure ID dictionaries (locations, items, NPCs, etc.) so Claude
 *     knows what IDs to pass to tool calls without guessing
 *
 * Player state, current location details, recent turns, and the action being
 * resolved are all in the *user* context — they change every turn and would
 * invalidate the cache if placed here.
 */
export function buildSystemPrompt(adventure: AdventureDefinition): string {
  const locationCatalog = Object.values(adventure.locations)
    .map((l) => `- ${l.id}: ${l.name}`)
    .join('\n');
  const itemCatalog = Object.values(adventure.items)
    .map((i) => `- ${i.id}: ${i.name}`)
    .join('\n');
  const npcCatalog = Object.values(adventure.npcs)
    .map((n) => `- ${n.id}: ${n.name}`)
    .join('\n');
  const questCatalog = Object.values(adventure.quests)
    .map((q) => `- ${q.id}: ${q.title}`)
    .join('\n');
  const goalCatalog = Object.values(adventure.goals)
    .map((g) => `- ${g.id}: ${g.description}${g.isEndGame ? ` [END:${g.endGameType}]` : ''}`)
    .join('\n');

  return [
    `# WORLD CONTEXT\n${adventure.worldContext}`,
    `# TONE\n${adventure.tone}`,
    `# RULES\n${BEHAVIORAL_RULES}`,
    '# ID REFERENCE (use these exact strings in tool calls)',
    `## Locations\n${locationCatalog}`,
    `## Items\n${itemCatalog}`,
    `## NPCs\n${npcCatalog}`,
    `## Quests\n${questCatalog}`,
    `## Goals\n${goalCatalog}`,
  ].join('\n\n');
}

export function buildUserContext(input: {
  adventure: AdventureDefinition;
  session: GameSession;
  action: ParsedAction;
  diceRoll?: DiceRoll;
  secondaryRoll?: DiceRoll;
  engineChanges?: StateChange[];
}): string {
  const { adventure, session, action, diceRoll, secondaryRoll, engineChanges } = input;
  const player = session.players.find((p) => p.id === session.currentTurnPlayerId);
  if (!player) throw new Error('Active player not found in session');
  const location = adventure.locations[player.currentLocationId];
  if (!location) throw new Error(`Location ${player.currentLocationId} not found`);

  const playerSheet = formatCharacterSheet(player);

  const sectionSummaries = session.memoryState.sectionSummaries
    .map((s) => `[${s.locationId} visit ${s.visitIndex}] ${s.summary}`)
    .join('\n');

  const recentTurns = session.memoryState.activeTurns
    .map((t) => `Turn ${t.turnNumber}: player said "${t.playerInput}" → ${t.narrativeResponse}`)
    .join('\n');

  const npcsHere = location.npcs
    .map((id) => adventure.npcs[id])
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => {
      const disposition = session.worldState.npcDispositions[n.id] ?? n.initialDisposition;
      const defeated = session.worldState.defeatedNpcIds.includes(n.id);
      const status = defeated ? 'DEFEATED' : disposition;
      return `- ${n.name} (${n.id}) [${status}]: ${n.personality}`;
    })
    .join('\n');

  const itemsHere = location.items
    .filter((g) => !session.worldState.collectedItemIds.includes(g.itemId))
    .map((g) => {
      const item = adventure.items[g.itemId];
      return item ? `- ${item.name} (${item.id})` : `- ${g.itemId}`;
    })
    .join('\n');

  const diceLines: string[] = [];
  if (diceRoll) diceLines.push(formatDiceRoll(diceRoll));
  if (secondaryRoll) diceLines.push(formatDiceRoll(secondaryRoll));
  const diceContext = diceLines.length
    ? `\n\n# DICE RESULTS (authoritative — narrate these outcomes; do not re-roll)\n${diceLines.join('\n')}`
    : '';

  const engineChangesLines = (engineChanges ?? []).map((c) => formatEngineChange(c));
  const engineChangesContext = engineChangesLines.length
    ? `\n\n# ENGINE-DETERMINED FACTS (already applied — narrate, then call matching tool calls if appropriate)\n${engineChangesLines.join('\n')}`
    : '';

  return [
    `# ACTIVE PLAYER\n${playerSheet}`,
    sectionSummaries ? `# HISTORY SUMMARIES\n${sectionSummaries}` : '',
    recentTurns ? `# RECENT TURNS\n${recentTurns}` : '',
    `# CURRENT LOCATION: ${location.name} (${location.id})\n${location.atmosphericDescription}`,
    npcsHere ? `# NPCS HERE\n${npcsHere}` : '',
    itemsHere ? `# ITEMS HERE\n${itemsHere}` : '',
    `# PLAYER ACTION\nRaw input: "${action.rawInput}"\nParsed as: ${action.type}${diceContext}${engineChangesContext}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatEngineChange(change: StateChange): string {
  switch (change.type) {
    case 'NPC_DEFEATED':
      return `- NPC ${change.npcId} has been defeated.`;
    case 'GOAL_COMPLETED':
      return `- Goal ${change.goalId} has been completed.`;
    case 'GAME_OVER':
      return `- The game has ended in ${change.result}.`;
    case 'HP_CHANGED':
      return `- Player ${change.playerId} HP changed by ${change.delta} (now ${change.newValue}).`;
    default:
      return `- ${change.type}`;
  }
}

function formatCharacterSheet(player: import('@loreforge/shared').PlayerState): string {
  const inventoryLines = player.inventory.length
    ? player.inventory
        .map((i) => `  - ${i.itemId} (instanceId: ${i.instanceId}, qty: ${i.quantity})`)
        .join('\n')
    : '  (empty)';
  return [
    `playerId: ${player.id}`,
    `name: ${player.name}`,
    `class: ${player.characterClass.name}`,
    `location: ${player.currentLocationId}`,
    `HP: ${player.hp.current}/${player.hp.max}`,
    `spells: ${player.spells.join(', ') || 'none'}`,
    `active quests: ${player.activeQuestIds.join(', ') || 'none'}`,
    `inventory:\n${inventoryLines}`,
  ].join('\n');
}

function formatDiceRoll(roll: DiceRoll): string {
  const successPart = roll.success === undefined ? '' : roll.success ? ' [SUCCESS]' : ' [FAILURE]';
  const dcPart = roll.dc !== undefined ? ` vs DC ${roll.dc}` : '';
  return `${roll.type}: d${roll.die} [${roll.rolls.join(',')}] + ${roll.modifier} = ${roll.total}${dcPart}${successPart}`;
}

export function buildNarrativePrompt(input: {
  adventure: AdventureDefinition;
  session: GameSession;
  action: ParsedAction;
  diceRoll?: DiceRoll;
  secondaryRoll?: DiceRoll;
  engineChanges?: StateChange[];
}): NarrativePrompt {
  return {
    systemPrompt: buildSystemPrompt(input.adventure),
    userContext: buildUserContext(input),
    toolDefinitions: NARRATOR_TOOL_DEFINITIONS,
  };
}
