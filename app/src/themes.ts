// app/src/themes.ts
// Thin re-export of the color source of truth, which lives in CORE
// (core/src/theme/tokens.ts) because the dependency runs app → core: core consumers
// (gcal color mapping, drawing paper/ink, the settings schema's theme enum) must be
// able to import the tokens, and core cannot import app. The frontend keeps importing
// from "./themes" — byte-identical runtime values, except resolveTheme/resolveAppearance,
// which are bound to the reactive custom-theme signal (customThemes.ts) so a vault's
// .themes/<name>.yaml resolves with no caller edit, and re-resolves reactively.
import {
    resolveTheme as coreResolveTheme,
    resolveAppearance as coreResolveAppearance,
} from '../../core/src/theme/tokens'
import type { TokenMap } from '../../core/src/theme/designTokens'
import { customThemes } from './customThemes'

export type {
    ColorTokens,
    ThemeName,
    CategorySwatchName,
    SemanticTokens,
    ShadowTokens,
} from '../../core/src/theme/tokens'
export {
    THEME_NAMES,
    DEFAULT_THEME,
    THEME_LABELS,
    CATEGORY_SWATCHES,
    ACCENT_RAMP,
    THEMES,
    THEME_ACCENTS,
    SEMANTIC_DARK,
    SEMANTIC_LIGHT,
    SHADOW_DARK,
    SHADOW_LIGHT,
    semanticTokens,
    shadowTokens,
} from '../../core/src/theme/tokens'

export const resolveTheme = (name: string) =>
    coreResolveTheme(name, customThemes())
export const resolveAppearance = (a: {
    theme: string
    tokens?: TokenMap
}) =>
    coreResolveAppearance(a, customThemes())
