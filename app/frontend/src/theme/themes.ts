/**
 * Theme registry — single source of truth for selectable themes.
 *
 * Each theme has:
 *   • id      — applied to <html data-theme="..."> to select the color palette
 *               (see src/styles/themes.css).
 *   • family  — 'dark' toggles the .dark class so every `dark:` utility fires.
 *               High-contrast themes are black-surfaced, so they use family
 *               'dark' too — `group` is what separates them in the picker.
 *   • group   — picker section: 'light' | 'dark' | 'high-contrast'. Purely a
 *               UI grouping label; only `family` drives the .dark class.
 *   • label   — human label for the picker.
 *   • swatch  — preview color for the picker (the theme's brand-500).
 *
 * Add a theme: append an entry here, and — only if it uses a new palette —
 * add a matching [data-theme="<id>"] block in src/styles/themes.css.
 */

export type ThemeFamily = 'light' | 'dark';
export type ThemeGroup = 'light' | 'dark' | 'high-contrast';

export interface ThemeDef {
  id: string;
  label: string;
  family: ThemeFamily;
  group: ThemeGroup;
  swatch: string;
}

export const THEMES = [
  { id: 'light',              label: 'Light',              family: 'light', group: 'light', swatch: 'rgb(241 245 249)' },
  { id: 'dark',                label: 'Dark',                family: 'dark',  group: 'dark',  swatch: 'rgb(16 185 129)' },
  { id: 'retro',              label: 'Retro',              family: 'light', group: 'light', swatch: 'rgb(192 96 28)' },
  { id: 'terminal',           label: 'Terminal',           family: 'dark',  group: 'dark',  swatch: 'rgb(0 230 70)' },
  { id: 'paper',              label: 'Paper',              family: 'light', group: 'light', swatch: 'rgb(30 64 153)' },
  { id: 'sand',               label: 'Sand',               family: 'light', group: 'light', swatch: 'rgb(176 99 70)' },
  { id: 'nord',               label: 'Nord',               family: 'dark',  group: 'dark',  swatch: 'rgb(67 122 177)' },
  { id: 'monokai',            label: 'Monokai',            family: 'dark',  group: 'dark',  swatch: 'rgb(233 12 133)' },
  { id: 'one-dark',           label: 'One Dark Pro',       family: 'dark',  group: 'dark',  swatch: 'rgb(26 132 219)' },
  { id: 'github-light',       label: 'GitHub Light',       family: 'light', group: 'light', swatch: 'rgb(10 115 235)' },
  { id: 'solarized-light',    label: 'Solarized Light',    family: 'light', group: 'light', swatch: 'rgb(50 195 183)' },
  { id: 'catppuccin-latte',   label: 'Catppuccin Latte',   family: 'light', group: 'light', swatch: 'rgb(126 26 219)' },
  { id: 'rose-pine-dawn',     label: 'Rosé Pine Dawn',     family: 'light', group: 'light', swatch: 'rgb(181 71 64)' },
  { id: 'everforest-light',   label: 'Everforest Light',   family: 'light', group: 'light', swatch: 'rgb(144 214 31)' },
  { id: 'blackout',           label: 'Blackout',           family: 'dark',  group: 'dark',  swatch: 'rgb(255 213 0)' },
  { id: 'high-contrast',      label: 'High Contrast',      family: 'dark',  group: 'high-contrast', swatch: 'rgb(255 255 0)' },
  { id: 'high-contrast-light', label: 'High Contrast Light', family: 'light', group: 'high-contrast', swatch: 'rgb(0 0 255)' },
] as const satisfies readonly ThemeDef[];

/** Fixed picker section order + labels, keyed by ThemeDef.group. */
export const THEME_GROUP_ORDER: readonly ThemeGroup[] = ['light', 'dark', 'high-contrast'];
export const THEME_GROUP_LABELS: Record<ThemeGroup, string> = {
  light: 'Light',
  dark: 'Dark',
  'high-contrast': 'High Contrast',
};

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME_ID: ThemeId = 'light';

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return !!value && THEMES.some((t) => t.id === value);
}

export function getTheme(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
