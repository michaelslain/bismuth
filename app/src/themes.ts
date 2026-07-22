// app/src/themes.ts
// Thin re-export of the color source of truth, which lives in CORE
// (core/src/theme/tokens.ts) because the dependency runs app → core: core consumers
// (gcal color mapping, drawing paper/ink, the settings schema's theme enum) must be
// able to import the tokens, and core cannot import app. The frontend keeps importing
// from "./themes" — these are byte-identical runtime values.
export type { ColorTokens, ThemeName, CategorySwatchName, SemanticTokens, ShadowTokens } from "../../core/src/theme/tokens";
export {
  THEME_NAMES,
  DEFAULT_THEME,
  THEME_LABELS,
  SHEEN,
  CATEGORY_SWATCHES,
  ACCENT_RAMP,
  THEMES,
  THEME_ACCENTS,
  SEMANTIC_DARK,
  SEMANTIC_LIGHT,
  SHADOW_DARK,
  SHADOW_LIGHT,
  resolveTheme,
  resolveAppearance,
  semanticTokens,
  shadowTokens,
} from "../../core/src/theme/tokens";
