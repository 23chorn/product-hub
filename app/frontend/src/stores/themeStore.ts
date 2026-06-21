import { create } from 'zustand';
import {
  DEFAULT_THEME_ID,
  getTheme,
  isThemeId,
  type ThemeId,
} from '../theme/themes';

const STORAGE_KEY = 'theme';

/** Apply a theme to <html>: data-theme selects the palette, .dark the brightness. */
function applyTheme(id: ThemeId): void {
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.classList.toggle('dark', theme.family === 'dark');
}

/** Legacy values stored 'dark'/'light' — both are still valid theme ids. */
function readInitial(): ThemeId {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isThemeId(saved) ? saved : DEFAULT_THEME_ID;
}

interface ThemeState {
  theme: ThemeId;
  /** Derived from the active theme's family. Kept for back-compat. */
  isDark: boolean;
  setTheme: (id: ThemeId) => void;
  /** Back-compat: flip between the plain light/dark themes. */
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readInitial();
  applyTheme(initial);

  return {
    theme: initial,
    isDark: getTheme(initial).family === 'dark',
    setTheme: (id) => {
      applyTheme(id);
      localStorage.setItem(STORAGE_KEY, id);
      set({ theme: id, isDark: getTheme(id).family === 'dark' });
    },
    toggleTheme: () => get().setTheme(get().isDark ? 'light' : 'dark'),
  };
});
