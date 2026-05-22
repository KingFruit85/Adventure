# LoreForge — AI Adventure Game Service
## Architecture & Implementation Specification

> This document is the canonical design reference for the project. It is intended to be handed to Claude Code as a project brief. All schemas, interfaces, and structural decisions here should be treated as authoritative unless explicitly overridden.

---

## 1. Project Overview

LoreForge is a text-based, AI-narrated choose-your-own-adventure game service. Players navigate structured adventure worlds defined by human-authored "adventure definitions" while an LLM fills in the narrative gaps. The system enforces game rules deterministically; the LLM is responsible only for prose generation and NPC dialogue.

**Core principles:**
- The engine controls facts; Claude controls words
- Rules are enforced before the LLM ever sees a player's input
- All state is persisted; sessions are always resumable
- The architecture must support multi-player co-op and voice-first interfaces (including future Tesla/Grok integration) without structural changes

---

## 2. Monorepo Structure

```
loreforge/
├── packages/
│   ├── engine/          # Core game logic, state machine, rules validation
│   ├── api/             # HTTP API server
│   ├── web/             # React frontend
│   └── shared/          # Shared TypeScript types and schemas
├── adventures/
│   ├── _template/       # Starter template for new adventures
│   └── whispers-of-eldenmoor/   # PoC adventure (two locations)
├── docs/
│   └── ARCHITECTURE.md  # This file
├── package.json         # Workspace root
└── turbo.json           # Turborepo config
```

**Tooling:**
- Package manager: `pnpm` with workspaces
- Build orchestration: Turborepo
- Language: TypeScript throughout (strict mode)
- Runtime: Node.js 20+

---

## 3. Shared Types (`packages/shared`)

These types are the lingua franca of the entire system. Define these first; all other packages import from here.

### 3.1 Adventure Definition Types

```typescript
// The complete definition of an adventure, loaded from the adventure directory
export interface AdventureDefinition {
  id: string;                          // e.g. "whispers-of-eldenmoor"
  title: string;
  description: string;                 // shown on adventure select screen
  minPlayers: number;                  // default: 1
  maxPlayers: number;                  // default: 2; increasing requires no structural changes
  startingLocationId: string;
  startingInventory: ItemGrant[];      // items given to all players at session start
  availableClasses: CharacterClass[];
  locations: Record<string, Location>;
  items: Record<string, Item>;
  npcs: Record<string, NPC>;
  puzzles: Record<string, Puzzle>;
  quests: Record<string, Quest>;
  goals: Record<string, Goal>;
  rules: AdventureRules;
  worldContext: string;                // injected into every system prompt
  tone: string;                        // e.g. "dark fantasy, tense, atmospheric"
}

export interface Location {
  id: string;
  name: string;
  atmosphericDescription: string;      // seed for Claude's narrative, not shown raw
  exits: Exit[];
  items: ItemGrant[];                  // items present in this location by default
  npcs: string[];                      // NPC IDs present here by default
  puzzleIds: string[];
  requiresQuestId?: string;            // location locked until this quest is active
  requiresGoalId?: string;             // location locked until this goal is complete
}

export interface Exit {
  direction: string;                   // "north", "south", "through the door", etc.
  toLocationId: string;
  requiresItemId?: string;             // must have item to use exit
  requiresGoalId?: string;             // goal must be complete to use exit
  lockedMessage?: string;              // what Claude should convey if locked
}

// Static definition of an item type — lives in the adventure definition
export interface Item {
  id: string;                          // slug, e.g. "rusty_dagger"
  name: string;
  description: string;
  category: ItemCategory;
  isConsumable: boolean;
  isQuestItem: boolean;
  isStackable: boolean;
  maxDurability?: number;              // if present, item degrades on use
  maxCharges?: number;                 // for wands, scrolls, torches, etc.
  usableWith?: string[];               // item IDs or puzzle IDs this works with
  combatProperties?: ItemCombatProperties;
  metadata?: Record<string, unknown>;  // adventure-specific extended properties
}

export type ItemCategory =
  | 'WEAPON'
  | 'ARMOUR'
  | 'CONSUMABLE'
  | 'QUEST_ITEM'
  | 'TOOL'
  | 'SPELL_FOCUS'
  | 'MISC';

export interface ItemCombatProperties {
  damageDie: number;                   // e.g. 6 for d6
  damageBonus: number;
  damageType: 'SLASHING' | 'PIERCING' | 'BLUDGEONING' | 'FIRE' | 'COLD' | 'ARCANE';
  range: 'MELEE' | 'RANGED';
  twoHanded: boolean;
}

// A grant of an item — used in adventure definitions to specify items at locations
// or in starting inventories. quantity defaults to 1.
export interface ItemGrant {
  itemId: string;
  quantity: number;
}

// A runtime instance of an item held in a player's inventory.
// itemId references the static Item definition; instanceId is unique per physical item.
export interface InventoryItem {
  instanceId: string;                  // UUID — unique per item instance
  itemId: string;                      // reference to Item definition
  quantity: number;
  durability?: number;                 // current durability (0–maxDurability)
  charges?: number;                    // remaining charges
  acquiredAtTurn: number;
  acquiredFromId?: string;             // locationId or npcId
  metadata?: Record<string, unknown>;  // runtime-specific overrides
}

export interface NPC {
  id: string;
  name: string;
  personality: string;                 // injected into prompt when player talks to NPC
  initialDisposition: 'FRIENDLY' | 'NEUTRAL' | 'HOSTILE';
  givesQuestId?: string;               // NPC grants this quest when spoken to
  knowledge: string[];                 // topics this NPC can speak to
  combatStats?: NPCCombatStats;        // present if NPC is combatable
}

export interface NPCCombatStats {
  hp: number;
  ac: number;                          // armour class
  attackBonus: number;
  damageDie: number;
  damageBonus: number;
  xpReward: number;
}

export interface Puzzle {
  id: string;
  locationId: string;
  description: string;                 // for Claude context
  solution: PuzzleSolution;
  rewardItemIds: string[];
  rewardGoalIds: string[];             // completing this puzzle advances these goals
  hint: string;
}

export interface PuzzleSolution {
  type: 'USE_ITEM' | 'SPEAK_PHRASE' | 'EXAMINE_SEQUENCE' | 'COMBAT';
  requiredItemId?: string;
  requiredPhrase?: string;
  combatTargetNpcId?: string;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  grantedByNpcId: string;
  completionGoalId: string;           // quest complete when this goal is done
  unlocksLocationIds: string[];
}

export interface Goal {
  id: string;
  description: string;
  type: 'DEFEAT_NPC' | 'COLLECT_ITEM' | 'SOLVE_PUZZLE' | 'VISIT_LOCATION' | 'TALK_TO_NPC';
  targetId: string;                   // NPC id, item id, puzzle id, etc.
  isEndGame: boolean;
  endGameType?: 'VICTORY' | 'DEFEAT';
}

export interface AdventureRules {
  allowedActionTypes: ActionType[];
  combatSystem: 'SRD5E_SIMPLIFIED' | 'NONE';
  permaDeath: boolean;
  maxInventorySize: number;
  globalForbiddenPhrases: string[];   // regex patterns that auto-reject input
}

export interface CharacterClass {
  id: string;
  name: string;                        // "Warrior", "Mage", "Rogue"
  description: string;
  hitDie: number;                      // e.g. 10 for d10
  abilityScoreBonus: Partial<AbilityScores>;
  startingItems: ItemGrant[];          // items granted when this class is chosen
  availableActions: ActionType[];      // class-specific actions (e.g. CAST_SPELL)
  spells?: string[];                   // spell IDs if applicable
}
```

### 3.2 Session / State Types

```typescript
export interface GameSession {
  id: string;                          // UUID — generated at session creation
  sessionCode: string;                 // e.g. "WOLF-42-STONE" — the shareable identifier
  adventureId: string;
  status: 'CHARACTER_SELECT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  createdAt: string;                   // ISO timestamp
  updatedAt: string;
  players: PlayerState[];
  currentTurnPlayerId: string;
  worldState: WorldState;
  memoryState: MemoryState;
}

export interface PlayerState {
  id: string;                          // UUID — generated at session creation
  name: string;
  characterClass: CharacterClass;
  currentLocationId: string;
  abilityScores: AbilityScores;
  hp: { current: number; max: number };
  inventory: InventoryItem[];          // strongly typed item instances
  spells: string[];                    // spell IDs
  activeQuestIds: string[];
  completedGoalIds: string[];
  statusEffects: string[];
}

export interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export interface WorldState {
  defeatedNpcIds: string[];
  collectedItemIds: string[];          // item instance IDs picked up (removes from world)
  solvedPuzzleIds: string[];
  completedGoalIds: string[];
  activeQuestIds: string[];
  visitedLocationIds: string[];
  npcDispositions: Record<string, 'FRIENDLY' | 'NEUTRAL' | 'HOSTILE'>;
  npcMemories: Record<string, NPCMemory>;  // keyed by npcId
}

// Per-NPC memory of interactions with players. Summarised once interaction count
// exceeds a threshold, using the same strategy as the main adventure memory.
export interface NPCMemory {
  npcId: string;
  interactions: NPCInteraction[];
  summary?: string;                    // haiku-generated once interactions > threshold (default: 10)
}

export interface NPCInteraction {
  turnNumber: number;
  playerId: string;
  playerSaid: string;
  npcReplied: string;                  // captured via npc_spoke tool call (see §4.6)
  questsGranted: string[];             // quest IDs granted during this interaction
  dispositionChange?: 'FRIENDLY' | 'NEUTRAL' | 'HOSTILE';
}

export interface MemoryState {
  activeTurns: TurnEntry[];            // last N turns, always in prompt
  sectionSummaries: SectionSummary[];  // compressed summaries of past location visits
  // Full log lives in blob storage, referenced by sessionId — never in this object
}

export interface TurnEntry {
  turnNumber: number;
  playerId: string;
  playerInput: string;
  narrativeResponse: string;
  stateChanges: StateChange[];
  timestamp: string;
}

export interface SectionSummary {
  locationId: string;
  visitIndex: number;                  // 1st visit, 2nd visit, etc.
  turnRange: [number, number];         // [startTurn, endTurn]
  summary: string;                     // LLM-generated summary paragraph
  keyEvents: string[];                 // bullet points of significant events
}

export type StateChange =
  | { type: 'PLAYER_MOVED'; playerId: string; toLocationId: string }
  | { type: 'ITEM_ADDED'; playerId: string; item: InventoryItem }
  | { type: 'ITEM_REMOVED'; playerId: string; instanceId: string }
  | { type: 'ITEM_DURABILITY_CHANGED'; playerId: string; instanceId: string; newDurability: number }
  | { type: 'NPC_DEFEATED'; npcId: string }
  | { type: 'NPC_DISPOSITION_CHANGED'; npcId: string; disposition: 'FRIENDLY' | 'NEUTRAL' | 'HOSTILE' }
  | { type: 'NPC_INTERACTION_RECORDED'; npcId: string; interaction: NPCInteraction }
  | { type: 'PUZZLE_SOLVED'; puzzleId: string }
  | { type: 'GOAL_COMPLETED'; goalId: string }
  | { type: 'QUEST_STARTED'; questId: string; playerId: string }
  | { type: 'HP_CHANGED'; playerId: string; delta: number; newValue: number }
  | { type: 'GAME_OVER'; result: 'VICTORY' | 'DEFEAT' };
```

### 3.3 Action Types

```typescript
export type ActionType =
  | 'MOVE'
  | 'EXAMINE'
  | 'TAKE_ITEM'
  | 'DROP_ITEM'
  | 'USE_ITEM'
  | 'TALK_TO_NPC'
  | 'ATTACK'
  | 'CAST_SPELL'
  | 'LOOK'            // describe current location
  | 'INVENTORY'       // list inventory
  | 'STATUS'          // show HP, quests, etc.
  | 'RECALL';         // trigger memory retrieval from blob

export interface ParsedAction {
  type: ActionType;
  rawInput: string;
  params: ActionParams;
}

export type ActionParams =
  | { type: 'MOVE'; direction: string }
  | { type: 'TAKE_ITEM'; itemId: string }                          // itemId = definition id (item not yet in inventory)
  | { type: 'DROP_ITEM'; instanceId: string }                      // instanceId = inventory instance
  | { type: 'USE_ITEM'; instanceId: string; targetId?: string }    // instanceId = inventory instance
  | { type: 'TALK_TO_NPC'; npcId: string }
  | { type: 'ATTACK'; targetNpcId: string }
  | { type: 'CAST_SPELL'; spellId: string; targetId?: string }
  | { type: 'EXAMINE'; targetId: string }
  | { type: 'LOOK' | 'INVENTORY' | 'STATUS' | 'RECALL' };
```

---

## 4. Engine Package (`packages/engine`)

The engine is a pure TypeScript library with no HTTP concerns. It exposes a single primary function and several supporting services. It has no side effects beyond what is passed in.

### 4.1 Primary Interface

```typescript
export async function processTurn(
  input: ProcessTurnInput,
  deps: EngineDependencies
): Promise<ProcessTurnResult>

export interface ProcessTurnInput {
  sessionId: string;
  playerId: string;
  rawInput: string;
}

export interface ProcessTurnResult {
  narrative: string;                  // stream-compatible: returned as AsyncIterable<string>
  stateChanges: StateChange[];
  updatedSession: GameSession;
  validationError?: string;           // set if input was rejected before LLM
  rollResult?: DiceRoll;              // set if a dice roll occurred
}

export interface EngineDependencies {
  sessionStore: SessionStore;         // persistence abstraction
  adventureLoader: AdventureLoader;   // loads adventure definitions
  llmProvider: LLMProvider;          // abstraction over Claude/GPT/etc.
  blobStore: BlobStore;              // raw turn log storage
}
```

### 4.2 Engine Pipeline

Each turn runs through this pipeline in order. Stages are discrete functions, easily testable in isolation:

```
rawInput
    │
    ▼
┌─────────────────────┐
│  1. Intent Parser   │  (haiku) classifies input into ActionType + params
└─────────────────────┘
    │  ParsedAction
    ▼
┌─────────────────────┐
│  2. Rules Validator │  (pure) checks action legality against session state
└─────────────────────┘
    │  ValidationResult (pass | reject with reason)
    ▼
┌─────────────────────┐
│  3. Dice Resolver   │  (pure) if action requires roll, resolves outcome
└─────────────────────┘
    │  ResolvedAction
    ▼
┌─────────────────────┐
│  4. Prompt Builder  │  (pure) assembles system prompt + context window
└─────────────────────┘
    │  PromptPayload
    ▼
┌─────────────────────┐
│  5. LLM Narrator    │  (sonnet, streaming) generates narrative + tool calls
└─────────────────────┘
    │  NarrativeStream + StateChanges
    ▼
┌─────────────────────┐
│  6. State Applier   │  (pure) applies state changes to session
└─────────────────────┘
    │  UpdatedSession
    ▼
┌─────────────────────┐
│  7. Memory Manager  │  (async, non-blocking) appends to blob, triggers summary if needed
└─────────────────────┘
    │
    ▼
ProcessTurnResult
```

### 4.3 Rules Validator

Validates a `ParsedAction` against current `GameSession` and `AdventureDefinition`. Returns either `{ valid: true }` or `{ valid: false; reason: string }`.

Key checks:
- **MOVE**: direction exists as exit in current location; exit not locked by unmet goal/quest/item requirement
- **TAKE_ITEM**: item exists in current location; player inventory not full
- **USE_ITEM**: item in player inventory; target is valid use target
- **TALK_TO_NPC**: NPC present in current location
- **ATTACK**: NPC present, is hostile or attackable; combat allowed by rules
- **CAST_SPELL**: player has spell; sufficient resources
- **All actions**: action type is in player's class `availableActions`

### 4.4 Dice Resolver (SRD 5e Simplified)

Used for ATTACK, CAST_SPELL, and skill checks. Implements a subset of D&D 5e SRD (Creative Commons):

```typescript
export interface DiceRoll {
  type: 'ATTACK' | 'SKILL_CHECK' | 'SAVING_THROW' | 'DAMAGE';
  die: number;              // e.g. 20 for d20
  rolls: number[];          // raw roll values
  modifier: number;         // ability score modifier
  total: number;
  dc?: number;              // difficulty class, if applicable
  success?: boolean;
  advantage?: boolean;
  disadvantage?: boolean;
}

// Core mechanic: roll d20 + ability modifier vs DC
// Attack: roll d20 + STR/DEX modifier vs target AC
// Damage: roll hit die (class-specific) + modifier
// Ability check: roll d20 + relevant modifier vs DC set in puzzle/adventure definition
```

### 4.5 Prompt Builder

Constructs the full prompt payload from layered context. The context window is **always bounded** regardless of session length:

```
SYSTEM PROMPT (fixed per session):
  ├── World context (from adventure definition)
  ├── Tone and narrative style instructions
  ├── LLM behavioural rules (stay on track, enforce rules, use tool calls for state)
  ├── Available tool definitions (state-change tool calls)
  └── Current player character sheets (all players)

USER CONTEXT (reconstructed per turn):
  ├── Section summaries (compressed history of past location visits)
  ├── Active window (last 10 turns verbatim)
  ├── Current world state snapshot (location, NPCs present, items present)
  └── Current action + dice result (if applicable)
```

**Active window size**: 10 turns (configurable). When a player leaves a location, the turns for that visit are summarised and archived; the active window resets.

### 4.6 LLM Narrator — Tool Use

Claude uses tool calls to signal state changes. This separates narrative prose from structured state mutations. The narrator receives the prompt and returns a streaming text response alongside zero or more tool calls.

**Tools available to Claude:**

```typescript
// Claude calls these during its response to signal what happened
const narratorTools = [
  {
    name: 'player_moved',
    description: 'Call when the player successfully moves to a new location',
    input_schema: { locationId: string, playerId: string }
  },
  {
    name: 'item_added_to_inventory',
    description: 'Call when a player picks up an item. Pass full item details to create the inventory instance.',
    input_schema: { itemId: string, playerId: string, quantity: number }
    // Engine creates InventoryItem instance (with UUID, acquiredAtTurn, etc.) from this signal
  },
  {
    name: 'item_removed_from_inventory',
    input_schema: { instanceId: string, playerId: string }
  },
  {
    name: 'item_used',
    description: 'Call when a consumable or charged item is used. Engine decrements charges/durability.',
    input_schema: { instanceId: string, playerId: string }
  },
  {
    name: 'npc_spoke',
    description: 'Call after every NPC dialogue exchange to record the interaction for NPC memory.',
    input_schema: {
      npcId: string,
      playerId: string,
      npcRepliedSummary: string,   // 1-2 sentence summary of what the NPC said (not full prose)
      questGranted?: string,       // quest ID if a quest was given
      dispositionChange?: 'FRIENDLY' | 'NEUTRAL' | 'HOSTILE'
    }
  },
  {
    name: 'npc_defeated',
    input_schema: { npcId: string }
  },
  {
    name: 'puzzle_solved',
    input_schema: { puzzleId: string }
  },
  {
    name: 'goal_completed',
    input_schema: { goalId: string }
  },
  {
    name: 'quest_started',
    input_schema: { questId: string, playerId: string }
  },
  {
    name: 'hp_changed',
    input_schema: { playerId: string, delta: number }
  },
  {
    name: 'game_over',
    input_schema: { result: 'VICTORY' | 'DEFEAT', message: string }
  }
];
```

**Critical LLM instruction (in system prompt):** Claude must never invent state changes that weren't resolved by the engine. The dice roll result is passed to Claude as fact; Claude narrates the outcome but does not re-roll or override it. If a player's action was validated and passed to Claude, it succeeded (or failed as determined by the dice resolver) — Claude describes *how*, not *whether*.

### 4.7 Memory Manager

Runs asynchronously (fire-and-forget, with error logging) after each turn to avoid adding latency:

1. **Append to blob**: appends the full `TurnEntry` to the session's raw log file (`{sessionId}.log.jsonl`)
2. **Check for section boundary**: if a `PLAYER_MOVED` state change occurred, trigger section summarisation for the location being left
3. **Summarisation** (haiku): sends last N turns for that location visit to haiku with instruction to produce a 2-3 sentence summary and 3-5 key event bullets. Stores result as a new `SectionSummary` in `memoryState.sectionSummaries`
4. **Prune active window**: removes turns that are now covered by a summary from `activeTurns`

**Recall tool**: If a player uses the `RECALL` action (or Claude decides it needs historical context via a `recall_history` tool call), the blob is searched by keyword and the matching `TurnEntry` objects are injected as additional context for that turn only.

---

## 5. LLM Provider Abstraction (`packages/engine/src/llm/`)

All LLM calls go through this interface. Swapping models or providers is a configuration change.

```typescript
export interface LLMProvider {
  // Streaming narrative generation (used by Narrator stage)
  streamNarrative(payload: NarrativePrompt): AsyncIterable<NarrativeChunk>;

  // Single-shot classification (used by Intent Parser and Summariser)
  complete(payload: CompletionPrompt): Promise<string>;
}

export interface NarrativeChunk {
  type: 'text_delta' | 'tool_call';
  textDelta?: string;
  toolCall?: { name: string; input: Record<string, unknown> };
}

// Concrete implementation: AnthropicProvider
// Constructor accepts { narrativeModel, completionModel } — defaults to sonnet/haiku
// Must implement retry logic with exponential backoff
// Must implement token usage logging
```

---

## 6. Session Store Abstraction

```typescript
export interface SessionStore {
  create(session: GameSession): Promise<void>;
  get(sessionId: string): Promise<GameSession | null>;
  getByCode(sessionCode: string): Promise<GameSession | null>;
  update(session: GameSession): Promise<void>;
  listByDevice(deviceFingerprint: string): Promise<SessionSummary[]>;
}

// PoC implementation: SQLiteSessionStore (better-sqlite3)
// Production-ready implementation: NeonSessionStore (postgres)
// The store is injected as a dependency — switching is a one-line change in the API bootstrap
```

---

## 7. Adventure Loader (`packages/engine/src/adventures/`)

```typescript
export interface AdventureLoader {
  load(adventureId: string): Promise<AdventureDefinition>;
  list(): Promise<AdventureMetadata[]>;
}

// Implementation: FileSystemAdventureLoader
// Reads from /adventures/{id}/ directory
// Validates against AdventureDefinition zod schema on load
// Caches in memory after first load
```

---

## 8. Adventure File Format (`adventures/{id}/`)

Each adventure is a directory with the following structure:

```
adventures/whispers-of-eldenmoor/
├── adventure.yaml          # Main definition (locations, items, NPCs, rules, etc.)
├── world-context.md        # Injected into every system prompt verbatim
├── classes/
│   ├── warrior.yaml
│   ├── mage.yaml
│   └── rogue.yaml
└── README.md               # Human-readable adventure guide for authors
```

Adventures are defined in YAML (not Markdown) for machine parseability. `world-context.md` is the human-authored narrative seed that Claude builds on — it's the only freeform prose in the definition.

---

## 9. API Package (`packages/api`)

**Framework:** Hono (lightweight, edge-compatible, TypeScript-native)

### Endpoints

```
# Session management
POST   /sessions                    Create new session (returns sessionCode)
GET    /sessions/:code              Load session by code
PATCH  /sessions/:code/players      Add player / update character selection

# Gameplay
POST   /sessions/:code/turn         Submit a player action (returns SSE stream)
GET    /sessions/:code/state        Get current full state snapshot
GET    /sessions/:code/history      Get section summaries + metadata

# Adventures
GET    /adventures                  List available adventures
GET    /adventures/:id              Get adventure metadata

# Device sessions
GET    /device-sessions             List sessions for this device (via fingerprint header)
```

### Turn Endpoint (SSE Streaming)

`POST /sessions/:code/turn` accepts `{ playerId, input }` and returns a Server-Sent Events stream:

```
event: validation_error
data: { "message": "You can't go that way — the path is blocked." }

event: roll_result
data: { "type": "ATTACK", "total": 14, "success": true }

event: text_delta
data: { "delta": "You swing your sword in a wide arc..." }

event: state_change
data: { "type": "HP_CHANGED", "playerId": "...", "delta": -6, "newValue": 14 }

event: turn_complete
data: { "stateChanges": [...], "updatedSession": {...} }
```

This SSE format is the single interface the frontend and future Tesla/voice integrations consume. A voice client subscribes to `text_delta` events and pipes to TTS; a Tesla/Grok integration would call this endpoint and stream the response identically.

---

## 10. Web Package (`packages/web`)

**Framework:** React 18 + Vite + TypeScript

### Key Components

```
src/
├── pages/
│   ├── Home.tsx              # Adventure select + session code entry
│   ├── CharacterSelect.tsx   # Class selection at session start
│   └── Game.tsx              # Main game view
├── components/
│   ├── NarrativeDisplay.tsx  # Streaming text output with typewriter effect
│   ├── ActionInput.tsx       # Text input + voice input toggle
│   ├── PlayerStatus.tsx      # HP, inventory, active quests
│   ├── DiceAnimation.tsx     # Visual dice roll display
│   └── VoiceNarrator.tsx     # TTS controller
├── hooks/
│   ├── useTurn.ts            # SSE stream consumer, manages turn state
│   ├── useVoiceInput.ts      # Web Speech API (SpeechRecognition)
│   └── useVoiceOutput.ts     # Progressive TTS (SpeechSynthesis queue)
└── stores/
    └── sessionStore.ts       # Zustand store for session state
```

### Progressive TTS Implementation

```typescript
// useVoiceOutput.ts — core pattern
// Buffer SSE text_delta events
// On sentence boundary detection (. ! ? followed by whitespace or end)
// Dispatch utterance to speechSynthesis queue
// Result: first sentence plays ~500ms after response starts
```

### Session Persistence (Client)

Sessions are identified by `sessionCode`. The client stores active session codes in `localStorage` keyed by `deviceFingerprint` (generated once, stored in localStorage). The "My Adventures" page lists sessions retrieved from `/device-sessions`. No login required.

---

## 11. PoC Adventure: Whispers of Eldenmoor

Two-location adventure designed to validate the full engine pipeline.

### World

A cursed village on the edge of a dark forest. Simple, original IP.

### Locations

1. **The Broken Hearth Tavern** (`tavern`)
   - Starting location
   - NPC: Mira the innkeeper — gives quest: "The Goblin Threat" when spoken to
   - Items: `rusty_dagger`, `bread_loaf`
   - Quest gate: forest is inaccessible until "The Goblin Threat" quest is active

2. **The Ashwood Forest Clearing** (`forest_clearing`)
   - Accessible after "The Goblin Threat" quest is started
   - NPC: `goblin_chief` (hostile, combat required)
   - Puzzle: `goblin_chief_combat` — defeat goblin chief (COMBAT type)
   - Goal: `defeat_goblin_chief` — completing this is the win condition
   - Goal gate on exit back to tavern: none (player can retreat)

### Classes (PoC subset)

- **Warrior**: d10 hit die, STR bonus, ATTACK + USE_ITEM + EXAMINE + MOVE + TALK_TO_NPC + LOOK + INVENTORY
- **Mage**: d6 hit die, INT bonus, CAST_SPELL + EXAMINE + MOVE + TALK_TO_NPC + LOOK + INVENTORY; starts with `fire_bolt` spell

### Win Condition

Defeat the goblin chief → `goal_completed: defeat_goblin_chief` → `game_over: VICTORY`

### Purpose

This adventure proves: location gating via quest, NPC dialogue triggering a quest, combat resolution via dice, win state detection, section summarisation on location change, and the full SSE streaming loop.

---

## 12. Future Considerations (Not PoC Scope)

These are explicitly deferred but the architecture above accommodates them without structural change:

- **Tesla / Grok integration**: Expose a `/voice-sessions` endpoint compatible with the xAI Voice Agent API tool-calling spec. Grok calls your API as a "tool" and proxies adventure interaction. The SSE turn endpoint is already the right shape.
- **Branching narratives**: Add `branchId` to `GameSession` and conditional `requiresBranchId` to goals/locations in the adventure definition.
- **Multi-player co-op**: `players` array and `currentTurnPlayerId` are already in the session model. Extend the turn endpoint to validate turn ownership.
- **Additional LLM providers**: Implement `LLMProvider` for OpenAI, Google Gemini, or local Ollama. Pass provider config at API startup.
- **Adventure authoring UI**: A web form that generates valid `adventure.yaml` files, targeting non-technical adventure authors.
- **Semantic recall**: Replace keyword search over blob with vector embeddings (pgvector on Neon) for `RECALL` queries.

---

## 13. Development Phases

### Phase 1 — Foundation
- [ ] Monorepo scaffold (pnpm workspaces + Turborepo)
- [ ] `packages/shared`: all types and Zod schemas
- [ ] `packages/engine`: pipeline skeleton with stub implementations
- [ ] SQLite session store
- [ ] Adventure loader + Zod validation
- [ ] Whispers of Eldenmoor adventure YAML

### Phase 2 — Engine Core
- [ ] Intent Parser (haiku-powered)
- [ ] Rules Validator (pure, fully unit-tested)
- [ ] Dice Resolver (SRD 5e simplified)
- [ ] Prompt Builder
- [ ] Anthropic LLM Provider (streaming + tool use)
- [ ] State Applier
- [ ] Memory Manager (blob append + summarisation)

### Phase 3 — API
- [ ] Hono API server
- [ ] All endpoints implemented
- [ ] SSE streaming turn endpoint
- [ ] Session code generation
- [ ] Device fingerprint session listing

### Phase 4 — Web Frontend
- [ ] Home / session entry page
- [ ] Character select page
- [ ] Game page with streaming narrative display
- [ ] Voice input (SpeechRecognition)
- [ ] Progressive TTS output (SpeechSynthesis)
- [ ] Player status sidebar

### Phase 5 — PoC Validation
- [ ] Full playthrough of Whispers of Eldenmoor (single player, Warrior)
- [ ] Full playthrough (single player, Mage)
- [ ] Session resume after browser close
- [ ] Voice input/output loop end-to-end

---

## 14. Key Technical Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Adventure format | YAML + MD | Machine-parseable definitions, human-authored prose seed |
| State format | JSON in SQLite | Queryable, zero-infra for PoC, trivially migrated to Postgres |
| Memory architecture | Active window + summaries + blob | Bounded context regardless of session length |
| NPC memory | Per-NPC interaction log + summary | Gives NPCs relationship continuity without polluting main context |
| LLM state signalling | Tool calls | Clean separation of narrative prose from state mutations |
| NPC dialogue capture | `npc_spoke` tool call | Extracts NPC reply cleanly without regex parsing of narrative prose |
| Item IDs | Slugs for definitions, UUIDs for instances | Human-readable authoring; unique runtime tracking per physical item |
| Session/Player IDs | UUIDs | Generated by code, never hand-authored |
| API framework | Hono | Lightweight, edge-ready, TypeScript-native, SSE support |
| Dice system | D&D 5e SRD (CC licence) | Proven, familiar, free to use |
| Auth | Session codes + device fingerprint | No friction for family/car use case |
| Streaming | SSE | Simple, browser-native, works for voice clients and future Tesla integration |
| Default player count | min: 1, max: 2 | Family co-op use case; increasing max requires no structural changes |
