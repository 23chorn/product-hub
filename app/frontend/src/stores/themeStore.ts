import { create } from 'zustand';

interface ThemeState {
  isDark: boolean;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  // Initialize from localStorage
  const saved = localStorage.getItem('theme');
  const isDark = saved === 'dark';

  // Apply initial class
  if (isDark) {
    document.documentElement.classList.add('dark');
  }

  return {
    isDark,
    toggleTheme: () =>
      set((state) => {
        const newIsDark = !state.isDark;
        if (newIsDark) {
          document.documentElement.classList.add('dark');
          localStorage.setItem('theme', 'dark');
        } else {
          document.documentElement.classList.remove('dark');
          localStorage.setItem('theme', 'light');
        }
        return { isDark: newIsDark };
      }),
  };
});
