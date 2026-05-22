# Whispers of Eldenmoor

A two-location proof-of-concept adventure for LoreForge.

## What it proves

- Location gating via quest (forest is inaccessible until Mira grants the quest).
- NPC dialogue triggering a quest (`mira.givesQuestId = the_goblin_threat`).
- Combat resolution via dice (Goblin Chief, AC 13, HP 12).
- Win-state detection (defeating the chief completes `defeat_goblin_chief`, which is `isEndGame: true, endGameType: VICTORY`).
- Defeat-state detection (party wipe → `party_wiped` goal).
- Section summarisation on location change (moving south back to the tavern triggers Memory Manager).

## Files

- `adventure.yaml` — items, NPCs, locations, puzzles, quests, goals, rules.
- `world-context.md` — narrative seed injected verbatim into every system prompt.
- `classes/warrior.yaml` — d10 hit die, STR+CON bonus, melee-focused actions.
- `classes/mage.yaml` — d6 hit die, INT+WIS bonus, starts with `fire_bolt`.

## Stat choices (and why)

| Element | Choice | Reason |
|---|---|---|
| Goblin Chief HP | 12 | Two clean d6+1 hits kill it on average — beatable for a Warrior with one bad roll allowance. |
| Goblin Chief AC | 13 | Roughly 50/50 to hit at attack bonus +2. Makes the combat tense, not trivial. |
| Rusty Dagger | d4, no bonus | Underwhelming on purpose — the Warrior should feel like a scrapper, not a hero. |
| Bread Loaf charges | 3 | Three rest-and-eat moments in a 2-location dungeon is generous, not infinite. |

## Future hooks (not implemented)

- A third location ("Deeper Ashwood") gated on the goblin tooth, foreshadowed by the "trees watching" line in the clearing.
- A second NPC ("Old Ren the woodcutter") for the tavern, expanding dialogue choices.
- A puzzle in the forest involving the bone whistle.
