import { create } from 'zustand';

interface PageHeaderState {
  titleNode: HTMLDivElement | null;
  setTitleNode: (node: HTMLDivElement | null) => void;
  actionsNode: HTMLDivElement | null;
  setActionsNode: (node: HTMLDivElement | null) => void;
}

/** Holds the DOM nodes for the shared PageHeader's two slots — a title/description
 * slot on the left and an actions slot on the right — so the currently active page
 * (or, for an open initiative, the pipeline view) can portal its own content into
 * the one common header instead of rendering its own. */
export const usePageHeaderStore = create<PageHeaderState>((set) => ({
  titleNode: null,
  setTitleNode: (node) => set({ titleNode: node }),
  actionsNode: null,
  setActionsNode: (node) => set({ actionsNode: node }),
}));
