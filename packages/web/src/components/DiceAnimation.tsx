import type { DiceRoll } from '@loreforge/shared';

interface Props {
  roll: DiceRoll | null;
}

/**
 * Compact, monospace dice readout for the most recent roll. No actual
 * animation in the PoC — the line just appears in an accent color, red on
 * failure. The architecture mentions a `DiceAnimation.tsx` component, but
 * the PoC's most useful information is the result line, not the visual.
 */
export function DiceAnimation({ roll }: Props) {
  if (!roll) return null;
  const failed = roll.success === false;
  const successPart = roll.success === undefined ? '' : roll.success ? ' ✓' : ' ✗';
  const dcPart = roll.dc !== undefined ? ` vs DC ${roll.dc}` : '';
  return (
    <div className={`dice${failed ? ' failure' : ''}`}>
      {roll.type}: d{roll.die} [{roll.rolls.join(', ')}] + {roll.modifier} = {roll.total}
      {dcPart}
      {successPart}
    </div>
  );
}
