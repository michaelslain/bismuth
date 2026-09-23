// app/src/icons/registry.ts
//
// The icon registry: a static NAME -> ART map. Every call site still passes a canonical icon name
// (e.g. "Plus", "FileText"), so the ~100 existing call sites never change; this module resolves
// that name to real art.
//
// ONE ICON SYSTEM, drawn from ONE generated manifest. This used to hold two other systems in turn:
// 112 hand-authored 24x24 pixel-art SVG paths, then a single Nerd Font character per name (the
// codepoint table that backed it, nerdGlyphs.ts, was deleted in ds-conformance Task 8 once nothing
// — including this file, which had already dropped it — referenced the font it described). Both
// replaced wholesale rather than patched, because both eras hit the same wall: a hand-maintained per-icon
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
// to either real Phosphor art or a hand-authored custom mark (Regex, WholeWord). iconMap.ts's
// KNOWN_MISSING is where a genuine gap would be declared (and drawn as FALLBACK_ART below) — it is
// empty. registry-svg.test.ts asserts this for all 140 names, so a name that slips through
// ungenerated fails a test rather than shipping an empty button.
//
// Resolution of the 140 is entirely SYNCHRONOUS — the map is a static object built from a static
// JSON import — so chrome icons never have a pending state. The full ~1,500-icon library a PERSON
// picks from is the one lazy part; see "The full icon library" below.
//
// All name-normalization (case/separator-insensitive matching, the "…Icon" alias, the legacy
// "Li"/"Lu" vault-icon prefix) is handled by the pure, framework-free registry-core.ts.
import {
    createIconRegistry,
    type IconEntry,
    type IconRegistry,
} from './registry-core'
import { looksLikeIconName, normalizeIconKey } from './registry-core'
import { LUCIDE_ALIASES } from './lucideAliases'
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
 *  resolves nowhere — not in the 140, not in the full library, not a known Lucide alias — AND for
 *  any canonical name iconMap.ts declares a genuine gap (none today). Both cases mean the same
 *  thing to a viewer — "no real icon here" — so they share one visual: a
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
    iconRegistry.resolve(spec) ?? resolveFromLibrary(spec)

// ── The full icon library ───────────────────────────────────────────────────────────────────────
// The 140 names above are the app's own chrome, and stay static + synchronous. Everything a PERSON
// can pick — every Phosphor Regular icon, ~1,500 of them — lives in a second generated file,
// assets/icons/icon-library.json, too big (~790 KB) to import statically. iconLibrary.ts loads it
// on demand and hands it to `installIconLibrary`; until then a name outside the 140 is PENDING
// (`isPendingIconName`), not missing, so <Icon> can draw an empty box instead of flashing the
// dashed "?" for the few milliseconds the chunk takes. This half stays framework-free: the Solid
// signal that re-renders on load lives in iconLibrary.ts.

/** One row of icon-library.json: [PascalCase name, SVG body, lowercase search terms]. */
export type IconLibraryRow = [string, string, string]
export type IconLibraryJson = { icons: IconLibraryRow[] }

/** A pickable library icon. `terms` is its slug, canonical aliases and the set's own tags. `core`
 *  = it is also one of the app's own 140 (same art), which the picker lists first on open. */
export type LibraryIcon = {
    name: string
    art: IconArt
    terms: string
    core: boolean
}

let library: IconRegistry<IconArt> | null = null
let libraryIcons: LibraryIcon[] = []
/** SVG body -> library name, so a canonical name (Bot) can be shown as the icon it IS (Robot). */
let libraryNameByBody = new Map<string, string>()

const LIBRARY_VIEWBOX = '0 0 256 256'

/** Install the loaded library. Idempotent — a second call replaces the first. */
export const installIconLibrary = (json: IconLibraryJson): void => {
    const coreBodies = new Set(
        iconRegistry
            .all()
            .map(e => (e.art.kind === 'svg' ? e.art.body : ''))
            .filter(Boolean),
    )
    libraryIcons = json.icons.map(([name, body, terms]) => ({
        name,
        art: { kind: 'svg' as const, body, viewBox: LIBRARY_VIEWBOX },
        terms,
        core: coreBodies.has(body),
    }))
    library = createIconRegistry<IconArt>(
        Object.fromEntries(libraryIcons.map(i => [i.name, i.art])),
    )
    libraryNameByBody = new Map(
        libraryIcons.map(i => [(i.art as { body: string }).body, i.name]),
    )
}

export const iconLibraryInstalled = (): boolean => library !== null

/** Every library icon, alphabetical. Empty until installed. */
export const libraryIconList = (): LibraryIcon[] => libraryIcons

const aliasByKey = new Map(
    Object.entries(LUCIDE_ALIASES).map(([k, v]) => [normalizeIconKey(k), v]),
)

function resolveFromLibrary(spec: string | null | undefined): IconArt | null {
    if (!library || !spec) return null
    const direct = library.resolve(spec)
    if (direct) return direct
    // A Lucide name Phosphor spells differently (`LiMountain` -> mountains). Try the spec as given,
    // then with the Obsidian `Li`/`Lu` prefix stripped.
    const raw = spec.trim()
    const stripped = /^(?:Li|Lu)(.+)$/.exec(raw)?.[1]
    for (const candidate of stripped ? [raw, stripped] : [raw]) {
        const slug = aliasByKey.get(normalizeIconKey(candidate))
        if (slug) return library.resolve(slug)
    }
    return null
}

/** A name-shaped spec that nothing resolves YET because the library hasn't loaded — the caller
 *  should load it (iconLibrary.ts) rather than show the fallback. */
export const isPendingIconName = (spec: string | null | undefined): boolean =>
    !library && looksLikeIconName(spec) && iconRegistry.resolve(spec) === null

/** The library name `spec` draws as (`Bot` -> `Robot`, `LiHouse` -> `House`), or null. Lets the
 *  picker highlight the cell for a value that was stored under an older or canonical name. */
export const libraryNameFor = (
    spec: string | null | undefined,
): string | null => {
    const art = resolveIcon(spec)
    return art?.kind === 'svg'
        ? (libraryNameByBody.get(art.body) ?? null)
        : null
}

/** True when `spec` names a known icon (vs. an emoji / arbitrary glyph) — used by the ui/
 *  button primitives' DEV-only lint (`warnBadIcon`) to catch a literal glyph hardcoded where a
 *  semantic icon name belongs. */
export const isIconName = (spec: string | null | undefined): boolean =>
    resolveIcon(spec) !== null

/** Every canonical icon (name + art), sorted by name — the 140, not the picker's full library. */
export const allIcons = (): IconEntry<IconArt>[] => iconRegistry.all()

/** All canonical icon names, sorted — the 140 the app's own chrome uses. */
export const iconNames = (): string[] => iconRegistry.names()

/** Every nameable icon, sorted: the 140 canonical names plus the full library once installed.
 *  For autocomplete (frontmatter + `.settings` `icon:` completion). */
export const allIconNames = (): string[] => {
    const canonical = iconRegistry.names()
    if (!libraryIcons.length) return canonical
    return [...new Set([...canonical, ...libraryIcons.map(i => i.name)])].sort(
        (a, b) => a.localeCompare(b),
    )
}
