import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AdventureDefinition,
  AdventureDefinitionSchema,
  type AdventureMetadata,
  type CharacterClass,
  CharacterClassSchema,
} from '@loreforge/shared';
import { parse as parseYaml } from 'yaml';
import type { AdventureLoader } from './interface.js';

interface AdventureYaml extends Omit<AdventureDefinition, 'availableClasses' | 'worldContext'> {
  classFiles?: string[];
}

export class FileSystemAdventureLoader implements AdventureLoader {
  private cache = new Map<string, AdventureDefinition>();

  constructor(private readonly adventuresDir: string) {}

  async load(adventureId: string): Promise<AdventureDefinition> {
    const cached = this.cache.get(adventureId);
    if (cached) return cached;

    const adventureDir = join(this.adventuresDir, adventureId);
    const adventureYamlPath = join(adventureDir, 'adventure.yaml');
    const worldContextPath = join(adventureDir, 'world-context.md');

    const [yamlText, worldContext] = await Promise.all([
      readFile(adventureYamlPath, 'utf-8'),
      readFile(worldContextPath, 'utf-8').catch(() => ''),
    ]);

    const raw = parseYaml(yamlText) as AdventureYaml;
    const classes = await this.loadClasses(adventureDir, raw.classFiles ?? []);

    const merged = {
      ...raw,
      availableClasses: classes,
      worldContext,
    };

    const validated = AdventureDefinitionSchema.parse(merged);
    this.validateCrossReferences(validated);
    this.cache.set(adventureId, validated);
    return validated;
  }

  async list(): Promise<AdventureMetadata[]> {
    const entries = await readdir(this.adventuresDir);
    const metadata: AdventureMetadata[] = [];
    for (const entry of entries) {
      if (entry.startsWith('_') || entry.startsWith('.')) continue;
      const entryPath = join(this.adventuresDir, entry);
      const entryStat = await stat(entryPath).catch(() => null);
      if (!entryStat?.isDirectory()) continue;
      try {
        const def = await this.load(entry);
        metadata.push({
          id: def.id,
          title: def.title,
          description: def.description,
          minPlayers: def.minPlayers,
          maxPlayers: def.maxPlayers,
        });
      } catch {
        // Skip invalid adventures rather than failing the whole list.
      }
    }
    return metadata;
  }

  private async loadClasses(adventureDir: string, classFiles: string[]): Promise<CharacterClass[]> {
    const classes: CharacterClass[] = [];
    for (const relPath of classFiles) {
      const text = await readFile(join(adventureDir, relPath), 'utf-8');
      const parsed = parseYaml(text);
      classes.push(CharacterClassSchema.parse(parsed));
    }
    return classes;
  }

  /**
   * Verifies that IDs referenced from one definition exist in the other definitions.
   * Catches authoring mistakes (typos in itemIds, missing NPCs, etc.) at load time
   * rather than at gameplay time.
   */
  private validateCrossReferences(def: AdventureDefinition): void {
    const errors: string[] = [];
    const itemIds = new Set(Object.keys(def.items));
    const npcIds = new Set(Object.keys(def.npcs));
    const locationIds = new Set(Object.keys(def.locations));
    const questIds = new Set(Object.keys(def.quests));
    const goalIds = new Set(Object.keys(def.goals));
    const puzzleIds = new Set(Object.keys(def.puzzles));

    if (!locationIds.has(def.startingLocationId)) {
      errors.push(`startingLocationId "${def.startingLocationId}" not found in locations`);
    }
    for (const grant of def.startingInventory) {
      if (!itemIds.has(grant.itemId)) {
        errors.push(`startingInventory references unknown item "${grant.itemId}"`);
      }
    }
    for (const [locId, loc] of Object.entries(def.locations)) {
      for (const exit of loc.exits) {
        if (!locationIds.has(exit.toLocationId)) {
          errors.push(`location "${locId}" exit to unknown location "${exit.toLocationId}"`);
        }
        if (exit.requiresItemId && !itemIds.has(exit.requiresItemId)) {
          errors.push(`location "${locId}" exit requires unknown item "${exit.requiresItemId}"`);
        }
        if (exit.requiresGoalId && !goalIds.has(exit.requiresGoalId)) {
          errors.push(`location "${locId}" exit requires unknown goal "${exit.requiresGoalId}"`);
        }
      }
      for (const npcId of loc.npcs) {
        if (!npcIds.has(npcId)) {
          errors.push(`location "${locId}" references unknown npc "${npcId}"`);
        }
      }
      for (const puzzleId of loc.puzzleIds) {
        if (!puzzleIds.has(puzzleId)) {
          errors.push(`location "${locId}" references unknown puzzle "${puzzleId}"`);
        }
      }
      for (const grant of loc.items) {
        if (!itemIds.has(grant.itemId)) {
          errors.push(`location "${locId}" references unknown item "${grant.itemId}"`);
        }
      }
      if (loc.requiresQuestId && !questIds.has(loc.requiresQuestId)) {
        errors.push(`location "${locId}" requires unknown quest "${loc.requiresQuestId}"`);
      }
      if (loc.requiresGoalId && !goalIds.has(loc.requiresGoalId)) {
        errors.push(`location "${locId}" requires unknown goal "${loc.requiresGoalId}"`);
      }
    }
    for (const [questId, quest] of Object.entries(def.quests)) {
      if (!npcIds.has(quest.grantedByNpcId)) {
        errors.push(`quest "${questId}" granted by unknown npc "${quest.grantedByNpcId}"`);
      }
      if (!goalIds.has(quest.completionGoalId)) {
        errors.push(`quest "${questId}" completion goal "${quest.completionGoalId}" not found`);
      }
      for (const locId of quest.unlocksLocationIds) {
        if (!locationIds.has(locId)) {
          errors.push(`quest "${questId}" unlocks unknown location "${locId}"`);
        }
      }
    }
    for (const [npcId, npc] of Object.entries(def.npcs)) {
      if (npc.givesQuestId && !questIds.has(npc.givesQuestId)) {
        errors.push(`npc "${npcId}" gives unknown quest "${npc.givesQuestId}"`);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `Adventure "${def.id}" failed cross-reference validation:\n  - ${errors.join('\n  - ')}`,
      );
    }
  }
}
