import { create } from 'zustand';

interface StatsState {
  isOpen: boolean;
  openStats: () => void;
  closeStats: () => void;
}

export const useStatsStore = create<StatsState>((set) => ({
  isOpen: false,
  openStats: () => set({ isOpen: true }),
  closeStats: () => set({ isOpen: false }),
}));
