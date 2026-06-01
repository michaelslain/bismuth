// app/src/themes.ts
// Named Bismuth color themes (distilled from the reference palettes.jsx) plus the
// pure resolver that layers a theme-as-base with per-key custom overrides. A color
// key counts as an "override" only when its value differs from the `default`
// theme's token — that's how we tell a user-set value apart from the always-present
// seeded default (the schema seeds every color key). DOM-free + Solid-free so it
// unit-tests in isolation and is safe to import from settingsCssVars / consumers.

/** The five color tokens a theme supplies, mirroring the appearance color keys. */
export interface ColorTokens {
  background: string;
  foreground: string;
  neutral: string;
  accent: string;
  accentPalette: string[];
}

/** The appearance subtree fields this module reads (a structural subset of Settings). */
export interface AppearanceColors extends ColorTokens {
  theme: string;
}

/** Ordered theme names; `default` is first and is the schema default. */
export const THEME_NAMES = [
  "default",
  "gunmetal-teal",
  "oxide-duotone",
  "rose-gold",
  "indigo-oxide",
  "forest-oxide",
  "full-sheen",
] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

/** Human display names (used in the schema doc string). */
export const THEME_LABELS: Record<ThemeName, string> = {
  "default": "Default (Oxide)",
  "gunmetal-teal": "Gunmetal · Teal",
  "oxide-duotone": "Oxide Duotone",
  "rose-gold": "Rose-Gold Metal",
  "indigo-oxide": "Indigo Oxide",
  "forest-oxide": "Forest Oxide",
  "full-sheen": "Gunmetal · Full Sheen",
};

const SHEEN = ["#F0509B", "#9B53E8", "#3F6BF0", "#27C7D9", "#43D49A", "#F2C53D"];

/** Theme name → color tokens. `default` equals today's hardcoded appearance defaults. */
export const THEMES: Record<ThemeName, ColorTokens> = {
  "default": {
    background: "#14151B",
    foreground: "#F4F2EE",
    neutral: "#AEB4C2",
    accent: "#3F6BF0",
    accentPalette: [...SHEEN],
  },
  "gunmetal-teal": {
    background: "#0E1014",
    foreground: "#E6E9EF",
    neutral: "#878F9E",
    accent: "#27C2D1",
    accentPalette: ["#2FD4BE", "#27C2D1", "#39A8E6", "#5C8DEF", "#6FE0A0"],
  },
  "oxide-duotone": {
    background: "#0D0E16",
    foreground: "#E7E8F2",
    neutral: "#888EA8",
    accent: "#5E8DE6",
    accentPalette: ["#22C6D6", "#3F9BE6", "#5C7BEE", "#8B6CF0", "#B16AD6"],
  },
  "rose-gold": {
    background: "#15110F",
    foreground: "#F1EAE5",
    neutral: "#A99A8F",
    accent: "#E1748F",
    accentPalette: ["#F2C24A", "#F0A055", "#EC7E6A", "#E1748F", "#E06AB0"],
  },
  "indigo-oxide": {
    background: "#0C0E1A",
    foreground: "#E7E9F6",
    neutral: "#868DAE",
    accent: "#5C6CF2",
    accentPalette: ["#6FA0FF", "#5C6CF2", "#7B5CF0", "#9B5CE8", "#56AEEA"],
  },
  "forest-oxide": {
    background: "#0D120F",
    foreground: "#E6EDE7",
    neutral: "#8B9A8E",
    accent: "#3FB87C",
    accentPalette: ["#43C586", "#2FB89A", "#7FD68A", "#9CC24F", "#C9A23E"],
  },
  "full-sheen": {
    background: "#0E0F12",
    foreground: "#EBEDF0",
    neutral: "#878D97",
    accent: "#27C2D1",
    accentPalette: [...SHEEN],
  },
};

/** Resolve the effective colors: theme tokens as base, any key differing from the
 *  `default` theme overrides on top. Both theme and custom keys are optional. */
export function resolveAppearance(a: AppearanceColors): ColorTokens {
  const base = THEMES[a.theme as ThemeName] ?? THEMES["default"];
  const def = THEMES["default"];
  return {
    background: a.background !== def.background ? a.background : base.background,
    foreground: a.foreground !== def.foreground ? a.foreground : base.foreground,
    neutral: a.neutral !== def.neutral ? a.neutral : base.neutral,
    accent: a.accent !== def.accent ? a.accent : base.accent,
    accentPalette:
      JSON.stringify(a.accentPalette) !== JSON.stringify(def.accentPalette)
        ? a.accentPalette
        : base.accentPalette,
  };
}
