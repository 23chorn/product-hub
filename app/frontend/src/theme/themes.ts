/**
 * Theme registry — single source of truth for selectable themes.
 *
 * Each theme has:
 *   • id      — applied to <html data-theme="..."> to select the color palette
 *               (see src/styles/themes.css).
 *   • family  — 'dark' toggles the .dark class so every `dark:` utility fires.
 *   • label   — human label for the picker.
 *   • swatch  — preview color for the picker (the theme's brand-500).
 *
 * Add a theme: append an entry here, and — only if it uses a new palette —
 * add a matching [data-theme="<id>"] block in src/styles/themes.css.
 */

export type ThemeFamily = 'light' | 'dark';

export interface ThemeDef {
  id: string;
  label: string;
  family: ThemeFamily;
  swatch: string;
}

export const THEMES = [
  { id: 'light',    label: 'Light',    family: 'light', swatch: 'rgb(241 245 249)' },
  { id: 'dark',     label: 'Dark',     family: 'dark',  swatch: 'rgb(16 185 129)' },
  { id: 'retro',    label: 'Retro',    family: 'light', swatch: 'rgb(192 96 28)' },
  { id: 'terminal', label: 'Terminal', family: 'dark',  swatch: 'rgb(0 230 70)' },
  { id: 'paper',    label: 'Paper',    family: 'light', swatch: 'rgb(30 64 153)' },
  { id: 'sand',     label: 'Sand',     family: 'light', swatch: 'rgb(176 99 70)' },
] as const satisfies readonly ThemeDef[];

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME_ID: ThemeId = 'light';

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return !!value && THEMES.some((t) => t.id === value);
}

export function getTheme(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
