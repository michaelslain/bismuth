// app/src/themes.ts
// The named Bismuth color themes (distilled from the reference palettes.jsx). Each
// theme carries the FULL set of base UI colors (background, surfaces, border, text,
// muted, accent) plus the graph node palette — so selecting a theme recolors the
// entire app + graph from one source. There are no per-color override keys in the
// initial release: a vault's settings.yaml just names a `theme`. DOM-free + Solid-
// free so it unit-tests in isolation and is safe to import from settingsCssVars /
// the graph + terminal consumers.

/** The resolved color tokens every consumer reads. `neutral` is the edge/muted grey;
 *  `accentPalette` is the graph node ramp. */
export interface ColorTokens {
  background: string;   // canvas / --bg
  foreground: string;   // text / --fg
  neutral: string;      // muted text + graph edges / --text-muted
  accent: string;       // --accent
  border: string;       // --border
  surface: string;      // --surface-1 / --panel
  surface2: string;     // --surface-2
  accentPalette: string[]; // graph nodes/clusters/tags
  // Light theme flag: drives color-scheme + the light/dark branch of derived
  // structural surfaces (rail, pop-bg, scrim, label-halo, …) in settingsCssVars.
  isLight?: boolean;
  // Category hues (Bases statuses, calendar event categories, map pins, chart series).
  // CATEGORICAL, not semantic — distinct from --success/--danger so destructive/success
  // affordances are untouched. Optional: each defaults to the Bismuth design value in
  // settingsCssVars; a theme only sets them to re-tint categories for its own palette.
  categoryGreen?: string;  // --green
  categoryGold?: string;   // --gold
  categoryRose?: string;   // --rose
}

/** Ordered theme names; the first (`oxide-duotone`) is the default. */
export const THEME_NAMES = [
  "oxide-duotone",
  "gunmetal-teal",
  "rose-gold",
  "indigo-oxide",
  "forest-oxide",
  "full-sheen",
  // Light counterparts (same accent identity on a tinted-white ground).
  "oxide-duotone-light",
  "gunmetal-teal-light",
  "rose-gold-light",
  "indigo-oxide-light",
  "forest-oxide-light",
  "full-sheen-light",
] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

/** The default theme name. */
export const DEFAULT_THEME: ThemeName = "oxide-duotone";

/** Human display names (used in the schema doc string). */
export const THEME_LABELS: Record<ThemeName, string> = {
  "oxide-duotone": "Oxide Duotone",
  "gunmetal-teal": "Gunmetal · Teal",
  "rose-gold": "Rose-Gold Metal",
  "indigo-oxide": "Indigo Oxide",
  "forest-oxide": "Forest Oxide",
  "full-sheen": "Gunmetal · Full Sheen",
  "oxide-duotone-light": "Oxide Duotone · Light",
  "gunmetal-teal-light": "Gunmetal · Teal · Light",
  "rose-gold-light": "Rose-Gold · Light",
  "indigo-oxide-light": "Indigo Oxide · Light",
  "forest-oxide-light": "Forest Oxide · Light",
  "full-sheen-light": "Gunmetal · Full Sheen · Light",
};

const SHEEN = ["#F0509B", "#9B53E8", "#3F6BF0", "#27C7D9", "#43D49A", "#F2C53D"];

/** Theme name → full color tokens. Values are the mockup's palette fields:
 *  background=bg, foreground=textHi, neutral=textLo, surface=surface,
 *  surface2=surface2, border=border, accent=accent, accentPalette=graph. */
export const THEMES: Record<ThemeName, ColorTokens> = {
  "oxide-duotone": {
    background: "#0D0E16",
    foreground: "#E7E8F2",
    neutral: "#888EA8",
    accent: "#5E8DE6",
    border: "#2A2E45",
    surface: "#161827",
    surface2: "#1E2133",
    accentPalette: ["#22C6D6", "#3F9BE6", "#5C7BEE", "#8B6CF0", "#B16AD6"],
    categoryGreen: "#43D49A",
    categoryGold: "#F2C53D",
    categoryRose: "#F0509B",
  },
  "gunmetal-teal": {
    background: "#0E1014",
    foreground: "#E6E9EF",
    neutral: "#878F9E",
    accent: "#27C2D1",
    border: "#2A303C",
    surface: "#161922",
    surface2: "#1E2330",
    accentPalette: ["#2FD4BE", "#27C2D1", "#39A8E6", "#5C8DEF", "#6FE0A0"],
  },
  "rose-gold": {
    background: "#15110F",
    foreground: "#F1EAE5",
    neutral: "#A99A8F",
    accent: "#E1748F",
    border: "#382E29",
    surface: "#201917",
    surface2: "#2A221E",
    accentPalette: ["#F2C24A", "#F0A055", "#EC7E6A", "#E1748F", "#E06AB0"],
  },
  "indigo-oxide": {
    background: "#0C0E1A",
    foreground: "#E7E9F6",
    neutral: "#868DAE",
    accent: "#5C6CF2",
    border: "#262B47",
    surface: "#151829",
    surface2: "#1D2138",
    accentPalette: ["#6FA0FF", "#5C6CF2", "#7B5CF0", "#9B5CE8", "#56AEEA"],
  },
  "forest-oxide": {
    background: "#0D120F",
    foreground: "#E6EDE7",
    neutral: "#8B9A8E",
    accent: "#3FB87C",
    border: "#2B362D",
    surface: "#161E18",
    surface2: "#1F2921",
    accentPalette: ["#43C586", "#2FB89A", "#7FD68A", "#9CC24F", "#C9A23E"],
  },
  "full-sheen": {
    background: "#0E0F12",
    foreground: "#EBEDF0",
    neutral: "#878D97",
    accent: "#27C2D1",
    border: "#262931",
    surface: "#16181D",
    surface2: "#1E2128",
    accentPalette: [...SHEEN],
  },
  // ── Light counterparts ──────────────────────────────────────────────────────
  "oxide-duotone-light": {
    background: "#F1EFF7", foreground: "#322D49", neutral: "#7A7393",
    accent: "#5E6FD0", border: "#DCD7EB", surface: "#FFFFFF", surface2: "#EEEBF7",
    accentPalette: ["#3FB6C4", "#6FA6E6", "#7A86DE", "#A98FE0", "#C08FD8"],
    isLight: true,
  },
  "gunmetal-teal-light": {
    background: "#EEF4F4", foreground: "#1B2A2C", neutral: "#6E8385",
    accent: "#1FA6B4", border: "#D4E2E2", surface: "#FFFFFF", surface2: "#E6EFEF",
    accentPalette: ["#3FB8A8", "#2FA9B6", "#5AA6DE", "#7C9CE6", "#6CC79A"],
    isLight: true,
  },
  "rose-gold-light": {
    background: "#FAF1EE", foreground: "#3A2A28", neutral: "#9A8780",
    accent: "#D06A86", border: "#ECDDD7", surface: "#FFFFFF", surface2: "#F4E9E4",
    accentPalette: ["#E0B65A", "#E0A06A", "#DE8A78", "#D27E92", "#CE82B0"],
    isLight: true,
  },
  "indigo-oxide-light": {
    background: "#EEEFF9", foreground: "#272B45", neutral: "#767C9C",
    accent: "#5360E0", border: "#DADCEF", surface: "#FFFFFF", surface2: "#E7E9F6",
    accentPalette: ["#6F9AEC", "#6470E2", "#8270E0", "#9A72DC", "#62A8E2"],
    isLight: true,
  },
  "forest-oxide-light": {
    background: "#EDF4EF", foreground: "#213027", neutral: "#74897C",
    accent: "#2FA86C", border: "#D6E4DA", surface: "#FFFFFF", surface2: "#E5EFE8",
    accentPalette: ["#4FB585", "#3FAE96", "#84C28E", "#9AB45E", "#C0A055"],
    isLight: true,
  },
  "full-sheen-light": {
    background: "#F2F1F4", foreground: "#25272D", neutral: "#6F757F",
    accent: "#1FA6B4", border: "#DEDCE4", surface: "#FFFFFF", surface2: "#EAE9EE",
    accentPalette: ["#E863A0", "#9A6CE0", "#5A82E8", "#3FB8C4", "#5AC79A", "#E0BC55"],
    isLight: true,
  },
};

/** Resolve a theme name to its color tokens; unknown names fall back to the default. */
export function resolveTheme(name: string): ColorTokens {
  return THEMES[name as ThemeName] ?? THEMES[DEFAULT_THEME];
}

/** Resolve the effective colors for an appearance subtree. Initial release: colors
 *  come entirely from the selected theme (no per-color overrides). */
export function resolveAppearance(a: { theme: string }): ColorTokens {
  return resolveTheme(a.theme);
}
