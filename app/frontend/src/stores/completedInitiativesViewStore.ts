import { create } from 'zustand';

interface CompletedInitiativesViewState {
  isActive: boolean;
  showCompletedInitiatives: () => void;
  showHome: () => void;
}

export const useCompletedInitiativesViewStore = create<CompletedInitiativesViewState>((set) => ({
  isActive: false,
  showCompletedInitiatives: () => set({ isActive: true }),
  showHome: () => set({ isActive: false }),
}));
