import type { AbilityScores, DiceRoll } from '@loreforge/shared';

export type AbilityName = keyof AbilityScores;

export interface RandomSource {
  next(): number; // 0..1
}

export const defaultRandomSource: RandomSource = { next: () => Math.random() };

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Rolls one die with optional advantage/disadvantage (rolls twice, picks
 * higher/lower respectively).
 */
function rollOne(
  die: number,
  rng: RandomSource,
  opts?: { advantage?: boolean; disadvantage?: boolean },
): { rolls: number[]; chosen: number } {
  const first = 1 + Math.floor(rng.next() * die);
  if (!opts?.advantage && !opts?.disadvantage) {
    return { rolls: [first], chosen: first };
  }
  const second = 1 + Math.floor(rng.next() * die);
  const chosen = opts.advantage ? Math.max(first, second) : Math.min(first, second);
  return { rolls: [first, second], chosen };
}

export function rollAttack(opts: {
  attackBonus: number;
  targetAc: number;
  rng?: RandomSource;
  advantage?: boolean;
  disadvantage?: boolean;
}): DiceRoll {
  const rng = opts.rng ?? defaultRandomSource;
  const { rolls, chosen } = rollOne(20, rng, opts);
  const total = chosen + opts.attackBonus;
  return {
    type: 'ATTACK',
    die: 20,
    rolls,
    modifier: opts.attackBonus,
    total,
    dc: opts.targetAc,
    success: total >= opts.targetAc,
    advantage: opts.advantage,
    disadvantage: opts.disadvantage,
  };
}

export function rollDamage(opts: {
  damageDie: number;
  damageBonus: number;
  rng?: RandomSource;
}): DiceRoll {
  const rng = opts.rng ?? defaultRandomSource;
  const { rolls, chosen } = rollOne(opts.damageDie, rng);
  const total = Math.max(1, chosen + opts.damageBonus);
  return {
    type: 'DAMAGE',
    die: opts.damageDie,
    rolls,
    modifier: opts.damageBonus,
    total,
  };
}

export function rollSkillCheck(opts: {
  abilityScore: number;
  dc: number;
  rng?: RandomSource;
  advantage?: boolean;
  disadvantage?: boolean;
}): DiceRoll {
  const rng = opts.rng ?? defaultRandomSource;
  const mod = abilityModifier(opts.abilityScore);
  const { rolls, chosen } = rollOne(20, rng, opts);
  const total = chosen + mod;
  return {
    type: 'SKILL_CHECK',
    die: 20,
    rolls,
    modifier: mod,
    total,
    dc: opts.dc,
    success: total >= opts.dc,
    advantage: opts.advantage,
    disadvantage: opts.disadvantage,
  };
}

export function rollSavingThrow(opts: {
  abilityScore: number;
  dc: number;
  rng?: RandomSource;
  advantage?: boolean;
  disadvantage?: boolean;
}): DiceRoll {
  const result = rollSkillCheck(opts);
  return { ...result, type: 'SAVING_THROW' };
}
