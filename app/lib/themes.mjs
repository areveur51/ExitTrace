/** User-selectable HUD themes. Visual language only — catalog copy stays ExitTrace routes. */
export const THEMES = [
  { id: "cyberdeck", label: "Cyberdeck" },
  { id: "phosphor", label: "Phosphor" },
  { id: "greyscale", label: "Greyscale" },
  { id: "stencil", label: "Stencil" },
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = "cyberdeck";
export const THEME_STORAGE_KEY = "exittrace-theme";

export function normalizeTheme(id) {
  return THEME_IDS.includes(String(id || "")) ? String(id) : DEFAULT_THEME;
}

export function applyTheme(id, { root, storage, buttons } = {}) {
  const theme = normalizeTheme(id);
  root?.setAttribute?.("data-theme", theme);
  try {
    storage?.setItem?.(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / quota */
  }
  if (buttons) {
    for (const btn of buttons) {
      const on = btn.getAttribute?.("data-theme-set") === theme;
      btn.setAttribute?.("aria-pressed", on ? "true" : "false");
    }
  }
  return theme;
}
