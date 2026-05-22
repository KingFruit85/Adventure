import type {
  AdventureDefinition,
  DiceRoll,
  GameSession,
  ParsedAction,
  StateChange,
  TurnEntry,
  TurnEvent,
} from '@loreforge/shared';
import type { EngineDependencies } from '../deps.js';
import { rollAttack, rollDamage } from './dice-resolver.js';
import { updateMemory } from './memory-manager.js';
import { narrateStream } from './narrator.js';
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

interface PipelineTail {
  backgroundWork?: Promise<void>;
}

/**
 * The 7-stage pipeline from ARCHITECTURE.md §4.2, as an async generator
 * yielding TurnEvents in the order they happen. Drives both the SSE turn
 * endpoint (via `streamTurn`) and the result-oriented `processTurn` wrapper.
 *
 * Yields, in order:
 *   - validation_error  (if rules reject the parsed action; pipeline terminates)
 *   - roll_result       (zero or one — the primary dice roll)
 *   - text_delta        (many — streamed LLM tokens)
 *   - state_change      (one per merged engine + LLM state change)
 *   - turn_complete     (always last on the happy path)
 *
 * Returns the post-turn `backgroundWork` promise so the result-oriented
 * caller can thread it back to its caller.
 */
async function* runTurnPipeline(
  input: ProcessTurnInput,
  deps: EngineDependencies,
): AsyncGenerator<TurnEvent, PipelineTail, void> {
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
    yield { type: 'validation_error', message: validation.reason };
    yield {
      type: 'turn_complete',
      stateChanges: [],
      updatedSession: session,
    };
    return {};
  }

  // Stage 3: dice + engine-determined consequences
  const turnNumber = session.memoryState.activeTurns.length;
  const previousLocationId = player.currentLocationId;
  const { diceRoll, secondaryRoll, engineChanges } = resolveDice(action, adventure, session);
  if (diceRoll) yield { type: 'roll_result', roll: diceRoll };
  if (secondaryRoll) yield { type: 'roll_result', roll: secondaryRoll };

  // Stages 4–5: prompt + streamed narration
  const prompt = buildNarrativePrompt({
    adventure,
    session,
    action,
    diceRoll,
    secondaryRoll,
    engineChanges,
  });

  const narrateGen = narrateStream(
    { prompt, action, session, adventure, turnNumber },
    deps.llmProvider,
  );
  let narrative = '';
  let llmChanges: StateChange[] = [];
  while (true) {
    const r = await narrateGen.next();
    if (r.done) {
      narrative = r.value.narrative;
      llmChanges = r.value.stateChanges;
      break;
    }
    yield { type: 'text_delta', delta: r.value };
  }

  // Stage 6: merge + apply
  const allChanges: StateChange[] = [...engineChanges, ...llmChanges];
  const apply = applyStateChanges(session, allChanges, { adventure, turnNumber });
  for (const change of apply.appliedChanges) {
    yield { type: 'state_change', change };
  }

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

  yield {
    type: 'turn_complete',
    stateChanges: apply.appliedChanges,
    updatedSession: nextSession,
  };

  return { backgroundWork };
}

export interface TurnHandle {
  /** Stream of TurnEvents in pipeline order. */
  events: AsyncIterable<TurnEvent>;
  /**
   * Settles once memory-manager background work completes (blob append +
   * any section summarisation save). SSE handlers can fire-and-forget;
   * tests should await before cleanup.
   */
  backgroundWork: Promise<void>;
}

/**
 * SSE-friendly entrypoint. Returns an event stream plus a promise that
 * resolves when post-turn background work completes.
 */
export function streamTurn(input: ProcessTurnInput, deps: EngineDependencies): TurnHandle {
  let resolveBg!: (p: Promise<void> | undefined) => void;
  const bgRef = new Promise<Promise<void> | undefined>((r) => {
    resolveBg = r;
  });

  const events = (async function* (): AsyncIterable<TurnEvent> {
    const gen = runTurnPipeline(input, deps);
    try {
      while (true) {
        const r = await gen.next();
        if (r.done) {
          resolveBg(r.value.backgroundWork);
          return;
        }
        yield r.value;
      }
    } catch (err) {
      // Ensure backgroundWork resolves even if the pipeline throws so callers
      // awaiting it don't hang.
      resolveBg(undefined);
      throw err;
    }
  })();

  const backgroundWork = bgRef.then((p) => p ?? Promise.resolve());

  return { events, backgroundWork };
}

/**
 * Result-oriented wrapper. Drains the pipeline and returns aggregated state.
 * Kept for tests and any non-streaming consumer; semantically equivalent to
 * consuming `streamTurn` and folding events into ProcessTurnResult.
 */
export async function processTurn(
  input: ProcessTurnInput,
  deps: EngineDependencies,
): Promise<ProcessTurnResult> {
  const gen = runTurnPipeline(input, deps);
  let narrative = '';
  let stateChanges: StateChange[] = [];
  let updatedSession: GameSession | undefined;
  let validationError: string | undefined;
  let rollResult: DiceRoll | undefined;

  while (true) {
    const r = await gen.next();
    if (r.done) {
      if (!updatedSession) {
        throw new Error('Pipeline ended without turn_complete event');
      }
      return {
        narrative,
        stateChanges,
        updatedSession,
        validationError,
        rollResult,
        backgroundWork: r.value.backgroundWork,
      };
    }
    const event = r.value;
    switch (event.type) {
      case 'validation_error':
        validationError = event.message;
        narrative = event.message;
        break;
      case 'roll_result':
        // First roll is the primary (attack). Damage roll comes second and we
        // don't surface it on the result object — clients can read both via
        // streamTurn if they care about damage rolls.
        if (!rollResult) rollResult = event.roll;
        break;
      case 'text_delta':
        narrative += event.delta;
        break;
      case 'state_change':
        // Final list comes from turn_complete; nothing to do here.
        break;
      case 'turn_complete':
        stateChanges = event.stateChanges;
        updatedSession = event.updatedSession;
        break;
    }
  }
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
