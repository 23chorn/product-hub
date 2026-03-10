import { create } from 'zustand';

interface TemplateEditorState {
  isOpen: boolean;
  openTemplateEditor: () => void;
  closeTemplateEditor: () => void;
}

export const useTemplateEditorStore = create<TemplateEditorState>((set) => ({
  isOpen: false,
  openTemplateEditor: () => set({ isOpen: true }),
  closeTemplateEditor: () => set({ isOpen: false }),
}));
