import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FileSystemAdventureLoader } from '../adventures/loader.js';
import { validateAction } from './rules-validator.js';
import { createSession } from './session-factory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADVENTURES_DIR = resolve(__dirname, '../../../../adventures');

describe('validateAction (Eldenmoor)', () => {
  it('blocks movement into the forest before quest is active', async () => {
    const loader = new FileSystemAdventureLoader(ADVENTURES_DIR);
    const adventure = await loader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    const result = validateAction(
      { type: 'MOVE', rawInput: 'north', params: { type: 'MOVE', direction: 'north' } },
      session,
      adventure,
    );
    expect(result.valid).toBe(false);
  });

  it('allows movement into the forest once quest is active', async () => {
    const loader = new FileSystemAdventureLoader(ADVENTURES_DIR);
    const adventure = await loader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Hero', classId: 'warrior' }],
    });
    session.worldState.activeQuestIds.push('the_goblin_threat');
    const result = validateAction(
      { type: 'MOVE', rawInput: 'north', params: { type: 'MOVE', direction: 'north' } },
      session,
      adventure,
    );
    expect(result.valid).toBe(true);
  });

  it('blocks Mage from attacking (no ATTACK in class actions)', async () => {
    const loader = new FileSystemAdventureLoader(ADVENTURES_DIR);
    const adventure = await loader.load('whispers-of-eldenmoor');
    const session = createSession({
      adventure,
      players: [{ name: 'Sage', classId: 'mage' }],
    });
    // Force the mage into the forest so the NPC is present.
    const mage = session.players[0]!;
    mage.currentLocationId = 'forest_clearing';
    session.worldState.activeQuestIds.push('the_goblin_threat');
    const result = validateAction(
      {
        type: 'ATTACK',
        rawInput: 'attack chief',
        params: { type: 'ATTACK', targetNpcId: 'goblin_chief' },
      },
      session,
      adventure,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/mage/i);
    }
  });
});
