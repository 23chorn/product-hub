import { create } from 'zustand';

interface DiscoveryState {
  isOpen: boolean;
  openDiscovery: () => void;
  closeDiscovery: () => void;
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  isOpen: false,
  openDiscovery: () => set({ isOpen: true }),
  closeDiscovery: () => set({ isOpen: false }),
}));
