import { create } from 'zustand';

export type PageKey = 'home' | 'completed' | 'discovery' | 'knowledge' | 'quickFeature';

const STORAGE_KEY = 'activePage';
const PAGE_KEYS: PageKey[] = ['home', 'completed', 'discovery', 'knowledge', 'quickFeature'];

function readInitial(): PageKey {
  const saved = localStorage.getItem(STORAGE_KEY);
  return (PAGE_KEYS as string[]).includes(saved ?? '') ? (saved as PageKey) : 'home';
}

interface PageNavState {
  activePage: PageKey;
  setActivePage: (page: PageKey) => void;
}

export const usePageNavStore = create<PageNavState>((set) => ({
  activePage: readInitial(),
  setActivePage: (page) => {
    localStorage.setItem(STORAGE_KEY, page);
    set({ activePage: page });
  },
}));
