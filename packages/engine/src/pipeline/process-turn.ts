import type {
  AdventureDefinition,
  DiceRoll,
  GameSession,
  ParsedAction,
  StateChange,
  TurnEntry,
} from '@loreforge/shared';
import type { EngineDependencies } from '../deps.js';
import { rollAttack, rollDamage } from './dice-resolver.js';
import { updateMemory } from './memory-manager.js';
import { narrate } from './narrator.js';
import { buildNarrativePrompt } from './prompt-builder.js';
import { validateAction } from './rules-validator.js';
import { applyStateChanges } from './state-applier.js';

export interface ProcessTurnInput {
  sessionId: string;
  playerId: string;
  rawInput: string;
}

export interface ProcessTurnResult {
  narrative: string;
  stateChanges: StateChange[];
  updatedSession: GameSession;
  validationError?: string;
  rollResult?: DiceRoll;
  /**
   * Resolves once memory-manager background work (blob append + summarisation
   * + save) completes. Production callers can ignore; tests should await
   * before asserting on persisted state.
   */
  backgroundWork?: Promise<void>;
}

/**
 * The 7-stage pipeline from ARCHITECTURE.md §4.2.
 *
 * Division of authority:
 *   - Engine resolves dice and decides mechanical outcomes (hit/miss,
 *     damage, NPC defeat). These emit StateChange events before the LLM
 *     speaks.
 *   - LLM narrates prose and emits descriptive StateChange events via tool
 *     calls (player_moved on a successful MOVE, item_added on TAKE_ITEM,
 *     npc_spoke on TALK_TO_NPC, etc.).
 *   - The two sets of changes are merged: engine first (settled facts),
 *     then LLM additions.
 */
export async function processTurn(
  input: ProcessTurnInput,
  deps: EngineDependencies,
): Promise<ProcessTurnResult> {
  const session = await deps.sessionStore.get(input.sessionId);
  if (!session) throw new Error(`Session ${input.sessionId} not found`);

  const adventure = await deps.adventureLoader.load(session.adventureId);
  const player = session.players.find((p) => p.id === input.playerId);
  if (!player) throw new Error(`Player ${input.playerId} not found in session`);
  if (session.currentTurnPlayerId !== input.playerId) {
    throw new Error("It is not this player's turn");
  }

  // Stage 1: parse intent
  const action = await deps.intentClassifier.classify(input.rawInput, {
    session,
    adventure,
    allowedActions: player.characterClass.availableActions,
  });

  // Stage 2: validate
  const validation = validateAction(action, session, adventure);
  if (!validation.valid) {
    return {
      narrative: validation.reason,
      stateChanges: [],
      updatedSession: session,
      validationError: validation.reason,
    };
  }

  // Stage 3: resolve dice + engine-determined consequences
  const turnNumber = session.memoryState.activeTurns.length;
  const previousLocationId = player.currentLocationId;
  const { diceRoll, secondaryRoll, engineChanges } = resolveDice(action, adventure, session);

  // Stages 4–5: build prompt and stream narrative
  const prompt = buildNarrativePrompt({
    adventure,
    session,
    action,
    diceRoll,
    secondaryRoll,
    engineChanges,
  });
  const { narrative, stateChanges: llmChanges } = await narrate(
    { prompt, action, session, adventure, turnNumber },
    deps.llmProvider,
  );

  // Stage 6: merge + apply
  const allChanges: StateChange[] = [...engineChanges, ...llmChanges];
  const apply = applyStateChanges(session, allChanges, { adventure, turnNumber });

  // Stage 7: memory (background work persists summaries when location changes)
  const turnEntry: TurnEntry = {
    turnNumber,
    playerId: input.playerId,
    playerInput: input.rawInput,
    narrativeResponse: narrative,
    stateChanges: apply.appliedChanges,
    timestamp: new Date().toISOString(),
  };
  const { session: nextSession, backgroundWork } = await updateMemory(
    apply.session,
    turnEntry,
    { adventure, previousLocationId },
    {
      blob: deps.blobStore,
      llm: deps.llmProvider,
      saveUpdatedSession: (s) => deps.sessionStore.update(s),
    },
  );

  await deps.sessionStore.update(nextSession);

  return {
    narrative,
    stateChanges: apply.appliedChanges,
    updatedSession: nextSession,
    rollResult: diceRoll,
    backgroundWork,
  };
}

interface DiceResolution {
  diceRoll?: DiceRoll;
  secondaryRoll?: DiceRoll;
  engineChanges: StateChange[];
}

function resolveDice(
  action: ParsedAction,
  adventure: AdventureDefinition,
  session: GameSession,
): DiceResolution {
  const engineChanges: StateChange[] = [];
  if (action.params.type !== 'ATTACK') {
    return { engineChanges };
  }
  const target = adventure.npcs[action.params.targetNpcId];
  if (!target?.combatStats) return { engineChanges };

  const attackRoll = rollAttack({
    attackBonus: 2, // PoC: flat bonus; class/weapon math is future work
    targetAc: target.combatStats.ac,
  });

  if (!attackRoll.success) {
    return { diceRoll: attackRoll, engineChanges };
  }

  const damage = rollDamage({ damageDie: 6, damageBonus: 1 });
  const currentHp = session.worldState.npcHp[target.id] ?? target.combatStats.hp;
  const newHp = currentHp - damage.total;
  engineChanges.push({ type: 'NPC_HP_CHANGED', npcId: target.id, newHp });

  if (newHp <= 0) {
    engineChanges.push({ type: 'NPC_DEFEATED', npcId: target.id });
    for (const goal of Object.values(adventure.goals)) {
      if (goal.type === 'DEFEAT_NPC' && goal.targetId === target.id) {
        engineChanges.push({ type: 'GOAL_COMPLETED', goalId: goal.id });
        if (goal.isEndGame && goal.endGameType) {
          engineChanges.push({ type: 'GAME_OVER', result: goal.endGameType });
        }
      }
    }
  }

  return { diceRoll: attackRoll, secondaryRoll: damage, engineChanges };
}
