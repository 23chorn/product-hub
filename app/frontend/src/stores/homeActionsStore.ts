import { create } from 'zustand';

/**
 * Bridges the Home screen's sync/new-initiative actions up to the app-level header
 * (App.tsx), which renders the buttons but doesn't own the data they act on. HomeScreen
 * registers its handlers on mount and clears them on unmount, so the header only shows
 * the buttons while the Home screen is actually the active view.
 */
interface HomeActionsState {
  syncing: boolean;
  setSyncing: (syncing: boolean) => void;
  onSync: (() => void) | null;
  onNewInitiative: (() => void) | null;
  registerHandlers: (handlers: { onSync: () => void; onNewInitiative: () => void }) => void;
  clearHandlers: () => void;
}

export const useHomeActionsStore = create<HomeActionsState>((set) => ({
  syncing: false,
  setSyncing: (syncing) => set({ syncing }),
  onSync: null,
  onNewInitiative: null,
  registerHandlers: (handlers) => set(handlers),
  clearHandlers: () => set({ onSync: null, onNewInitiative: null }),
}));
