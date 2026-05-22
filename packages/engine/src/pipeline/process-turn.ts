import type { DiceRoll, GameSession, StateChange, TurnEntry } from '@loreforge/shared';
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
   * Promise that resolves once memory-manager background work (blob append,
   * section summarisation) completes. Awaiting is optional in production —
   * the result is already returned — but tests and shutdown paths should
   * drain it.
   */
  backgroundWork?: Promise<void>;
}

/**
 * The 7-stage pipeline from ARCHITECTURE.md §4.2, orchestrated as a single
 * async function. Each stage is a pure or near-pure operation; this function
 * does the IO (loading, persisting) and chains them together.
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

  // Stage 2: validate against rules
  const validation = validateAction(action, session, adventure);
  if (!validation.valid) {
    return {
      narrative: validation.reason,
      stateChanges: [],
      updatedSession: session,
      validationError: validation.reason,
    };
  }

  // Stage 3: resolve dice (only for combat actions in PoC)
  let diceRoll: DiceRoll | undefined;
  if (action.params.type === 'ATTACK') {
    const target = adventure.npcs[action.params.targetNpcId];
    if (target?.combatStats) {
      const attackRoll = rollAttack({
        attackBonus: 2, // placeholder until class/weapon math is wired up
        targetAc: target.combatStats.ac,
      });
      if (attackRoll.success) {
        const damage = rollDamage({
          damageDie: 6,
          damageBonus: 1,
        });
        diceRoll = { ...attackRoll, total: attackRoll.total };
        // Damage is applied via state changes below.
        // For Phase 1, attribute damage directly here so the test loop sees HP move.
        // Phase 2 lets the LLM narrate damage application via hp_changed tool calls.
        const npcDefeated = damage.total >= target.combatStats.hp;
        const stub: StateChange[] = npcDefeated ? [{ type: 'NPC_DEFEATED', npcId: target.id }] : [];
        const turnNumber = session.memoryState.activeTurns.length;
        const previousLocationId = player.currentLocationId;
        const stateChanges = stub;
        const apply = applyStateChanges(session, stateChanges, { adventure, turnNumber });
        const narrativeText = npcDefeated
          ? `You strike ${target.name} down.`
          : `You wound ${target.name}, but it still stands.`;
        const turnEntry: TurnEntry = {
          turnNumber,
          playerId: input.playerId,
          playerInput: input.rawInput,
          narrativeResponse: narrativeText,
          stateChanges,
          timestamp: new Date().toISOString(),
        };
        const { session: nextSession, backgroundWork } = await updateMemory(
          apply.session,
          turnEntry,
          { adventure, previousLocationId },
          { blob: deps.blobStore, llm: deps.llmProvider },
        );
        await deps.sessionStore.update(nextSession);
        return {
          narrative: narrativeText,
          stateChanges,
          updatedSession: nextSession,
          rollResult: diceRoll,
          backgroundWork,
        };
      }
      diceRoll = attackRoll;
    }
  }

  // Stages 4–5: build prompt and stream narrative
  const turnNumber = session.memoryState.activeTurns.length;
  const previousLocationId = player.currentLocationId;
  const prompt = buildNarrativePrompt({ adventure, session, action, diceRoll });
  const { narrative, stateChanges } = await narrate(
    { prompt, action, session, adventure, turnNumber },
    deps.llmProvider,
  );

  // Stage 6: apply state changes
  const apply = applyStateChanges(session, stateChanges, { adventure, turnNumber });

  // Stage 7: memory (sync part returns immediately; async part runs in background)
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
    { blob: deps.blobStore, llm: deps.llmProvider },
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
