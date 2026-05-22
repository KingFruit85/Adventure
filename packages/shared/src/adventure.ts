import { z } from 'zod';
import { ActionTypeSchema } from './actions.js';

export const ItemCategorySchema = z.enum([
  'WEAPON',
  'ARMOUR',
  'CONSUMABLE',
  'QUEST_ITEM',
  'TOOL',
  'SPELL_FOCUS',
  'MISC',
]);
export type ItemCategory = z.infer<typeof ItemCategorySchema>;

export const DamageTypeSchema = z.enum([
  'SLASHING',
  'PIERCING',
  'BLUDGEONING',
  'FIRE',
  'COLD',
  'ARCANE',
]);
export type DamageType = z.infer<typeof DamageTypeSchema>;

export const ItemCombatPropertiesSchema = z.object({
  damageDie: z.number().int().positive(),
  damageBonus: z.number().int(),
  damageType: DamageTypeSchema,
  range: z.enum(['MELEE', 'RANGED']),
  twoHanded: z.boolean(),
});
export type ItemCombatProperties = z.infer<typeof ItemCombatPropertiesSchema>;

export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: ItemCategorySchema,
  isConsumable: z.boolean(),
  isQuestItem: z.boolean(),
  isStackable: z.boolean(),
  maxDurability: z.number().int().positive().optional(),
  maxCharges: z.number().int().positive().optional(),
  usableWith: z.array(z.string()).optional(),
  combatProperties: ItemCombatPropertiesSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export const ItemGrantSchema = z.object({
  itemId: z.string(),
  quantity: z.number().int().positive(),
});
export type ItemGrant = z.infer<typeof ItemGrantSchema>;

export const InventoryItemSchema = z.object({
  instanceId: z.string().uuid(),
  itemId: z.string(),
  quantity: z.number().int().positive(),
  durability: z.number().int().nonnegative().optional(),
  charges: z.number().int().nonnegative().optional(),
  acquiredAtTurn: z.number().int().nonnegative(),
  acquiredFromId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const ExitSchema = z.object({
  direction: z.string(),
  toLocationId: z.string(),
  requiresItemId: z.string().optional(),
  requiresGoalId: z.string().optional(),
  lockedMessage: z.string().optional(),
});
export type Exit = z.infer<typeof ExitSchema>;

export const LocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  atmosphericDescription: z.string(),
  exits: z.array(ExitSchema),
  items: z.array(ItemGrantSchema),
  npcs: z.array(z.string()),
  puzzleIds: z.array(z.string()),
  requiresQuestId: z.string().optional(),
  requiresGoalId: z.string().optional(),
});
export type Location = z.infer<typeof LocationSchema>;

export const DispositionSchema = z.enum(['FRIENDLY', 'NEUTRAL', 'HOSTILE']);
export type Disposition = z.infer<typeof DispositionSchema>;

export const NPCCombatStatsSchema = z.object({
  hp: z.number().int().positive(),
  ac: z.number().int().positive(),
  attackBonus: z.number().int(),
  damageDie: z.number().int().positive(),
  damageBonus: z.number().int(),
  xpReward: z.number().int().nonnegative(),
});
export type NPCCombatStats = z.infer<typeof NPCCombatStatsSchema>;

export const NPCSchema = z.object({
  id: z.string(),
  name: z.string(),
  personality: z.string(),
  initialDisposition: DispositionSchema,
  givesQuestId: z.string().optional(),
  knowledge: z.array(z.string()),
  combatStats: NPCCombatStatsSchema.optional(),
});
export type NPC = z.infer<typeof NPCSchema>;

export const PuzzleSolutionSchema = z.object({
  type: z.enum(['USE_ITEM', 'SPEAK_PHRASE', 'EXAMINE_SEQUENCE', 'COMBAT']),
  requiredItemId: z.string().optional(),
  requiredPhrase: z.string().optional(),
  combatTargetNpcId: z.string().optional(),
});
export type PuzzleSolution = z.infer<typeof PuzzleSolutionSchema>;

export const PuzzleSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  description: z.string(),
  solution: PuzzleSolutionSchema,
  rewardItemIds: z.array(z.string()),
  rewardGoalIds: z.array(z.string()),
  hint: z.string(),
});
export type Puzzle = z.infer<typeof PuzzleSchema>;

export const QuestSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  grantedByNpcId: z.string(),
  completionGoalId: z.string(),
  unlocksLocationIds: z.array(z.string()),
});
export type Quest = z.infer<typeof QuestSchema>;

export const GoalSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['DEFEAT_NPC', 'COLLECT_ITEM', 'SOLVE_PUZZLE', 'VISIT_LOCATION', 'TALK_TO_NPC']),
  targetId: z.string(),
  isEndGame: z.boolean(),
  endGameType: z.enum(['VICTORY', 'DEFEAT']).optional(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const AdventureRulesSchema = z.object({
  allowedActionTypes: z.array(ActionTypeSchema),
  combatSystem: z.enum(['SRD5E_SIMPLIFIED', 'NONE']),
  permaDeath: z.boolean(),
  maxInventorySize: z.number().int().positive(),
  globalForbiddenPhrases: z.array(z.string()),
});
export type AdventureRules = z.infer<typeof AdventureRulesSchema>;

export const AbilityScoresSchema = z.object({
  strength: z.number().int(),
  dexterity: z.number().int(),
  constitution: z.number().int(),
  intelligence: z.number().int(),
  wisdom: z.number().int(),
  charisma: z.number().int(),
});
export type AbilityScores = z.infer<typeof AbilityScoresSchema>;

export const CharacterClassSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  hitDie: z.number().int().positive(),
  abilityScoreBonus: AbilityScoresSchema.partial(),
  startingItems: z.array(ItemGrantSchema),
  availableActions: z.array(ActionTypeSchema),
  spells: z.array(z.string()).optional(),
});
export type CharacterClass = z.infer<typeof CharacterClassSchema>;

export const AdventureDefinitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  minPlayers: z.number().int().positive(),
  maxPlayers: z.number().int().positive(),
  startingLocationId: z.string(),
  startingInventory: z.array(ItemGrantSchema),
  availableClasses: z.array(CharacterClassSchema),
  locations: z.record(z.string(), LocationSchema),
  items: z.record(z.string(), ItemSchema),
  npcs: z.record(z.string(), NPCSchema),
  puzzles: z.record(z.string(), PuzzleSchema),
  quests: z.record(z.string(), QuestSchema),
  goals: z.record(z.string(), GoalSchema),
  rules: AdventureRulesSchema,
  worldContext: z.string(),
  tone: z.string(),
});
export type AdventureDefinition = z.infer<typeof AdventureDefinitionSchema>;

export const AdventureMetadataSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  minPlayers: z.number().int().positive(),
  maxPlayers: z.number().int().positive(),
});
export type AdventureMetadata = z.infer<typeof AdventureMetadataSchema>;
