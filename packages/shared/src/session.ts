import { z } from 'zod';
import {
  AbilityScoresSchema,
  CharacterClassSchema,
  DispositionSchema,
  InventoryItemSchema,
} from './adventure.js';

export const SessionStatusSchema = z.enum(['CHARACTER_SELECT', 'ACTIVE', 'PAUSED', 'COMPLETED']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const PlayerStateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  characterClass: CharacterClassSchema,
  currentLocationId: z.string(),
  abilityScores: AbilityScoresSchema,
  hp: z.object({
    current: z.number().int(),
    max: z.number().int().positive(),
  }),
  inventory: z.array(InventoryItemSchema),
  spells: z.array(z.string()),
  activeQuestIds: z.array(z.string()),
  completedGoalIds: z.array(z.string()),
  statusEffects: z.array(z.string()),
});
export type PlayerState = z.infer<typeof PlayerStateSchema>;

export const NPCInteractionSchema = z.object({
  turnNumber: z.number().int().nonnegative(),
  playerId: z.string().uuid(),
  playerSaid: z.string(),
  npcReplied: z.string(),
  questsGranted: z.array(z.string()),
  dispositionChange: DispositionSchema.optional(),
});
export type NPCInteraction = z.infer<typeof NPCInteractionSchema>;

export const NPCMemorySchema = z.object({
  npcId: z.string(),
  interactions: z.array(NPCInteractionSchema),
  summary: z.string().optional(),
});
export type NPCMemory = z.infer<typeof NPCMemorySchema>;

export const WorldStateSchema = z.object({
  defeatedNpcIds: z.array(z.string()),
  collectedItemIds: z.array(z.string()),
  solvedPuzzleIds: z.array(z.string()),
  completedGoalIds: z.array(z.string()),
  activeQuestIds: z.array(z.string()),
  visitedLocationIds: z.array(z.string()),
  npcDispositions: z.record(z.string(), DispositionSchema),
  npcMemories: z.record(z.string(), NPCMemorySchema),
  /**
   * Current HP per NPC. Initialized lazily on first damage — if an NPC ID is
   * absent here, callers should fall back to the static `combatStats.hp`
   * defined on the adventure. Phase 2 extension beyond ARCHITECTURE.md §3.2;
   * needed so multi-hit combat actually resolves.
   */
  npcHp: z.record(z.string(), z.number().int()),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

export const StateChangeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PLAYER_MOVED'),
    playerId: z.string().uuid(),
    toLocationId: z.string(),
  }),
  z.object({
    type: z.literal('ITEM_ADDED'),
    playerId: z.string().uuid(),
    item: InventoryItemSchema,
  }),
  z.object({
    type: z.literal('ITEM_REMOVED'),
    playerId: z.string().uuid(),
    instanceId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('ITEM_DURABILITY_CHANGED'),
    playerId: z.string().uuid(),
    instanceId: z.string().uuid(),
    newDurability: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('NPC_DEFEATED'), npcId: z.string() }),
  z.object({
    type: z.literal('NPC_HP_CHANGED'),
    npcId: z.string(),
    newHp: z.number().int(),
  }),
  z.object({
    type: z.literal('NPC_DISPOSITION_CHANGED'),
    npcId: z.string(),
    disposition: DispositionSchema,
  }),
  z.object({
    type: z.literal('NPC_INTERACTION_RECORDED'),
    npcId: z.string(),
    interaction: NPCInteractionSchema,
  }),
  z.object({ type: z.literal('PUZZLE_SOLVED'), puzzleId: z.string() }),
  z.object({ type: z.literal('GOAL_COMPLETED'), goalId: z.string() }),
  z.object({
    type: z.literal('QUEST_STARTED'),
    questId: z.string(),
    playerId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('HP_CHANGED'),
    playerId: z.string().uuid(),
    delta: z.number().int(),
    newValue: z.number().int(),
  }),
  z.object({
    type: z.literal('GAME_OVER'),
    result: z.enum(['VICTORY', 'DEFEAT']),
  }),
]);
export type StateChange = z.infer<typeof StateChangeSchema>;

export const TurnEntrySchema = z.object({
  turnNumber: z.number().int().nonnegative(),
  playerId: z.string().uuid(),
  playerInput: z.string(),
  narrativeResponse: z.string(),
  stateChanges: z.array(StateChangeSchema),
  timestamp: z.string(),
});
export type TurnEntry = z.infer<typeof TurnEntrySchema>;

export const SectionSummarySchema = z.object({
  locationId: z.string(),
  visitIndex: z.number().int().positive(),
  turnRange: z.tuple([z.number().int(), z.number().int()]),
  summary: z.string(),
  keyEvents: z.array(z.string()),
});
export type SectionSummary = z.infer<typeof SectionSummarySchema>;

export const MemoryStateSchema = z.object({
  activeTurns: z.array(TurnEntrySchema),
  sectionSummaries: z.array(SectionSummarySchema),
});
export type MemoryState = z.infer<typeof MemoryStateSchema>;

export const GameSessionSchema = z.object({
  id: z.string().uuid(),
  sessionCode: z.string(),
  adventureId: z.string(),
  status: SessionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  players: z.array(PlayerStateSchema),
  currentTurnPlayerId: z.string(),
  worldState: WorldStateSchema,
  memoryState: MemoryStateSchema,
});
export type GameSession = z.infer<typeof GameSessionSchema>;

export const SessionSummarySchema = z.object({
  sessionCode: z.string(),
  adventureId: z.string(),
  status: SessionStatusSchema,
  updatedAt: z.string(),
  playerNames: z.array(z.string()),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
