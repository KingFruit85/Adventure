import type { AdventureDefinition, GameSession, StateChange } from '@loreforge/shared';
import { describe, expect, it } from 'vitest';
import { applyStateChanges } from './state-applier.js';

function makeAdventure(): AdventureDefinition {
  return {
    id: 'test',
    title: 'Test',
    description: '',
    minPlayers: 1,
    maxPlayers: 1,
    startingLocationId: 'start',
    startingInventory: [],
    availableClasses: [],
    locations: {},
    items: {
      quest_relic: {
        id: 'quest_relic',
        name: 'Quest Relic',
        description: 'A unique relic.',
        category: 'QUEST_ITEM',
        isConsumable: false,
        isQuestItem: true,
        isStackable: false,
      },
      gold_coin: {
        id: 'gold_coin',
        name: 'Gold Coin',
        description: 'Currency.',
        category: 'MISC',
        isConsumable: false,
        isQuestItem: false,
        isStackable: true,
      },
    },
    npcs: {},
    puzzles: {},
    quests: {},
    goals: {},
    rules: {
      allowedActionTypes: ['LOOK'],
      combatSystem: 'NONE',
      permaDeath: false,
      maxInventorySize: 20,
      globalForbiddenPhrases: [],
    },
    worldContext: '',
    tone: '',
  };
}

function makeSession(): GameSession {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    sessionCode: 'TEST-01-CODE',
    adventureId: 'test',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    players: [
      {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Hero',
        characterClass: {
          id: 'tester',
          name: 'Tester',
          description: '',
          hitDie: 10,
          abilityScoreBonus: {},
          startingItems: [],
          availableActions: ['LOOK'],
        },
        currentLocationId: 'start',
        abilityScores: {
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        },
        hp: { current: 10, max: 10 },
        inventory: [],
        spells: [],
        activeQuestIds: [],
        completedGoalIds: [],
        statusEffects: [],
      },
    ],
    currentTurnPlayerId: '00000000-0000-0000-0000-000000000002',
    worldState: {
      defeatedNpcIds: [],
      collectedItemIds: [],
      solvedPuzzleIds: [],
      completedGoalIds: [],
      activeQuestIds: [],
      visitedLocationIds: ['start'],
      npcDispositions: {},
      npcMemories: {},
      npcHp: {},
    },
    memoryState: {
      activeTurns: [],
      sectionSummaries: [],
    },
  };
}

describe('state-applier ITEM_ADDED dedup', () => {
  it('drops duplicate ITEM_ADDED for a non-stackable item already collected', () => {
    const adventure = makeAdventure();
    const session = makeSession();
    const playerId = session.players[0]!.id;

    const change: StateChange = {
      type: 'ITEM_ADDED',
      playerId,
      item: {
        instanceId: '00000000-0000-0000-0000-000000000010',
        itemId: 'quest_relic',
        quantity: 1,
        acquiredAtTurn: 0,
      },
    };
    const second: StateChange = {
      type: 'ITEM_ADDED',
      playerId,
      item: {
        instanceId: '00000000-0000-0000-0000-000000000011',
        itemId: 'quest_relic',
        quantity: 1,
        acquiredAtTurn: 1,
      },
    };

    const result = applyStateChanges(session, [change, second], { adventure, turnNumber: 1 });

    expect(result.session.players[0]!.inventory).toHaveLength(1);
    expect(result.session.players[0]!.inventory[0]!.itemId).toBe('quest_relic');
    expect(result.session.worldState.collectedItemIds).toEqual(['quest_relic']);
  });

  it('still adds duplicate ITEM_ADDED for stackable items', () => {
    const adventure = makeAdventure();
    const session = makeSession();
    const playerId = session.players[0]!.id;

    const change: StateChange = {
      type: 'ITEM_ADDED',
      playerId,
      item: {
        instanceId: '00000000-0000-0000-0000-000000000020',
        itemId: 'gold_coin',
        quantity: 1,
        acquiredAtTurn: 0,
      },
    };
    const second: StateChange = {
      type: 'ITEM_ADDED',
      playerId,
      item: {
        instanceId: '00000000-0000-0000-0000-000000000021',
        itemId: 'gold_coin',
        quantity: 1,
        acquiredAtTurn: 1,
      },
    };

    const result = applyStateChanges(session, [change, second], { adventure, turnNumber: 1 });
    expect(result.session.players[0]!.inventory).toHaveLength(2);
  });
});
