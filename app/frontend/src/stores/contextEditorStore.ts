import { create } from 'zustand';

interface ContextEditorState {
  isOpen: boolean;
  openContextEditor: () => void;
  closeContextEditor: () => void;
}

export const useContextEditorStore = create<ContextEditorState>((set) => ({
  isOpen: false,
  openContextEditor: () => set({ isOpen: true }),
  closeContextEditor: () => set({ isOpen: false }),
}));
