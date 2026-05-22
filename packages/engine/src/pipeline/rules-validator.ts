import type {
  AdventureDefinition,
  GameSession,
  ParsedAction,
  PlayerState,
} from '@loreforge/shared';

export type ValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Pure rules validator. Verifies a ParsedAction is legal given current session
 * state and adventure definition. Returns a structured result so the engine
 * can convert "invalid" into player-friendly narrative without surfacing a
 * raw error.
 */
export function validateAction(
  action: ParsedAction,
  session: GameSession,
  adventure: AdventureDefinition,
): ValidationResult {
  const player = session.players.find((p) => p.id === session.currentTurnPlayerId);
  if (!player) {
    return { valid: false, reason: 'No active player in session' };
  }

  if (!adventure.rules.allowedActionTypes.includes(action.type)) {
    return { valid: false, reason: `Action ${action.type} is not allowed in this adventure` };
  }

  if (!player.characterClass.availableActions.includes(action.type)) {
    return {
      valid: false,
      reason: `Your class (${player.characterClass.name}) cannot ${action.type.toLowerCase()}`,
    };
  }

  const location = adventure.locations[player.currentLocationId];
  if (!location) {
    return { valid: false, reason: `Current location ${player.currentLocationId} not found` };
  }

  switch (action.params.type) {
    case 'MOVE':
      return validateMove(action.params, player, location, session, adventure);
    case 'TAKE_ITEM':
      return validateTake(action.params, player, location, session, adventure);
    case 'DROP_ITEM':
      return validateDrop(action.params, player);
    case 'USE_ITEM':
      return validateUse(action.params, player);
    case 'TALK_TO_NPC':
      return validateTalk(action.params, location, adventure);
    case 'ATTACK':
      return validateAttack(action.params, location, session, adventure);
    case 'CAST_SPELL':
      return validateCast(action.params, player);
    case 'EXAMINE':
    case 'LOOK':
    case 'INVENTORY':
    case 'STATUS':
    case 'RECALL':
      return { valid: true };
  }
}

function validateMove(
  params: { direction: string },
  player: PlayerState,
  location: AdventureDefinition['locations'][string],
  session: GameSession,
  adventure: AdventureDefinition,
): ValidationResult {
  const exit = location.exits.find(
    (e) => e.direction.toLowerCase() === params.direction.toLowerCase(),
  );
  if (!exit) {
    return { valid: false, reason: `No exit "${params.direction}" from ${location.name}` };
  }
  const target = adventure.locations[exit.toLocationId];
  if (!target) {
    return { valid: false, reason: `Destination ${exit.toLocationId} not found` };
  }
  if (exit.requiresItemId && !player.inventory.some((i) => i.itemId === exit.requiresItemId)) {
    return {
      valid: false,
      reason: exit.lockedMessage ?? `You need ${exit.requiresItemId} to go that way`,
    };
  }
  if (exit.requiresGoalId && !session.worldState.completedGoalIds.includes(exit.requiresGoalId)) {
    return { valid: false, reason: exit.lockedMessage ?? 'The way is barred' };
  }
  if (
    target.requiresQuestId &&
    !session.worldState.activeQuestIds.includes(target.requiresQuestId)
  ) {
    return { valid: false, reason: 'You have no reason to go there yet' };
  }
  if (
    target.requiresGoalId &&
    !session.worldState.completedGoalIds.includes(target.requiresGoalId)
  ) {
    return { valid: false, reason: 'The path remains closed to you' };
  }
  return { valid: true };
}

function validateTake(
  params: { itemId: string },
  player: PlayerState,
  location: AdventureDefinition['locations'][string],
  session: GameSession,
  adventure: AdventureDefinition,
): ValidationResult {
  const grant = location.items.find((g) => g.itemId === params.itemId);
  if (!grant) {
    return { valid: false, reason: `No "${params.itemId}" is here` };
  }
  if (session.worldState.collectedItemIds.includes(params.itemId)) {
    return { valid: false, reason: 'That item is already gone' };
  }
  if (player.inventory.length >= adventure.rules.maxInventorySize) {
    return { valid: false, reason: 'Your inventory is full' };
  }
  return { valid: true };
}

function validateDrop(params: { instanceId: string }, player: PlayerState): ValidationResult {
  if (!player.inventory.some((i) => i.instanceId === params.instanceId)) {
    return { valid: false, reason: 'You do not carry that' };
  }
  return { valid: true };
}

function validateUse(
  params: { instanceId: string; targetId?: string },
  player: PlayerState,
): ValidationResult {
  if (!player.inventory.some((i) => i.instanceId === params.instanceId)) {
    return { valid: false, reason: 'You do not carry that' };
  }
  return { valid: true };
}

function validateTalk(
  params: { npcId: string },
  location: AdventureDefinition['locations'][string],
  adventure: AdventureDefinition,
): ValidationResult {
  if (!location.npcs.includes(params.npcId)) {
    return { valid: false, reason: 'They are not here' };
  }
  if (!adventure.npcs[params.npcId]) {
    return { valid: false, reason: `NPC ${params.npcId} is undefined in this adventure` };
  }
  return { valid: true };
}

function validateAttack(
  params: { targetNpcId: string },
  location: AdventureDefinition['locations'][string],
  session: GameSession,
  adventure: AdventureDefinition,
): ValidationResult {
  if (adventure.rules.combatSystem === 'NONE') {
    return { valid: false, reason: 'Combat is not available in this adventure' };
  }
  if (!location.npcs.includes(params.targetNpcId)) {
    return { valid: false, reason: 'There is no such foe here' };
  }
  const npc = adventure.npcs[params.targetNpcId];
  if (!npc?.combatStats) {
    return { valid: false, reason: `${npc?.name ?? 'They'} cannot be attacked` };
  }
  if (session.worldState.defeatedNpcIds.includes(params.targetNpcId)) {
    return { valid: false, reason: 'They are already defeated' };
  }
  return { valid: true };
}

function validateCast(params: { spellId: string }, player: PlayerState): ValidationResult {
  if (!player.spells.includes(params.spellId)) {
    return { valid: false, reason: `You do not know the spell "${params.spellId}"` };
  }
  return { valid: true };
}
