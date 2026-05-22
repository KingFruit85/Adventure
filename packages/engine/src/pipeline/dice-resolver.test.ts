import { describe, expect, it } from 'vitest';
import { abilityModifier, rollAttack, rollDamage, rollSkillCheck } from './dice-resolver.js';

const fixedRng = (values: number[]) => {
  let i = 0;
  return { next: () => values[i++ % values.length]! };
};

describe('abilityModifier', () => {
  it('matches D&D 5e math', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(12)).toBe(1);
    expect(abilityModifier(18)).toBe(4);
  });
});

describe('rollAttack', () => {
  it('hits when d20 + bonus meets AC', () => {
    // rng 0.95 -> floor(0.95*20)+1 = 20
    const roll = rollAttack({ attackBonus: 3, targetAc: 15, rng: fixedRng([0.95]) });
    expect(roll.rolls).toEqual([20]);
    expect(roll.total).toBe(23);
    expect(roll.success).toBe(true);
  });

  it('misses when below AC', () => {
    // rng 0.05 -> floor(0.05*20)+1 = 2
    const roll = rollAttack({ attackBonus: 0, targetAc: 15, rng: fixedRng([0.05]) });
    expect(roll.success).toBe(false);
  });

  it('advantage picks higher of two rolls', () => {
    const roll = rollAttack({
      attackBonus: 0,
      targetAc: 10,
      rng: fixedRng([0.05, 0.9]),
      advantage: true,
    });
    expect(roll.rolls).toHaveLength(2);
    // higher of (2, 19) is 19
    expect(roll.total).toBe(19);
  });
});

describe('rollDamage', () => {
  it('clamps minimum to 1', () => {
    const roll = rollDamage({ damageDie: 4, damageBonus: -10, rng: fixedRng([0.0]) });
    expect(roll.total).toBe(1);
  });
});

describe('rollSkillCheck', () => {
  it('uses ability modifier', () => {
    const roll = rollSkillCheck({ abilityScore: 16, dc: 12, rng: fixedRng([0.5]) });
    // 0.5 * 20 + 1 = 11; mod for 16 is +3; total 14 vs DC 12 -> success
    expect(roll.modifier).toBe(3);
    expect(roll.success).toBe(true);
  });
});
