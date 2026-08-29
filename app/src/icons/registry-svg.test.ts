// app/src/icons/registry-svg.test.ts
//
// Guards registry.ts's resolution behaviour now that every icon resolves to Phosphor SVG art (or
// a deliberate fallback marker), replacing registry-glyph.test.ts — DELETED, not weakened, because
// every one of its assertions was about the retired Nerd Font system specifically:
//   - "every registry name resolves to exactly one character" pinned the single-codepoint
//     invariant that made the old multi-cell ASCII marks a bug. There is no character-count
//     invariant for SVG art at all, so the assertion has nothing left to mean.
//   - its absolute-value checks compared against `String.fromCodePoint` codepoints, which no
//     longer exist in the resolution path.
//   - its fallback-collision check compared codepoints against `NERD_GLYPHS`, which registry.ts no
//     longer imports.
// What survives is reworded below in SVG terms: absolute-value pinning, fallback distinctness,
// case-insensitive resolution, and the full-set/unique-names guarantee.
//
// The MAPPING TABLE is tested separately (iconMap.test.ts: every name covered exactly once,
// no accidental slug collisions, counts match the plan record). This file tests what registry.ts
// does with it — including the loud-failure guarantee item 8 of the migration required: every one
// of the 140 canonical names resolves to either real art or a deliberate known-missing entry,
// never to nothing.
import { test, expect } from 'bun:test'
import {
    resolveIcon,
    allIcons,
    iconNames,
    FALLBACK_ART,
    type IconArt,
} from './registry'
import { ICON_NAMES } from './iconNames'
import { KNOWN_MISSING } from './iconMap'

test('every one of the 140 canonical names resolves to real art or the deliberate fallback — never null, never empty', () => {
    // The loud-failure guarantee: a name that slipped out of the manifest, or a manifest entry with
    // an empty body, would show up here as a name resolving to null/undefined/empty markup — a
    // silent blank in the old Nerd Font sense, just achieved a different way.
    for (const name of ICON_NAMES) {
        const art = resolveIcon(name)
        expect(art, `${name} must resolve`).not.toBeNull()
        if (art!.kind === 'svg') {
            expect(
                art!.body.length,
                `${name}: svg body must not be empty`,
            ).toBeGreaterThan(0)
            expect(
                art!.viewBox,
                `${name}: svg must have a viewBox`,
            ).toBeTruthy()
        }
    }
})

test('the five genuine Phosphor gaps resolve to FALLBACK_ART specifically, not to invented art', () => {
    for (const name of KNOWN_MISSING)
        expect(resolveIcon(name)).toEqual(FALLBACK_ART)
})

test('named icons resolve to real Phosphor art, not the fallback', () => {
    for (const name of ICON_NAMES) {
        if (KNOWN_MISSING.includes(name)) continue
        expect(resolveIcon(name), name).not.toEqual(FALLBACK_ART)
    }
})

test('named icons resolve to their mapped body, not merely to something', () => {
    // Absolute expected values. Asserting only "it resolves" would restate whatever the manifest
    // happens to contain and could never fail.
    expect(resolveIcon('Plus')).toEqual({
        kind: 'svg',
        viewBox: '0 0 256 256',
        body: '<path fill="currentColor" d="M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8"/>',
    })
    expect((resolveIcon('Regex') as IconArt & { kind: 'svg' }).body).toContain(
        '.*',
    )
    expect(
        (resolveIcon('WholeWord') as IconArt & { kind: 'svg' }).body,
    ).toContain('[W]')
})

test('the fallback does NOT impersonate a real icon', () => {
    // This was a live bug in the Nerd Font era: FALLBACK_GLYPH was `▸`, the same character as
    // `Folder` — an unresolvable name rendered as a folder arrow, indistinguishable from a real
    // icon inside a tree full of real folder arrows. FALLBACK_ART is hand-authored markup that
    // cannot coincidentally equal any Phosphor body, so this can't happen the same way again — but
    // pin it directly anyway, against the two icons most likely to be confused with a generic mark.
    expect(FALLBACK_ART).not.toEqual(resolveIcon('Folder'))
    expect(FALLBACK_ART).not.toEqual(resolveIcon('CircleHelp'))
    // The fallback's own body is distinctive (dashed box + literal "?"), not blank.
    expect(FALLBACK_ART.kind).toBe('svg')
    if (FALLBACK_ART.kind === 'svg') {
        expect(FALLBACK_ART.body).toContain('?')
        expect(FALLBACK_ART.body).toContain('dasharray')
    }
})

test('an unmapped but name-shaped spec gets the fallback, and a glyph passes through as null', () => {
    // registry.resolve returns null for both cases; <Icon> is what distinguishes them. Pinning the
    // null here keeps that decision in one place instead of drifting into the component.
    expect(resolveIcon('SomeLegacyLucideName')).toBeNull()
    expect(resolveIcon('🪶')).toBeNull()
})

test('resolution is case- and separator-insensitive, and honours the legacy prefixes', () => {
    const plus = resolveIcon('Plus') as IconArt
    expect(plus).not.toBeNull()
    expect(resolveIcon('plus')).toEqual(plus)
    expect(resolveIcon('PlusIcon')).toEqual(plus)
    expect(resolveIcon('LiPlus')).toEqual(plus)
})

test('allIcons exposes the whole set with unique names, all SVG', () => {
    const all = allIcons()
    expect(new Set(all.map(e => e.name)).size).toBe(all.length)
    // Exact, not a lower bound: a regression that dropped part of the map would still satisfy
    // `> 100` while quietly emptying the icon picker of a third of its contents.
    expect(all.length).toBe(ICON_NAMES.length)
    expect(new Set(all.map(e => e.art.kind))).toEqual(new Set(['svg']))
})

test('iconNames matches the canonical 140-name list exactly', () => {
    expect([...iconNames()].sort()).toEqual([...ICON_NAMES].sort())
})
