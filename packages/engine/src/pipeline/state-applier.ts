import { randomUUID } from 'node:crypto';
import type {
  AdventureDefinition,
  GameSession,
  InventoryItem,
  PlayerState,
  StateChange,
} from '@loreforge/shared';

export interface ApplyResult {
  session: GameSession;
  appliedChanges: StateChange[];
}

/**
 * Pure state applier. Walks a list of StateChange events and produces a new
 * GameSession with each applied. Original session is not mutated.
 *
 * Side rules baked in here (kept out of the LLM contract):
 *   - HP is clamped to [0, max].
 *   - Item pickups create a new InventoryItem instance with a fresh UUID,
 *     and add the source itemId to worldState.collectedItemIds so it cannot
 *     be picked up again.
 *   - Goal completion is recorded both on the player who triggered it and
 *     on worldState (some goals are co-op visible).
 */
export function applyStateChanges(
  session: GameSession,
  changes: StateChange[],
  ctx: { adventure: AdventureDefinition; turnNumber: number },
): ApplyResult {
  let updated = cloneSession(session);
  const applied: StateChange[] = [];

  for (const change of changes) {
    updated = applyOne(updated, change, ctx);
    applied.push(change);
  }

  updated.updatedAt = new Date().toISOString();
  return { session: updated, appliedChanges: applied };
}

function applyOne(
  session: GameSession,
  change: StateChange,
  ctx: { adventure: AdventureDefinition; turnNumber: number },
): GameSession {
  switch (change.type) {
    case 'PLAYER_MOVED':
      return updatePlayer(session, change.playerId, (p) => ({
        ...p,
        currentLocationId: change.toLocationId,
      }))
        .withWorld((w) => ({
          ...w,
          visitedLocationIds: addUnique(w.visitedLocationIds, change.toLocationId),
        }))
        .get();

    case 'ITEM_ADDED': {
      const itemDef = ctx.adventure.items[change.item.itemId];
      const instance: InventoryItem = {
        ...change.item,
        instanceId: change.item.instanceId || randomUUID(),
        acquiredAtTurn: change.item.acquiredAtTurn ?? ctx.turnNumber,
        durability: change.item.durability ?? itemDef?.maxDurability,
        charges: change.item.charges ?? itemDef?.maxCharges,
      };
      return updatePlayer(session, change.playerId, (p) => ({
        ...p,
        inventory: [...p.inventory, instance],
      }))
        .withWorld((w) => ({
          ...w,
          collectedItemIds: addUnique(w.collectedItemIds, instance.itemId),
        }))
        .get();
    }

    case 'ITEM_REMOVED':
      return updatePlayer(session, change.playerId, (p) => ({
        ...p,
        inventory: p.inventory.filter((i) => i.instanceId !== change.instanceId),
      })).get();

    case 'ITEM_DURABILITY_CHANGED':
      return updatePlayer(session, change.playerId, (p) => ({
        ...p,
        inventory: p.inventory.map((i) =>
          i.instanceId === change.instanceId ? { ...i, durability: change.newDurability } : i,
        ),
      })).get();

    case 'NPC_DEFEATED':
      return mutWorld(session, (w) => ({
        ...w,
        defeatedNpcIds: addUnique(w.defeatedNpcIds, change.npcId),
      }));

    case 'NPC_DISPOSITION_CHANGED':
      return mutWorld(session, (w) => ({
        ...w,
        npcDispositions: { ...w.npcDispositions, [change.npcId]: change.disposition },
      }));

    case 'NPC_INTERACTION_RECORDED': {
      const existing = session.worldState.npcMemories[change.npcId] ?? {
        npcId: change.npcId,
        interactions: [],
      };
      return mutWorld(session, (w) => ({
        ...w,
        npcMemories: {
          ...w.npcMemories,
          [change.npcId]: {
            ...existing,
            interactions: [...existing.interactions, change.interaction],
          },
        },
      }));
    }

    case 'PUZZLE_SOLVED':
      return mutWorld(session, (w) => ({
        ...w,
        solvedPuzzleIds: addUnique(w.solvedPuzzleIds, change.puzzleId),
      }));

    case 'GOAL_COMPLETED': {
      const goal = ctx.adventure.goals[change.goalId];
      const withWorld = mutWorld(session, (w) => ({
        ...w,
        completedGoalIds: addUnique(w.completedGoalIds, change.goalId),
      }));
      if (goal?.isEndGame && goal.endGameType) {
        return { ...withWorld, status: 'COMPLETED' };
      }
      return withWorld;
    }

    case 'QUEST_STARTED':
      return updatePlayer(session, change.playerId, (p) => ({
        ...p,
        activeQuestIds: addUnique(p.activeQuestIds, change.questId),
      }))
        .withWorld((w) => ({
          ...w,
          activeQuestIds: addUnique(w.activeQuestIds, change.questId),
        }))
        .get();

    case 'HP_CHANGED':
      return updatePlayer(session, change.playerId, (p) => {
        const next = Math.max(0, Math.min(p.hp.max, p.hp.current + change.delta));
        return { ...p, hp: { ...p.hp, current: next } };
      }).get();

    case 'GAME_OVER':
      return { ...session, status: 'COMPLETED' };
  }
}

// --- helpers --------------------------------------------------------------

function cloneSession(session: GameSession): GameSession {
  return structuredClone(session);
}

function addUnique<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr : [...arr, value];
}

interface PlayerUpdater {
  withWorld(fn: (w: GameSession['worldState']) => GameSession['worldState']): PlayerUpdater;
  get(): GameSession;
}

function updatePlayer(
  session: GameSession,
  playerId: string,
  updater: (p: PlayerState) => PlayerState,
): PlayerUpdater {
  const next: GameSession = {
    ...session,
    players: session.players.map((p) => (p.id === playerId ? updater(p) : p)),
  };
  return wrap(next);
}

function mutWorld(
  session: GameSession,
  fn: (w: GameSession['worldState']) => GameSession['worldState'],
): GameSession {
  return { ...session, worldState: fn(session.worldState) };
}

function wrap(session: GameSession): PlayerUpdater {
  return {
    withWorld(fn) {
      return wrap(mutWorld(session, fn));
    },
    get() {
      return session;
    },
  };
}
