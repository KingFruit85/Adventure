import { z } from 'zod';

export const ActionTypeSchema = z.enum([
  'MOVE',
  'EXAMINE',
  'TAKE_ITEM',
  'DROP_ITEM',
  'USE_ITEM',
  'TALK_TO_NPC',
  'ATTACK',
  'CAST_SPELL',
  'LOOK',
  'INVENTORY',
  'STATUS',
  'RECALL',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionParamsSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MOVE'), direction: z.string() }),
  z.object({ type: z.literal('TAKE_ITEM'), itemId: z.string() }),
  z.object({ type: z.literal('DROP_ITEM'), instanceId: z.string() }),
  z.object({
    type: z.literal('USE_ITEM'),
    instanceId: z.string(),
    targetId: z.string().optional(),
  }),
  z.object({ type: z.literal('TALK_TO_NPC'), npcId: z.string() }),
  z.object({ type: z.literal('ATTACK'), targetNpcId: z.string() }),
  z.object({
    type: z.literal('CAST_SPELL'),
    spellId: z.string(),
    targetId: z.string().optional(),
  }),
  z.object({ type: z.literal('EXAMINE'), targetId: z.string() }),
  z.object({ type: z.literal('LOOK') }),
  z.object({ type: z.literal('INVENTORY') }),
  z.object({ type: z.literal('STATUS') }),
  z.object({ type: z.literal('RECALL') }),
]);
export type ActionParams = z.infer<typeof ActionParamsSchema>;

export const ParsedActionSchema = z.object({
  type: ActionTypeSchema,
  rawInput: z.string(),
  params: ActionParamsSchema,
});
export type ParsedAction = z.infer<typeof ParsedActionSchema>;
