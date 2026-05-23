# PoC Validation Report — Whispers of Eldenmoor

Status: **PASSING**. All four foundational phases plus PoC validation are complete; the system runs end-to-end against the real Anthropic API with both character classes.

## What was validated

### 1. Warrior playthrough (automated, live API)

`packages/engine/src/poc-validation.live.test.ts` drives a full Warrior run:

| Turn | Player input | Action | Engine result |
|---|---|---|---|
| 1 | `talk to Mira about the missing villagers` | `LOOK` (classifier ambiguous) → engine + LLM-emitted `NPC_INTERACTION_RECORDED` → derived `QUEST_STARTED` | `the_goblin_threat` active |
| 2 | `head north into the Ashwood` | `MOVE` direction `north` (canonicalized from full phrase) | Player now in `forest_clearing` |
| 3–4 | `attack the goblin chief` ×2 | `ATTACK` targeting `goblin_chief` | `NPC_HP_CHANGED` → `NPC_DEFEATED` → `GOAL_COMPLETED` → `GAME_OVER:VICTORY` |

Goblin chief defeated. Session status: `COMPLETED`.

### 2. Mage playthrough (automated, live API)

Same arc, different combat path:

| Turn | Player input | Action | Engine result |
|---|---|---|---|
| 1 | `speak with the innkeeper Mira` | `LOOK` (classifier) → derived `QUEST_STARTED` via post-narrate sweep | quest active |
| 2 | `go north toward the Ashwood clearing` | `MOVE` direction `north` (canonicalized) | in forest |
| 3+ | `cast fire_bolt at the goblin chief` ×N | `CAST_SPELL` `fire_bolt` → `goblin_chief` | `NPC_HP_CHANGED` until defeat → `GAME_OVER:VICTORY` |

Mage cannot `ATTACK` (not in class `availableActions`); the validator correctly blocks any fallback to melee. CAST_SPELL is wired in `resolveDice` to do d10+2 damage on the target NPC.

### 3. Session resume after browser close (automated, live API)

The store is closed and reopened from the same SQLite file mid-adventure. State preserved:
- Player location: `forest_clearing` ✓
- `activeQuestIds`: `["the_goblin_threat"]` ✓
- Continuation turn against the restored store produces a normal narrative turn ✓

### 4. Voice loop (manual — browser-only feature)

`SpeechRecognition` and `SpeechSynthesis` are browser APIs that the headless test environment can't exercise. Unit tests (`packages/web/src/hooks/useVoiceOutput.test.ts`) cover:
- Sentence-boundary detection on the text-delta stream
- `flush()` speaks any remaining buffer at end-of-turn
- The `enabled` flag gates speaking

To verify in a real browser:
1. `pnpm --filter @loreforge/api dev` (in one terminal)
2. `pnpm --filter @loreforge/web dev` (in another)
3. Open `http://localhost:5173`, create a Warrior session
4. Toggle 🔊 in the Game view → narrative should be spoken sentence-by-sentence as it streams
5. Toggle 🎤 → speak an action → text field populates from `SpeechRecognition`

## Engine changes required during validation

Discovered by running the live playthroughs against the real LLM. Each one made a stochastic-LLM failure into a reliable engine guarantee:

| Issue | Fix |
|---|---|
| Haiku returned `npcId: "Mira"` (display case) but validator did exact match against `"mira"` slug | `canonicalizeAction()` in the LLM classifier maps any display-name back to the canonical slug |
| Haiku returned `direction: "north into the ashwood"` (full phrase) | `canonicalizeDirection()` strips trailing prose from the matched exit direction |
| Haiku returned `LOOK` for "cast fire_bolt at X" | Run keyword classifier in parallel; prefer its specific result over haiku's LOOK fallback |
| LLM `npc_defeated` tool call fired on a still-alive goblin (HP > 0); `GOAL_COMPLETED` never cascaded because engine's defeat path didn't run | Moved goal-completion cascade from `resolveCombatAttack` into the state-applier — applies whenever `NPC_DEFEATED` is processed, regardless of source |
| `CAST_SPELL` did nothing (Mage's fire_bolt was unwired) | `resolveDice` treats `CAST_SPELL` with an NPC `targetId` like a ranged attack (d10+2) |
| `TALK_TO_NPC` reliably grants the quest; `EXAMINE` with the NPC as target was getting the dialogue narrative but no quest | Post-narrate sweep: any `NPC_INTERACTION_RECORDED` for an NPC with `givesQuestId` derives a `QUEST_STARTED` |

## What's NOT validated (out of PoC scope, deferred)

- Multi-player sessions (`maxPlayers: 2` is structural; turn validation against `currentTurnPlayerId` is in place but unexercised)
- Voice loop in an actual browser (covered by unit tests; needs real browser to verify the end-to-end TTS pacing)
- Combat against multiple simultaneous NPCs in one location
- Save/load via session code from a fresh device (the `/sessions/:code` endpoint works; client UI flow is present but not auto-tested)
- Adventure authoring UX (the YAML format is documented; no UI for non-technical authors)

## How to run

```bash
# Unit tests (no API cost)
pnpm test

# Live integration suite (requires ANTHROPIC_API_KEY in .env)
RUN_LIVE_TESTS=1 pnpm --filter @loreforge/engine test
RUN_LIVE_TESTS=1 pnpm --filter @loreforge/api test

# Full live playthrough with transcript dumps
cd packages/engine && RUN_LIVE_TESTS=1 LOREFORGE_TRANSCRIPT=1 \
  pnpm exec vitest run src/poc-validation.live.test.ts

# Run the actual game
pnpm --filter @loreforge/api dev       # API at :3000
pnpm --filter @loreforge/web dev       # Web at :5173 (proxies API)
```

## Test totals at PoC validation completion

| Suite | Tests | Skipped (live) | Status |
|---|---|---|---|
| `@loreforge/shared` | 4 | — | ✓ |
| `@loreforge/engine` | 23 | 5 live | ✓ |
| `@loreforge/api` | 7 | 1 live | ✓ |
| `@loreforge/web` | 7 | — | ✓ |
| **Total** | **41 unit** | **6 live** | **✓** |

All 6 live tests confirmed green during this validation pass.
