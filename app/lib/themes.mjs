/** Single HUD theme. Visual language only — catalog copy stays ExitTrace routes. */
export const THEMES = [{ id: "glass", label: "Glass" }];

export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = "glass";
export const THEME_STORAGE_KEY = "exittrace-theme";

export function normalizeTheme(id) {
  return THEME_IDS.includes(String(id || "")) ? String(id) : DEFAULT_THEME;
}

export function applyTheme(id, { root, storage } = {}) {
  const theme = normalizeTheme(id);
  root?.setAttribute?.("data-theme", theme);
  try {
    const prev = storage?.getItem?.(THEME_STORAGE_KEY);
    if (prev && prev !== theme) storage.removeItem?.(THEME_STORAGE_KEY);
    storage?.setItem?.(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / quota */
  }
  return theme;
}
