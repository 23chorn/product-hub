import { create } from 'zustand';

interface SkillManagerState {
  isOpen: boolean;
  openSkillManager: () => void;
  closeSkillManager: () => void;
}

export const useSkillManagerStore = create<SkillManagerState>((set) => ({
  isOpen: false,
  openSkillManager: () => set({ isOpen: true }),
  closeSkillManager: () => set({ isOpen: false }),
}));
