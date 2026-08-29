// app/src/icons/iconMarkup.ts
// Static markup for an icon, for IMPERATIVE call sites that cannot dispose a reactive root —
// notably CodeMirror's `addToOptions` render hook, which gives no per-option teardown.
//
// This builds the markup straight from the registry rather than mounting <Icon> into a detached
// node and reading it back — reading back innerHTML would work, but duplicating Icon.tsx's own
// box-and-branch logic here (rather than round-tripping through the DOM) keeps this fast and
// keeps the box styles explicit and diffable. So the box is MIRRORED from Icon.tsx instead — see
// boxStyle, and keep the two in lockstep. Results are memoized by name+size.
import {
    resolveIcon,
    looksLikeIconName,
    FALLBACK_ART,
    type IconArt,
} from './registry'
import { escapeHtml } from '../htmlEscape'

const cache = new Map<string, string>()

/** The `<Icon>` box, as an inline style string. Mirrors Icon.tsx's boxStyle exactly — a fixed
 *  `size x size` box, no widening logic (that invariant was retired with the multi-character
 *  ASCII marks; see Icon.tsx's header). */
const boxStyle = (size: number): string =>
    `display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;` +
    `width:${size}px;height:${size}px;line-height:1`

/** Cached static markup for an icon, sized and rendered to match <Icon>. Empty string only if the
 *  name resolves to nothing (an empty spec). */
export function iconMarkup(name: string, size = 14): string {
    const key = `${name}@${size}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit

    const art: IconArt =
        resolveIcon(name) ??
        (looksLikeIconName(name)
            ? FALLBACK_ART
            : { kind: 'glyph' as const, text: name })

    const inner =
        art.kind === 'svg'
            ? // Manifest bodies are generated or hand-authored in this repo, never user-supplied
              // (see registry.ts) — trusted markup, inserted as-is, same as Icon.tsx's <svg innerHTML>.
              `<svg width="${size}" height="${size}" viewBox="${art.viewBox}" fill="currentColor" style="display:block">${art.body}</svg>`
            : escapeHtml(art.text)

    const markup = inner
        ? `<span style="${boxStyle(size)}">${inner}</span>`
        : ''
    cache.set(key, markup)
    return markup
}
