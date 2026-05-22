import { randomUUID } from 'node:crypto';
import type {
  AdventureDefinition,
  CharacterClass,
  GameSession,
  InventoryItem,
  PlayerState,
} from '@loreforge/shared';
import { generateSessionCode } from '../session-store/code-generator.js';

export interface CreateSessionInput {
  adventure: AdventureDefinition;
  players: Array<{
    name: string;
    classId: string;
  }>;
}

const DEFAULT_ABILITY_SCORES = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

/**
 * Builds a fresh GameSession from an adventure definition and a roster of
 * players. Each player is rolled with default ability scores plus the class's
 * `abilityScoreBonus`. Starting inventory comes from both the adventure-level
 * `startingInventory` and the class's `startingItems`.
 */
export function createSession(input: CreateSessionInput): GameSession {
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const players = input.players.map((p) => {
    const klass = input.adventure.availableClasses.find((c) => c.id === p.classId);
    if (!klass) throw new Error(`Class ${p.classId} not found in adventure`);
    return buildPlayerState(p.name, klass, input.adventure);
  });
  if (players.length === 0) throw new Error('Cannot create session with no players');

  return {
    id: sessionId,
    sessionCode: generateSessionCode(),
    adventureId: input.adventure.id,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    players,
    currentTurnPlayerId: players[0]!.id,
    worldState: {
      defeatedNpcIds: [],
      collectedItemIds: [],
      solvedPuzzleIds: [],
      completedGoalIds: [],
      activeQuestIds: [],
      visitedLocationIds: [input.adventure.startingLocationId],
      npcDispositions: Object.fromEntries(
        Object.values(input.adventure.npcs).map((n) => [n.id, n.initialDisposition]),
      ),
      npcMemories: {},
    },
    memoryState: {
      activeTurns: [],
      sectionSummaries: [],
    },
  };
}

function buildPlayerState(
  name: string,
  klass: CharacterClass,
  adventure: AdventureDefinition,
): PlayerState {
  const abilityScores = { ...DEFAULT_ABILITY_SCORES };
  for (const [key, val] of Object.entries(klass.abilityScoreBonus)) {
    if (typeof val !== 'number') continue;
    const k = key as keyof typeof abilityScores;
    abilityScores[k] = (abilityScores[k] ?? 10) + val;
  }
  const hp = klass.hitDie + Math.floor((abilityScores.constitution - 10) / 2);
  const playerId = randomUUID();
  const inventory: InventoryItem[] = [
    ...adventure.startingInventory.flatMap((g) => buildInventoryItems(g, adventure, playerId)),
    ...klass.startingItems.flatMap((g) => buildInventoryItems(g, adventure, playerId)),
  ];
  return {
    id: playerId,
    name,
    characterClass: klass,
    currentLocationId: adventure.startingLocationId,
    abilityScores,
    hp: { current: hp, max: hp },
    inventory,
    spells: klass.spells ?? [],
    activeQuestIds: [],
    completedGoalIds: [],
    statusEffects: [],
  };
}

function buildInventoryItems(
  grant: { itemId: string; quantity: number },
  adventure: AdventureDefinition,
  _playerId: string,
): InventoryItem[] {
  const def = adventure.items[grant.itemId];
  if (!def) throw new Error(`Starting item ${grant.itemId} not found in adventure`);
  const items: InventoryItem[] = [];
  if (def.isStackable) {
    items.push({
      instanceId: randomUUID(),
      itemId: grant.itemId,
      quantity: grant.quantity,
      durability: def.maxDurability,
      charges: def.maxCharges,
      acquiredAtTurn: 0,
    });
  } else {
    for (let i = 0; i < grant.quantity; i++) {
      items.push({
        instanceId: randomUUID(),
        itemId: grant.itemId,
        quantity: 1,
        durability: def.maxDurability,
        charges: def.maxCharges,
        acquiredAtTurn: 0,
      });
    }
  }
  return items;
}
