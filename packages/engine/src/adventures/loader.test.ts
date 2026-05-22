import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FileSystemAdventureLoader } from './loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADVENTURES_DIR = resolve(__dirname, '../../../../adventures');

describe('FileSystemAdventureLoader', () => {
  it('loads whispers-of-eldenmoor without validation errors', async () => {
    const loader = new FileSystemAdventureLoader(ADVENTURES_DIR);
    const adventure = await loader.load('whispers-of-eldenmoor');
    expect(adventure.id).toBe('whispers-of-eldenmoor');
    expect(adventure.locations.tavern).toBeDefined();
    expect(adventure.locations.forest_clearing).toBeDefined();
    expect(adventure.npcs.mira).toBeDefined();
    expect(adventure.npcs.goblin_chief?.combatStats).toBeDefined();
    expect(adventure.availableClasses).toHaveLength(2);
    expect(adventure.worldContext.length).toBeGreaterThan(0);
  });

  it('lists at least the Eldenmoor adventure', async () => {
    const loader = new FileSystemAdventureLoader(ADVENTURES_DIR);
    const list = await loader.list();
    expect(list.some((a) => a.id === 'whispers-of-eldenmoor')).toBe(true);
  });

  it('detects cross-reference errors', async () => {
    const brokenDir = resolve(__dirname, '../../../../adventures');
    const loader = new FileSystemAdventureLoader(brokenDir);
    await expect(loader.load('definitely-does-not-exist')).rejects.toThrow();
  });
});
