import { create } from 'zustand';

interface SettingsState {
  isOpen: boolean;
  isDemoMode: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  setDemoMode: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  isDemoMode: false,
  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false }),
  setDemoMode: (enabled) => set({ isDemoMode: enabled }),
}));
