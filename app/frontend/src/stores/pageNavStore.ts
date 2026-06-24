import { create } from 'zustand';

export type PageKey = 'home' | 'completed' | 'discovery' | 'knowledge';

interface PageNavState {
  activePage: PageKey;
  setActivePage: (page: PageKey) => void;
}

export const usePageNavStore = create<PageNavState>((set) => ({
  activePage: 'home',
  setActivePage: (page) => set({ activePage: page }),
}));
