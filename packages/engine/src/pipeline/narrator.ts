import { randomUUID } from 'node:crypto';
import type {
  AdventureDefinition,
  GameSession,
  ParsedAction,
  StateChange,
} from '@loreforge/shared';
import type { LLMProvider, NarrativePrompt } from '../llm/provider.js';

export interface NarrateResult {
  narrative: string;
  stateChanges: StateChange[];
}

export interface NarrateInput {
  prompt: NarrativePrompt;
  action: ParsedAction;
  session: GameSession;
  adventure: AdventureDefinition;
  turnNumber: number;
}

/**
 * Streams from an LLMProvider, collects text deltas into the narrative
 * string, and translates each tool call into an engine StateChange.
 *
 * Claude's tool calls are the canonical record of what happened — the
 * narrator never invents state changes that weren't signalled this way.
 */
export async function narrate(input: NarrateInput, llm: LLMProvider): Promise<NarrateResult> {
  const stateChanges: StateChange[] = [];
  let narrative = '';

  for await (const chunk of llm.streamNarrative(input.prompt)) {
    if (chunk.type === 'text_delta' && chunk.textDelta) {
      narrative += chunk.textDelta;
    } else if (chunk.type === 'tool_call' && chunk.toolCall) {
      const change = toolCallToStateChange(chunk.toolCall, input);
      if (change) stateChanges.push(change);
    }
  }

  return { narrative: narrative.trim(), stateChanges };
}

function toolCallToStateChange(
  toolCall: { name: string; input: Record<string, unknown> },
  ctx: NarrateInput,
): StateChange | null {
  const { name, input } = toolCall;
  switch (name) {
    case 'player_moved':
      return {
        type: 'PLAYER_MOVED',
        playerId: String(input.playerId),
        toLocationId: String(input.locationId),
      };
    case 'item_added_to_inventory': {
      const itemId = String(input.itemId);
      const itemDef = ctx.adventure.items[itemId];
      return {
        type: 'ITEM_ADDED',
        playerId: String(input.playerId),
        item: {
          instanceId: randomUUID(),
          itemId,
          quantity: Number(input.quantity ?? 1),
          acquiredAtTurn: ctx.turnNumber,
          durability: itemDef?.maxDurability,
          charges: itemDef?.maxCharges,
        },
      };
    }
    case 'item_removed_from_inventory':
      return {
        type: 'ITEM_REMOVED',
        playerId: String(input.playerId),
        instanceId: String(input.instanceId),
      };
    case 'npc_defeated':
      return { type: 'NPC_DEFEATED', npcId: String(input.npcId) };
    case 'puzzle_solved':
      return { type: 'PUZZLE_SOLVED', puzzleId: String(input.puzzleId) };
    case 'goal_completed':
      return { type: 'GOAL_COMPLETED', goalId: String(input.goalId) };
    case 'quest_started':
      return {
        type: 'QUEST_STARTED',
        questId: String(input.questId),
        playerId: String(input.playerId),
      };
    case 'hp_changed': {
      const playerId = String(input.playerId);
      const player = ctx.session.players.find((p) => p.id === playerId);
      const delta = Number(input.delta ?? 0);
      const newValue = Math.max(
        0,
        Math.min(player?.hp.max ?? 0, (player?.hp.current ?? 0) + delta),
      );
      return { type: 'HP_CHANGED', playerId, delta, newValue };
    }
    case 'game_over':
      return {
        type: 'GAME_OVER',
        result: input.result === 'VICTORY' ? 'VICTORY' : 'DEFEAT',
      };
    case 'npc_spoke': {
      const npcId = String(input.npcId);
      const playerId = String(input.playerId);
      return {
        type: 'NPC_INTERACTION_RECORDED',
        npcId,
        interaction: {
          turnNumber: ctx.turnNumber,
          playerId,
          playerSaid: ctx.action.rawInput,
          npcReplied: String(input.npcRepliedSummary),
          questsGranted: input.questGranted ? [String(input.questGranted)] : [],
          dispositionChange: input.dispositionChange as
            | 'FRIENDLY'
            | 'NEUTRAL'
            | 'HOSTILE'
            | undefined,
        },
      };
    }
    default:
      return null;
  }
}
