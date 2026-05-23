import type { AdventureDefinition, StateChange } from '@loreforge/shared';

interface Props {
  changes: StateChange[];
  adventure: AdventureDefinition;
}

/**
 * Compact, glanceable indicators for the state changes the engine applied
 * this turn. Items, kills, quests, and game-over flags all surface here so
 * the player doesn't have to scan the inventory sidebar to know what
 * actually changed. Renders nothing when there are no notable changes.
 */
export function TurnChanges({ changes, adventure }: Props) {
  const lines = changes
    .map((c) => formatChange(c, adventure))
    .filter((s): s is string => Boolean(s));
  if (lines.length === 0) return null;
  return (
    <ul className="turn-changes">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: turn-change lines are ephemeral and replaced wholesale on each turn; index is stable identity.
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}

function formatChange(change: StateChange, adventure: AdventureDefinition): string | null {
  switch (change.type) {
    case 'ITEM_ADDED': {
      const def = adventure.items[change.item.itemId];
      const name = def?.name ?? change.item.itemId;
      const qty = change.item.quantity > 1 ? ` ×${change.item.quantity}` : '';
      return `＋ ${name}${qty} added to inventory`;
    }
    case 'ITEM_REMOVED':
      return '－ Item removed from inventory';
    case 'NPC_DEFEATED': {
      const npc = adventure.npcs[change.npcId];
      return `✓ ${npc?.name ?? change.npcId} defeated`;
    }
    case 'GOAL_COMPLETED': {
      const goal = adventure.goals[change.goalId];
      return `✓ ${goal?.description ?? change.goalId}`;
    }
    case 'QUEST_STARTED': {
      const quest = adventure.quests[change.questId];
      return `❖ Quest started: ${quest?.title ?? change.questId}`;
    }
    case 'PLAYER_MOVED': {
      const loc = adventure.locations[change.toLocationId];
      return loc ? `→ ${loc.name}` : null;
    }
    case 'GAME_OVER':
      return change.result === 'VICTORY'
        ? '★ Adventure complete'
        : '✗ The adventure ends in defeat';
    default:
      return null;
  }
}
