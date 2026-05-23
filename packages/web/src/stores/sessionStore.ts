import type { AdventureDefinition, GameSession } from '@loreforge/shared';
import { create } from 'zustand';

interface SessionStoreState {
  session: GameSession | null;
  adventure: AdventureDefinition | null;
  setSession: (session: GameSession | null) => void;
  setAdventure: (adventure: AdventureDefinition | null) => void;
  /**
   * Returns the currently-active player from the session, or null if the
   * session hasn't been loaded yet. The architecture's single-player PoC
   * always uses the player at index 0; multi-player support would route
   * via `currentTurnPlayerId`.
   */
  activePlayer: () => GameSession['players'][number] | null;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  session: null,
  adventure: null,
  setSession: (session) => set({ session }),
  setAdventure: (adventure) => set({ adventure }),
  activePlayer: () => {
    const s = get().session;
    if (!s) return null;
    return s.players.find((p) => p.id === s.currentTurnPlayerId) ?? s.players[0] ?? null;
  },
}));
