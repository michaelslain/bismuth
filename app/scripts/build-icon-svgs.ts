// app/scripts/build-icon-svgs.ts
//
// Generates `app/src/assets/icons/icon-manifest.json` — the SVG manifest behind `<Icon>` —
// by resolving every one of icons/iconNames.ts's 140 canonical names against icons/iconMap.ts
// (name -> Phosphor slug or a hand-authored custom mark) and @iconify-json/ph's icons.json
// (~9161 icons), then writing out ONLY the names actually in use.
//
//   cd app && bun run icons:svg
//
// MIRRORS build-icon-font.ts'S SHAPE ON PURPOSE: a small, committed, hand-edited mapping resolved
// against a big upstream source into a small committed artifact nothing else regenerates by hand.
// There the big source was a downloaded font release; here it's a devDependency already in
// node_modules, so there's no network fetch — but the self-check-before-write discipline is the
// same, and for the same reason.
//
// WHY NOT IMPORT @iconify-json/ph DIRECTLY FROM registry.ts. Its icons.json is ~9161 icons worth
// of SVG path data as one JS object literal. A bundler cannot tree-shake property lookups into a
// big imported JSON blob, so importing it from app code ships every icon whether the app
// references it or not — exactly the "ship 9000 icons, not 140" outcome the plan calls out. This
// script is the ONLY place that JSON is read; everything downstream (registry.ts) sees only the
// slim, committed manifest.
//
// WHY IT SELF-CHECKS BEFORE WRITING. A typo'd slug, or an upstream rename between @iconify-json/ph
// versions, makes `data.icons[slug]` undefined. Without a check, that silently produces a missing
// manifest entry and `<Icon>` renders nothing for that name — the FONT era's exact "missing glyph
// draws zero pixels" failure mode, reintroduced in SVG form. So every `slug` entry in
// iconMap.ts is resolved and confirmed present before anything is written; the script exits
// non-zero (and writes nothing) on the first miss.
//
// WHY THE FUTURE-SWAP STORY HOLDS, LITERALLY. This script names no icon-set package anywhere in
// its own source — it reads SOURCE_PACKAGE as a plain string EXPORTED BY iconMap.ts and
// resolves the icon data + version against THAT via a dynamic `import()`, not a static `import …
// from '@iconify-json/ph/…'` specifier. So swapping sets later really is "overwrite
// iconMap.ts's entries + KNOWN_MISSING + SOURCE_PACKAGE for the new set, rerun
// `bun run icons:svg`" — one data module, one unmodified script, nothing else. iconNames.ts (the
// 140 canonical names) and registry.ts (which only ever sees the manifest's shape) do not change.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ICON_NAMES } from '../src/icons/iconNames'
import {
    ICON_MAP,
    KNOWN_MISSING,
    SOURCE_PACKAGE,
} from '../src/icons/iconMap'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..')
const OUT_DIR = join(APP, 'src', 'assets', 'icons')
const OUT_FILE = 'icon-manifest.json'

type IconifyIconData = {
    icons: Record<string, { body: string }>
    width?: number
    height?: number
}

// Dynamic, driven entirely by the mapping module's own SOURCE_PACKAGE — a genuine set swap edits
// only iconMap.ts (or its replacement), never this specifier.
const phData: unknown = (await import(`${SOURCE_PACKAGE}/icons.json`)).default
const phMeta: unknown = (await import(`${SOURCE_PACKAGE}/package.json`)).default

const PH = phData as IconifyIconData
const SRC_WIDTH = PH.width ?? 256
const SRC_HEIGHT = PH.height ?? 256

type ManifestEntry =
    | { kind: 'svg'; body: string; viewBox: string; custom?: true }
    | { kind: 'missing' }

const manifest: Record<string, ManifestEntry> = {}
const unresolvedSlugs: string[] = []

for (const name of ICON_NAMES) {
    if (KNOWN_MISSING.includes(name)) {
        manifest[name] = { kind: 'missing' }
        continue
    }
    const entry = ICON_MAP[name]
    if (!entry) {
        // A name in iconNames.ts with neither a mapping nor a KNOWN_MISSING declaration — not a
        // "genuine gap" (those are named on purpose) but an unrecorded one. Treated the same as an
        // unresolvable slug below: refuse to write rather than silently emit a hole.
        unresolvedSlugs.push(
            `${name}: no iconMap.ts entry and not in KNOWN_MISSING`,
        )
        continue
    }
    if (entry.kind === 'custom') {
        manifest[name] = {
            kind: 'svg',
            body: entry.body,
            viewBox: entry.viewBox,
            custom: true,
        }
        continue
    }
    const icon = PH.icons[entry.slug]
    if (!icon) {
        unresolvedSlugs.push(
            `${name} -> '${entry.slug}' (not in ${SOURCE_PACKAGE})`,
        )
        continue
    }
    manifest[name] = {
        kind: 'svg',
        body: icon.body,
        viewBox: `0 0 ${SRC_WIDTH} ${SRC_HEIGHT}`,
    }
}

// Names iconNames.ts declares that iconMap.ts + KNOWN_MISSING never mentioned at all (the
// inverse of the loop above — a name silently absent from BOTH tables). Caught here too so the
// manifest can never be missing a key present in iconNames.ts.
for (const name of ICON_NAMES) {
    if (!(name in manifest))
        unresolvedSlugs.push(`${name}: produced no manifest entry`)
}

if (unresolvedSlugs.length) {
    console.error(
        `\nREFUSING TO WRITE: ${unresolvedSlugs.length} name(s) did not resolve to real art, a ` +
            `custom mark, or a declared KNOWN_MISSING gap:`,
    )
    for (const s of unresolvedSlugs) console.error(`  ${s}`)
    process.exit(1)
}

const svgCount = Object.values(manifest).filter(e => e.kind === 'svg').length
const customCount = Object.values(manifest).filter(
    e => e.kind === 'svg' && e.custom,
).length
const missingCount = Object.values(manifest).filter(
    e => e.kind === 'missing',
).length

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(
    join(OUT_DIR, OUT_FILE),
    `${JSON.stringify(
        {
            $comment:
                'GENERATED by app/scripts/build-icon-svgs.ts — do not edit. canonical icon name -> ' +
                'Phosphor Regular SVG body (or a deliberate "missing" marker for a genuine gap). ' +
                'registry.ts substitutes its own hand-authored FALLBACK_ART for every "missing" entry ' +
                'here rather than baking a marker into generated output.',
            source: {
                package: SOURCE_PACKAGE,
                version: (phMeta as { version: string }).version,
                nativeGrid: `${SRC_WIDTH}x${SRC_HEIGHT}`,
            },
            counts: {
                total: ICON_NAMES.length,
                svg: svgCount,
                custom: customCount,
                missing: missingCount,
            },
            icons: manifest,
        },
        null,
        2,
    )}\n`,
)

console.log(
    `wrote src/assets/icons/${OUT_FILE}: ${ICON_NAMES.length} name(s) -> ${svgCount} svg ` +
        `(${customCount} custom) + ${missingCount} deliberate gap(s)`,
)
