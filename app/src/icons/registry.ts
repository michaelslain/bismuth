// app/src/icons/registry.ts
//
// The icon registry: a static NAME -> GLYPH map. Every call site still passes a canonical
// Lucide-style name (e.g. "Plus", "FileText"), so the ~100 existing call sites never change; this
// module resolves that name to a single Nerd Font character.
//
// ONE ICON SYSTEM, NO OTHERS. This used to hold two: 112 hand-authored 24x24 pixel-art SVG paths,
// and 19 typed characters layered over them (seven "surface glyphs" plus a set of ASCII marks like
// `[ ]`, `<<`, `.*`, `][`). Both are gone. The ASCII marks were also actively broken — a
// three-character glyph in a fixed size x size box wrapped to a second row, so the chat Stop button
// rendered as a bracket pair split by a line break. Codepoints come from ./nerdGlyphs.ts; the face
// they are drawn from is subset into app/src/assets/fonts/ by app/scripts/build-icon-font.ts.
//
// A MISSING GLYPH IS INVISIBLE, NOT BROKEN-LOOKING. Measured in Chrome: a Private Use Area
// codepoint the subset font does not contain draws ZERO pixels — no `.notdef` box, no placeholder,
// no console warning. So a name that slips out of nerdGlyphs.ts, or a codepoint that never made it
// into the subset, is a button with nothing in it. nerdGlyphs.test.ts asserts an exact name count
// and full font coverage precisely because nothing downstream would notice.
//
// Resolution is entirely SYNCHRONOUS — the map is a static literal of numbers, not ~1,700 lazily
// imported components — so there is no pending/placeholder state and `resolveIcon` returns art or
// null immediately.
//
// All name-normalization (case/separator-insensitive matching, the "…Icon" alias, the legacy
// "Li"/"Lu" vault-icon prefix) is handled by the pure, framework-free registry-core.ts.
import {
    createIconRegistry,
    type IconEntry,
    type IconRegistry,
} from './registry-core'
import { looksLikeIconName } from './registry-core'
import { NERD_GLYPHS, FALLBACK_CODEPOINT } from './nerdGlyphs'

export { looksLikeIconName }

/** What a name resolves to. A single shape now — the `pixel` variant died with the SVG paths, and
 *  keeping the discriminated union for one member would leave every consumer branching on nothing. */
export type IconArt = { kind: 'glyph'; text: string }

const asGlyph = (text: string): IconArt => ({ kind: 'glyph', text })

/** Codepoint -> character. `String.fromCodePoint` is why nerdGlyphs.ts stores NUMBERS: the astral
 *  literals would be invisible in review and undiffable in source. */
const glyphFor = (cp: number): IconArt => asGlyph(String.fromCodePoint(cp))

const manifest: Record<string, IconArt> = Object.fromEntries(
    Object.entries(NERD_GLYPHS).map(([name, cp]) => [name, glyphFor(cp)]),
)

const iconRegistry: IconRegistry<IconArt> =
    createIconRegistry<IconArt>(manifest)

/** Generic fallback for a value that LOOKS like an icon name (see `looksLikeIconName`) but isn't
 *  mapped — e.g. a legacy Lucide name left in old vault frontmatter.
 *
 *  It has its OWN glyph, deliberately. This used to be `▸`, the same character as `Folder`, so an
 *  unresolved name rendered as a folder arrow: indistinguishable from a real icon, in a tree full of
 *  real folder arrows. Given that a missing glyph draws nothing at all, the fallback is now the only
 *  thing that can make a bad name visible, so it must not impersonate a valid icon. */
export const FALLBACK_ART: IconArt = glyphFor(FALLBACK_CODEPOINT)
export const FALLBACK_GLYPH = FALLBACK_ART.text

/**
 * Resolve an icon spec (a name in any casing, the legacy "Li"/"Lu" convention, or an emoji /
 * arbitrary glyph) to its art, or `null` when it isn't a known name — the caller (`<Icon>`)
 * then decides between the fallback glyph and passing the raw value through as text (see
 * `looksLikeIconName`).
 */
export const resolveIcon = (spec: string | null | undefined): IconArt | null =>
    iconRegistry.resolve(spec)

/** True when `spec` names a known icon (vs. an emoji / arbitrary glyph) — used by the ui/
 *  button primitives' DEV-only lint (`warnBadIcon`) to catch a literal glyph hardcoded where a
 *  semantic icon name belongs. */
export const isIconName = (spec: string | null | undefined): boolean =>
    resolveIcon(spec) !== null

/** Every mapped icon (canonical name + art), sorted by name. For the icon picker. */
export const allIcons = (): IconEntry<IconArt>[] => iconRegistry.all()

/** All canonical icon names, sorted — for autocomplete suggestions (settings `icon:` completion). */
export const iconNames = (): string[] => iconRegistry.names()
