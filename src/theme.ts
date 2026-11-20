/** The themes (plan 9). Ids match the user_settings.theme check constraint and index.css. */
export const THEMES = [
  { id: 'superman', label: 'Superman (light)' },
  { id: 'batman', label: 'Batman (dark)' },
  { id: 'letterboxd', label: 'Letterboxd (dark)' },
] as const

export type Theme = (typeof THEMES)[number]['id']

/** localStorage key; index.html reads it before first paint. */
export const THEME_STORAGE_KEY = 'film-club-theme'

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((t) => t.id === value)
}

/** The theme on <html> right now (set by index.html before first paint). */
export function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme
  return isTheme(theme) ? theme : 'superman'
}

/** Applies a theme and remembers it on this device. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage blocked (e.g. private mode): the theme still applies for this visit.
  }
}
