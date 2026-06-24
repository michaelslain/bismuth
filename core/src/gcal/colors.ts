// core/src/gcal/colors.ts
// Map a Bismuth category color → the nearest Google Calendar EVENT color. A category color
// is a THEME TOKEN ("accent"/"teal"/"blue"/"violet"/"green"/"gold"/"rose") or a custom hex
// (app/src/calendar/categoryColor.ts). We resolve tokens to their hex (swatches are fixed in
// App.css; `accent` is per-theme) then snap to the nearest of Google's 11 event colors — which
// works with the calendar.events scope (colorId is just an event field). Pure + unit-tested.

// Google's 11 event colors: colorId → background hex (the classic event palette).
const EVENT_COLORS: Record<string, string> = {
  "1": "#a4bdfc", "2": "#7ae7bf", "3": "#dbadff", "4": "#ff887c", "5": "#fbd75b",
  "6": "#ffb878", "7": "#46d6db", "8": "#e1e1e1", "9": "#5484ed", "10": "#51b749", "11": "#dc2127",
};

// Fixed Bismuth swatch tokens → hex (App.css :root). `accent` is per-theme (below).
const SWATCH_HEX: Record<string, string> = {
  teal: "#22C6D6", blue: "#5C7BEE", violet: "#8B6CF0", green: "#43D49A", gold: "#F2C53D", rose: "#F0509B",
};

// Per-theme `--accent` hex (app/src/themes.ts). Used to resolve the `accent` category token.
const THEME_ACCENT: Record<string, string> = {
  "oxide-duotone": "#5E8DE6", "gunmetal-teal": "#27C2D1", "rose-gold": "#E1748F",
  "indigo-oxide": "#5C6CF2", "forest-oxide": "#3FB87C", "full-sheen": "#27C2D1",
  "oxide-duotone-light": "#7A86DE", "gunmetal-teal-light": "#1FA6B4", "rose-gold-light": "#D06A86",
  "indigo-oxide-light": "#5360E0", "forest-oxide-light": "#2FA86C", "full-sheen-light": "#1FA6B4",
};
const DEFAULT_ACCENT = THEME_ACCENT["oxide-duotone"];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Nearest Google event colorId (1–11) to a hex color by RGB distance; undefined if unparseable. */
export function nearestGoogleColorId(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const rgb = hexToRgb(hex);
  if (!rgb) return undefined;
  let best: string | undefined;
  let bestD = Infinity;
  for (const [id, chex] of Object.entries(EVENT_COLORS)) {
    const c = hexToRgb(chex)!;
    const d = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/**
 * Resolve a Bismuth category color (theme token OR hex) to a Google event colorId, using the
 * active theme to resolve the `accent` token. Returns undefined for unknown/unparseable input.
 */
export function categoryColorId(color: string | undefined, theme?: string): string | undefined {
  if (!color) return undefined;
  if (color === "accent") return nearestGoogleColorId(THEME_ACCENT[theme ?? ""] ?? DEFAULT_ACCENT);
  if (SWATCH_HEX[color]) return nearestGoogleColorId(SWATCH_HEX[color]);
  return nearestGoogleColorId(color); // hex passthrough
}
