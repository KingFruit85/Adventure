import { z } from 'zod';
import { DiceRollSchema } from './dice.js';
import { GameSessionSchema, StateChangeSchema } from './session.js';

/**
 * Wire-level events emitted during a single turn. This is the contract between
 * the engine pipeline (which yields these events as the turn progresses) and
 * any consumer: the SSE API, future voice clients, the Tesla/Grok integration.
 *
 * Events are emitted in this order during a normal turn:
 *   - validation_error  (only if the parsed action fails rules validation; loop ends here)
 *   - roll_result       (zero or one per ATTACK / dice-rolling action)
 *   - text_delta        (many; streamed from the LLM)
 *   - state_change      (zero or more; merged engine + LLM tool-call changes)
 *   - turn_complete     (always last; carries the final session snapshot)
 */
export const TurnEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('validation_error'), message: z.string() }),
  z.object({ type: z.literal('roll_result'), roll: DiceRollSchema }),
  z.object({ type: z.literal('text_delta'), delta: z.string() }),
  z.object({ type: z.literal('state_change'), change: StateChangeSchema }),
  z.object({
    type: z.literal('turn_complete'),
    stateChanges: z.array(StateChangeSchema),
    updatedSession: GameSessionSchema,
  }),
]);
export type TurnEvent = z.infer<typeof TurnEventSchema>;
