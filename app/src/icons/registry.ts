// app/src/icons/registry.ts
//
// The icon registry: a static NAME -> ART map. Every call site still passes a canonical icon name
// (e.g. "Plus", "FileText"), so the ~100 existing call sites never change; this module resolves
// that name to real art.
//
// ONE ICON SYSTEM, drawn from ONE generated manifest. This used to hold two other systems in turn:
// 112 hand-authored 24x24 pixel-art SVG paths, then a single Nerd Font character per name (still
// present in nerdGlyphs.ts, but RETIRED from this file — see that module's header). Both replaced
// wholesale rather than patched, because both eras hit the same wall: a hand-maintained per-icon
// asset (a path, a hand-picked codepoint) does not scale and does not swap cheaply. This era is
// generated: icons/iconNames.ts declares the 140 canonical names (set-independent), icons/
// iconMap.ts maps each to a Phosphor Regular identifier or a hand-authored custom mark, and
// `bun run icons:svg` (app/scripts/build-icon-svgs.ts) resolves that against @iconify-json/ph and
// writes assets/icons/icon-manifest.json — the ONLY thing this file imports for art. Swapping
// sets again is: replace iconMap.ts (or add a sibling + repoint the script), rerun the script.
// Nothing here changes.
//
// A MISSING NAME IS NOT A MISSING GLYPH. The Nerd Font era's defining trap was that an unmapped
// codepoint drew ZERO pixels in Chrome — no `.notdef`, no console warning, an invisibly empty
// button. SVG can't fail that way by accident (a bad body renders as literally nothing, which is
// just as bad), so the manifest is built to have NO such gap: every one of the 140 names resolves
// to either real Phosphor art, a hand-authored custom mark (Regex, WholeWord), or a deliberate
// "missing" declaration for the five names Phosphor genuinely has no equivalent for (ArchiveX,
// Blend, FolderInput, Map, Vote) — see iconMap.ts's KNOWN_MISSING. Those five render
// FALLBACK_ART below: a visible, unmistakable marker, never a blank box. registry.test.ts asserts
// this for all 140 names, so a name that slips through ungenerated fails a test rather than
// shipping an empty button.
//
// Resolution is entirely SYNCHRONOUS — the map is a static object built from a static JSON import,
// not ~1,700 lazily imported components — so there is no pending/placeholder state and
// `resolveIcon` returns art or null immediately.
//
// All name-normalization (case/separator-insensitive matching, the "…Icon" alias, the legacy
// "Li"/"Lu" vault-icon prefix) is handled by the pure, framework-free registry-core.ts.
import {
    createIconRegistry,
    type IconEntry,
    type IconRegistry,
} from './registry-core'
import { looksLikeIconName } from './registry-core'
import manifestJson from '../assets/icons/icon-manifest.json'

export { looksLikeIconName }

/** What a name resolves to. `glyph` stays defined (rather than being deleted along with the
 *  Nerd Font era) precisely so a future migration back to a typed-character set — or a mixed set —
 *  is a DATA change to the manifest, not a renderer refactor: Icon.tsx already branches on both
 *  members. It is unused by name resolution today; the only live `glyph` art is the raw
 *  pass-through case (an emoji or arbitrary string in a note's `icon:` frontmatter — see Icon.tsx),
 *  which was never a *named* icon in the first place. */
export type IconArt =
    | { kind: 'glyph'; text: string }
    | { kind: 'svg'; body: string; viewBox: string }

type ManifestEntry =
    | { kind: 'svg'; body: string; viewBox: string; custom?: boolean }
    | { kind: 'missing' }

type Manifest = {
    icons: Record<string, ManifestEntry>
}

const manifest = manifestJson as unknown as Manifest

/** Generic fallback: both for a value that LOOKS like an icon name (see `looksLikeIconName`) but
 *  isn't in the registry at all (e.g. a legacy icon name left in old vault frontmatter), AND for
 *  the five canonical names iconMap.ts records as a genuine gap (ArchiveX, Blend, FolderInput,
 *  Map, Vote — user 2026-08-27: "thats ok, dont worry about it. 11 'missing' icons, who cares").
 *  Both cases mean the same thing to a viewer — "no real icon here" — so they share one visual: a
 *  dashed square around a question mark. Hand-authored rather than any Phosphor icon, so it can
 *  never coincidentally collide with (and impersonate) a real one, which was a LIVE bug in the
 *  Nerd Font era (FALLBACK_GLYPH used to be `▸`, the same character as `Folder`). */
export const FALLBACK_ART: IconArt = {
    kind: 'svg',
    viewBox: '0 0 256 256',
    body:
        '<rect x="28" y="28" width="200" height="200" rx="24" fill="none" stroke="currentColor" ' +
        'stroke-width="16" stroke-dasharray="24 20"/>' +
        '<text x="128" y="172" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" ' +
        'font-size="120" font-weight="700" text-anchor="middle" fill="currentColor">?</text>',
}

const manifestArt: Record<string, IconArt> = Object.fromEntries(
    Object.entries(manifest.icons).map(([name, entry]) => [
        name,
        entry.kind === 'svg'
            ? { kind: 'svg' as const, body: entry.body, viewBox: entry.viewBox }
            : FALLBACK_ART,
    ]),
)

const iconRegistry: IconRegistry<IconArt> =
    createIconRegistry<IconArt>(manifestArt)

/**
 * Resolve an icon spec (a name in any casing, the legacy "Li"/"Lu" convention, or an emoji /
 * arbitrary glyph) to its art, or `null` when it isn't a known name — the caller (`<Icon>`)
 * then decides between the fallback and passing the raw value through as text (see
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
