import { describe, expect, it } from 'vitest';
import { AdventureDefinitionSchema, ItemSchema, NPCSchema } from './adventure.js';

describe('AdventureDefinitionSchema', () => {
  it('rejects an adventure missing required fields', () => {
    expect(() => AdventureDefinitionSchema.parse({})).toThrow();
  });

  it('accepts a minimal valid adventure', () => {
    const minimal = {
      id: 'test',
      title: 'Test',
      description: 'A test',
      minPlayers: 1,
      maxPlayers: 1,
      startingLocationId: 'start',
      startingInventory: [],
      availableClasses: [],
      locations: {},
      items: {},
      npcs: {},
      puzzles: {},
      quests: {},
      goals: {},
      rules: {
        allowedActionTypes: ['LOOK'],
        combatSystem: 'NONE' as const,
        permaDeath: false,
        maxInventorySize: 5,
        globalForbiddenPhrases: [],
      },
      worldContext: '',
      tone: 'plain',
    };
    expect(() => AdventureDefinitionSchema.parse(minimal)).not.toThrow();
  });
});

describe('ItemSchema', () => {
  it('allows weapon with combat properties', () => {
    const item = {
      id: 'sword',
      name: 'Sword',
      description: 'A blade',
      category: 'WEAPON' as const,
      isConsumable: false,
      isQuestItem: false,
      isStackable: false,
      combatProperties: {
        damageDie: 6,
        damageBonus: 0,
        damageType: 'SLASHING' as const,
        range: 'MELEE' as const,
        twoHanded: false,
      },
    };
    expect(() => ItemSchema.parse(item)).not.toThrow();
  });
});

describe('NPCSchema', () => {
  it('rejects invalid disposition', () => {
    expect(() =>
      NPCSchema.parse({
        id: 'x',
        name: 'X',
        personality: 'p',
        initialDisposition: 'ANGRY',
        knowledge: [],
      }),
    ).toThrow();
  });
});
