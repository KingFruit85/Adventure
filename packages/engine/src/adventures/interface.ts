import type { AdventureDefinition, AdventureMetadata } from '@loreforge/shared';

export interface AdventureLoader {
  load(adventureId: string): Promise<AdventureDefinition>;
  list(): Promise<AdventureMetadata[]>;
}
