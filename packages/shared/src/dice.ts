import { z } from 'zod';

export const DiceRollTypeSchema = z.enum(['ATTACK', 'SKILL_CHECK', 'SAVING_THROW', 'DAMAGE']);
export type DiceRollType = z.infer<typeof DiceRollTypeSchema>;

export const DiceRollSchema = z.object({
  type: DiceRollTypeSchema,
  die: z.number().int().positive(),
  rolls: z.array(z.number().int()),
  modifier: z.number().int(),
  total: z.number().int(),
  dc: z.number().int().optional(),
  success: z.boolean().optional(),
  advantage: z.boolean().optional(),
  disadvantage: z.boolean().optional(),
});
export type DiceRoll = z.infer<typeof DiceRollSchema>;
