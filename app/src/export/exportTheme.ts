// app/src/export/exportTheme.ts
// Concrete colors/fonts for the visual export renderers (calendar/cards/kanban/list) and
// the document wrapper. The export document is standalone and carries none of the app's
// `:root` palette vars, so theme tokens (accent/teal/…) and status colors must be resolved
// to literal values here instead of emitting var()/color-mix (which the html2canvas
// rasterizer may drop). The LIVE app palette is read from the DOM at export time
// (resolvePalette.ts) and passed in via ExportOptions; DEFAULT_PALETTE below is the
// headless (CLI) fallback AND the safety net if that DOM probe throws — it embeds an
// inline copy of a NAMED scope's tokens straight from core/src/theme/tokens.ts (design/
// ascii-extended PORTING.md §3d), not a hand-copied literal that can drift from the design
// system. "dark" = the default scope (ink); "light" = paper (the print-friendly light
// scope) — the SAME dark/light → ink/paper mapping core/src/drawing/theme.ts uses, so a
// headless export is deterministic and reproducible regardless of the vault's OWN
// .settings theme (unlike the live in-app path, which mirrors whatever scope is active).
import type { ExportTheme, ThemePalette, PaletteToken, TypeScale } from './types'
import { CATEGORY_SWATCHES, THEMES, DEFAULT_THEME } from '../themes'

const DARK_SCOPE = DEFAULT_THEME // "ink"
const LIGHT_SCOPE = 'paper'

const DEFAULT_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif'
// appearance.uiFont's default, in the same shape FONT_STACKS gives it. NOT DEFAULT_FONT: that
// is a sans-serif chrome fallback, and pointing the mono scoping at it rendered code and
// frontmatter in Helvetica.
const DEFAULT_MONO_FONT = "'Monaspace Xenon', ui-monospace, monospace"

// Mirrors app/src/styles/tokens.css (--prose-font, --prose-scale) and editor.lineHeight's schema
// default. A headless (CLI) export has no DOM to probe, so these stand in for the live values —
// same role DEFAULT_PALETTE plays for colour.
const DEFAULT_PROSE_FONT = "'Lora Variable', Lora, Georgia, serif"
// PLACEHOLDER — mirrors styles/tokens.css's --prose-scale for Lora and MUST be kept in sync with
// it. Task 1 (this plan's Lora swap, a sibling worktree) is the one measuring the real value —
// expected near 1.0, not CMU Serif's 1.28 — and this constant could not be read from that
// worktree. Reconcile at merge: replace 1.28 below with Task 1's measured --prose-scale.
const PROSE_SCALE = 1.28
// The app's defaults: --row-h 18px x editor.lineHeight 1.5 = 27px of leading on prose set at
// editorFontSize 13.5 x --prose-scale PROSE_SCALE. 27 / (13.5 * PROSE_SCALE), "the normal range
// for serif body text" that editor.lineHeight's own schema doc cites, at whatever PROSE_SCALE
// currently is (see the placeholder note above it).
const DEFAULT_PROSE_LEADING = 27 / (13.5 * PROSE_SCALE)

// The app's note type scale: the fixed design STEPS from styles/tokens.css, not six resolved
// heading sizes. The ramp is applied to a document's own body size by headingSizes() — see
// TypeScale's docs for why carrying resolved pixels coupled heading size to the editor's font
// size and the line box to the export's point size, two settings nothing ties together.
//   --fs-display 24 (h1 floor) · --fs-title 19 (h2 floor) · --fs-body 13 (h5/h6 ceiling)
//   --fw-bold 600 (h1..h3) · --fw-medium 500 (h4..h6) · --lh-tight 1.4 · tracking in em
export const DEFAULT_TYPE_SCALE: TypeScale = {
    stepDisplayPx: 24,
    stepTitlePx: 19,
    stepBodyPx: 13,
    headingWeight: [600, 600, 600, 500, 500, 500],
    lhTight: 1.4,
    lsDisplay: '-0.01em',
    lsLabel: '0.06em',
}

function paletteFromScope(theme: ExportTheme): ThemePalette {
    const t = theme === 'light' ? THEMES[LIGHT_SCOPE] : THEMES[DARK_SCOPE]
    // The 7-token category/status palette: accent from the resolved scope, the teal→rose
    // ramp from the ONE fixed source (themes.ts CATEGORY_SWATCHES) so it can't drift from
    // the drawing toolbar / gcal copies — category hues are intentionally scope-invariant.
    const tokens: Record<PaletteToken, string> = {
        accent: t.accent,
        ...CATEGORY_SWATCHES,
    }
    return {
        scheme: theme,
        bg: t.background,
        fg: t.foreground,
        muted: t.neutral,
        border: t.border,
        cell: t.surface,
        head: t.surface2,
        accent: t.accent,
        tokens,
        font: DEFAULT_FONT,
        monoFont: DEFAULT_MONO_FONT,
        proseFont: DEFAULT_PROSE_FONT,
        proseLeading: DEFAULT_PROSE_LEADING,
        type: DEFAULT_TYPE_SCALE,
    }
}

export const DEFAULT_PALETTE: Record<ExportTheme, ThemePalette> = {
    dark: paletteFromScope('dark'),
    light: paletteFromScope('light'),
}

/** The palette to render with: a live-theme override (from the DOM) or the default. */
export function paletteFor(
    theme: ExportTheme,
    override?: ThemePalette,
): ThemePalette {
    return override ?? DEFAULT_PALETTE[theme]
}

// Status -> palette token (mirrors ui/StatusDot.STATUS_COLOR, which stores var(--token)
// values that can't render in a standalone export doc).
const STATUS_TOKEN: Record<string, PaletteToken> = {
    reading: 'teal',
    'to read': 'blue',
    toread: 'blue',
    finished: 'green',
    done: 'green',
    complete: 'green',
    abandoned: 'rose',
    dropped: 'rose',
}

/** A stored color string (theme token name, hex, rgb, or named) -> a literal CSS color. */
export function resolveColor(
    color: string | undefined,
    p: ThemePalette,
): string {
    if (!color) return p.accent
    return (p.tokens as Record<string, string>)[color] ?? color
}

/** Group/column-header color for a (status-ish) key, resolved to a literal color. */
export function groupColorHex(key: string, p: ThemePalette): string {
    const tok = STATUS_TOKEN[key.trim().toLowerCase()]
    return tok ? p.tokens[tok] : p.accent
}

export function hexToRgba(hex: string, alpha: number): string | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return null
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** A `border-left + faint fill` tint for a category/status color (no color-mix). */
export function tintStyle(
    color: string | undefined,
    p: ThemePalette,
    alpha?: number,
): string {
    const c = resolveColor(color, p)
    const a = alpha ?? (p.scheme === 'dark' ? 0.3 : 0.16)
    const bg = hexToRgba(c, a) ?? 'transparent'
    return `border-left:3px solid ${c};background:${bg};`
}
