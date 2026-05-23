import type { AdventureDefinition, GameSession, PlayerState } from '@loreforge/shared';

interface Props {
  player: PlayerState;
  session: GameSession;
  adventure: AdventureDefinition;
}

/**
 * Sidebar showing the active player's HP, inventory, and quests. Inventory
 * shows item names (not raw IDs) by looking them up in the adventure
 * definition.
 */
export function PlayerStatus({ player, session, adventure }: Props) {
  const hpPct = Math.max(0, Math.min(100, (player.hp.current / player.hp.max) * 100));
  const activeQuests = player.activeQuestIds
    .map((qid) => adventure.quests[qid])
    .filter((q): q is NonNullable<typeof q> => Boolean(q));
  const completedGoals = session.worldState.completedGoalIds
    .map((gid) => adventure.goals[gid])
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  return (
    <aside className="card status-panel">
      <h3>{player.name}</h3>
      <div className="muted">{player.characterClass.name}</div>

      <h3>Health</h3>
      <div
        className="hp-bar"
        role="progressbar"
        aria-valuenow={hpPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Health"
        tabIndex={0}
      >
        <div className="hp-bar-fill" style={{ width: `${hpPct}%` }} />
      </div>
      <div className="muted">
        {player.hp.current} / {player.hp.max}
      </div>

      <h3>Inventory</h3>
      {player.inventory.length === 0 ? (
        <div className="muted">Empty.</div>
      ) : (
        <ul className="inventory-list">
          {player.inventory.map((i) => {
            const def = adventure.items[i.itemId];
            return (
              <li key={i.instanceId}>
                {def?.name ?? i.itemId}
                {i.quantity > 1 ? ` ×${i.quantity}` : ''}
              </li>
            );
          })}
        </ul>
      )}

      <h3>Quests</h3>
      {activeQuests.length === 0 ? (
        <div className="muted">None active.</div>
      ) : (
        <ul className="quest-list">
          {activeQuests.map((q) => (
            <li key={q.id}>{q.title}</li>
          ))}
        </ul>
      )}

      {completedGoals.length > 0 && (
        <>
          <h3>Completed</h3>
          <ul className="quest-list">
            {completedGoals.map((g) => (
              <li key={g.id}>✓ {g.description}</li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
