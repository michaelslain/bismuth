// app/src/export/resolvePalette.ts
// Read the LIVE app theme into a concrete ThemePalette so the export matches the app.
// Browser-only: the app's CSS vars (--bg/--fg/--accent/--teal/… + the font) are set at
// runtime by settingsCssVars from the active theme + settings, and many resolve through
// color-mix()/var() — which the export doc + html2canvas can't evaluate. So we resolve each
// to a literal rgb()/hex by applying it to a probe element and reading the computed color.
// Headless callers never reach this (they keep DEFAULT_PALETTE).
//
// The probe alone is NOT enough: Chrome serializes the computed value of a color-mix that
// carries alpha (every `color-mix(… X%, transparent)` var — --border/--faint/--panel/…) as
// a CSS Color 4 `color(srgb r g b / a)` function, which html2canvas can't parse either
// ("Attempting to parse an unsupported color function 'color'"). So every probed value is
// additionally normalized to rgb()/rgba() via cssColor.normalizeCssColor.
import { DEFAULT_PALETTE } from './exportTheme'
import { normalizeCssColor } from './cssColor'
import { PALETTE_TOKENS } from '../ui/palette'
import type { ExportTheme, ThemePalette, TypeScale, PaletteToken } from './types'

const TOKENS: PaletteToken[] = [...PALETTE_TOKENS]

/**
 * Resolve the current app theme to a palette. `scheme === "dark"` mirrors the app's actual
 * chrome (bg/fg/border read live); `scheme === "light"` keeps the live accent/category
 * tokens + font but swaps in light "paper" chrome (a print-friendly variant).
 */
export function readThemePalette(scheme: ExportTheme): ThemePalette {
    if (
        typeof document === 'undefined' ||
        typeof getComputedStyle === 'undefined'
    ) {
        return DEFAULT_PALETTE[scheme]
    }
    try {
        const probe = document.createElement('span')
        probe.style.cssText =
            'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0'
        document.body.appendChild(probe)
        const fallback = DEFAULT_PALETTE[scheme]
        // Resolve a CSS color expression (var()/color-mix/hex) to a literal rgb()/rgba() the
        // rasterizer can parse. The probe's computed color may still be a `color(srgb …)`
        // serialization (see header comment) — normalizeCssColor converts it; when even that
        // fails, the given palette default wins so an export never carries an unsafe color.
        const lit = (expr: string, dflt: string): string => {
            probe.style.color = ''
            probe.style.color = expr
            return normalizeCssColor(
                getComputedStyle(probe).color || expr,
                dflt,
            )
        }

        const tokens = Object.fromEntries(
            TOKENS.map(t => [t, lit(`var(--${t})`, fallback.tokens[t])]),
        ) as Record<PaletteToken, string>
        // --ui-font-stack, NOT getComputedStyle(document.body).fontFamily. Nothing sets a
        // font-family on <body> — App.css puts the app's `font:` shorthand on .app-shell and
        // .layout — so reading the body resolved to the browser default (Times on macOS), and
        // every base/calendar/sheet export has been rendering in Times rather than the app's
        // Monaspace. Verified live off the running app: bodyFontFamily === "Times".
        const rootCs = getComputedStyle(document.documentElement)
        const font =
            rootCs.getPropertyValue('--ui-font-stack').trim() ||
            getComputedStyle(document.body).fontFamily ||
            DEFAULT_PALETTE[scheme].font

        // The typography the app is CURRENTLY showing. --prose-font is a plain custom property
        // (styles/tokens.css), so :root's computed value is already the literal stack.
        const dp = DEFAULT_PALETTE[scheme]
        const proseFont =
            rootCs.getPropertyValue('--prose-font').trim() || dp.proseFont
        // --editor-font, not --ui-font-stack: the mono face everything outside prose returns to.
        const monoFont =
            rootCs.getPropertyValue('--editor-font').trim() || dp.monoFont
        // Leading as a RATIO of the type, read back from the app's own declaration rather than
        // recomputed from its parts. editor.lineHeight is a multiple of the 18px row unit, so the
        // raw setting means nothing at the export's font size — only the ratio transfers. Putting
        // the identical calc() on the probe is what keeps this from drifting when the app's
        // expression changes.
        probe.style.fontSize = 'var(--prose-font-size)'
        probe.style.lineHeight =
            'calc(var(--row-h, 18px) * var(--prose-line-height, 1))'
        const probed = getComputedStyle(probe)
        const probedSize = parseFloat(probed.fontSize)
        const probedLeading = parseFloat(probed.lineHeight)
        const proseLeading =
            probedSize > 0 && probedLeading > 0
                ? probedLeading / probedSize
                : dp.proseLeading

        // The app's NOTE TYPE SCALE. Numeric steps are resolved through a real property, because
        // getPropertyValue on a custom property returns its SPECIFIED text — custom properties are
        // substituted, not computed — so `--fs-title` could read back as a var() or calc() chain
        // rather than a number. Assigning it to fontSize and reading the computed value back is
        // what evaluates it, the same technique proseLeading above relies on.
        const px = (expr: string, dflt: number): number => {
            probe.style.fontSize = ''
            probe.style.fontSize = expr
            const v = parseFloat(getComputedStyle(probe).fontSize)
            return v > 0 ? v : dflt
        }
        const weight = (expr: string, dflt: number): number => {
            probe.style.fontWeight = ''
            probe.style.fontWeight = expr
            const v = parseFloat(getComputedStyle(probe).fontWeight)
            return v > 0 ? v : dflt
        }
        // TRACKING IS READ AS TEXT, NOT RESOLVED. --ls-label is `.06em`, and an em resolves
        // against the element's OWN font size — so putting it on the probe resolves it against
        // whatever size the probe happens to be at, not the size the heading will render at. The
        // first version of this did exactly that and emitted `letter-spacing: 6px` on h5/h6 (the
        // probe was still pinned at the 100px the lh-tight read left behind), roughly 7x the app's
        // real tracking and frozen regardless of font size. Passing the em through keeps it
        // relative to each heading, which is what the app does.
        const text = (name: string, dflt: string): string =>
            rootCs.getPropertyValue(name).trim() || dflt
        const dt = dp.type
        const type: TypeScale = {
            stepDisplayPx: px('var(--fs-display)', dt.stepDisplayPx),
            stepTitlePx: px('var(--fs-title)', dt.stepTitlePx),
            stepBodyPx: px('var(--fs-body)', dt.stepBodyPx),
            headingWeight: [1, 2, 3, 4, 5, 6].map((n, i) =>
                weight(`var(--fw-h${n})`, dt.headingWeight[i]),
            ) as TypeScale['headingWeight'],
            // A bare ratio, so read it back against a known size — then put the probe's font size
            // BACK, since later reads would otherwise inherit this one's 100px.
            lhTight: (() => {
                const before = probe.style.fontSize
                probe.style.fontSize = '100px'
                probe.style.lineHeight = 'var(--lh-tight)'
                const lh = parseFloat(getComputedStyle(probe).lineHeight)
                probe.style.lineHeight = ''
                probe.style.fontSize = before
                return lh > 0 ? lh / 100 : dt.lhTight
            })(),
            lsDisplay: text('--ls-display', dt.lsDisplay),
            lsLabel: text('--ls-label', dt.lsLabel),
        }

        const chrome =
            scheme === 'dark'
                ? {
                      bg: lit('var(--bg)', fallback.bg),
                      fg: lit('var(--fg)', fallback.fg),
                      muted: lit('var(--faint)', fallback.muted),
                      border: lit('var(--border)', fallback.border),
                      cell: lit('var(--panel)', fallback.cell),
                      head: lit('var(--surface-2)', fallback.head),
                  }
                : {
                      bg: fallback.bg,
                      fg: fallback.fg,
                      muted: fallback.muted,
                      border: fallback.border,
                      cell: fallback.cell,
                      head: fallback.head,
                  }

        probe.remove()
        return {
            scheme,
            ...chrome,
            accent: tokens.accent,
            tokens,
            font,
            proseFont,
            monoFont,
            proseLeading,
            type,
        }
    } catch {
        return DEFAULT_PALETTE[scheme]
    }
}
